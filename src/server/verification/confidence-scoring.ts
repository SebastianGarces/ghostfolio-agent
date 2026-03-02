export interface ConfidenceFactor {
  name: string;
  score: number;
  reason: string;
}

export interface ConfidenceResult {
  score: number; // 0.0 - 1.0
  level: 'high' | 'medium' | 'low';
  factors: ConfidenceFactor[];
}

const HEDGING_PATTERNS = [
  /\bi'?m not sure\b/i,
  /\bapproximately\b/i,
  /\bit seems\b/i,
  /\bpossibly\b/i,
  /\bI think\b/i,
  /\bmight be\b/i,
  /\bnot certain\b/i,
  /\broughly\b/i
];

const DATA_PATTERNS = [
  /\d+(\.\d+)?%/, // percentages
  /\$[\d,]+(\.\d+)?/, // dollar amounts
  /\d{1,3}(,\d{3})+(\.\d+)?/ // large numbers with commas
];

const STRUCTURE_PATTERNS = [
  /^[-*] /m, // bullet points
  /\*\*[^*]+\*\*/, // bold text headers
  /^##? /m, // markdown headers
  /\|/, // pipe separators (metric_row from blocksToText)
  /\[.+ from .+\]/ // data-reference blocks (blocksToText)
];

function countHedging(response: string): number {
  return HEDGING_PATTERNS.filter((p) => p.test(response)).length;
}

function countDataPatterns(response: string): number {
  return DATA_PATTERNS.filter((p) => p.test(response)).length;
}

function scoreLowHedging(response: string): ConfidenceFactor {
  const hedgingCount = countHedging(response);
  const score = Math.max(1.0 - hedgingCount * 0.25, 0.0);

  return {
    name: 'low-hedging',
    score,
    reason:
      hedgingCount > 0
        ? `Found ${hedgingCount} hedging indicator(s) suggesting uncertainty.`
        : 'No hedging language detected.'
  };
}

/**
 * Data mode: the agent called tools — score how well it presented the data.
 */
function scoreDataMode(
  response: string,
  toolCalls: { name: string; success: boolean }[]
): ConfidenceFactor[] {
  const factors: ConfidenceFactor[] = [];

  // tool-success (0.30): successes / total
  const successCount = toolCalls.filter((t) => t.success).length;
  const successRate = successCount / toolCalls.length;
  factors.push({
    name: 'tool-success',
    score: successRate,
    reason: `${successCount}/${toolCalls.length} tool calls succeeded.`
  });

  // data-cited (0.30): count of data patterns in response
  const dataCount = countDataPatterns(response);
  const dataCitedScore = dataCount >= 2 ? 1.0 : dataCount === 1 ? 0.5 : 0.0;
  factors.push({
    name: 'data-cited',
    score: dataCitedScore,
    reason:
      dataCount > 0
        ? `Response cites ${dataCount} data indicator(s) (numbers, percentages, dollar amounts).`
        : 'Response contains no quantitative data from tool results.'
  });

  // low-hedging (0.20)
  factors.push(scoreLowHedging(response));

  // well-structured (0.20): bullets/headers + multi-line
  const hasStructure = STRUCTURE_PATTERNS.some((p) => p.test(response));
  const isMultiLine = response.includes('\n');
  const structureScore = hasStructure && isMultiLine ? 1.0 : 0.3;
  factors.push({
    name: 'well-structured',
    score: structureScore,
    reason:
      hasStructure && isMultiLine
        ? 'Response is well-structured with formatting and multiple lines.'
        : 'Response lacks structured formatting (bullets, headers, or multiple lines).'
  });

  return factors;
}

/**
 * Conversational mode: no tools called — score appropriateness.
 */
function scoreConversationalMode(response: string): ConfidenceFactor[] {
  const factors: ConfidenceFactor[] = [];

  // no-tool-needed (0.30): always 1.0 — not calling tools is correct
  factors.push({
    name: 'no-tool-needed',
    score: 1.0,
    reason: 'No tools were needed for this response type.'
  });

  // no-fabrication (0.30): suspicious if data patterns appear without tool backing
  const dataCount = countDataPatterns(response);
  const fabricationScore = dataCount >= 2 ? 0.0 : dataCount === 1 ? 0.2 : 1.0;
  factors.push({
    name: 'no-fabrication',
    score: fabricationScore,
    reason:
      dataCount > 0
        ? `Response contains ${dataCount} data pattern(s) without tool backing — possible fabrication.`
        : 'No unsupported data claims detected.'
  });

  // low-hedging (0.20)
  factors.push(scoreLowHedging(response));

  // clear-response (0.20): non-empty and reasonable length
  let clearScore: number;
  let clearReason: string;
  const len = response.trim().length;

  if (len === 0) {
    clearScore = 0.0;
    clearReason = 'Response is empty.';
  } else if (len < 10) {
    clearScore = 0.3;
    clearReason = 'Response is extremely short.';
  } else if (len > 2000) {
    clearScore = 1.0;
    clearReason = 'Response is substantive (though long).';
  } else {
    clearScore = 1.0;
    clearReason = 'Response is clear and substantive.';
  }

  factors.push({
    name: 'clear-response',
    score: clearScore,
    reason: clearReason
  });

  return factors;
}

/**
 * Scores response confidence based on observable signals.
 * Uses mode-aware scoring: data mode (tools called) vs conversational mode (no tools).
 */
export function scoreConfidence(
  response: string,
  toolCalls: { name: string; success: boolean }[]
): ConfidenceResult {
  const isDataMode = toolCalls.length > 0;
  const factors = isDataMode
    ? scoreDataMode(response, toolCalls)
    : scoreConversationalMode(response);

  // Both modes use the same weights: [0.30, 0.30, 0.20, 0.20]
  const weights = [0.3, 0.3, 0.2, 0.2];
  const weightedScore = factors.reduce(
    (sum, f, i) => sum + f.score * weights[i],
    0
  );
  const score = Math.round(weightedScore * 100) / 100;

  let level: ConfidenceResult['level'];

  if (score >= 0.7) {
    level = 'high';
  } else if (score >= 0.4) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { score, level, factors };
}
