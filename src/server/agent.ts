import type { BaseMessage } from '@langchain/core/messages';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage
} from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { getCurrentRunTree, traceable } from 'langsmith/traceable';

import { checkpointer } from './checkpointer';
import { GhostfolioClient } from './ghostfolio-client';
import { buildAgentGraph } from './graph';
import type { ContentBlock } from './graph/content-blocks';
import { SynthesisOutputSchema } from './graph/content-blocks';
import type { QueryPlan } from './graph/planner';
import { QueryPlanSchema } from './graph/planner';
import { AgentStateAnnotation } from './graph/state';
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
import type { IGhostfolioClient } from './tools/create-tool';
import { scoreConfidence } from './verification/confidence-scoring';
import {
  SAFE_FALLBACK_RESPONSE,
  checkForLeaks
} from './verification/domain-constraints';
import type { GroundednessResult } from './verification/groundedness-scoring';
import type { HallucinationResult } from './verification/hallucination-detection';
import { checkInputForInjection } from './verification/input-guard';

export const MAX_ITERATIONS = 5;

// --- Token usage & cost estimation ---

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

/** Pricing per 1M tokens (input / output). Source: OpenAI API pricing, Feb 2026. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-5.1': { input: 1.25, output: 10.0 }
};

/** Estimate cost in USD. Unknown models fall back to gpt-4o pricing. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o'];
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

export interface AgentOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseCurrency?: string;
  language?: string;
  /** Override the Ghostfolio API client (used for testing/evals with mock data) */
  client?: IGhostfolioClient;
}

export interface AgentResponse {
  response: string;
  toolCalls: { name: string; success: boolean; data?: unknown }[];
  sessionId: string;
  runId?: string;
  tokenUsage?: TokenUsage;
  contentBlocks?: ContentBlock[] | null;
  queryPlan?: QueryPlan | null;
  verification?: {
    passed: boolean;
    violations: { rule: string; severity: string; description: string }[];
    outputValidation?: {
      passed: boolean;
      issues: { rule: string; severity: string; description: string }[];
    };
    confidence?: {
      score: number;
      level: 'high' | 'medium' | 'low';
      factors: { name: string; score: number; reason: string }[];
    };
    hallucination?: HallucinationResult;
    groundedness?: GroundednessResult;
  };
}

const _traced = traceable(
  async (
    jwt: string,
    message: string,
    sessionId: string,
    options?: AgentOptions
  ): Promise<AgentResponse> => {
    // Tag LangSmith trace with session_id for filtering
    let runId: string | undefined;
    const startTime = Date.now();
    try {
      const runTree = getCurrentRunTree();
      runTree.metadata = { ...runTree.metadata, session_id: sessionId };
      runId = runTree.id;
    } catch {
      // tracing disabled — ignore
    }

    // Layer 1: Input guard — reject obvious injection attempts before LLM call
    const inputCheck = checkInputForInjection(message);
    if (inputCheck.blocked) {
      const blockedConfidence = scoreConfidence(SAFE_FALLBACK_RESPONSE, []);
      const blockedLeakCheck = checkForLeaks(SAFE_FALLBACK_RESPONSE);
      return {
        response: SAFE_FALLBACK_RESPONSE,
        toolCalls: [],
        sessionId,
        runId,
        verification: {
          passed: false,
          violations: [
            {
              rule: 'input-guard',
              severity: 'error',
              description: inputCheck.reason ?? 'Input blocked by guard'
            },
            ...blockedLeakCheck.leaks.map((leak) => ({
              rule: 'no-internal-leaks',
              severity: 'error',
              description: `Response contains internal identifier: ${leak}`
            }))
          ],
          confidence: blockedConfidence,
          hallucination: { passed: true, issues: [] },
          groundedness: {
            accuracy: {
              score: 1.0,
              details: 'Static fallback response'
            },
            precision: {
              score: 1.0,
              details: 'Static fallback response'
            },
            groundedness: {
              score: 1.0,
              details: 'Static fallback response'
            },
            overall: 1.0
          }
        }
      };
    }

    const model = options?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o';
    const baseCurrency = options?.baseCurrency ?? 'USD';

    // Use injected client or create one with user's JWT
    const client = options?.client ?? new GhostfolioClient(jwt);

    // Create tools
    const tools = [
      createMarketDataTool(client),
      createPortfolioAnalysisTool(client),
      createPerformanceReportTool(client),
      createRiskAssessmentTool(client),
      createDividendAnalysisTool(client),
      createInvestmentHistoryTool(client),
      createHoldingsSearchTool(client)
    ];

    const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

    // Create planner LLM (structured output, deterministic, low max tokens)
    const plannerLlm = new ChatOpenAI({
      modelName: model,
      temperature: 0,
      maxTokens: 256,
      openAIApiKey: process.env.OPENAI_API_KEY
    }).withStructuredOutput(QueryPlanSchema, {
      name: 'query_plan',
      includeRaw: true
    });

    // Create synthesis LLM (structured output for content blocks)
    const synthesisLlm = new ChatOpenAI({
      modelName: model,
      temperature: 0.3,
      maxTokens: 2048,
      openAIApiKey: process.env.OPENAI_API_KEY
    }).withStructuredOutput(SynthesisOutputSchema, {
      name: 'synthesis_output',
      includeRaw: true
    });

    // Build message history — checkpointer handles history, we only send
    // system prompt (deduped by ID) + current user message
    const systemPrompt = getSystemPrompt({
      baseCurrency,
      language: options?.language
    });

    const initialMessages: BaseMessage[] = [
      new SystemMessage({ content: systemPrompt, id: 'system-prompt' }),
      new HumanMessage(message)
    ];

    // Dummy LLM for BuildGraphOptions.llm — not used in the new graph
    const dummyLlm = plannerLlm;

    // Build and invoke the LangGraph agent with checkpointer
    const graph = buildAgentGraph({
      llm: dummyLlm,
      toolsByName,
      model,
      checkpointer,
      plannerLlm,
      synthesisLlm
    });

    const finalState = await graph.invoke(
      { messages: initialMessages },
      { configurable: { thread_id: sessionId } }
    );

    // Extract results from final graph state
    const responseText = finalState.responseText;
    const toolCalls = finalState.toolCalls;
    const tokenUsage = finalState.tokenUsage;
    const verification = finalState.verification;
    const contentBlocks = finalState.contentBlocks;
    const queryPlan = finalState.queryPlan;

    // Update LangSmith trace with post-run metadata
    try {
      const runTree = getCurrentRunTree();
      runTree.metadata = {
        ...runTree.metadata,
        toolsUsed: toolCalls.map(
          (tc: { name: string; success: boolean }) => tc.name
        ),
        confidence: verification?.confidence?.score,
        latencyMs: Date.now() - startTime,
        tokenUsage
      };
    } catch {
      // tracing disabled — ignore
    }

    return {
      response: responseText,
      toolCalls,
      sessionId,
      runId,
      tokenUsage,
      contentBlocks,
      queryPlan,
      verification
    };
  },
  { name: 'ghostfolio-agent-chat', run_type: 'chain', tags: ['chat'] }
);

