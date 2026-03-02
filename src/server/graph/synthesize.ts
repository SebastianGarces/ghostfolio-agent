import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import { getWriter } from '@langchain/langgraph';

import { estimateCost, type TokenUsage } from '../agent';
import { scoreConfidence } from '../verification/confidence-scoring';
import { checkForLeaks } from '../verification/domain-constraints';
import { condenseArtifacts } from './condense-artifacts';
import {
  ContentBlockSchema,
  SynthesisOutputSchema,
  type ContentBlock,
  type SynthesisOutput,
  blocksToText
} from './content-blocks';
import type { AgentState, AgentStateUpdate } from './state';

/**
 * Attempt to parse a partial JSON string. Tries progressively more aggressive
 * repairs (closing brackets/braces) so we can extract blocks from an
 * incomplete LLM response stream.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePartialJson(text: string): any | null {
  // Try parsing as-is first
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  // Try closing the JSON with various bracket/brace combinations
  const closers = ['}', ']}', '"]}', '"}]}', 'null}]}', '""]}'];
  for (const closer of closers) {
    try {
      return JSON.parse(text + closer);
    } catch {
      // fall through
    }
  }

  return null;
}

/** Helper to create a ContentBlock with all defaults filled in by Zod. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function block(partial: Record<string, any>): ContentBlock {
  return ContentBlockSchema.parse(partial);
}

// ---------------------------------------------------------------------------
// Synthesis system prompt
// ---------------------------------------------------------------------------

const SYNTHESIS_PROMPT = `You are a portfolio assistant generating structured content blocks. Return a JSON object with a "blocks" array.

Each block is a flat object with a "type" field. Set fields relevant to the type, and set all other fields to null.

Block types and their relevant fields:

TEXT: { type: "text", style: "paragraph"|"title"|"subtitle"|"caption", value: "..." }
METRIC: { type: "metric", label: "Net Worth", value: "$100,000", format: "currency"|"percentage"|null, sentiment: "positive"|"negative"|"neutral"|null }
METRIC_ROW: { type: "metric_row", metrics: [{ label: "...", value: "...", format: null, sentiment: null }, ...] } — 2-4 metrics side by side
LIST: { type: "list", items: ["...", "..."] }
SYMBOL: { type: "symbol", symbol: "AAPL", name: "Apple Inc." }

DATA-REFERENCE (widget renders actual data from tools):
HOLDINGS_TABLE: { type: "holdings_table", source: "portfolio_analysis"|"holdings_search", maxRows: 5 }
PIE_CHART: { type: "pie_chart", source: "portfolio_analysis" }
BAR_CHART: { type: "bar_chart", source: "dividend_analysis"|"investment_history" }
AREA_CHART: { type: "area_chart", source: "performance_report" }
RULE_STATUS: { type: "rule_status", source: "risk_assessment" }

RULES:
- ALWAYS lead with a text block (style "title") summarizing the answer, then a text block (style "paragraph") explaining the insight or analysis. Metrics and charts SUPPORT the text — they are not the entire response.
- A good response answers WHY, not just WHAT. "Your best asset is GOOG — it has the highest performance at 231.5%, driven by strong price appreciation since your initial purchase" is better than just showing a metric card.
- For analytical questions: title → paragraph with insight → 1-3 metrics highlighting key numbers → optional chart/table if warranted.
- For simple lookups: title → 1-2 metrics. A paragraph is optional for very short answers.
- Each tool has a corresponding data-reference block. The mapping is:
  - portfolio_analysis → holdings_table
  - risk_assessment → rule_status
  - dividend_analysis → bar_chart (source: dividend_analysis)
  - investment_history → bar_chart (source: investment_history)
  - performance_report → area_chart (source: performance_report)
- ALWAYS include the data-reference block when the user explicitly asked for that kind of data (e.g. "table of holdings" → holdings_table, "risk" → rule_status, "dividends" → bar_chart).
- When a tool was called as supplementary context (not directly requested), you MAY omit its data-reference block if the key insight is already captured in a metric or text block. When in doubt, include it.
- Do NOT include data-reference blocks for tools that were NOT called.
- Use metric blocks to highlight key numbers. Include symbols, percentages, and specific values.
- Data-reference blocks MUST reference a tool that was actually called. Only use sources from the tool data provided.
- For greetings/general questions with no tool data, return only text blocks.
- Keep responses concise. 2-8 blocks is typical. Max 20.
- Use specific numbers from the data. Never fabricate values.
- Do NOT add disclaimers — those are added automatically.`;

// ---------------------------------------------------------------------------
// Synthesize node
// ---------------------------------------------------------------------------

/**
 * Creates the synthesize node — streams raw JSON tokens from the LLM,
 * parses blocks incrementally, and emits `blocks_delta` events so the
 * widget can display content progressively (ChatGPT-style typing).
 *
 * Also handles greetings/FAQs (no tool data) by producing text-only blocks.
 */
