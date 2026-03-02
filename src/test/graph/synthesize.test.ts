import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { describe, expect, test } from 'bun:test';

import type { AgentState } from '../../server/graph/state';
import {
  buildFallbackBlocks,
  createFastSynthesizeNode,
  createSynthesizeNode
} from '../../server/graph/synthesize';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSynthesisLlm(blocks: unknown[]) {
  const jsonStr = JSON.stringify({ blocks });
  return {
    // stream() returns an async iterable of message chunks
    stream: async function* () {
      yield { content: jsonStr };
    },
    invoke: async () => ({
      blocks,
      usage_metadata: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150
      }
    })
  };
}

function createFailingLlm() {
  return {
    stream: async function* () {
      throw new Error('LLM unavailable');
      // eslint-disable-next-line no-unreachable
      yield;
    },
    invoke: async () => {
      throw new Error('LLM unavailable');
    }
  };
}

function createState(
  message: string,
  toolCalls: { name: string; success: boolean; data?: unknown }[] = []
): AgentState {
  return {
    messages: [
      new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
      new HumanMessage(message)
    ],
    toolCalls,
    tokenUsage: null,
    responseText: '',
    verification: null,
    iterationCount: 0,
    queryPlan: null,
    contentBlocks: null
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSynthesizeNode', () => {
  test('returns contentBlocks and responseText', async () => {
    const blocks = [
      { type: 'text', style: 'paragraph', value: 'Your portfolio looks great.' }
    ];

    const synth = createSynthesizeNode(
      createMockSynthesisLlm(blocks),
      'gpt-4o'
    );
    const state = createState('How is my portfolio?', [
      {
        name: 'portfolio_analysis',
        success: true,
        data: { holdings: [], summary: { currentNetWorth: 100000 } }
      }
    ]);
    const result = await synth(state);

    expect(result.contentBlocks).toBeDefined();
    expect(result.contentBlocks).toHaveLength(1);
    expect(result.responseText).toBe('Your portfolio looks great.');
  });

  test('greeting with no tools returns text-only blocks and verification', async () => {
    const blocks = [
      {
        type: 'text',
        style: 'paragraph',
        value: 'Hello! I can help with your portfolio.'
      }
    ];

    const synth = createSynthesizeNode(
      createMockSynthesisLlm(blocks),
      'gpt-4o'
    );
    const state = createState('Hello');
    const result = await synth(state);

    expect(result.contentBlocks).toHaveLength(1);
    expect(result.contentBlocks![0].type).toBe('text');
    // Greeting path includes verification directly
    expect(result.verification).toBeDefined();
    expect(result.verification!.passed).toBe(true);
  });

  test('accumulates token usage', async () => {
    const blocks = [{ type: 'text', style: 'paragraph', value: 'Test' }];

    const synth = createSynthesizeNode(
      createMockSynthesisLlm(blocks),
      'gpt-4o'
    );
    const state = createState('Test', [
      { name: 'portfolio_analysis', success: true, data: { holdings: [] } }
    ]);
    const result = await synth(state);

    expect(result.tokenUsage).toBeDefined();
    // Token usage is estimated from buffer length in streaming mode
    expect(result.tokenUsage!.outputTokens).toBeGreaterThan(0);
  });

  test('accumulates synthesis tokens on top of planner tokens from state', async () => {
    const blocks = [{ type: 'text', style: 'paragraph', value: 'Test' }];

    const synth = createSynthesizeNode(
      createMockSynthesisLlm(blocks),
      'gpt-4o'
    );
    const state: AgentState = {
      messages: [
        new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
        new HumanMessage('Test')
      ],
      toolCalls: [
        { name: 'portfolio_analysis', success: true, data: { holdings: [] } }
      ],
      // Simulate planner having set tokenUsage
      tokenUsage: {
        inputTokens: 150,
        outputTokens: 30,
        totalTokens: 180,
        estimatedCost: 0.000675
      },
      responseText: '',
      verification: null,
      iterationCount: 0,
      queryPlan: null,
      contentBlocks: null
    };
    const result = await synth(state);

    expect(result.tokenUsage).toBeDefined();
    // Should accumulate: planner input (150) + synthesis input (0 from mock)
    expect(result.tokenUsage!.inputTokens).toBe(150);
    // Should accumulate: planner output (30) + synthesis output (estimated from buffer)
    expect(result.tokenUsage!.outputTokens).toBeGreaterThan(30);
  });

  test('captures real usage_metadata from stream chunks', async () => {
    const blocks = [{ type: 'text', style: 'paragraph', value: 'Test' }];
    const jsonStr = JSON.stringify({ blocks });

    // Mock LLM that emits usage_metadata on the final chunk (like OpenAI)
    const mockLlmWithUsage = {
      stream: async function* () {
        yield { content: jsonStr };
        // Final chunk with usage_metadata
        yield {
          content: '',
          usage_metadata: {
            input_tokens: 200,
            output_tokens: 50,
            total_tokens: 250
          }
        };
      },
      invoke: async () => ({ blocks })
    };

    const synth = createSynthesizeNode(mockLlmWithUsage, 'gpt-4o');
    const state: AgentState = {
      messages: [
        new SystemMessage({ content: 'System prompt', id: 'system-prompt' }),
        new HumanMessage('Test')
      ],
      toolCalls: [
        { name: 'portfolio_analysis', success: true, data: { holdings: [] } }
      ],
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        estimatedCost: 0.00045
      },
      responseText: '',
      verification: null,
      iterationCount: 0,
      queryPlan: null,
      contentBlocks: null
    };
    const result = await synth(state);

    expect(result.tokenUsage).toBeDefined();
    // Should use real usage_metadata: planner (100) + synthesis (200)
    expect(result.tokenUsage!.inputTokens).toBe(300);
    // planner (20) + synthesis (50)
    expect(result.tokenUsage!.outputTokens).toBe(70);
    expect(result.tokenUsage!.totalTokens).toBe(370);
    expect(result.tokenUsage!.estimatedCost).toBeGreaterThan(0);
  });

  test('LLM failure produces fallback blocks', async () => {
    const synth = createSynthesizeNode(createFailingLlm(), 'gpt-4o');
    const state = createState('Show me my portfolio', [
      {
        name: 'portfolio_analysis',
        success: true,
        data: {
          holdings: [{ symbol: 'AAPL', name: 'Apple', allocation: 0.5 }],
          summary: { currentNetWorth: 100000 }
        }
      }
    ]);
    const result = await synth(state);

    // Should still produce blocks from fallback
    expect(result.contentBlocks).toBeDefined();
    expect(result.contentBlocks!.length).toBeGreaterThan(0);
    expect(result.responseText).toBeDefined();
  });

  test('preserves streamed blocks when final validation fails', async () => {
    // 21 valid blocks — each individually valid but array exceeds .max(20)
    const manyBlocks = [
      { type: 'text', style: 'title', value: 'Health Check' },
      ...Array(20).fill({
        type: 'text',
        style: 'paragraph',
        value: 'Analysis paragraph.'
      })
    ];

    const synth = createSynthesizeNode(
      createMockSynthesisLlm(manyBlocks),
      'gpt-4o'
    );
    const state = createState('Full health check', [
      {
        name: 'portfolio_analysis',
        success: true,
        data: {
          holdings: [{ symbol: 'AAPL', name: 'Apple', allocation: 0.5 }],
          summary: { currentNetWorth: 100000 }
        }
      },
      {
        name: 'risk_assessment',
        success: true,
        data: { statistics: { rulesPassed: 3, rulesTotal: 5 } }
      }
    ]);
    const result = await synth(state);

    // Should use tier-2 (streamed blocks), NOT tier-3 (deterministic fallback)
    expect(result.contentBlocks).toBeDefined();
    expect(result.contentBlocks!.length).toBe(21);
    expect(result.contentBlocks![0].value).toBe('Health Check');
  });

  test('LLM failure with no tools produces greeting fallback', async () => {
    const synth = createSynthesizeNode(createFailingLlm(), 'gpt-4o');
    const state = createState('Hello');
    const result = await synth(state);

    expect(result.contentBlocks).toBeDefined();
    expect(result.contentBlocks![0].type).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// buildFallbackBlocks — title generation
// ---------------------------------------------------------------------------

describe('buildFallbackBlocks', () => {
  test('generates tool-specific title for single tool', () => {
    const blocks = buildFallbackBlocks(
      [
        {
          name: 'market_data_lookup',
          success: true,
          data: { symbol: 'AAPL', price: 150 }
        }
      ],
      'What is the price of AAPL?'
    );

    expect(blocks[0].type).toBe('text');
    expect(blocks[0].style).toBe('title');
    expect(blocks[0].value).toBe('Market Data');
  });

  test('generates generic title for multi-tool calls', () => {
    const blocks = buildFallbackBlocks(
      [
        {
          name: 'portfolio_analysis',
          success: true,
          data: { holdings: [], summary: { currentNetWorth: 100000 } }
        },
        {
          name: 'dividend_analysis',
          success: true,
          data: { totalDividends: 500 }
        }
      ],
      'Show me everything'
    );

    expect(blocks[0].type).toBe('text');
    expect(blocks[0].style).toBe('title');
    expect(blocks[0].value).toBe('Portfolio Analysis');
  });

  test('investment_history fallback includes streak metrics', () => {
    const blocks = buildFallbackBlocks(
      [
        {
          name: 'investment_history',
          success: true,
          data: {
            totalInvested: 60000,
            streaks: { current: 6, longest: 12 }
          }
        }
      ],
      'How consistent have I been investing?'
    );

    const text = blocks.map((b) => JSON.stringify(b)).join(' ');
    expect(text).toContain('Current Streak');
    expect(text).toContain('Longest Streak');
    expect(text).toContain('6 months');
    expect(text).toContain('12 months');
  });

  test('investment_history fallback shows longest streak when current is zero', () => {
    const blocks = buildFallbackBlocks(
      [
        {
          name: 'investment_history',
          success: true,
          data: {
            totalInvested: 60000,
            streaks: { current: 0, longest: 8 }
          }
        }
      ],
      'Show my investment streaks'
    );

    const text = blocks.map((b) => JSON.stringify(b)).join(' ');
    expect(text).toContain('Longest Streak');
    expect(text).toContain('8 months');
  });

  test('allocation query gets allocation-specific title', () => {
    const blocks = buildFallbackBlocks(
      [
        {
          name: 'portfolio_analysis',
          success: true,
          data: {
            holdings: [{ symbol: 'AAPL', name: 'Apple', allocation: 0.5 }],
            summary: { currentNetWorth: 100000 }
          }
        }
      ],
      'What is my portfolio allocation?'
    );

    expect(blocks[0].value).toBe('Portfolio Allocation');
  });

  test('generic query falls through to tool-specific title', () => {
    const blocks = buildFallbackBlocks(
      [
        {
          name: 'market_data_lookup',
          success: true,
          data: { symbol: 'AAPL', price: 150 }
        }
      ],
      'Show me AAPL data'
    );

    expect(blocks[0].value).toBe('Market Data');
  });

  test('greeting with no tools returns paragraph, not title', () => {
    const blocks = buildFallbackBlocks([], 'Hello');

    expect(blocks[0].type).toBe('text');
    expect(blocks[0].style).toBe('paragraph');
    expect(blocks[0].value).toContain('portfolio assistant');
  });
});

// ---------------------------------------------------------------------------
// createFastSynthesizeNode
// ---------------------------------------------------------------------------

describe('createFastSynthesizeNode', () => {
  test('produces blocks without LLM for tool data', async () => {
    const fast = createFastSynthesizeNode();
    const state = createState('What is my net worth?', [
      {
        name: 'portfolio_analysis',
        success: true,
        data: {
          holdings: [{ symbol: 'AAPL', name: 'Apple', allocation: 0.5 }],
          summary: { currentNetWorth: 100000, netPerformancePercent: 0.15 }
        }
      }
    ]);
    const result = await fast(state);

    expect(result.contentBlocks).toBeDefined();
    expect(result.contentBlocks!.length).toBeGreaterThan(0);
    expect(result.responseText).toBeDefined();
    expect(result.responseText!.length).toBeGreaterThan(0);
  });

  test('includes title block as first block', async () => {
    const fast = createFastSynthesizeNode();
    const state = createState('What is the price of AAPL?', [
      {
        name: 'market_data_lookup',
        success: true,
        data: {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          price: 150,
          currency: 'USD'
        }
      }
    ]);
    const result = await fast(state);

    expect(result.contentBlocks![0].type).toBe('text');
    expect(result.contentBlocks![0].style).toBe('title');
    expect(result.contentBlocks![0].value).toBe('Market Data');
  });

  test('reports zero additional synthesis tokens', async () => {
    const fast = createFastSynthesizeNode();
    const state = createState('What is my net worth?', [
      {
        name: 'portfolio_analysis',
        success: true,
        data: { holdings: [], summary: { currentNetWorth: 100000 } }
      }
    ]);
    const result = await fast(state);

    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.outputTokens).toBe(0);
    expect(result.tokenUsage!.estimatedCost).toBe(0);
  });

  test('handles greeting path with inline verification', async () => {
    const fast = createFastSynthesizeNode();
    const state = createState('Hello');
    const result = await fast(state);

    expect(result.contentBlocks).toBeDefined();
    expect(result.contentBlocks![0].type).toBe('text');
    expect(result.verification).toBeDefined();
    expect(result.verification!.passed).toBe(true);
  });
});