export async function createAndRunAgent(
  jwt: string,
  message: string,
  sessionId: string,
  options?: AgentOptions
): Promise<AgentResponse> {
  return _traced(jwt, message, sessionId, options);
}

// Export for session deletion endpoint
export async function deleteSession(sessionId: string): Promise<void> {
  await checkpointer.deleteThread(sessionId);
}

// Export for conversation history endpoint
export interface HistoryMessage {
  role: 'human' | 'ai';
  content: string;
  toolCalls?: { name: string; success: boolean; data?: unknown }[];
  contentBlocks?: ContentBlock[];
}

export async function getConversationHistory(
  sessionId: string
): Promise<HistoryMessage[]> {
  const { StateGraph, END, START } = await import('@langchain/langgraph');

  // Build a minimal graph just to read state via the checkpointer
  const minimalGraph = new StateGraph(AgentStateAnnotation)
    .addNode('noop', () => ({}))
    .addEdge(START, 'noop')
    .addEdge('noop', END)
    .compile({ checkpointer });

  const state = await minimalGraph.getState({
    configurable: { thread_id: sessionId }
  });

  if (!state?.values?.messages) {
    return [];
  }

  const messages = state.values.messages as BaseMessage[];
  const result: HistoryMessage[] = [];

  // Buffer tool messages between an AI tool-calling message and the final AI response
  let toolBuffer: { name: string; success: boolean; data?: unknown }[] = [];

  for (const m of messages) {
    const type = m._getType();

    if (type === 'human') {
      if (typeof m.content === 'string' && m.content.length > 0) {
        result.push({ role: 'human', content: m.content });
      }
    } else if (type === 'tool') {
      // Extract tool name and artifact data from ToolMessage
      const tm = m as ToolMessage;
      const name = tm.name ?? 'unknown';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const artifact = (tm as any).artifact;
      const isError =
        typeof tm.content === 'string' && tm.content.startsWith('Error:');
      toolBuffer.push({
        name,
        success: !isError,
        ...(artifact != null ? { data: artifact } : {})
      });
    } else if (type === 'ai') {
      if (typeof m.content === 'string' && m.content.length > 0) {
        // Final AI response — attach any buffered tool calls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contentBlocks = (m as any).additional_kwargs?.contentBlocks;
        const entry: HistoryMessage = {
          role: 'ai',
          content: m.content,
          ...(contentBlocks ? { contentBlocks } : {})
        };
        if (toolBuffer.length > 0) {
          entry.toolCalls = toolBuffer;
          toolBuffer = [];
        }
        result.push(entry);
      }
      // Skip AI messages with empty content (intermediate tool-calling messages)
    }
  }

  return result;
}
