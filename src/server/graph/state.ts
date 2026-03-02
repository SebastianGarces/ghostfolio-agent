import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';

import type { TokenUsage } from '../agent';
import type { ConfidenceResult } from '../verification/confidence-scoring';
import type { ConstraintViolation } from '../verification/domain-constraints';
import type { GroundednessResult } from '../verification/groundedness-scoring';
import type { HallucinationResult } from '../verification/hallucination-detection';
import type { ContentBlock } from './content-blocks';
import type { QueryPlan } from './planner';

export interface ToolCallRecord {
  name: string;
  success: boolean;
  data?: unknown;
}

export interface VerificationState {
  passed: boolean;
  violations: ConstraintViolation[];
  outputValidation?: {
    passed: boolean;
    issues: { rule: string; severity: string; description: string }[];
  };
  confidence?: ConfidenceResult;
  hallucination?: HallucinationResult;
  groundedness?: GroundednessResult;
}

export const AgentStateAnnotation = Annotation.Root({
  /** Chat messages — uses LangGraph's built-in messages reducer (handles dedup by ID). */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => []
  }),

  /** Current-turn tool call tracking for widget artifact data and verification. */
  toolCalls: Annotation<ToolCallRecord[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),

  /** Accumulated token usage across all LLM invocations. */
  tokenUsage: Annotation<TokenUsage | null>({
    reducer: (_left, right) => right,
    default: () => null
  }),

  /** Final response text after verification (may include appended disclaimer). */
  responseText: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => ''
  }),

  /** Verification pipeline results. */
  verification: Annotation<VerificationState | null>({
    reducer: (_left, right) => right,
    default: () => null
  }),

  /** Loop iteration counter for the agent→tool cycle. */
  iterationCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0
  }),

  /** Query plan produced by the planner node. */
  queryPlan: Annotation<QueryPlan | null>({
    reducer: (_left, right) => right,
    default: () => null
  }),

  /** Structured content blocks produced by the synthesize node. */
  contentBlocks: Annotation<ContentBlock[] | null>({
    reducer: (_left, right) => right,
    default: () => null
  })
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
