import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { type AgentOptions, type TokenUsage, estimateCost } from './agent';
import { checkpointer } from './checkpointer';
import { GhostfolioClient } from './ghostfolio-client';
import { buildAgentGraph } from './graph';
import { QueryPlanSchema } from './graph/planner';
import { getSystemPrompt } from './system-prompt';
import {
  createDividendAnalysisTool,
  createHoldingsSearchTool,
  createInvestmentHistoryTool,
  createMarketDataTool,
  createPerformanceReportTool,
  createPortfolioAnalysisTool,
  createRiskAssessmentTool
} from './tools';
import { SAFE_FALLBACK_RESPONSE } from './verification/domain-constraints';
import { checkInputForInjection } from './verification/input-guard';

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface StreamAgentOptions extends AgentOptions {
  /** Override the planner LLM. Used for testing with fake models. */
  plannerLlm?: import('@langchain/core/runnables').Runnable;
  /** Override the synthesis LLM. Used for testing with fake models. */
  synthesisLlm?: import('@langchain/core/runnables').Runnable;
}

/**
 * Streaming agent using LangGraph's StateGraph with updates stream mode.
 *
 * Graph topology (linear):
 *   START → planner → executePlannedTools → [fastSynthesize | synthesize] → verify → END
 *
 * SSE event sequence:
 *   session → plan → tool_start → tool_end → blocks_delta* → blocks → verification → usage → done
 */
