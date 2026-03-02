import {
  AIMessage,
  HumanMessage,
  SystemMessage
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { describe, expect, test } from 'bun:test';

import {
  buildConversationContext,
  createPlannerNode,
  deduplicateToolPlan
} from '../../server/graph/planner';
import {
  QueryPlanSchema,
  type QueryPlan,
  type ToolPlan
} from '../../server/graph/planner';
import type { AgentState } from '../../server/graph/state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock planner LLM that returns a pre-defined QueryPlan and captures messages. */
function createMockPlannerLlm(plan: QueryPlan) {
  return {
    invoke: async (_messages: unknown) => plan
  };
}

/**
 * Creates a mock planner LLM that captures the messages it receives.
 * Returns the captured messages via the `captured` array.
 */
function createCapturingPlannerLlm(plan: QueryPlan) {
  const captured: unknown[][] = [];
  return {
    captured,
    llm: {
      invoke: async (messages: unknown) => {
        captured.push(messages as unknown[]);
        return plan;
      }
    }
  };
}

/** Creates a minimal AgentState with a human message. */
function createMinimalState(message: string): AgentState {
  return {
    messages: [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
      new HumanMessage(message)
    ],
    toolCalls: [],
    tokenUsage: null,
    responseText: '',
    verification: null,
    iterationCount: 0,
    queryPlan: null,
    contentBlocks: null
  };
}

/** Creates an AgentState that simulates a follow-up turn with conversation history. */
function createFollowUpState(
  previousQuestion: string,
  followUpQuestion: string,
  options?: {
    queryPlanContent?: string;
    aiResponseContent?: string;
    aiContentBlocks?: { type: string; style?: string; value?: string }[];
  }
): AgentState {
  const messages: BaseMessage[] = [
    new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
    new HumanMessage(previousQuestion)
  ];

  if (options?.queryPlanContent) {
    messages.push(
      new SystemMessage({
        content: options.queryPlanContent,
        id: 'query-plan'
      })
    );
  }

  if (options?.aiResponseContent !== undefined) {
    const aiMsg = new AIMessage({
      content: options.aiResponseContent,
      additional_kwargs: options?.aiContentBlocks
        ? { contentBlocks: options.aiContentBlocks }
        : {}
    });
    messages.push(aiMsg);
  }

  messages.push(new HumanMessage(followUpQuestion));

  return {
    messages,
    toolCalls: [],
    tokenUsage: null,
    responseText: '',
    verification: null,
    iterationCount: 0,
    queryPlan: null,
    contentBlocks: null
  };
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('QueryPlanSchema', () => {
  test('validates a well-formed plan', () => {
    const plan = {
      intent: 'analysis',
      toolPlan: [
        { tool: 'portfolio_analysis', reason: 'Get data', parameters: [] }
      ],
      reasoning: 'Simple analysis',
      complexity: 'moderate'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(true);
  });

  test('validates a plan with parameters', () => {
    const plan = {
      intent: 'lookup',
      toolPlan: [
        {
          tool: 'market_data_lookup',
          reason: 'Price check',
          parameters: [{ key: 'symbol', value: 'AAPL' }]
        }
      ],
      reasoning: 'User wants current AAPL price',
      complexity: 'simple'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(true);
  });

  test('validates a multi-tool plan', () => {
    const plan = {
      intent: 'comparison',
      toolPlan: [
        {
          tool: 'portfolio_analysis',
          reason: 'Get holdings',
          parameters: []
        },
        { tool: 'performance_report', reason: 'Get returns', parameters: [] }
      ],
      reasoning: 'Compare holdings and performance',
      complexity: 'complex'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(true);
  });

  test('rejects unknown tool names', () => {
    const plan = {
      intent: 'analysis',
      toolPlan: [{ tool: 'unknown_tool', reason: 'invalid', parameters: [] }],
      reasoning: 'test',
      complexity: 'simple'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(false);
  });

  test('rejects unknown intent', () => {
    const plan = {
      intent: 'unknown_intent',
      toolPlan: [
        { tool: 'portfolio_analysis', reason: 'test', parameters: [] }
      ],
      reasoning: 'test',
      complexity: 'simple'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(false);
  });

  test('accepts empty tool plan (greeting/general)', () => {
    const plan = {
      intent: 'general',
      toolPlan: [],
      reasoning: 'This is a greeting',
      complexity: 'simple'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(true);
  });

  test('rejects more than 3 tools', () => {
    const plan = {
      intent: 'analysis',
      toolPlan: Array(4).fill({
        tool: 'portfolio_analysis',
        reason: 'r',
        parameters: []
      }),
      reasoning: 'test',
      complexity: 'complex'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(false);
  });

  test('accepts exactly 3 tools', () => {
    const plan = {
      intent: 'general',
      toolPlan: [
        { tool: 'portfolio_analysis', reason: 'a', parameters: [] },
        { tool: 'performance_report', reason: 'b', parameters: [] },
        { tool: 'dividend_analysis', reason: 'c', parameters: [] }
      ],
      reasoning: 'test',
      complexity: 'complex'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(true);
  });

  test('rejects plan with omitted complexity (required field)', () => {
    const plan = {
      intent: 'analysis',
      toolPlan: [
        { tool: 'portfolio_analysis', reason: 'Get data', parameters: [] }
      ],
      reasoning: 'Simple analysis'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(false);
  });

  test('rejects unknown complexity value', () => {
    const plan = {
      intent: 'analysis',
      toolPlan: [
        { tool: 'portfolio_analysis', reason: 'Get data', parameters: [] }
      ],
      reasoning: 'test',
      complexity: 'ultra'
    };
    expect(QueryPlanSchema.safeParse(plan).success).toBe(false);
  });

  test('accepts all valid complexity values', () => {
    for (const complexity of ['simple', 'moderate', 'complex']) {
      const plan = {
        intent: 'analysis',
        toolPlan: [
          { tool: 'portfolio_analysis', reason: 'Get data', parameters: [] }
        ],
        reasoning: 'test',
        complexity
      };
      expect(QueryPlanSchema.safeParse(plan).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Planner node
// ---------------------------------------------------------------------------

describe('createPlannerNode', () => {
  test('produces a query plan and sets state', async () => {
    const expectedPlan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        {
          tool: 'portfolio_analysis',
          reason: 'Get holdings and allocation data',
          parameters: []
        }
      ],
      reasoning: 'User wants to see their portfolio composition',
      complexity: 'moderate'
    };

    const planner = createPlannerNode(
      createMockPlannerLlm(expectedPlan),
      'gpt-4o'
    );
    const state = createMinimalState('Show me my portfolio allocation');
    const result = await planner(state);

    expect(result.queryPlan).toEqual(expectedPlan);
  });

  test('emits a SystemMessage with the plan', async () => {
    const plan: QueryPlan = {
      intent: 'lookup',
      toolPlan: [
        {
          tool: 'market_data_lookup',
          reason: 'Price check',
          parameters: [{ key: 'symbol', value: 'AAPL' }]
        }
      ],
      reasoning: 'User wants current price of AAPL',
      complexity: 'simple'
    };

    const planner = createPlannerNode(createMockPlannerLlm(plan), 'gpt-4o');
    const state = createMinimalState('What is the price of AAPL?');
    const result = await planner(state);

    expect(result.messages).toHaveLength(1);
    expect(result.messages![0]._getType()).toBe('system');
  });

  test('plan message has stable ID for deduplication', async () => {
    const plan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        { tool: 'portfolio_analysis', reason: 'Get data', parameters: [] }
      ],
      reasoning: 'Simple analysis',
      complexity: 'moderate'
    };

    const planner = createPlannerNode(createMockPlannerLlm(plan), 'gpt-4o');
    const state = createMinimalState('Analyze my portfolio');
    const result = await planner(state);

    expect(result.messages![0].id).toBe('query-plan');
  });

  test('multi-tool plan includes all tools in message content', async () => {
    // Use a non-redundant pair so deduplication does not remove any tool
    const plan: QueryPlan = {
      intent: 'comparison',
      toolPlan: [
        {
          tool: 'portfolio_analysis',
          reason: 'Get holdings by asset class',
          parameters: []
        },
        {
          tool: 'risk_assessment',
          reason: 'Check diversification rules',
          parameters: []
        }
      ],
      reasoning: 'Full health check with risk',
      complexity: 'complex'
    };

    const planner = createPlannerNode(createMockPlannerLlm(plan), 'gpt-4o');
    const state = createMinimalState(
      'Give me a full portfolio health check with risk analysis'
    );
    const result = await planner(state);

    const content = result.messages![0].content as string;
    expect(content).toContain('portfolio_analysis');
    expect(content).toContain('risk_assessment');
  });

  test('greeting returns empty toolPlan with general intent', async () => {
    const plan: QueryPlan = {
      intent: 'general',
      toolPlan: [],
      reasoning: 'This is a simple greeting',
      complexity: 'simple'
    };

    const planner = createPlannerNode(createMockPlannerLlm(plan), 'gpt-4o');
    const state = createMinimalState('Hello!');
    const result = await planner(state);

    expect(result.queryPlan).toEqual(plan);
    expect(result.queryPlan!.toolPlan).toHaveLength(0);
    expect(result.queryPlan!.intent).toBe('general');
  });

  test('gracefully handles planner LLM failure', async () => {
    const failingLlm = {
      invoke: async () => {
        throw new Error('LLM unavailable');
      }
    };

    const planner = createPlannerNode(failingLlm, 'gpt-4o');
    const state = createMinimalState('Analyze my portfolio');
    const result = await planner(state);

    // Should return empty object — no crash, no plan
    expect(result).toEqual({});
  });

  test('includes conversation context in system prompt on follow-up turns', async () => {
    const plan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        { tool: 'risk_assessment', reason: 'Check criteria', parameters: [] }
      ],
      reasoning: 'Follow-up about risk criteria',
      complexity: 'moderate'
    };

    const { captured, llm } = createCapturingPlannerLlm(plan);
    const planner = createPlannerNode(llm, 'gpt-4o');

    const state = createFollowUpState(
      'Give me a full health check',
      'what are the criterias?',
      {
        queryPlanContent:
          '## Query Plan\nIntent: analysis\n\nRecommended tool execution order:\n1. portfolio_analysis — Get holdings\n2. risk_assessment — Check risk',
        aiResponseContent: 'Here is your health check...',
        aiContentBlocks: [
          {
            type: 'text',
            style: 'title',
            value: 'Full Health Check: Performance, Risk, and Dividends'
          }
        ]
      }
    );

    await planner(state);

    const systemPrompt = (captured[0][0] as SystemMessage).content as string;
    expect(systemPrompt).toContain('Follow-up resolution:');
    expect(systemPrompt).toContain('Conversation context (previous turn):');
    expect(systemPrompt).toContain('Give me a full health check');
    expect(systemPrompt).toContain('portfolio_analysis');
    expect(systemPrompt).toContain('risk_assessment');
    expect(systemPrompt).toContain(
      'Full Health Check: Performance, Risk, and Dividends'
    );
  });

  test('applies deduplication to remove redundant secondary tools', async () => {
    // LLM returns a plan with portfolio_analysis as redundant secondary
    const overSelectedPlan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        {
          tool: 'performance_report',
          reason: 'Get returns',
          parameters: []
        },
        {
          tool: 'portfolio_analysis',
          reason: 'Supplementary context',
          parameters: []
        }
      ],
      reasoning: 'Performance with context',
      complexity: 'moderate'
    };

    const planner = createPlannerNode(
      createMockPlannerLlm(overSelectedPlan),
      'gpt-4o'
    );
    const state = createMinimalState('How is my portfolio performing?');
    const result = await planner(state);

    // Deduplication should have removed portfolio_analysis
    expect(result.queryPlan!.toolPlan).toHaveLength(1);
    expect(result.queryPlan!.toolPlan[0].tool).toBe('performance_report');

    // The plan message should only mention performance_report
    const content = result.messages![0].content as string;
    expect(content).toContain('performance_report');
    expect(content).not.toContain('portfolio_analysis');
  });

  test('extracts tokenUsage from { raw, parsed } shape (includeRaw: true)', async () => {
    const expectedPlan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        {
          tool: 'portfolio_analysis',
          reason: 'Get data',
          parameters: []
        }
      ],
      reasoning: 'Simple analysis',
      complexity: 'simple'
    };

    // Mock LLM that returns { raw: AIMessage, parsed: QueryPlan } like withStructuredOutput(includeRaw: true)
    const mockRawLlm = {
      invoke: async () => ({
        raw: {
          usage_metadata: {
            input_tokens: 150,
            output_tokens: 30,
            total_tokens: 180
          }
        },
        parsed: expectedPlan
      })
    };

    const planner = createPlannerNode(mockRawLlm, 'gpt-4o');
    const state = createMinimalState('Show me my portfolio');
    const result = await planner(state);

    expect(result.queryPlan).toEqual(expectedPlan);
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.inputTokens).toBe(150);
    expect(result.tokenUsage!.outputTokens).toBe(30);
    expect(result.tokenUsage!.totalTokens).toBe(180);
    expect(result.tokenUsage!.estimatedCost).toBeGreaterThan(0);
  });

  test('handles plain QueryPlan return (no raw) with no tokenUsage', async () => {
    const expectedPlan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        {
          tool: 'portfolio_analysis',
          reason: 'Get data',
          parameters: []
        }
      ],
      reasoning: 'Simple analysis',
      complexity: 'simple'
    };

    const planner = createPlannerNode(
      createMockPlannerLlm(expectedPlan),
      'gpt-4o'
    );
    const state = createMinimalState('Show me my portfolio');
    const result = await planner(state);

    expect(result.queryPlan).toEqual(expectedPlan);
    // Plain mocks don't return { raw, parsed }, so tokenUsage should be undefined
    expect(result.tokenUsage).toBeUndefined();
  });

  test('does NOT include conversation context on first turn', async () => {
    const plan: QueryPlan = {
      intent: 'analysis',
      toolPlan: [
        {
          tool: 'portfolio_analysis',
          reason: 'Get data',
          parameters: []
        }
      ],
      reasoning: 'First turn',
      complexity: 'moderate'
    };

    const { captured, llm } = createCapturingPlannerLlm(plan);
    const planner = createPlannerNode(llm, 'gpt-4o');

    const state = createMinimalState('Show me my portfolio');
    await planner(state);

    const systemPrompt = (captured[0][0] as SystemMessage).content as string;
    expect(systemPrompt).not.toContain('Follow-up resolution:');
    expect(systemPrompt).not.toContain('Conversation context');
  });
});

// ---------------------------------------------------------------------------
// buildConversationContext
// ---------------------------------------------------------------------------

describe('buildConversationContext', () => {
  test('returns null for first turn (single human message)', () => {
    const messages: BaseMessage[] = [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
      new HumanMessage('Hello')
    ];
    expect(buildConversationContext(messages)).toBeNull();
  });

  test('returns null when no human messages exist', () => {
    const messages: BaseMessage[] = [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' })
    ];
    expect(buildConversationContext(messages)).toBeNull();
  });

  test('extracts previous question, tool names, and response title', () => {
    const messages: BaseMessage[] = [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
      new HumanMessage('Give me a full health check'),
      new SystemMessage({
        content:
          '## Query Plan\nIntent: analysis\n\nRecommended tool execution order:\n1. portfolio_analysis — Get holdings\n2. risk_assessment — Check risk\n3. dividend_analysis — Check dividends',
        id: 'query-plan'
      }),
      new AIMessage({
        content: 'Here is your full health check...',
        additional_kwargs: {
          contentBlocks: [
            {
              type: 'text',
              style: 'title',
              value: 'Full Health Check: Performance, Risk, and Dividends'
            }
          ]
        }
      }),
      new HumanMessage('what are the criterias?')
    ];

    const result = buildConversationContext(messages);
    expect(result).not.toBeNull();
    expect(result).toContain('Give me a full health check');
    expect(result).toContain('portfolio_analysis');
    expect(result).toContain('risk_assessment');
    expect(result).toContain('dividend_analysis');
    expect(result).toContain(
      'Full Health Check: Performance, Risk, and Dividends'
    );
  });

  test('handles history without query-plan message', () => {
    const messages: BaseMessage[] = [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
      new HumanMessage('Hello'),
      new AIMessage({ content: 'Hi there! How can I help?' }),
      new HumanMessage('tell me more')
    ];

    const result = buildConversationContext(messages);
    expect(result).not.toBeNull();
    expect(result).toContain('User asked: "Hello"');
    expect(result).toContain('Hi there! How can I help?');
    // Should NOT contain "Tools called" since no query-plan
    expect(result).not.toContain('Tools called:');
  });

  test('falls back to content snippet when no title content block', () => {
    const messages: BaseMessage[] = [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
      new HumanMessage('What is the price of AAPL?'),
      new AIMessage({ content: 'The current price of AAPL is $185.50.' }),
      new HumanMessage('tell me more')
    ];

    const result = buildConversationContext(messages);
    expect(result).not.toBeNull();
    expect(result).toContain('The current price of AAPL is $185.50.');
  });

  test('caps previous question at 200 chars', () => {
    const longQuestion = 'A'.repeat(300);
    const messages: BaseMessage[] = [
      new HumanMessage(longQuestion),
      new AIMessage({ content: 'Response' }),
      new HumanMessage('follow up')
    ];

    const result = buildConversationContext(messages);
    expect(result).not.toBeNull();
    // Should contain exactly 200 A's, not 300
    expect(result).toContain('A'.repeat(200));
    expect(result).not.toContain('A'.repeat(201));
  });
});

// ---------------------------------------------------------------------------
// deduplicateToolPlan
// ---------------------------------------------------------------------------

describe('deduplicateToolPlan', () => {
  const makeTool = (tool: string): ToolPlan => ({
    tool: tool as ToolPlan['tool'],
    reason: `Reason for ${tool}`,
    parameters: []
  });

  test('keeps single-tool plans unchanged', () => {
    const plan = [makeTool('performance_report')];
    expect(deduplicateToolPlan(plan)).toEqual(plan);
  });

  test('keeps empty plans unchanged', () => {
    expect(deduplicateToolPlan([])).toEqual([]);
  });

  test('removes portfolio_analysis when secondary to performance_report', () => {
    const plan = [
      makeTool('performance_report'),
      makeTool('portfolio_analysis')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe('performance_report');
  });

  test('removes portfolio_analysis when secondary to risk_assessment', () => {
    const plan = [makeTool('risk_assessment'), makeTool('portfolio_analysis')];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe('risk_assessment');
  });

  test('keeps portfolio_analysis when secondary to dividend_analysis (needed for cross-holding comparison)', () => {
    const plan = [
      makeTool('dividend_analysis'),
      makeTool('portfolio_analysis')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe('dividend_analysis');
    expect(result[1].tool).toBe('portfolio_analysis');
  });

  test('removes portfolio_analysis when secondary to investment_history', () => {
    const plan = [
      makeTool('investment_history'),
      makeTool('portfolio_analysis')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe('investment_history');
  });

  test('removes performance_report when secondary to portfolio_analysis', () => {
    const plan = [
      makeTool('portfolio_analysis'),
      makeTool('performance_report')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe('portfolio_analysis');
  });

  test('keeps non-redundant multi-tool plans (portfolio_analysis + risk_assessment)', () => {
    const plan = [makeTool('portfolio_analysis'), makeTool('risk_assessment')];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe('portfolio_analysis');
    expect(result[1].tool).toBe('risk_assessment');
  });

  test('keeps non-redundant multi-tool plans (performance_report + dividend_analysis)', () => {
    const plan = [
      makeTool('performance_report'),
      makeTool('dividend_analysis')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe('performance_report');
    expect(result[1].tool).toBe('dividend_analysis');
  });

  test('keeps non-redundant multi-tool plans (dividend_analysis + investment_history)', () => {
    const plan = [
      makeTool('dividend_analysis'),
      makeTool('investment_history')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe('dividend_analysis');
    expect(result[1].tool).toBe('investment_history');
  });

  test('removes only redundant tools from a 3-tool plan', () => {
    const plan = [
      makeTool('performance_report'),
      makeTool('portfolio_analysis'),
      makeTool('dividend_analysis')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe('performance_report');
    expect(result[1].tool).toBe('dividend_analysis');
  });

  test('keeps plan when primary has no redundancy rules (holdings_search)', () => {
    const plan = [makeTool('holdings_search'), makeTool('portfolio_analysis')];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(2);
  });

  test('keeps plan when primary has no redundancy rules (market_data_lookup)', () => {
    const plan = [
      makeTool('market_data_lookup'),
      makeTool('portfolio_analysis')
    ];
    const result = deduplicateToolPlan(plan);
    expect(result).toHaveLength(2);
  });
});
