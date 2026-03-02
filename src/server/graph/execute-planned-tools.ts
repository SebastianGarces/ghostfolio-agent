import { AIMessage, ToolMessage } from '@langchain/core/messages';

import type { AgentState, AgentStateUpdate, ToolCallRecord } from './state';

/**
 * Executes tools directly from the planner's query plan, bypassing the agent LLM.
 *
 * Reads `state.queryPlan.toolPlan`, converts planner parameters to tool input,
 * and runs all planned tools in parallel via `Promise.all`.
 *
 * Produces:
 * - A synthetic AIMessage with `tool_calls` (required by LangGraph message protocol)
 * - ToolMessages with results (for verification compatibility)
 * - ToolCallRecords with artifacts (for widget rendering)
 */
export function createExecutePlannedToolsNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolsByName: Record<string, any>
) {
  return async (state: AgentState): Promise<Partial<AgentStateUpdate>> => {
    const plan = state.queryPlan;
    if (!plan?.toolPlan?.length) {
      // No tools planned (greeting/FAQ/general) — pass through with empty toolCalls
      return { toolCalls: [] };
    }

    // Build synthetic tool_calls for the AIMessage
    const syntheticToolCalls = plan.toolPlan.map((tp, i) => ({
      name: tp.tool,
      args: Object.fromEntries(tp.parameters.map((p) => [p.key, p.value])),
      id: `planned-tool-${i}`,
      type: 'tool_call' as const
    }));

    // AIMessage with tool_calls — required so ToolMessages have a parent to reference
    const aiMessage = new AIMessage({
      content: '',
      tool_calls: syntheticToolCalls
    });

    // Execute all planned tools in parallel
    const results = await Promise.all(
      syntheticToolCalls.map(async (tc) => {
        const toolFn = toolsByName[tc.name];

        if (!toolFn) {
          return {
            message: new ToolMessage({
              content: `Error: unknown tool "${tc.name}"`,
              tool_call_id: tc.id
            }),
            record: { name: tc.name, success: false } as ToolCallRecord
          };
        }

        try {
          const toolMessage = await toolFn.invoke({
            name: tc.name,
            args: tc.args,
            id: tc.id,
            type: 'tool_call' as const
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const artifact =
            toolMessage instanceof ToolMessage
              ? (toolMessage as any).artifact
              : undefined;

          const msg =
            toolMessage instanceof ToolMessage
              ? toolMessage
              : new ToolMessage({
                  content:
                    typeof toolMessage === 'string'
                      ? toolMessage
                      : String(toolMessage),
                  tool_call_id: tc.id
                });

          return {
            message: msg,
            record: {
              name: tc.name,
              success: true,
              data: artifact ?? undefined
            } as ToolCallRecord
          };
        } catch (error) {
          return {
            message: new ToolMessage({
              content:
                error instanceof Error
                  ? `Error: ${error.message}`
                  : 'Error: unknown error',
              tool_call_id: tc.id
            }),
            record: { name: tc.name, success: false } as ToolCallRecord
          };
        }
      })
    );

    return {
      messages: [aiMessage, ...results.map((r) => r.message)],
      toolCalls: results.map((r) => r.record)
    };
  };
}