export async function* streamAgent(
  jwt: string,
  message: string,
  sessionId: string,
  options?: StreamAgentOptions
): AsyncGenerator<SSEEvent> {
  const runId = crypto.randomUUID();

  // Layer 1: Input guard — reject obvious injection attempts before LLM call
  const inputCheck = checkInputForInjection(message);
  if (inputCheck.blocked) {
    yield { event: 'session', data: { sessionId, runId } };
    yield {
      event: 'verification',
      data: {
        passed: false,
        violations: [
          {
            rule: 'input-guard',
            severity: 'error',
            description: inputCheck.reason ?? 'Input blocked by guard'
          }
        ]
      }
    };
    yield {
      event: 'usage',
      data: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      }
    };
    yield { event: 'done', data: { response: SAFE_FALLBACK_RESPONSE } };
    return;
  }

  const model = options?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o';
  const baseCurrency = options?.baseCurrency ?? 'USD';

  const client = options?.client ?? new GhostfolioClient(jwt);

  const tools = [
    createMarketDataTool(client),
    createPortfolioAnalysisTool(client),
    createPerformanceReportTool(client),
    createRiskAssessmentTool(client),
    createDividendAnalysisTool(client),
    createInvestmentHistoryTool(client),
    createHoldingsSearchTool(client)
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolsByName: Record<string, any> = Object.fromEntries(
    tools.map((t) => [t.name, t])
  );

  const systemPrompt = getSystemPrompt({
    baseCurrency,
    language: options?.language
  });

  // Checkpointer handles history — only send system prompt (deduped by ID) + current message
  const initialMessages: BaseMessage[] = [
    new SystemMessage({ content: systemPrompt, id: 'system-prompt' }),
    new HumanMessage(message)
  ];

  // Create planner LLM (structured output, deterministic, no streaming needed)
  const plannerLlm =
    options?.plannerLlm ??
    new ChatOpenAI({
      modelName: model,
      temperature: 0,
      maxTokens: 256,
      openAIApiKey: process.env.OPENAI_API_KEY
    }).withStructuredOutput(QueryPlanSchema, {
      name: 'query_plan',
      includeRaw: true
    });

  // Create synthesis LLM — raw streaming with JSON mode (no structured output)
  // so we can parse blocks incrementally for progressive typing
  const synthesisLlm =
    options?.synthesisLlm ??
    new ChatOpenAI({
      modelName: model,
      temperature: 0.1,
      maxTokens: 2048,
      openAIApiKey: process.env.OPENAI_API_KEY,
      streaming: true,
      modelKwargs: { response_format: { type: 'json_object' } }
    });

  // Dummy LLM for BuildGraphOptions.llm — not used in the new graph
  const dummyLlm = plannerLlm;

  // Build graph with checkpointer for persistent memory
  const graph = buildAgentGraph({
    llm: dummyLlm,
    toolsByName,
    model,
    checkpointer,
    plannerLlm,
    synthesisLlm
  });

  // Emit session event with runId so the widget can link feedback
  yield { event: 'session', data: { sessionId, runId } };

  // Stream using LangGraph's multi-mode: "updates" for node completions +
  // "custom" for blocks_delta events emitted via getWriter() inside nodes.
  const stream = await graph.stream(
    { messages: initialMessages },
    {
      configurable: { thread_id: sessionId },
      streamMode: ['updates', 'custom'] as const,
      runId,
      metadata: { session_id: sessionId }
    }
  );

  const toolCalls: { name: string; success: boolean; data?: unknown }[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokensAccum = 0;
  let finalResponseText = '';
  let verificationData: Record<string, unknown> | null = null;

  for await (const chunk of stream) {
    // With multi-mode streamMode (array), chunks are [mode, payload] tuples
    const [mode, data] = chunk as unknown as [string, unknown];

    // Handle custom stream events (e.g. blocks_delta from synthesize node)
    if (mode === 'custom') {
      const customData = data as { type: string; blocks?: unknown[] };
      if (customData.type === 'blocks_delta' && customData.blocks) {
        yield {
          event: 'blocks_delta',
          data: { blocks: customData.blocks }
        };
      }
      continue;
    }

    // mode === 'updates' — existing node completion handling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeUpdates = data as Record<string, any>;

    // Planner node completed — emit plan event and capture planner tokens
    if (nodeUpdates.planner) {
      const planUpdate = nodeUpdates.planner;
      if (planUpdate.queryPlan) {
        yield {
          event: 'plan',
          data: planUpdate.queryPlan as Record<string, unknown>
        };
      }
      if (planUpdate.tokenUsage) {
        totalInputTokens += planUpdate.tokenUsage.inputTokens ?? 0;
        totalOutputTokens += planUpdate.tokenUsage.outputTokens ?? 0;
        totalTokensAccum += planUpdate.tokenUsage.totalTokens ?? 0;
      }
    }

    // executePlannedTools node completed — emit tool_start/tool_end events
    if (nodeUpdates.executePlannedTools) {
      const toolUpdate = nodeUpdates.executePlannedTools;
      const newToolCalls = toolUpdate.toolCalls ?? [];

      for (let j = 0; j < newToolCalls.length; j++) {
        const tc = newToolCalls[j];
        yield {
          event: 'tool_start',
          data: { name: tc.name, index: j }
        };
        yield {
          event: 'tool_end',
          data: {
            name: tc.name,
            index: j,
            success: tc.success,
            ...(tc.data !== undefined ? { data: tc.data } : {})
          }
        };
        toolCalls.push(tc);
      }
    }

    // Synthesize node completed — emit blocks event
    if (nodeUpdates.synthesize) {
      const synthUpdate = nodeUpdates.synthesize;

      if (synthUpdate.contentBlocks) {
        yield {
          event: 'blocks',
          data: { blocks: synthUpdate.contentBlocks }
        };
      }

      // Capture token usage from synthesis
      if (synthUpdate.tokenUsage) {
        totalInputTokens = synthUpdate.tokenUsage.inputTokens ?? 0;
        totalOutputTokens = synthUpdate.tokenUsage.outputTokens ?? 0;
        totalTokensAccum = synthUpdate.tokenUsage.totalTokens ?? 0;
      }

      // If synthesize handled verification (greeting path), capture it
      if (synthUpdate.verification) {
        finalResponseText = synthUpdate.responseText ?? '';
        verificationData = synthUpdate.verification ?? null;
      }

      // Capture responseText from synthesize
      if (synthUpdate.responseText) {
        finalResponseText = synthUpdate.responseText;
      }
    }

    // Fast-path synthesize node completed — same handling as synthesize
    if (nodeUpdates.fastSynthesize) {
      const fastUpdate = nodeUpdates.fastSynthesize;

      if (fastUpdate.contentBlocks) {
        yield {
          event: 'blocks',
          data: { blocks: fastUpdate.contentBlocks }
        };
      }

      if (fastUpdate.tokenUsage) {
        totalInputTokens = fastUpdate.tokenUsage.inputTokens ?? 0;
        totalOutputTokens = fastUpdate.tokenUsage.outputTokens ?? 0;
        totalTokensAccum = fastUpdate.tokenUsage.totalTokens ?? 0;
      }

      if (fastUpdate.verification) {
        finalResponseText = fastUpdate.responseText ?? '';
        verificationData = fastUpdate.verification ?? null;
      }

      if (fastUpdate.responseText) {
        finalResponseText = fastUpdate.responseText;
      }
    }

    // Verification node completed
    if (nodeUpdates.verify) {
      const vUpdate = nodeUpdates.verify;
      finalResponseText = vUpdate.responseText ?? '';
      verificationData = vUpdate.verification ?? null;

      // Re-emit blocks with disclosure caption appended by verification
      if (vUpdate.contentBlocks) {
        yield {
          event: 'blocks',
          data: { blocks: vUpdate.contentBlocks }
        };
      }
    }
  }

  // Build token usage
  const tokenUsage: TokenUsage = {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalTokensAccum || totalInputTokens + totalOutputTokens,
    estimatedCost: estimateCost(model, totalInputTokens, totalOutputTokens)
  };

  // Emit verification event
  if (verificationData) {
    yield {
      event: 'verification',
      data: verificationData as Record<string, unknown>
    };

    // If verification failed, emit correction to replace streamed content
    if (verificationData.passed === false) {
      finalResponseText = SAFE_FALLBACK_RESPONSE;
      yield {
        event: 'correction',
        data: { response: SAFE_FALLBACK_RESPONSE }
      };
    }
  }

  yield {
    event: 'usage',
    data: tokenUsage as unknown as Record<string, unknown>
  };

  yield {
    event: 'done',
    data: { response: finalResponseText }
  };
}
