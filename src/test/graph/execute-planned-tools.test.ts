import {
  HumanMessage,
  SystemMessage,
  ToolMessage
} from '@langchain/core/messages';
import { describe, expect, test } from 'bun:test';

import { createExecutePlannedToolsNode } from '../../server/graph/execute-planned-tools';
import type { QueryPlan } from '../../server/graph/planner';
import type { AgentState } from '../../server/graph/state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createState(plan: QueryPlan | null): AgentState {
  return {
    messages: [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
      new HumanMessage('Test message')
    ],
    toolCalls: [],
    tokenUsage: null,
    responseText: '',
    verification: null,
    iterationCount: 0,
    queryPlan: plan,
    contentBlocks: null
  };
}

/** Creates a mock tool that returns a ToolMessage with content and artifact. */
function createMockTool(
  name: string,
  artifact: unknown,
  content = 'Tool result text'
) {
  return {
    name,
    invoke: async (input: { id: string }) =>
      new ToolMessage({
        content,
        tool_call_id: input.id,
        name,
        artifact
      })
  };
}

/** Creates a mock tool that throws an error. */
function createFailingTool(name: string, errorMessage: string) {
  return {
    name,
    invoke: async () => {
      throw new Error(errorMessage);
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createExecutePlannedToolsNode', () => {
  test('returns empty toolCalls when no query plan', async () => {
    const node = createExecutePlannedToolsNode({});
    const state = createState(null);
    const result = await node(state);
    expect(result).toEqual({ toolCalls: [] });
  });

  test('returns empty toolCalls when tool plan is empty', async () => {
    const node = createExecutePlannedToolsNode({});
    const state = createState({
      intent: 'general',
      toolPlan: [],
      reasoning: 'This is a greeting'
    });
    const result = await node(state);
    expect(result).toEqual({ toolCalls: [] });
  });

  test('executes a single tool from the plan', async () => {
    const artifact = {
      type: 'risk_assessment',
      statistics: { rulesPassed: 5, rulesTotal: 7 },
      categories: []
    };
    const toolsByName = {
      risk_assessment: createMockTool('risk_assessment', artifact)
    };

    const plan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        { tool: 'risk_assessment', reason: 'Check risks', parameters: [] }
      ],
      reasoning: 'User wants risk analysis'
    };

    const node = createExecutePlannedToolsNode(toolsByName);
    const result = await node(createState(plan));

    // Should have: 1 AIMessage (synthetic) + 1 ToolMessage
    expect(result.messages).toHaveLength(2);
    expect(result.messages![0]._getType()).toBe('ai');
    expect(result.messages![1]._getType()).toBe('tool');

    // ToolCallRecords
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('risk_assessment');
    expect(result.toolCalls![0].success).toBe(true);
    expect(result.toolCalls![0].data).toEqual(artifact);
  });

  test('executes multiple tools in parallel', async () => {
    const riskArtifact = {
      type: 'risk_assessment',
      statistics: { rulesPassed: 3, rulesTotal: 5 },
      categories: []
    };
    const perfArtifact = {
      type: 'performance_report',
      metrics: { currentNetWorth: 100000 }
    };

    const toolsByName = {
      risk_assessment: createMockTool('risk_assessment', riskArtifact),
      performance_report: createMockTool('performance_report', perfArtifact)
    };

    const plan: QueryPlan = {
      intent: 'comparison',
      toolPlan: [
        { tool: 'risk_assessment', reason: 'Check risks', parameters: [] },
        {
          tool: 'performance_report',
          reason: 'Get performance',
          parameters: [{ key: 'range', value: '1y' }]
        }
      ],
      reasoning: 'Compare risk and performance'
    };

    const node = createExecutePlannedToolsNode(toolsByName);
    const result = await node(createState(plan));

    // 1 AIMessage + 2 ToolMessages
    expect(result.messages).toHaveLength(3);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0].name).toBe('risk_assessment');
    expect(result.toolCalls![1].name).toBe('performance_report');
  });

  test('converts planner parameters to tool args', async () => {
    let capturedArgs: unknown = null;
    const toolsByName = {
      market_data_lookup: {
        name: 'market_data_lookup',
        invoke: async (input: { args: unknown; id: string }) => {
          capturedArgs = input.args;
          return new ToolMessage({
            content: 'Price data',
            tool_call_id: input.id,
            name: 'market_data_lookup'
          });
        }
      }
    };

    const plan: QueryPlan = {
      intent: 'lookup',
      toolPlan: [
        {
          tool: 'market_data_lookup',
          reason: 'Price check',
          parameters: [{ key: 'symbol', value: 'AAPL' }]
        }
      ],
      reasoning: 'Get AAPL price'
    };

    const node = createExecutePlannedToolsNode(toolsByName);
    await node(createState(plan));

    expect(capturedArgs).toEqual({ symbol: 'AAPL' });
  });

  test('handles unknown tool gracefully', async () => {
    const plan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        {
          tool: 'risk_assessment',
          reason: 'nonexistent',
          parameters: []
        }
      ],
      reasoning: 'test'
    };

    const node = createExecutePlannedToolsNode({}); // no tools registered
    const result = await node(createState(plan));

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].success).toBe(false);
    expect(result.toolCalls![0].name).toBe('risk_assessment');

    // ToolMessage should contain error
    const toolMsg = result.messages![1]; // index 0 is AIMessage
    expect(toolMsg._getType()).toBe('tool');
    expect(String(toolMsg.content)).toContain('Error');
  });

  test('handles tool execution error gracefully', async () => {
    const toolsByName = {
      risk_assessment: createFailingTool('risk_assessment', 'API timeout')
    };

    const plan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        { tool: 'risk_assessment', reason: 'Check risks', parameters: [] }
      ],
      reasoning: 'test'
    };

    const node = createExecutePlannedToolsNode(toolsByName);
    const result = await node(createState(plan));

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].success).toBe(false);
    expect(String(result.messages![1].content)).toContain('API timeout');
  });

  test('synthetic AIMessage has correct tool_calls structure', async () => {
    const toolsByName = {
      portfolio_analysis: createMockTool('portfolio_analysis', {
        type: 'portfolio_analysis'
      })
    };

    const plan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        {
          tool: 'portfolio_analysis',
          reason: 'Get data',
          parameters: [{ key: 'range', value: '1y' }]
        }
      ],
      reasoning: 'test'
    };

    const node = createExecutePlannedToolsNode(toolsByName);
    const result = await node(createState(plan));

    const aiMsg = result.messages![0];
    expect(aiMsg._getType()).toBe('ai');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolCalls = (aiMsg as any).tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('portfolio_analysis');
    expect(toolCalls[0].args).toEqual({ range: '1y' });
    expect(toolCalls[0].id).toBe('planned-tool-0');
  });
});
