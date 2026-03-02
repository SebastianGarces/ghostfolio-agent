export interface ConstraintViolation {
  rule: string;
  severity: 'error' | 'warning';
  description: string;
}

export interface VerificationResult {
  passed: boolean;
  violations: ConstraintViolation[];
  modifiedResponse?: string;
}

const BUY_SELL_PATTERNS = [
  /\byou should (buy|sell|invest in|purchase|trade)\b/i,
  /\bi recommend (buying|selling|purchasing|trading)\b/i,
  /\bconsider (buying|selling|purchasing)\b/i,
  /\b(buy|sell|purchase|trade)\s+\d+\s+(shares?|units?)\b/i,
  /\bgo (long|short) on\b/i
];

const PREDICTION_PATTERNS = [
  /\bwill return \d+(\.\d+)?%/i,
  /\bwill grow to\b/i,
  /\bprice will (reach|hit|exceed)\b/i,
  /\bexpect(ed)? to (rise|fall|grow|decline) to\b/i,
  /\bwill be worth \$[\d,]+/i,
  /\bguaranteed\s+(return|profit|gain)/i
];

const DISCLAIMER =
  'This analysis is for informational purposes only and does not constitute financial advice.';

export const SAFE_FALLBACK_RESPONSE =
  "I'm the Ghostfolio portfolio assistant. I can only help with portfolio analysis and investment-related questions. Please ask me about your portfolio, holdings, performance, risk, dividends, or market data.";

const OFF_TOPIC_PATTERNS = [
  /\b(medication|prescription|dosage|symptom|diagnos)\w*/i,
  /\b(recipe|ingredient|cooking|baking)\b/i,
  /\b(code|programming|javascript|python|html|css|sql|algorithm)\b/i,
  /\b(flight|hotel|vacation|travel itinerary|tourist)\b/i,
  /\b(movie|tv show|song|album|game|novel|book review)\b/i,
  /\b(weather forecast|sports score|celebrity)\b/i,
  /\b(homework|essay|exam|quiz answer)\b/i,
  /\b(calories|workout|exercise routine|diet plan)\b/i
];

const FINANCIAL_INDICATORS = [
  /\bportfolio\b/i,
  /\ballocation\b/i,
  /\bholding/i,
  /\bstock/i,
  /\bbond/i,
  /\bequit/i,
  /\bfund\b/i,
  /\betf\b/i,
  /\bdividend/i,
  /\binvestment\b/i,
  /\bmarket\b/i,
  /\basset/i,
  /\bperformance\b/i,
  /\bnet worth\b/i,
  /\breturn/i,
  /\$[\d,]+/
];

function hasFinancialContext(response: string): boolean {
  return FINANCIAL_INDICATORS.some((p) => p.test(response));
}

function hasOffTopicIndicators(response: string): boolean {
  return OFF_TOPIC_PATTERNS.some((p) => p.test(response));
}

/**
 * Checks whether portfolio data is discussed in the response.
 * Looks for financial terms that indicate portfolio analysis content.
 */
function discussesPortfolioData(response: string): boolean {
  const indicators = [
    /\bportfolio\b/i,
    /\ballocation\b/i,
    /\bperformance\b/i,
    /\bholding/i,
    /\bnet worth\b/i,
    /\binvestment\b/i,
    /\breturn/i,
    /\brisk\b/i,
    /\basset/i,
    /\$[\d,]+/
  ];

  return indicators.some((pattern) => pattern.test(response));
}

// ---------------------------------------------------------------------------
// Leak detection — checks if response contains internal identifiers
// ---------------------------------------------------------------------------

const INTERNAL_IDENTIFIERS = [
  'PLANNER_SYSTEM_PROMPT',
  'ANALYTICAL_KEYWORDS',
  'getSystemPrompt',
  'QueryPlanSchema',
  'checkInputForInjection',
  'AgentStateAnnotation',
  'factCheckLlm',
  'plannerLlm',
  'synthesisLlm',
  'SynthesisOutputSchema',
  'ContentBlockSchema',
  'SAFE_FALLBACK_RESPONSE'
];

const SYSTEM_PROMPT_SECTION_PATTERNS = [
  /##\s*(?:Available tools|Query Plan|Rules|System Instructions)/i,
  /You are a query planning assistant/i,
  /You are a portfolio assistant generating structured content blocks/i
];

export interface LeakCheckResult {
  passed: boolean;
  leaks: string[];
}

/**
 * Checks whether the response contains internal implementation identifiers
 * or system prompt fragments that should never be exposed to end users.
 */
export function checkForLeaks(response: string): LeakCheckResult {
  const leaks: string[] = [];

  for (const identifier of INTERNAL_IDENTIFIERS) {
    if (response.includes(identifier)) {
      leaks.push(identifier);
    }
  }

  for (const pattern of SYSTEM_PROMPT_SECTION_PATTERNS) {
    if (pattern.test(response)) {
      leaks.push(pattern.source);
    }
  }

  return {
    passed: leaks.length === 0,
    leaks
  };
}

/**
 * Validates agent responses against financial domain rules.
 * Checks for buy/sell recommendations, return predictions, and missing disclaimers.
 */
export function checkDomainConstraints(response: string): VerificationResult {
  const violations: ConstraintViolation[] = [];

  // Rule 1: No buy/sell recommendations
  for (const pattern of BUY_SELL_PATTERNS) {
    if (pattern.test(response)) {
      violations.push({
        rule: 'no-buy-sell-recommendations',
        severity: 'error',
        description: `Response contains buy/sell recommendation matching: ${pattern.source}`
      });
      break; // One violation per rule is enough
    }
  }

  // Rule 2: No specific return predictions
  for (const pattern of PREDICTION_PATTERNS) {
    if (pattern.test(response)) {
      violations.push({
        rule: 'no-return-predictions',
        severity: 'error',
        description: `Response contains return prediction matching: ${pattern.source}`
      });
      break;
    }
  }

  // Rule 3: Disclaimer present if discussing portfolio data
  const needsDisclaimer = discussesPortfolioData(response);
  const hasDisclaimer = response
    .toLowerCase()
    .includes('informational purposes only');

  if (needsDisclaimer && !hasDisclaimer) {
    violations.push({
      rule: 'disclaimer-required',
      severity: 'warning',
      description: 'Response discusses portfolio data but lacks disclaimer'
    });
  }

  // Rule 4: No off-topic content (only flag if no financial context is present)
  if (hasOffTopicIndicators(response) && !hasFinancialContext(response)) {
    violations.push({
      rule: 'no-off-topic-content',
      severity: 'error',
      description:
        'Response contains off-topic content unrelated to portfolio analysis'
    });
  }

  const passed = violations.every((v) => v.severity !== 'error');
  const modifiedResponse =
    needsDisclaimer && !hasDisclaimer
      ? `${response}\n\n*${DISCLAIMER}*`
      : response;

  return {
    passed,
    violations,
    modifiedResponse
  };
}
