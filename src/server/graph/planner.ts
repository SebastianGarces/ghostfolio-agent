import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';

import { estimateCost, type TokenUsage } from '../agent';
import type { AgentState, AgentStateUpdate } from './state';

// ---------------------------------------------------------------------------
// Zod schema for the query plan
// ---------------------------------------------------------------------------

export const QueryIntentEnum = z.enum([
  'analysis',
  'lookup',
  'comparison',
  'general'
]);

export const QueryComplexityEnum = z.enum(['simple', 'moderate', 'complex']);
export type QueryComplexity = z.infer<typeof QueryComplexityEnum>;

export const ToolPlanSchema = z.object({
  tool: z.enum([
    'portfolio_analysis',
    'performance_report',
    'risk_assessment',
    'holdings_search',
    'market_data_lookup',
    'dividend_analysis',
    'investment_history'
  ]),
  reason: z.string().describe('Why this tool is needed for the query'),
  parameters: z
    .array(
      z.object({
        key: z.string().describe('Parameter name (e.g. range, symbol, query)'),
        value: z.string().describe('Parameter value')
      })
    )
    .describe(
      'Suggested parameters (range, symbol, filters, etc.). Empty array if none.'
    )
});

export const QueryPlanSchema = z.object({
  intent: QueryIntentEnum.describe('Primary intent classification'),
  toolPlan: z
    .array(ToolPlanSchema)
    .min(0)
    .max(3)
    .describe(
      'Ordered list of tools to call. 0-3 tools. Empty for greetings/FAQs/off-topic.'
    ),
  reasoning: z
    .string()
    .describe('Brief reasoning about the approach (1-2 sentences)'),
  complexity: z
    .enum(['simple', 'moderate', 'complex'])
    .describe(
      'Query complexity: simple (direct data retrieval), moderate (needs explanation), or complex (multi-faceted analysis)'
    )
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type QueryIntent = z.infer<typeof QueryIntentEnum>;
export type ToolPlan = z.infer<typeof ToolPlanSchema>;

// ---------------------------------------------------------------------------
// Programmatic deduplication of redundant secondary tools
// ---------------------------------------------------------------------------

/**
 * Map from primary tool → set of tools that are redundant as secondaries.
 *
 * When the primary tool already covers the data the secondary would provide,
 * the secondary is removed. This is a hard constraint the LLM cannot bypass.
 */
const REDUNDANT_SECONDARY_MAP: Record<string, Set<string>> = {
  performance_report: new Set(['portfolio_analysis']),
  risk_assessment: new Set(['portfolio_analysis']),
  // NOTE: dividend_analysis does NOT list portfolio_analysis as redundant.
  // Comparing dividend yield "across holdings" requires both tools.
  investment_history: new Set(['portfolio_analysis']),
  portfolio_analysis: new Set(['performance_report'])
};

/**
 * Removes known-redundant secondary tools from a tool plan.
 *
 * The first tool in the plan is the "primary". Any subsequent tool that
 * appears in the primary's redundancy set is removed.
 *
 * This preserves legitimate multi-tool plans (e.g., portfolio_analysis +
 * risk_assessment) since those pairs are NOT in the redundancy map.
 */
export function deduplicateToolPlan(toolPlan: ToolPlan[]): ToolPlan[] {
  if (toolPlan.length <= 1) {
    return toolPlan;
  }

  const primary = toolPlan[0];
  const redundantSet = REDUNDANT_SECONDARY_MAP[primary.tool];

  if (!redundantSet) {
    return toolPlan;
  }

  return [
    primary,
    ...toolPlan.slice(1).filter((t) => !redundantSet.has(t.tool))
  ];
}

// ---------------------------------------------------------------------------
// Planner system prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM_PROMPT = `You are a query planning assistant for a portfolio analysis tool. Analyze the user's question and create an execution plan.

═══════════════════════════════════════════════════
MOST IMPORTANT RULE: DEFAULT TO ONE TOOL.
═══════════════════════════════════════════════════
Most queries need exactly 1 tool. Only add a second tool when the user EXPLICITLY asks for two distinct data types in the same query (e.g., "allocation AND dividends", "performance AND risks"). The word "and" connecting two data domains is your signal. If in doubt between 1 or 2 tools, choose 1.

SINGLE-TOOL ROUTING (use exactly 1 tool for these):
- Allocation, holdings, positions, net worth overview → portfolio_analysis
- Performance, returns, gains/losses, P&L → performance_report
- Risk, diversification rules, X-ray → risk_assessment
- Dividends, income history → dividend_analysis
- Investment consistency, contribution streaks → investment_history
- Find/search/filter specific holdings → holdings_search
- Current market price of a ticker → market_data_lookup
- Prices for MULTIPLE tickers in one query → market_data_lookup with comma-separated symbols (e.g., symbol=TSLA,AAPL,GOOGL)
- Compare asset classes (equity vs bonds) → portfolio_analysis (has per-holding asset class data)
- Best/worst performer, ranking → portfolio_analysis (has per-holding performance)
- "How am I doing financially?" → portfolio_analysis
- "What shape is my nest egg in?" → portfolio_analysis
- "Am I on track for retirement?" → portfolio_analysis

TOOL OVERLAP — These pairs are REDUNDANT (never call both):
- portfolio_analysis ↔ performance_report: Both have net worth and investment totals. Use portfolio_analysis for holdings/allocation/per-holding data, performance_report for aggregate returns/charts.
- portfolio_analysis ↔ holdings_search: Both return holdings. Use portfolio_analysis for full picture with allocation %, holdings_search for filtered search by name/symbol.
- portfolio_analysis ↔ investment_history: portfolio_analysis has investment totals. Only add investment_history if the user specifically asks about contribution streaks/consistency.
- dividend_analysis ↔ portfolio_analysis: portfolio_analysis has a dividend total and per-holding yield. Call dividend_analysis when the user mentions "dividends" explicitly or asks about dividend income/history/amounts. EXCEPTION: when the user asks to COMPARE dividend yield ACROSS holdings, call BOTH dividend_analysis AND portfolio_analysis — dividend_analysis provides income data, portfolio_analysis provides per-holding context.
- risk_assessment ↔ portfolio_analysis: Don't add risk_assessment as supplementary context. Only call it when the user explicitly asks about risk, diversification rules, or X-ray.

EXPLICIT REQUEST OVERRIDE:
When the user explicitly names a data domain (e.g., "including dividends", "show me dividends and risk"),
ALWAYS use the dedicated tool for that domain, even if another tool has partial data.
"Including dividends" → must call dividend_analysis. "Including investment history" → must call investment_history.
"Dividend yield", "dividend income", "dividend comparison" → must call dividend_analysis.
"Dividend yield across holdings", "compare dividends across holdings" → call BOTH dividend_analysis AND portfolio_analysis.
The overlap rules above apply only when the user does NOT explicitly request a domain.

EMPTY toolPlan — return [] ONLY for:
- Pure greetings: "hi", "hello", "thanks", "bye"
- FAQs about yourself: "what can you do", "who are you"
- Completely off-topic: "what is the weather", "tell me a joke"
- Buy/sell/trade requests: "buy AAPL", "sell my shares"
- Price predictions: "what will AAPL be worth next year"

CRITICAL: If the user mentions ANYTHING about their portfolio, investments, money, finances, holdings, net worth, performance, retirement, or savings — ALWAYS call at least one tool. Vague financial questions are NOT greetings.

Available tools:
- portfolio_analysis: Holdings, allocation, accounts, net worth. Has per-holding data with assetClass labels. Best for composition questions and comparing asset classes.
- performance_report: Aggregate portfolio performance, returns, net worth chart over time. Portfolio-wide totals only. Best for overall performance questions.
- risk_assessment: X-Ray analysis with pass/fail rules. No parameters. Best for risk/diversification questions.
- holdings_search: Filter holdings by name, symbol, asset class, sub-class. Best for finding specific holdings or categories.
- market_data_lookup: Current price and profile for one or more ticker symbols. Requires a symbol parameter. For multiple symbols, pass them comma-separated in a SINGLE call (e.g., symbol=TSLA,AAPL,GOOGL). Best for general market price checks (NOT the user's position value).
- dividend_analysis: Dividend income history grouped by month or year. Best for dividend income questions.
- investment_history: Contribution history and investment consistency streaks. Best for investment pattern questions.

Rules:
- Call the MINIMUM number of tools. Usually 1 tool suffices.
- Do NOT add ANY tool as supplementary context. Each tool in your plan should be the PRIMARY answer to a distinct part of the user's question. If one tool covers the question fully, use only that tool.
- When in doubt whether to call ANY tool, call ONE tool. It is better to call one tool unnecessarily than to return an empty plan for a financial question.
- For comparing asset classes, use portfolio_analysis (one call), NOT multiple performance_report calls.
- For overall performance, use performance_report.
- For specific symbol prices, use market_data_lookup.
- For ranking or comparing INDIVIDUAL holdings (best/worst performer, which stock), use portfolio_analysis — it has per-holding performance data. Do NOT use performance_report for per-holding comparisons.
- Order tools by importance — the most critical tool first.
- Extract date ranges, symbols, and filter parameters from the query when present.
- When the user asks about "my position", "my holding", "my shares", or "how much is my X worth", use holdings_search or portfolio_analysis — these return position data (value, gain/loss, cost basis). Do NOT use market_data_lookup for position-value questions.

Complexity classification:
- 0 tools → "simple"
- 1 tool → "simple"
- 2 tools → "moderate"
- 3 tools → "complex"

EXAMPLES:
Q: "What is my portfolio allocation?" → intent: "lookup", toolPlan: [portfolio_analysis], complexity: "simple"
Q: "How is my portfolio performing?" → intent: "lookup", toolPlan: [performance_report], complexity: "simple"
Q: "What's my worst performer?" → intent: "analysis", toolPlan: [portfolio_analysis], complexity: "simple"
Q: "What is my best asset?" → intent: "analysis", toolPlan: [portfolio_analysis], complexity: "simple"
Q: "What are my risks?" → intent: "lookup", toolPlan: [risk_assessment], complexity: "simple"
Q: "How much dividend income?" → intent: "lookup", toolPlan: [dividend_analysis], complexity: "simple"
Q: "Have I been investing consistently?" → intent: "lookup", toolPlan: [investment_history], complexity: "simple"
Q: "Compare equity vs bonds" → intent: "comparison", toolPlan: [portfolio_analysis], complexity: "simple"
Q: "How does my dividend yield compare across my holdings?" → intent: "comparison", toolPlan: [dividend_analysis, portfolio_analysis], complexity: "moderate"
Q: "What's the current price of AAPL?" → intent: "lookup", toolPlan: [market_data_lookup], complexity: "simple"
Q: "Show dividends AND investment history" → intent: "lookup", toolPlan: [dividend_analysis, investment_history], complexity: "moderate"
Q: "Price of TSLA, Apple, and Google" → intent: "lookup", toolPlan: [market_data_lookup(symbol=TSLA,AAPL,GOOGL)], complexity: "simple"
Q: "Give me a full health check" → intent: "analysis", toolPlan: [portfolio_analysis, risk_assessment], complexity: "moderate"
Q: "Full health check including dividends and risk" → intent: "analysis", toolPlan: [portfolio_analysis, risk_assessment, dividend_analysis], complexity: "complex"`;

// ---------------------------------------------------------------------------
// Follow-up resolution instructions (appended only when context exists)
// ---------------------------------------------------------------------------

const FOLLOW_UP_INSTRUCTIONS = `Follow-up resolution:
- When conversation context is provided, use it to resolve ambiguous references.
- "the criterias", "those rules", "that stock", "tell me more", "expand on that" likely refer to the previous turn.
- If the previous turn used risk_assessment and user asks about "criterias"/"rules", call risk_assessment.
- If the user asks for more detail on the previous topic, re-call the same tool(s).
- Only use context for disambiguation — if the current query is self-contained, ignore it.`;

// ---------------------------------------------------------------------------
// Conversation context builder
// ---------------------------------------------------------------------------

/**
 * Builds a compact conversation context summary from the previous turn.
 * Returns `null` on the first turn (no prior history).
 */
export function buildConversationContext(
  messages: BaseMessage[]
): string | null {
  // Find the previous human message (second-to-last HumanMessage)
  const humanMessages = messages.filter((m) => m._getType() === 'human');
  if (humanMessages.length < 2) {
    return null;
  }
  const previousQuestion = humanMessages[humanMessages.length - 2];

  // Extract tool names from the query-plan SystemMessage
  const queryPlanMessage = messages.find(
    (m) => m._getType() === 'system' && m.id === 'query-plan'
  );
  let toolNames: string[] = [];
  if (queryPlanMessage) {
    const content =
      typeof queryPlanMessage.content === 'string'
        ? queryPlanMessage.content
        : '';
    const toolMatches = content.matchAll(/\d+\.\s+(\w+)/g);
    toolNames = [...toolMatches].map((m) => m[1]);
  }

  // Extract response snippet from the last AIMessage
  let responseSnippet = '';
  const lastAiMessage = [...messages]
    .reverse()
    .find((m) => m._getType() === 'ai');
  if (lastAiMessage) {
    // Prefer the title content block from additional_kwargs.contentBlocks
    const contentBlocks = (
      lastAiMessage.additional_kwargs as {
        contentBlocks?: { type: string; style?: string; value?: string }[];
      }
    )?.contentBlocks;
    if (contentBlocks) {
      const titleBlock = contentBlocks.find(
        (b) => b.type === 'text' && b.style === 'title' && b.value
      );
      if (titleBlock?.value) {
        responseSnippet = titleBlock.value;
      }
    }
    // Fall back to first 150 chars of content
    if (!responseSnippet) {
      const content =
        typeof lastAiMessage.content === 'string' ? lastAiMessage.content : '';
      responseSnippet = content.slice(0, 150);
    }
  }

  // Cap previous question at 200 chars
  const questionText =
    typeof previousQuestion.content === 'string'
      ? previousQuestion.content.slice(0, 200)
      : '';

  const lines = [`Conversation context (previous turn):`];
  lines.push(`User asked: "${questionText}"`);
  if (toolNames.length > 0) {
    lines.push(`Tools called: ${toolNames.join(', ')}`);
  }
  if (responseSnippet) {
    lines.push(`Assistant responded about: "${responseSnippet.slice(0, 150)}"`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Planner node
// ---------------------------------------------------------------------------

/**
 * Creates the planner node — a focused LLM call with structured output
 * that produces a QueryPlan before the agent begins tool execution.
 */
export function createPlannerNode(plannerLlm: Runnable, model: string) {
  return async (state: AgentState): Promise<Partial<AgentStateUpdate>> => {
    try {
      // Extract only the last human message to minimize input tokens
      const lastHumanMessage = [...state.messages]
        .reverse()
        .find((m) => m._getType() === 'human');

      // Build conversation context for follow-up resolution
      const conversationContext = buildConversationContext(state.messages);
      const systemPromptWithContext = conversationContext
        ? `${PLANNER_SYSTEM_PROMPT}\n\n${FOLLOW_UP_INSTRUCTIONS}\n\n${conversationContext}`
        : PLANNER_SYSTEM_PROMPT;

      const plannerMessages = [
        new SystemMessage({ content: systemPromptWithContext }),
        lastHumanMessage ?? new HumanMessage('Analyze my portfolio')
      ];

      const result = await plannerLlm.invoke(plannerMessages);

      // Handle both { raw, parsed } shape (includeRaw: true) and plain QueryPlan (mocks)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultAny = result as any;
      const rawPlan: QueryPlan =
        resultAny && typeof resultAny === 'object' && 'parsed' in resultAny
          ? resultAny.parsed
          : (result as QueryPlan);

      // Extract usage_metadata from the raw AIMessage when available
      let tokenUsage: TokenUsage | undefined;
      if (
        resultAny &&
        typeof resultAny === 'object' &&
        'raw' in resultAny &&
        resultAny.raw?.usage_metadata
      ) {
        const usage = resultAny.raw.usage_metadata;
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        tokenUsage = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCost: estimateCost(model, inputTokens, outputTokens)
        };
      }

      // Hard-constraint deduplication: remove known-redundant secondary tools
      const plan: QueryPlan = {
        ...rawPlan,
        toolPlan: deduplicateToolPlan(rawPlan.toolPlan)
      };

      // Format plan as a SystemMessage for the agent LLM
      const toolList = plan.toolPlan
        .map((t, i) => {
          const params =
            t.parameters && t.parameters.length > 0
              ? ` (params: ${JSON.stringify(Object.fromEntries(t.parameters.map((p) => [p.key, p.value])))})`
              : '';
          return `${i + 1}. ${t.tool}${params} — ${t.reason}`;
        })
        .join('\n');

      const planMessage = new SystemMessage({
        content: `## Query Plan\nIntent: ${plan.intent}\nReasoning: ${plan.reasoning}\n\nRecommended tool execution order:\n${toolList}\n\nFollow this plan. Call the tools in the suggested order with the suggested parameters. If data from an earlier tool changes the approach, adapt accordingly. Do NOT re-call a tool you have already called — use the results you already received.`,
        id: 'query-plan'
      });

      return {
        messages: [planMessage],
        queryPlan: plan,
        ...(tokenUsage ? { tokenUsage } : {})
      };
    } catch (error) {
      console.warn(
        'Planner failed, falling through to agent without plan:',
        error
      );
      return {};
    }
  };
}
