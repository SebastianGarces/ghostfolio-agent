import { z } from 'zod';

// ---------------------------------------------------------------------------
// Text styles for text blocks
// ---------------------------------------------------------------------------

export const TextStyleEnum = z.enum([
  'title',
  'subtitle',
  'paragraph',
  'caption',
  'label'
]);

// ---------------------------------------------------------------------------
// Sentiment for metrics
// ---------------------------------------------------------------------------

export const SentimentEnum = z.enum(['positive', 'negative', 'neutral']);

// ---------------------------------------------------------------------------
// Block type enum — all supported types
// ---------------------------------------------------------------------------

export const BlockTypeEnum = z.enum([
  'text',
  'metric',
  'metric_row',
  'list',
  'symbol',
  'holdings_table',
  'pie_chart',
  'bar_chart',
  'area_chart',
  'rule_status'
]);

// ---------------------------------------------------------------------------
// Flat content block schema — OpenAI compatible (no oneOf/anyOf/discriminatedUnion)
// ---------------------------------------------------------------------------
// All fields are present on every block. Fields not relevant to a given type
// are set to null. This is required because OpenAI's structured output does
// not support JSON Schema unions (oneOf/anyOf).

const MetricItemSchema = z.object({
  label: z.string(),
  value: z.string(),
  format: z.string().nullable().default(null),
  sentiment: SentimentEnum.nullable().default(null)
});

export const ContentBlockSchema = z.object({
  type: BlockTypeEnum,
  // text block fields
  style: TextStyleEnum.nullable().default(null),
  value: z.string().nullable().default(null),
  // metric block fields
  label: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  sentiment: SentimentEnum.nullable().default(null),
  // metric_row block fields
  metrics: z.array(MetricItemSchema).nullable().default(null),
  // list block fields
  items: z.array(z.string()).nullable().default(null),
  // symbol block fields
  symbol: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
  // data-reference block fields
  source: z.string().nullable().default(null),
  maxRows: z.number().nullable().default(null)
});

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// ---------------------------------------------------------------------------
// Synthesis output schema — what the LLM returns
// ---------------------------------------------------------------------------

export const SynthesisOutputSchema = z.object({
  blocks: z.array(ContentBlockSchema).min(1).max(20)
});

export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;

// ---------------------------------------------------------------------------
// Type guard helpers for cleaner block access
// ---------------------------------------------------------------------------

export function isTextBlock(
  block: ContentBlock
): block is ContentBlock & { style: string; value: string } {
  return block.type === 'text' && block.style != null && block.value != null;
}

export function isMetricBlock(
  block: ContentBlock
): block is ContentBlock & { label: string; value: string } {
  return block.type === 'metric' && block.label != null && block.value != null;
}

export function isMetricRowBlock(block: ContentBlock): block is ContentBlock & {
  metrics: {
    label: string;
    value: string;
    format: string | null;
    sentiment: string | null;
  }[];
} {
  return block.type === 'metric_row' && block.metrics != null;
}

export function isListBlock(
  block: ContentBlock
): block is ContentBlock & { items: string[] } {
  return block.type === 'list' && block.items != null;
}

export function isSymbolBlock(
  block: ContentBlock
): block is ContentBlock & { symbol: string } {
  return block.type === 'symbol' && block.symbol != null;
}

export function isDataRefBlock(
  block: ContentBlock
): block is ContentBlock & { source: string } {
  return (
    [
      'holdings_table',
      'pie_chart',
      'bar_chart',
      'area_chart',
      'rule_status'
    ].includes(block.type) && block.source != null
  );
}

// ---------------------------------------------------------------------------
// blocksToText — serialize blocks to plain text for verification
// ---------------------------------------------------------------------------

export function blocksToText(blocks: ContentBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.value) lines.push(block.value);
        break;

      case 'metric':
        if (block.label && block.value) {
          lines.push(`${block.label}: ${block.value}`);
        }
        break;

      case 'metric_row':
        if (block.metrics) {
          lines.push(
            block.metrics.map((m) => `${m.label}: ${m.value}`).join(' | ')
          );
        }
        break;

      case 'list':
        if (block.items) {
          for (const item of block.items) {
            lines.push(`- ${item}`);
          }
        }
        break;

      case 'symbol':
        if (block.symbol) {
          lines.push(
            block.name ? `${block.symbol} (${block.name})` : block.symbol
          );
        }
        break;

      case 'holdings_table':
        if (block.source) lines.push(`[Holdings table from ${block.source}]`);
        break;

      case 'pie_chart':
        if (block.source) lines.push(`[Pie chart from ${block.source}]`);
        break;

      case 'bar_chart':
        if (block.source) lines.push(`[Bar chart from ${block.source}]`);
        break;

      case 'area_chart':
        if (block.source) lines.push(`[Area chart from ${block.source}]`);
        break;

      case 'rule_status':
        if (block.source) lines.push(`[Rule status from ${block.source}]`);
        break;
    }
  }

  return lines.join('\n');
}