export function createSynthesizeNode(synthesisLlm: Runnable, model: string) {
  return async (state: AgentState): Promise<Partial<AgentStateUpdate>> => {
    const toolCalls = state.toolCalls ?? [];
    const successfulCalls = toolCalls.filter((tc) => tc.success && tc.data);

    // Extract user's question from the last human message
    const lastHuman = [...state.messages]
      .reverse()
      .find((m) => m._getType() === 'human');
    const question =
      typeof lastHuman?.content === 'string'
        ? lastHuman.content
        : 'Analyze my portfolio';

    // Build prompt
    let dataSection: string;
    if (successfulCalls.length > 0) {
      dataSection = `Tool data:\n${condenseArtifacts(toolCalls)}\n\nAvailable tool sources: ${successfulCalls.map((tc) => tc.name).join(', ')}`;
    } else {
      dataSection =
        'No tool data available. This is a greeting, FAQ, or general question. Respond with text blocks only.';
    }

    const prompt = `${SYNTHESIS_PROMPT}

User question: ${question}

${dataSection}`;

    // Get writer for emitting streaming deltas.
    // getWriter() throws when called outside a LangGraph context (e.g. unit tests),
    // so we guard with try-catch and treat undefined/error as a no-op.
    let writer: ((chunk: unknown) => void) | undefined;
    try {
      writer = getWriter();
    } catch {
      // Not running inside a LangGraph graph — skip delta emission
    }

    let blocks: ContentBlock[];
    let tokenUsage: TokenUsage;

    try {
      // Stream raw JSON tokens and parse blocks incrementally
      const stream = await synthesisLlm.stream([new HumanMessage(prompt)]);
      let buffer = '';
      let lastEmittedJson = '';
      let lastStreamedBlocks: ContentBlock[] = [];

      // Track usage_metadata from final stream chunk (OpenAI sends it on the last chunk)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let streamUsageMeta: any = null;

      for await (const chunk of stream) {
        // Handle { raw, parsed } shape from includeRaw: true, or plain chunk
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunkAny = chunk as any;
        const actualChunk =
          chunkAny && typeof chunkAny === 'object' && 'raw' in chunkAny
            ? chunkAny.raw
            : chunk;

        // Capture usage_metadata if present (OpenAI includes it on the final chunk)
        if (actualChunk?.usage_metadata) {
          streamUsageMeta = actualChunk.usage_metadata;
        }

        // Extract text content from the chunk
        const content =
          typeof actualChunk.content === 'string'
            ? actualChunk.content
            : typeof actualChunk === 'string'
              ? actualChunk
              : '';
        buffer += content;

        // Try to parse partial JSON to extract blocks
        const parsed = parsePartialJson(buffer);
        if (!parsed?.blocks || !Array.isArray(parsed.blocks)) continue;

        // Parse whatever blocks are complete or in-progress
        const currentBlocks: ContentBlock[] = [];
        for (const raw of parsed.blocks) {
          const result = ContentBlockSchema.safeParse(raw);
          if (result.success) currentBlocks.push(result.data);
        }

        if (currentBlocks.length === 0) continue;

        // Only emit if blocks changed
        const currentJson = JSON.stringify(currentBlocks);
        if (currentJson !== lastEmittedJson) {
          lastEmittedJson = currentJson;
          lastStreamedBlocks = currentBlocks;
          if (writer) {
            writer({ type: 'blocks_delta', blocks: currentBlocks });
          }
        }
      }

      // Final validation of the complete JSON — 3-tier fallback:
      // 1. Fully validated final parse (ideal)
      // 2. Individually validated blocks from streaming (preserves LLM response)
      // 3. Deterministic fallback from tool data (last resort)
      const finalParsed = parsePartialJson(buffer);
      if (finalParsed?.blocks) {
        const result = SynthesisOutputSchema.safeParse(finalParsed);
        if (result.success) {
          blocks = result.data.blocks;
        } else if (lastStreamedBlocks.length > 0) {
          blocks = lastStreamedBlocks;
        } else {
          blocks = buildFallbackBlocks(successfulCalls, question);
        }
      } else if (lastStreamedBlocks.length > 0) {
        blocks = lastStreamedBlocks;
      } else {
        blocks = buildFallbackBlocks(successfulCalls, question);
      }

      // Accumulate token usage: planner tokens (from state) + synthesis tokens
      const prev = state.tokenUsage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      };

      // Prefer real usage_metadata from stream; fall back to buffer length estimate
      const synthInputTokens = streamUsageMeta?.input_tokens ?? 0;
      const synthOutputTokens =
        streamUsageMeta?.output_tokens ?? Math.ceil(buffer.length / 4);

      const inputTokens = prev.inputTokens + synthInputTokens;
      const outputTokens = prev.outputTokens + synthOutputTokens;
      const totalTokens = inputTokens + outputTokens;

      tokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost: estimateCost(model, inputTokens, outputTokens)
      };
    } catch (error) {
      console.warn(
        'Synthesis LLM failed, using deterministic fallback:',
        error
      );

      // Deterministic fallback: generate minimal blocks from tool data
      blocks = buildFallbackBlocks(successfulCalls, question);

      tokenUsage = state.tokenUsage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      };
    }

    const responseText = blocksToText(blocks);

    // For no-tool responses (greetings), run lightweight verification
    if (successfulCalls.length === 0) {
      const confidence = scoreConfidence(responseText, []);
      const leakCheck = checkForLeaks(responseText);

      return {
        messages: [
          new AIMessage({
            content: responseText,
            additional_kwargs: { contentBlocks: blocks }
          })
        ],
        contentBlocks: blocks,
        responseText,
        tokenUsage,
        verification: {
          passed: leakCheck.passed,
          violations: leakCheck.leaks.map((leak) => ({
            rule: 'no-internal-leaks',
            severity: 'error' as const,
            description: `Response contains internal identifier: ${leak}`
          })),
          confidence,
          hallucination: { passed: true, issues: [] },
          groundedness: {
            accuracy: {
              score: 1.0,
              details: 'No tool data to verify against'
            },
            precision: {
              score: 1.0,
              details: 'No tool data to verify against'
            },
            groundedness: {
              score: 1.0,
              details: 'No tool data to verify against'
            },
            overall: 1.0
          }
        }
      };
    }

    return {
      contentBlocks: blocks,
      responseText,
      tokenUsage
    };
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback when LLM fails
// ---------------------------------------------------------------------------

