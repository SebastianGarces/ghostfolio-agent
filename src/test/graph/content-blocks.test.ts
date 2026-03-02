import { describe, expect, test } from 'bun:test';

import {
  ContentBlockSchema,
  SynthesisOutputSchema,
  blocksToText,
  type ContentBlock
} from '../../server/graph/content-blocks';

// Helper: parse a partial block through Zod to get defaults filled in
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function b(partial: Record<string, any>): ContentBlock {
  return ContentBlockSchema.parse(partial);
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('ContentBlockSchema', () => {
  test('validates text block', () => {
    const block = { type: 'text', style: 'paragraph', value: 'Hello world' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates all text styles', () => {
    for (const style of [
      'title',
      'subtitle',
      'paragraph',
      'caption',
      'label'
    ]) {
      const block = { type: 'text', style, value: 'test' };
      expect(ContentBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  test('validates metric block', () => {
    const block = {
      type: 'metric',
      label: 'Net Worth',
      value: '$100,000',
      format: 'currency',
      sentiment: 'positive'
    };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates metric block without optional fields', () => {
    const block = { type: 'metric', label: 'Count', value: '42' };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success) {
      // Defaults should be filled in as null
      expect(result.data.format).toBeNull();
      expect(result.data.sentiment).toBeNull();
    }
  });

  test('validates metric_row block', () => {
    const block = {
      type: 'metric_row',
      metrics: [
        { label: 'A', value: '1' },
        { label: 'B', value: '2' }
      ]
    };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates list block', () => {
    const block = { type: 'list', items: ['item 1', 'item 2'] };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates symbol block', () => {
    const block = { type: 'symbol', symbol: 'AAPL', name: 'Apple Inc.' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates symbol block without name', () => {
    const block = { type: 'symbol', symbol: 'BTC-USD' };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeNull();
    }
  });

  test('validates holdings_table block', () => {
    const block = {
      type: 'holdings_table',
      source: 'portfolio_analysis',
      maxRows: 5
    };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates pie_chart block', () => {
    const block = { type: 'pie_chart', source: 'portfolio_analysis' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates bar_chart block', () => {
    const block = { type: 'bar_chart', source: 'dividend_analysis' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates area_chart block', () => {
    const block = { type: 'area_chart', source: 'performance_report' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('validates rule_status block', () => {
    const block = { type: 'rule_status', source: 'risk_assessment' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  test('rejects invalid block type', () => {
    const block = { type: 'invalid_type', value: 'test' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(false);
  });

  test('rejects invalid text style', () => {
    const block = { type: 'text', style: 'huge', value: 'test' };
    expect(ContentBlockSchema.safeParse(block).success).toBe(false);
  });

  test('fills null defaults for unused fields', () => {
    const result = ContentBlockSchema.parse({
      type: 'text',
      style: 'paragraph',
      value: 'hello'
    });
    expect(result.label).toBeNull();
    expect(result.metrics).toBeNull();
    expect(result.items).toBeNull();
    expect(result.symbol).toBeNull();
    expect(result.source).toBeNull();
    expect(result.maxRows).toBeNull();
  });
});

describe('SynthesisOutputSchema', () => {
  test('validates output with blocks', () => {
    const output = {
      blocks: [{ type: 'text', style: 'paragraph', value: 'Hello' }]
    };
    expect(SynthesisOutputSchema.safeParse(output).success).toBe(true);
  });

  test('rejects empty blocks array', () => {
    const output = { blocks: [] };
    expect(SynthesisOutputSchema.safeParse(output).success).toBe(false);
  });

  test('rejects more than 20 blocks', () => {
    const output = {
      blocks: Array(21).fill({
        type: 'text',
        style: 'paragraph',
        value: 'x'
      })
    };
    expect(SynthesisOutputSchema.safeParse(output).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// blocksToText
// ---------------------------------------------------------------------------

describe('blocksToText', () => {
  test('serializes text block', () => {
    const blocks = [
      b({ type: 'text', style: 'paragraph', value: 'Hello world' })
    ];
    expect(blocksToText(blocks)).toBe('Hello world');
  });

  test('serializes metric block', () => {
    const blocks = [
      b({ type: 'metric', label: 'Net Worth', value: '$100,000' })
    ];
    expect(blocksToText(blocks)).toBe('Net Worth: $100,000');
  });

  test('serializes metric_row block', () => {
    const blocks = [
      b({
        type: 'metric_row',
        metrics: [
          { label: 'A', value: '1' },
          { label: 'B', value: '2' }
        ]
      })
    ];
    expect(blocksToText(blocks)).toBe('A: 1 | B: 2');
  });

  test('serializes list block', () => {
    const blocks = [b({ type: 'list', items: ['first', 'second'] })];
    expect(blocksToText(blocks)).toBe('- first\n- second');
  });

  test('serializes symbol block with name', () => {
    const blocks = [b({ type: 'symbol', symbol: 'AAPL', name: 'Apple Inc.' })];
    expect(blocksToText(blocks)).toBe('AAPL (Apple Inc.)');
  });

  test('serializes symbol block without name', () => {
    const blocks = [b({ type: 'symbol', symbol: 'BTC-USD' })];
    expect(blocksToText(blocks)).toBe('BTC-USD');
  });

  test('serializes data-reference blocks', () => {
    const blocks = [
      b({ type: 'holdings_table', source: 'portfolio_analysis' }),
      b({ type: 'pie_chart', source: 'portfolio_analysis' }),
      b({ type: 'bar_chart', source: 'dividend_analysis' }),
      b({ type: 'area_chart', source: 'performance_report' }),
      b({ type: 'rule_status', source: 'risk_assessment' })
    ];
    const text = blocksToText(blocks);
    expect(text).toContain('[Holdings table from portfolio_analysis]');
    expect(text).toContain('[Pie chart from portfolio_analysis]');
    expect(text).toContain('[Bar chart from dividend_analysis]');
    expect(text).toContain('[Area chart from performance_report]');
    expect(text).toContain('[Rule status from risk_assessment]');
  });

  test('serializes mixed block array', () => {
    const blocks = [
      b({
        type: 'text',
        style: 'paragraph',
        value: 'Your portfolio overview.'
      }),
      b({
        type: 'metric_row',
        metrics: [
          { label: 'Net Worth', value: '$384,161' },
          { label: 'Return', value: '+$159,414', sentiment: 'positive' }
        ]
      }),
      b({ type: 'pie_chart', source: 'portfolio_analysis' })
    ];
    const text = blocksToText(blocks);
    expect(text).toContain('Your portfolio overview.');
    expect(text).toContain('Net Worth: $384,161');
    expect(text).toContain('Return: +$159,414');
    expect(text).toContain('[Pie chart from portfolio_analysis]');
  });
});
