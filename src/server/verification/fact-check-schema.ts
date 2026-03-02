import { z } from 'zod';

// ---------------------------------------------------------------------------
// Claim extraction schema — LLM extracts structured claims, code compares
// ---------------------------------------------------------------------------
// Flat object (no discriminatedUnion / oneOf) so OpenAI structured output
// accepts it.  Nullable fields are set to null when irrelevant for the type.

export const ExtractedClaimSchema = z.object({
  type: z.enum(['amount', 'percentage', 'count', 'symbol', 'assertion']),
  value: z.number().nullable().default(null), // amount, percentage, count
  context: z.string(), // all types
  symbol: z.string().nullable().default(null), // amount, percentage, symbol
  text: z.string().nullable().default(null) // assertion
});

export const ClaimExtractionSchema = z.object({
  claims: z.array(ExtractedClaimSchema)
});

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;
export type ClaimExtractionResult = z.infer<typeof ClaimExtractionSchema>;
