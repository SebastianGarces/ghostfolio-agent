/**
 * Structured fact-checking pipeline:
 *   Phase 1 (deterministic): Build SourceDataIndex from raw tool data
 *   Phase 2 (deterministic): Extract structured claims from content blocks
 *   Phase 3 (deterministic): Compare each claim against SourceDataIndex
 *   Phase 4 (deterministic): Compute scores from match/mismatch counts
 */
import type { ContentBlock } from '../graph/content-blocks';
import type { ToolCallRecord } from '../graph/state';
import type { GroundednessResult } from './groundedness-scoring';
import type { HallucinationResult } from './hallucination-detection';
import {
  type SourceDataIndex,
  buildSourceDataIndex
} from './source-data-index';

// ---------------------------------------------------------------------------
// Claim types (previously in fact-check-schema.ts, now inlined)
// ---------------------------------------------------------------------------

export interface ExtractedClaim {
  type: 'amount' | 'percentage' | 'count' | 'symbol' | 'assertion';
  value: number | null;
  context: string;
  symbol: string | null;
  text: string | null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimVerdict =
  | 'match'
  | 'mismatch'
  | 'not_in_source'
  | 'unverifiable';

export interface VerifiedClaim {
  claim: ExtractedClaim;
  verdict: ClaimVerdict;
  actual?: number | string;
  detail: string;
}

interface FactCheckOutput {
  hallucination: HallucinationResult;
  groundedness: GroundednessResult;
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  accuracy: 0.4,
  precision: 0.35,
  groundedness: 0.25
};

// ---------------------------------------------------------------------------
// Default pass
// ---------------------------------------------------------------------------

const DEFAULT_PASS: FactCheckOutput = {
  hallucination: { passed: true, issues: [] },
  groundedness: {
    accuracy: { score: 1.0, details: 'No tool data to verify against.' },
    precision: { score: 1.0, details: 'No tool data to verify against.' },
    groundedness: { score: 1.0, details: 'No tool data to verify against.' },
    overall: 1.0
  }
};

// ---------------------------------------------------------------------------
// Context matching — token-overlap (Jaccard) with symbol-aware boosting
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 0)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find the best matching key in a map using Jaccard similarity.
 * Symbol-aware: if the claim has a symbol, keys containing that symbol get a boost.
 */