const QUERY_TITLE_PATTERNS: [RegExp, string][] = [
  [/\ballocation\b/i, 'Portfolio Allocation'],
  [/\bconcentrat/i, 'Concentration Analysis'],
  [/\bequity\b.*\bbond\b|\bbond\b.*\bequity\b/i, 'Equity vs Bond Comparison'],
  [/\bcompar/i, 'Portfolio Comparison'],
  [/\bdiversif/i, 'Diversification Analysis'],
  [/\bstreak/i, 'Investment Streak'],
  [/\bconsisten/i, 'Investment Consistency']
];

const TOOL_TITLES: Record<string, string> = {
  portfolio_analysis: 'Portfolio Overview',
  performance_report: 'Performance Summary',
  risk_assessment: 'Risk Assessment',
  market_data_lookup: 'Market Data',
  dividend_analysis: 'Dividend Summary',
  investment_history: 'Investment History',
  holdings_search: 'Holdings Search Results'
};

function generateFallbackTitle(
  toolCalls: { name: string; success: boolean; data?: unknown }[],
  question: string
): string {
  for (const [pattern, title] of QUERY_TITLE_PATTERNS) {
    if (pattern.test(question)) return title;
  }
  const successfulNames = toolCalls
    .filter((tc) => tc.success && tc.data)
    .map((tc) => tc.name);
  if (successfulNames.length === 1) {
    return TOOL_TITLES[successfulNames[0]] ?? 'Portfolio Analysis';
  }
  return 'Portfolio Analysis';
}

