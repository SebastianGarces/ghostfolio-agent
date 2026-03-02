import type { Runnable } from '@langchain/core/runnables';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

import { createExecutePlannedToolsNode } from './execute-planned-tools';
import { createVerificationNode } from './nodes';
import { createPlannerNode } from './planner';
import { AgentStateAnnotation } from './state';
import { createFastSynthesizeNode, createSynthesizeNode } from './synthesize';

export interface BuildGraphOptions {
  /** The LLM (with tools already bound). Used as fallback when no planner is available. */
  llm: Runnable;
  /** Tool instances keyed by name for direct tool execution. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolsByName: Record<string, any>;
  /** Model name for cost estimation. */
  model: string;
  /** Max agent→tool iterations (unused in fast path, kept for interface compat). */
  maxIterations?: number;
  /** Checkpoint saver for persistent memory. */
  checkpointer?: BaseCheckpointSaver;
  /** Planner LLM (structured output bound, no tools). */
  plannerLlm?: Runnable;
  /** Synthesis LLM (structured output for content blocks). */
  synthesisLlm?: Runnable;
}

/**
 * Builds the LangGraph StateGraph for the Ghostfolio agent.
 *
 * Graph topology:
 *   START → planner → executePlannedTools → [conditional]
 *     ── lookup, ≤1 tool ──→ fastSynthesize → [conditional] → verify → END
 *     ── else             ──→ synthesize     → [conditional] → verify → END
 *
 * The planner classifies intent (analysis/lookup/comparison/general).
 * Only single-tool lookups use the fast path (deterministic blocks);
 * analytical and comparison queries always go through LLM synthesis.
 */
export function buildAgentGraph(options: BuildGraphOptions) {
  const { toolsByName, model, checkpointer, plannerLlm, synthesisLlm } =
    options;

  if (!plannerLlm) {
    throw new Error('plannerLlm is required for the agent graph');
  }
  if (!synthesisLlm) {
    throw new Error('synthesisLlm is required for the agent graph');
  }

  const builder = new StateGraph(AgentStateAnnotation)
    .addNode('planner', createPlannerNode(plannerLlm, model))
    .addNode('executePlannedTools', createExecutePlannedToolsNode(toolsByName))
    .addNode('fastSynthesize', createFastSynthesizeNode())
    .addNode('synthesize', createSynthesizeNode(synthesisLlm, model))
    .addNode('verify', createVerificationNode())
    .addEdge(START, 'planner')
    .addEdge('planner', 'executePlannedTools')
    // Route to fast or full synthesis based on intent + tool count.
    // Only single-tool lookups (direct data retrieval) use deterministic blocks.
    // Analytical, comparison, and general queries always go through the LLM
    // synthesizer so it can interpret data and answer the question.
    .addConditionalEdges(
      'executePlannedTools',
      (state) => {
        const plan = state.queryPlan;
        if (!plan) return 'synthesize';
        if (plan.toolPlan.length <= 1 && plan.intent === 'lookup')
          return 'fastSynthesize';
        return 'synthesize';
      },
      { fastSynthesize: 'fastSynthesize', synthesize: 'synthesize' }
    )
    // fastSynthesize → verify or end (same pattern as synthesize)
    .addConditionalEdges(
      'fastSynthesize',
      (state) => {
        const hasToolData = (state.toolCalls ?? []).some(
          (tc) => tc.success && tc.data
        );
        if (!hasToolData) return 'end';
        return 'verify';
      },
      { verify: 'verify', end: END }
    )
    // synthesize → verify or end
    .addConditionalEdges(
      'synthesize',
      (state) => {
        const hasToolData = (state.toolCalls ?? []).some(
          (tc) => tc.success && tc.data
        );
        if (!hasToolData) return 'end';
        return 'verify';
      },
      { verify: 'verify', end: END }
    )
    .addEdge('verify', END);

  return builder.compile({ checkpointer });
}