export function findBestMatch(
  context: string,
  keys: Iterable<string>,
  symbol?: string | null
): { key: string; score: number } | null {
  const contextTokens = tokenize(context);
  const symbolLower = symbol?.toLowerCase();

  let bestKey: string | null = null;
  let bestScore = 0;

  for (const key of keys) {
    const keyTokens = tokenize(key);
    let score = jaccardSimilarity(contextTokens, keyTokens);

    // Symbol-aware boosting: if claim mentions a symbol and key contains it
    if (symbolLower && key.toLowerCase().includes(symbolLower)) {
      score += 0.3;
    }

    // Exact substring match bonus
    if (
      key.toLowerCase().includes(context.toLowerCase()) ||
      context.toLowerCase().includes(key.toLowerCase())
    ) {
      score += 0.2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestKey === null || bestScore < 0.3) return null;
  return { key: bestKey, score: bestScore };
}

/**
 * Return the top N matching keys sorted by score (descending).
 * Same scoring logic as findBestMatch but returns multiple candidates
 * so the verifier can check if *any* source entry matches the claim.
 */
export function findTopMatches(
  context: string,
  keys: Iterable<string>,
  symbol?: string | null,
  topN: number = 3
): { key: string; score: number }[] {
  const contextTokens = tokenize(context);
  const symbolLower = symbol?.toLowerCase();

  const scored: { key: string; score: number }[] = [];

  for (const key of keys) {
    const keyTokens = tokenize(key);
    let score = jaccardSimilarity(contextTokens, keyTokens);

    if (symbolLower && key.toLowerCase().includes(symbolLower)) {
      score += 0.3;
    }

    if (
      key.toLowerCase().includes(context.toLowerCase()) ||
      context.toLowerCase().includes(key.toLowerCase())
    ) {
      score += 0.2;
    }

    if (score >= 0.3) {
      scored.push({ key, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// ---------------------------------------------------------------------------
// Claim verification — deterministic comparison
// ---------------------------------------------------------------------------

export function verifyClaim(
  claim: ExtractedClaim,
  index: SourceDataIndex
): VerifiedClaim {
  switch (claim.type) {
    case 'amount': {
      const claimValue = claim.value!;
      // Multi-candidate matching: when multiple tools write to the same key,
      // check all candidates and accept if *any* match within tolerance.
      const candidates = findTopMatches(
        claim.context,
        index.amounts.keys(),
        claim.symbol
      );
      if (candidates.length === 0) {
        return {
          claim,
          verdict: 'not_in_source',
          detail: `Amount claim "${claim.context}" not found in source data`
        };
      }
      for (const candidate of candidates) {
        const actual = index.amounts.get(candidate.key)!;
        const relDiff =
          actual === 0
            ? Math.abs(claimValue)
            : Math.abs(claimValue - actual) / Math.abs(actual);
        if (relDiff <= 0.01 || Math.abs(claimValue - actual) <= 1) {
          return {
            claim,
            verdict: 'match',
            actual,
            detail: `Matches ${candidate.key}: ${actual}`
          };
        }
      }
      // Value-existence fallback: check if value exists anywhere (handles key overwrites)
      for (const knownValue of index.allAmountValues) {
        const relDiff =
          knownValue === 0
            ? Math.abs(claimValue)
            : Math.abs(claimValue - knownValue) / Math.abs(knownValue);
        if (relDiff <= 0.01 || Math.abs(claimValue - knownValue) <= 1) {
          return {
            claim,
            verdict: 'match',
            actual: knownValue,
            detail: `Value ${claimValue} found in source data (key collision recovery)`
          };
        }
      }
      // No candidate matched — report mismatch against the best one
      const bestKey = candidates[0].key;
      const bestActual = index.amounts.get(bestKey)!;
      const bestRelDiff =
        bestActual === 0
          ? Math.abs(claimValue)
          : Math.abs(claimValue - bestActual) / Math.abs(bestActual);
      return {
        claim,
        verdict: 'mismatch',
        actual: bestActual,
        detail: `Claimed ${claimValue} for "${bestKey}" but actual is ${bestActual} (${(bestRelDiff * 100).toFixed(1)}% off)`
      };
    }

    case 'percentage': {
      const claimValue = claim.value!;
      const candidates = findTopMatches(
        claim.context,
        index.percentages.keys(),
        claim.symbol
      );
      if (candidates.length === 0) {
        return {
          claim,
          verdict: 'not_in_source',
          detail: `Percentage claim "${claim.context}" not found in source data`
        };
      }
      for (const candidate of candidates) {
        const actual = index.percentages.get(candidate.key)!;
        if (Math.abs(claimValue - actual) <= 1.0) {
          return {
            claim,
            verdict: 'match',
            actual,
            detail: `Matches ${candidate.key}: ${actual}%`
          };
        }
      }
      // Value-existence fallback: check if value exists anywhere (handles key overwrites)
      for (const knownValue of index.allPercentageValues) {
        if (Math.abs(claimValue - knownValue) <= 1.0) {
          return {
            claim,
            verdict: 'match',
            actual: knownValue,
            detail: `Value ${claimValue}% found in source data (key collision recovery)`
          };
        }
      }
      const bestKey = candidates[0].key;
      const bestActual = index.percentages.get(bestKey)!;
      return {
        claim,
        verdict: 'mismatch',
        actual: bestActual,
        detail: `Claimed ${claimValue}% for "${bestKey}" but actual is ${bestActual.toFixed(1)}% (${Math.abs(claimValue - bestActual).toFixed(1)}pp off)`
      };
    }

    case 'count': {
      const claimValue = claim.value!;
      const candidates = findTopMatches(claim.context, index.counts.keys());
      if (candidates.length === 0) {
        return {
          claim,
          verdict: 'not_in_source',
          detail: `Count claim "${claim.context}" not found in source data`
        };
      }
      for (const candidate of candidates) {
        const actual = index.counts.get(candidate.key)!;
        if (claimValue === actual) {
          return {
            claim,
            verdict: 'match',
            actual,
            detail: `Matches ${candidate.key}: ${actual}`
          };
        }
      }
      // Value-existence fallback: check if value exists anywhere (handles key overwrites)
      for (const knownValue of index.allCountValues) {
        if (claimValue === knownValue) {
          return {
            claim,
            verdict: 'match',
            actual: knownValue,
            detail: `Value ${claimValue} found in source data (key collision recovery)`
          };
        }
      }
      const bestKey = candidates[0].key;
      const bestActual = index.counts.get(bestKey)!;
      return {
        claim,
        verdict: 'mismatch',
        actual: bestActual,
        detail: `Claimed ${claimValue} for "${bestKey}" but actual is ${bestActual}`
      };
    }

    case 'symbol': {
      const claimSymbol = claim.symbol!;
      if (index.symbols.has(claimSymbol.toUpperCase())) {
        return {
          claim,
          verdict: 'match',
          detail: `Symbol ${claimSymbol} found in source data`
        };
      }
      return {
        claim,
        verdict: 'mismatch',
        detail: `Symbol ${claimSymbol} not found in source data`
      };
    }

    case 'assertion': {
      return {
        claim,
        verdict: 'unverifiable',
        detail: `Assertion "${claim.text ?? ''}" cannot be verified deterministically`
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Scoring — deterministic from verdicts
// ---------------------------------------------------------------------------

export function computeScores(verified: VerifiedClaim[]): FactCheckOutput {
  // Partition claims by type for scoring
  const numericClaims = verified.filter(
    (v) =>
      v.claim.type === 'amount' ||
      v.claim.type === 'percentage' ||
      v.claim.type === 'count'
  );
  const symbolClaims = verified.filter((v) => v.claim.type === 'symbol');
  const allCheckable = verified.filter(
    (v) =>
      v.verdict === 'match' ||
      v.verdict === 'mismatch' ||
      v.verdict === 'unverifiable'
  );

  // Accuracy: matched numeric claims / checkable numeric claims
  const checkableNumeric = numericClaims.filter(
    (v) => v.verdict === 'match' || v.verdict === 'mismatch'
  );
  const matchedNumeric = checkableNumeric.filter((v) => v.verdict === 'match');
  const accuracy =
    checkableNumeric.length === 0
      ? 1.0
      : matchedNumeric.length / checkableNumeric.length;

  // Precision: matched symbols / checkable symbols
  const checkableSymbols = symbolClaims.filter(
    (v) => v.verdict === 'match' || v.verdict === 'mismatch'
  );
  const matchedSymbols = checkableSymbols.filter((v) => v.verdict === 'match');
  const precision =
    checkableSymbols.length === 0
      ? 1.0
      : matchedSymbols.length / checkableSymbols.length;

  // Groundedness: (matched + 0.5 * unverifiable) / all checkable
  const matched = allCheckable.filter((v) => v.verdict === 'match').length;
  const unverifiable = allCheckable.filter(
    (v) => v.verdict === 'unverifiable'
  ).length;
  const groundedness =
    allCheckable.length === 0
      ? 1.0
      : (matched + 0.5 * unverifiable) / allCheckable.length;

  // Overall weighted score
  const overall =
    Math.round(
      (accuracy * WEIGHTS.accuracy +
        precision * WEIGHTS.precision +
        groundedness * WEIGHTS.groundedness) *
        100
    ) / 100;

  // Build hallucination issues from mismatches
  const issues = verified
    .filter(
      (v) =>
        v.verdict === 'mismatch' ||
        (v.verdict === 'not_in_source' && v.claim.type === 'symbol')
    )
    .map((v) => {
      const issueType = (() => {
        switch (v.claim.type) {
          case 'percentage':
            return 'percentage_mismatch' as const;
          case 'amount':
            return 'amount_mismatch' as const;
          case 'symbol':
            return 'symbol_not_in_data' as const;
          case 'count':
            return 'amount_mismatch' as const;
          case 'assertion':
            return 'unsupported_claim' as const;
        }
      })();

      const claimed = (() => {
        switch (v.claim.type) {
          case 'amount':
            return `$${v.claim.value}`;
          case 'percentage':
            return `${v.claim.value}%`;
          case 'count':
            return String(v.claim.value);
          case 'symbol':
            return v.claim.symbol ?? '';
          case 'assertion':
            return v.claim.text ?? '';
        }
      })();

      return {
        type: issueType,
        severity: 'warning' as const,
        claimed,
        actual: v.actual != null ? String(v.actual) : undefined,
        description: v.detail
      };
    });

  // Build accuracy details
  const accuracyDetails =
    checkableNumeric.length === 0
      ? 'No numeric claims to verify.'
      : `${matchedNumeric.length}/${checkableNumeric.length} numeric claims match source data.`;

  const precisionDetails =
    checkableSymbols.length === 0
      ? 'No financial symbols to verify.'
      : `${matchedSymbols.length}/${checkableSymbols.length} symbols found in source data.`;

  const groundednessDetails =
    allCheckable.length === 0
      ? 'No verifiable claims found.'
      : `${matched} matched, ${unverifiable} unverifiable, out of ${allCheckable.length} checkable claims.`;

  return {
    hallucination: {
      passed: issues.length === 0,
      issues
    },
    groundedness: {
      accuracy: {
        score: Math.round(accuracy * 100) / 100,
        details: accuracyDetails
      },
      precision: {
        score: Math.round(precision * 100) / 100,
        details: precisionDetails
      },
      groundedness: {
        score: Math.round(groundedness * 100) / 100,
        details: groundednessDetails
      },
      overall
    }
  };
}

// ---------------------------------------------------------------------------
// Deterministic claim extraction from structured content blocks
// ---------------------------------------------------------------------------

export function extractClaimsFromBlocks(
  blocks: ContentBlock[]
): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'metric': {
        if (block.label && block.value) {
          const parsed = parseMetricValue(block.value);
          if (parsed) {
            claims.push({
              ...parsed,
              context: block.label,
              symbol: extractSymbolFromText(block.label)
            });
          }
        }
        break;
      }

      case 'metric_row': {
        if (block.metrics) {
          for (const m of block.metrics) {
            const parsed = parseMetricValue(m.value);
            if (parsed) {
              claims.push({
                ...parsed,
                context: m.label,
                symbol: extractSymbolFromText(m.label)
              });
            }
          }
        }
        break;
      }

      case 'symbol': {
        if (block.symbol) {
          claims.push({
            type: 'symbol',
            symbol: block.symbol,
            context: block.name ?? 'symbol',
            value: null,
            text: null
          });
        }
        break;
      }

      case 'text':
      case 'list': {
        // Extract claims from free text using regex fallback
        const text =
          block.type === 'text'
            ? (block.value ?? '')
            : (block.items ?? []).join(' ');
        claims.push(...extractFallbackClaims(text));
        break;
      }
    }
  }

  return claims;
}

/**
 * Parse a metric value string into a claim type + numeric value.
 * Handles "$100,000", "35.5%", "8", and plain numbers.
 */
function parseMetricValue(
  value: string
): { type: ExtractedClaim['type']; value: number; text: null } | null {
  const trimmed = value.trim();

  // Dollar amounts: "$100,000", "$33,500.00"
  const dollarMatch = trimmed.match(/^\$?([\d,]+(?:\.\d+)?)/);
  if (dollarMatch && trimmed.startsWith('$')) {
    const num = parseFloat(dollarMatch[1].replace(/,/g, ''));
    if (!isNaN(num)) {
      return { type: 'amount', value: num, text: null };
    }
  }

  // Percentages: "35.5%", "-2.4%"
  const pctMatch = trimmed.match(/^-?([\d,]+(?:\.\d+)?)%/);
  if (pctMatch) {
    const num = parseFloat(trimmed.replace(/[,%]/g, ''));
    if (!isNaN(num)) {
      return { type: 'percentage', value: num, text: null };
    }
  }

  // Currency amounts without $: "100,000 USD", "38,951"
  const currencyMatch = trimmed.match(
    /^-?([\d,]+(?:\.\d+)?)\s*(?:USD|EUR|GBP|CHF|JPY)?$/
  );
  if (currencyMatch) {
    const num = parseFloat(currencyMatch[1].replace(/,/g, ''));
    if (!isNaN(num)) {
      return { type: 'amount', value: num, text: null };
    }
  }

  return null;
}

/** Extract a stock-like symbol (2-5 uppercase letters) from text. */
function extractSymbolFromText(text: string): string | null {
  const match = text.match(/\b([A-Z]{2,5})\b/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Regex fallback — extract obvious claims from free text
// ---------------------------------------------------------------------------

function extractFallbackClaims(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  // Match dollar amounts like "$100", "$33,500.00"
  const amountRegex = /\$[\d,]+(?:\.\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = amountRegex.exec(text)) !== null) {
    const raw = match[0].replace(/[$,]/g, '');
    const value = parseFloat(raw);
    if (!isNaN(value)) {
      claims.push({
        type: 'amount',
        value,
        context: text
          .slice(
            Math.max(0, match.index - 30),
            match.index + match[0].length + 10
          )
          .trim(),
        symbol: null,
        text: null
      });
    }
  }

  // Match percentages like "16.2%", "35%"
  const pctRegex = /(\d+(?:\.\d+)?)%/g;
  while ((match = pctRegex.exec(text)) !== null) {
    const value = parseFloat(match[1]);
    if (!isNaN(value)) {
      claims.push({
        type: 'percentage',
        value,
        context: text
          .slice(
            Math.max(0, match.index - 30),
            match.index + match[0].length + 10
          )
          .trim(),
        symbol: null,
        text: null
      });
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Claim deduplication — prefer metric-sourced claims over regex-extracted ones
// ---------------------------------------------------------------------------

/**
 * When the same numeric value appears in both a metric block (short, clean
 * label context) and a text/list block (longer regex-extracted context with $),
 * the regex-sourced claim often matches the wrong key. Drop it.
 */
export function deduplicateClaims(claims: ExtractedClaim[]): ExtractedClaim[] {
  // Collect type:value keys from metric-sourced claims (short context, no $)
  const metricKeys = new Set<string>();
  for (const c of claims) {
    if (c.value != null && c.context.length <= 50 && !c.context.includes('$')) {
      metricKeys.add(`${c.type}:${c.value}`);
    }
  }

  return claims.filter((c) => {
    // Keep all metric-sourced claims
    if (c.value != null && c.context.length <= 50 && !c.context.includes('$')) {
      return true;
    }
    // Drop regex-sourced claims when a metric-sourced claim for the same value exists
    if (c.value != null && metricKeys.has(`${c.type}:${c.value}`)) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Fact-checks the agent's response against tool call data using deterministic
 * claim extraction from content blocks + deterministic comparison (code).
 *
 * Short-circuits (returns default pass) when:
 * - No tool calls were made
 * - All tool calls failed (no ground truth)
 */
export async function factCheck(
  responseText: string,
  toolCalls: ToolCallRecord[],
  contentBlocks: ContentBlock[]
): Promise<FactCheckOutput> {
  // No tool calls — nothing to check against
  if (toolCalls.length === 0) {
    return DEFAULT_PASS;
  }

  // All failed — no ground truth
  const successfulCalls = toolCalls.filter((tc) => tc.success && tc.data);
  if (successfulCalls.length === 0) {
    return DEFAULT_PASS;
  }

  // Phase 1: Build source data index (deterministic)
  const index = buildSourceDataIndex(toolCalls);

  // Phase 2: Extract claims from content blocks (deterministic)
  let claims =
    contentBlocks.length > 0
      ? extractClaimsFromBlocks(contentBlocks)
      : extractFallbackClaims(responseText);

  // If block extraction found nothing, fall back to regex on responseText
  if (claims.length === 0) {
    claims = extractFallbackClaims(responseText);
  }

  if (claims.length === 0) {
    return DEFAULT_PASS;
  }

  // Phase 2b: Deduplicate claims (prefer metric-sourced over regex-extracted)
  claims = deduplicateClaims(claims);

  if (claims.length === 0) {
    return DEFAULT_PASS;
  }

  // Phase 3: Verify each claim deterministically
  const verified = claims.map((claim) => verifyClaim(claim, index));

  // Phase 4: Compute scores
  return computeScores(verified);
}