export function buildFallbackBlocks(
  toolCalls: { name: string; success: boolean; data?: unknown }[],
  question: string
): ContentBlock[] {
  if (toolCalls.length === 0) {
    return [
      block({
        type: 'text',
        style: 'paragraph',
        value:
          "Hello! I'm your Ghostfolio portfolio assistant. You can ask me about your holdings, performance, risk analysis, dividends, and more."
      })
    ];
  }

  const blocks: ContentBlock[] = [
    block({
      type: 'text',
      style: 'title',
      value: generateFallbackTitle(toolCalls, question)
    })
  ];

  for (const tc of toolCalls) {
    if (!tc.success || !tc.data) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = tc.data as any;

    switch (tc.name) {
      case 'portfolio_analysis': {
        const summary = d.summary;
        if (summary) {
          const metrics = [
            {
              label: 'Net Worth',
              value: String(summary.currentNetWorth),
              format: 'currency',
              sentiment: null
            }
          ];
          if (summary.totalInvestment != null) {
            metrics.push({
              label: 'Total Invested',
              value: String(summary.totalInvestment),
              format: 'currency',
              sentiment: null
            });
          }
          if (summary.netPerformancePercent != null) {
            const pct = (summary.netPerformancePercent * 100).toFixed(1);
            metrics.push({
              label: 'Performance',
              value: `${pct}%`,
              format: 'percentage',
              sentiment:
                summary.netPerformancePercent >= 0 ? 'positive' : 'negative'
            });
          }
          if (metrics.length >= 2) {
            blocks.push(block({ type: 'metric_row', metrics }));
          } else {
            blocks.push(block({ type: 'metric', ...metrics[0] }));
          }
        }
        // Add top holdings as list
        const holdings = d.holdings ?? [];
        if (holdings.length > 0) {
          const topItems = holdings
            .slice(0, 5)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((h: any) => {
              const alloc =
                h.allocation > 0
                  ? ` (${(h.allocation * 100).toFixed(1)}%)`
                  : '';
              return `${h.symbol} — ${h.name}${alloc}`;
            });
          blocks.push(block({ type: 'list', items: topItems }));
        }
        blocks.push(
          block({ type: 'holdings_table', source: 'portfolio_analysis' })
        );
        break;
      }

      case 'performance_report': {
        const m = d.metrics;
        if (m) {
          const metrics = [
            {
              label: 'Net Worth',
              value: String(m.currentNetWorth),
              format: 'currency',
              sentiment: null
            }
          ];
          if (m.netPerformance != null) {
            metrics.push({
              label: 'Net Performance',
              value: String(m.netPerformance),
              format: 'currency',
              sentiment: m.netPerformance >= 0 ? 'positive' : 'negative'
            });
          }
          if (metrics.length >= 2) {
            blocks.push(block({ type: 'metric_row', metrics }));
          } else {
            blocks.push(block({ type: 'metric', ...metrics[0] }));
          }
        }
        blocks.push(
          block({ type: 'area_chart', source: 'performance_report' })
        );
        break;
      }

      case 'risk_assessment': {
        const stats = d.statistics;
        if (stats) {
          blocks.push(
            block({
              type: 'text',
              style: 'paragraph',
              value: `Risk assessment: ${stats.rulesPassed}/${stats.rulesTotal} rules passed.`
            })
          );
        }
        blocks.push(block({ type: 'rule_status', source: 'risk_assessment' }));
        break;
      }

      case 'dividend_analysis': {
        if (d.totalDividends != null) {
          blocks.push(
            block({
              type: 'metric',
              label: 'Total Dividends',
              value: String(d.totalDividends),
              format: 'currency'
            })
          );
        }
        blocks.push(block({ type: 'bar_chart', source: 'dividend_analysis' }));
        break;
      }

      case 'investment_history': {
        if (d.totalInvested != null) {
          blocks.push(
            block({
              type: 'metric',
              label: 'Total Invested',
              value: String(d.totalInvested),
              format: 'currency'
            })
          );
        }
        if (d.streaks) {
          const streakMetrics: {
            label: string;
            value: string;
            format: null;
            sentiment: null;
          }[] = [];
          if (d.streaks.current != null) {
            streakMetrics.push({
              label: 'Current Streak',
              value: `${d.streaks.current} months`,
              format: null,
              sentiment: null
            });
          }
          if (d.streaks.longest != null) {
            streakMetrics.push({
              label: 'Longest Streak',
              value: `${d.streaks.longest} months`,
              format: null,
              sentiment: null
            });
          }
          if (streakMetrics.length >= 2) {
            blocks.push(block({ type: 'metric_row', metrics: streakMetrics }));
          } else if (streakMetrics.length === 1) {
            blocks.push(block({ type: 'metric', ...streakMetrics[0] }));
          }
        }
        blocks.push(block({ type: 'bar_chart', source: 'investment_history' }));
        break;
      }

      case 'holdings_search': {
        const searchHoldings = d.holdings ?? [];
        if (searchHoldings.length > 0) {
          const items = searchHoldings
            .slice(0, 8)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((h: any) => {
              const alloc =
                h.allocation > 0
                  ? ` (${(h.allocation * 100).toFixed(1)}%)`
                  : '';
              return `${h.symbol} — ${h.name}${alloc}`;
            });
          blocks.push(block({ type: 'list', items }));
        }
        blocks.push(
          block({ type: 'holdings_table', source: 'holdings_search' })
        );
        break;
      }

      case 'market_data_lookup':
        if (Array.isArray(d.results)) {
          // Multi-symbol response
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const r of d.results as any[]) {
            if (r.symbol) {
              blocks.push(
                block({
                  type: 'symbol',
                  symbol: r.symbol,
                  name: r.name ?? null
                })
              );
              if (r.price != null || r.marketPrice != null) {
                blocks.push(
                  block({
                    type: 'metric',
                    label: 'Price',
                    value:
                      `${r.price ?? r.marketPrice} ${r.currency ?? ''}`.trim(),
                    format: 'currency'
                  })
                );
              }
            }
          }
        } else if (d.symbol) {
          blocks.push(
            block({
              type: 'symbol',
              symbol: d.symbol,
              name: d.name ?? null
            })
          );
          if (d.price != null || d.marketPrice != null) {
            blocks.push(
              block({
                type: 'metric',
                label: 'Price',
                value: `${d.price ?? d.marketPrice} ${d.currency ?? ''}`.trim(),
                format: 'currency'
              })
            );
          }
        }
        break;
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Fast-path synthesis node (deterministic, no LLM)
// ---------------------------------------------------------------------------

/**
 * Creates the fast-path synthesize node — produces content blocks
 * deterministically from tool data without an LLM call.
 *
 * Used for "simple" queries where the data speaks for itself.
 */
export function createFastSynthesizeNode() {
  return async (state: AgentState): Promise<Partial<AgentStateUpdate>> => {
    const toolCalls = state.toolCalls ?? [];
    const successfulCalls = toolCalls.filter((tc) => tc.success && tc.data);

    // Extract user's question from the last human message
    const lastHuman = [...state.messages]
      .reverse()
      .find((m) => m._getType() === 'human');
    const question =
      typeof lastHuman?.content === 'string'
        ? lastHuman.content
        : 'Analyze my portfolio';

    let blocks: ContentBlock[];

    if (successfulCalls.length === 0) {
      // Greeting / FAQ path — deterministic text-only blocks
      blocks = buildFallbackBlocks([], question);

      const confidence = scoreConfidence(blocksToText(blocks), []);
      const leakCheck = checkForLeaks(blocksToText(blocks));

      return {
        messages: [
          new AIMessage({
            content: blocksToText(blocks),
            additional_kwargs: { contentBlocks: blocks }
          })
        ],
        contentBlocks: blocks,
        responseText: blocksToText(blocks),
        tokenUsage: state.tokenUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCost: 0
        },
        verification: {
          passed: leakCheck.passed,
          violations: leakCheck.leaks.map((leak) => ({
            rule: 'no-internal-leaks',
            severity: 'error' as const,
            description: `Response contains internal identifier: ${leak}`
          })),
          confidence,
          hallucination: { passed: true, issues: [] },
          groundedness: {
            accuracy: {
              score: 1.0,
              details: 'No tool data to verify against'
            },
            precision: {
              score: 1.0,
              details: 'No tool data to verify against'
            },
            groundedness: {
              score: 1.0,
              details: 'No tool data to verify against'
            },
            overall: 1.0
          }
        }
      };
    }

    // Build blocks deterministically from tool data
    blocks = buildFallbackBlocks(successfulCalls, question);

    // Emit a single blocks_delta event for widget streaming compatibility
    let writer: ((chunk: unknown) => void) | undefined;
    try {
      writer = getWriter();
    } catch {
      // Not running inside a LangGraph graph — skip delta emission
    }
    if (writer) {
      writer({ type: 'blocks_delta', blocks });
    }

    const responseText = blocksToText(blocks);

    return {
      contentBlocks: blocks,
      responseText,
      tokenUsage: state.tokenUsage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      }
    };
  };
}
