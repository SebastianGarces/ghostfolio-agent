/**
 * Eval runner for Ghostfolio Agent.
 *
 * Runs test cases against the real LLM with mocked Ghostfolio API responses.
 * Supports multiple portfolio archetypes for diverse testing.
 * Requires OPENAI_API_KEY env var.
 *
 * Usage: bun run src/test/eval/run-evals.ts
 */
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import type { AgentResponse, TokenUsage } from '../../server/agent';
import { createAndRunAgent, deleteSession } from '../../server/agent';
import type { IGhostfolioClient } from '../../server/tools/create-tool';
import type { GroundednessResult } from '../../server/verification/groundedness-scoring';
import { COMMON_WORDS as COMMON_WORDS_SET } from '../../server/verification/hallucination-detection';

// --- ANSI color helpers ---
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m'
};

const CATEGORY_COLORS: Record<string, string> = {
  'happy-path': `${c.bgGreen}${c.bold}  HAPPY  `,
  'multi-tool': `${c.bgBlue}${c.bold}  MULTI  `,
  reasoning: `${c.bgCyan}${c.bold} REASON  `,
  adversarial: `${c.bgRed}${c.bold}   ADV   `,
  'edge-case': `${c.bgYellow}${c.bold}  EDGE   `
};

function categoryBadge(category: string): string {
  return (
    (CATEGORY_COLORS[category] ??
      `${c.bgMagenta}${c.bold} ${category.slice(0, 5).toUpperCase()} `) +
    c.reset
  );
}

function toolList(tools: string[]): string {
  if (tools.length === 0) return `${c.dim}(none)${c.reset}`;
  return tools.map((t) => `${c.cyan}${t}${c.reset}`).join(', ');
}

function toolMatch(
  expected: string[],
  alternatives: string[],
  actual: string[]
): string {
  if (expected.length === 0 && actual.length === 0) {
    return `${c.dim}no tools expected, none called${c.reset}`;
  }
  if (expected.length === 0 && actual.length > 0) {
    return `${c.dim}none expected${c.reset}, called: ${actual.map((t) => `${c.yellow}${t}${c.reset}`).join(', ')}`;
  }

  const parts: string[] = [];
  const allAcceptable = new Set([...expected, ...alternatives]);

  for (const t of expected) {
    if (actual.includes(t)) {
      parts.push(`${c.green}${t} ✓${c.reset}`);
    } else {
      // Check if an alternative was used instead
      const altUsed = alternatives.find((alt) => actual.includes(alt));
      if (altUsed) {
        parts.push(
          `${c.yellow}${t} ~${c.reset} ${c.dim}(${altUsed} used instead)${c.reset}`
        );
      } else {
        parts.push(`${c.red}${t} ✗${c.reset}`);
      }
    }
  }

  // Show extra tools called beyond expected + alternatives
  const extra = actual.filter((t) => !allAcceptable.has(t));
  for (const t of extra) {
    parts.push(`${c.yellow}+${t}${c.reset}`);
  }

  return parts.join(', ');
}

function verificationSummary(v: AgentResponse['verification']): string {
  if (!v) return `${c.dim}(no verification)${c.reset}`;
  const domainIcon = v.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const outputIcon = v.outputValidation?.passed
    ? `${c.green}✓${c.reset}`
    : `${c.red}✗${c.reset}`;
  const confLevel = v.confidence?.level ?? '?';
  const confColor =
    confLevel === 'high' ? c.green : confLevel === 'medium' ? c.yellow : c.red;
  const confScore = v.confidence?.score?.toFixed(2) ?? '?';

  const hallucinationIcon =
    v.hallucination != null
      ? v.hallucination.passed
        ? `${c.green}✓${c.reset}`
        : `${c.yellow}⚠${c.reset}`
      : `${c.dim}-${c.reset}`;

  const gnd = v.groundedness;
  const gndStr = gnd
    ? `${c.dim}ground:${c.reset} acc:${gnd.accuracy.score.toFixed(2)} prec:${gnd.precision.score.toFixed(2)} gnd:${gnd.groundedness.score.toFixed(2)} (${gnd.overall.toFixed(2)})`
    : '';

  return `domain:${domainIcon} output:${outputIcon} halluc:${hallucinationIcon} confidence:${confColor}${confLevel}(${confScore})${c.reset}${gndStr ? ` ${gndStr}` : ''}`;
}

const DISCLAIMER_PATTERN = /informational purposes only/i;

/** Max parallel LLM calls. Override with EVAL_CONCURRENCY env var. */
const CONCURRENCY = parseInt(process.env.EVAL_CONCURRENCY ?? '3', 10);

// --- Fixture loading with per-portfolio support ---
interface FixtureSet {
  portfolioDetails: any;
  portfolioPerformance: any;
  portfolioReport: any;
  portfolioDividends: any;
  portfolioInvestments: any;
  portfolioHoldings: any;
}

const fixtureCache = new Map<string, FixtureSet>();

function loadFixtures(portfolio: string): FixtureSet {
  const cached = fixtureCache.get(portfolio);
  if (cached) return cached;

  const fixturesDir = resolve(import.meta.dir, '../fixtures', portfolio);

  const fixtures: FixtureSet = {
    portfolioDetails: JSON.parse(
      readFileSync(resolve(fixturesDir, 'portfolio-details.json'), 'utf-8')
    ),
    portfolioPerformance: JSON.parse(
      readFileSync(resolve(fixturesDir, 'portfolio-performance.json'), 'utf-8')
    ),
    portfolioReport: JSON.parse(
      readFileSync(resolve(fixturesDir, 'portfolio-report.json'), 'utf-8')
    ),
    portfolioDividends: JSON.parse(
      readFileSync(resolve(fixturesDir, 'portfolio-dividends.json'), 'utf-8')
    ),
    portfolioInvestments: JSON.parse(
      readFileSync(resolve(fixturesDir, 'portfolio-investments.json'), 'utf-8')
    ),
    portfolioHoldings: JSON.parse(
      readFileSync(resolve(fixturesDir, 'portfolio-holdings.json'), 'utf-8')
    )
  };

  fixtureCache.set(portfolio, fixtures);
  return fixtures;
}

// --- Asset-class filtering helpers for mock client ---
function filterDetailsByAssetClass(data: any, assetClasses: string): any {
  const classes = assetClasses.split(',').map((c) => c.trim().toUpperCase());
  const filteredHoldings: Record<string, any> = {};

  for (const [symbol, holding] of Object.entries<any>(data.holdings ?? {})) {
    if (classes.includes(holding.assetClass)) {
      filteredHoldings[symbol] = holding;
    }
  }

  // Recompute summary from filtered holdings
  const entries = Object.values(filteredHoldings);
  const totalInvestment = entries.reduce(
    (sum: number, h: any) => sum + (h.investment ?? 0),
    0
  );
  const totalValue = entries.reduce(
    (sum: number, h: any) => sum + (h.valueInBaseCurrency ?? 0),
    0
  );
  const netPerformance = entries.reduce(
    (sum: number, h: any) => sum + (h.netPerformance ?? 0),
    0
  );

  return {
    ...data,
    holdings: filteredHoldings,
    summary: {
      ...data.summary,
      totalInvestment,
      currentNetWorth: totalValue,
      netPerformance,
      netPerformancePercentage:
        totalInvestment > 0 ? netPerformance / totalInvestment : 0
    }
  };
}

function filterPerformanceByAssetClass(
  data: any,
  detailsData: any,
  assetClasses: string
): any {
  const filtered = filterDetailsByAssetClass(detailsData, assetClasses);
  const summary = filtered.summary;

  return {
    ...data,
    firstOrderDate: data.firstOrderDate,
    performance: {
      ...data.performance,
      currentNetWorth: summary.currentNetWorth,
      currentValueInBaseCurrency: summary.currentNetWorth,
      netPerformance: summary.netPerformance,
      netPerformancePercentage: summary.netPerformancePercentage,
      netPerformancePercentageWithCurrencyEffect:
        summary.netPerformancePercentage,
      netPerformanceWithCurrencyEffect: summary.netPerformance,
      totalInvestment: summary.totalInvestment,
      totalInvestmentValueWithCurrencyEffect: summary.totalInvestment
    }
  };
}

function filterHoldingsByAssetClass(data: any, assetClasses: string): any {
  const classes = assetClasses.split(',').map((c) => c.trim().toUpperCase());
  return {
    holdings: (data.holdings ?? []).filter((h: any) =>
      classes.includes(h.assetClass)
    )
  };
}

function filterHoldingsByQuery(data: any, query: string): any {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t: string) => t.length > 0);
  return {
    holdings: (data.holdings ?? []).filter((h: any) => {
      const fields = [
        (h.symbol ?? '').toLowerCase(),
        (h.name ?? '').toLowerCase(),
        (h.assetClass ?? '').toLowerCase(),
        (h.assetSubClass ?? '').toLowerCase()
      ].join(' ');
      return terms.every((t: string) => fields.includes(t));
    })
  };
}

// --- Mock Ghostfolio client factory ---
function createMockClient(fixtures: FixtureSet): IGhostfolioClient {
  return {
    async get<T>(
      path: string,
      params?: Record<string, string | boolean | undefined>
    ): Promise<T> {
      const assetClasses = params?.assetClasses as string | undefined;

      if (path.includes('/portfolio/holdings')) {
        let result = fixtures.portfolioHoldings;
        if (assetClasses) {
          result = filterHoldingsByAssetClass(result, assetClasses);
        }
        if (params?.query) {
          result = filterHoldingsByQuery(result, params.query as string);
        }
        return result as T;
      }
      if (path.includes('/portfolio/details')) {
        if (assetClasses) {
          return filterDetailsByAssetClass(
            fixtures.portfolioDetails,
            assetClasses
          ) as T;
        }
        return fixtures.portfolioDetails as T;
      }
      if (path.includes('/portfolio/performance')) {
        if (assetClasses) {
          return filterPerformanceByAssetClass(
            fixtures.portfolioPerformance,
            fixtures.portfolioDetails,
            assetClasses
          ) as T;
        }
        return fixtures.portfolioPerformance as T;
      }
      if (path.includes('/portfolio/report')) {
        return fixtures.portfolioReport as T;
      }
      if (path.includes('/portfolio/dividends')) {
        return fixtures.portfolioDividends as T;
      }
      if (path.includes('/portfolio/investments')) {
        return fixtures.portfolioInvestments as T;
      }
      if (path.includes('/symbol/lookup')) {
        return {
          items: [
            {
              dataSource: 'YAHOO',
              symbol: params?.query ?? 'UNKNOWN',
              name: `Mock ${params?.query ?? 'Unknown'}`,
              currency: 'USD',
              assetClass: 'EQUITY',
              assetSubClass: 'STOCK'
            }
          ]
        } as T;
      }
      if (path.includes('/symbol/')) {
        return {
          marketPrice: 100.0,
          currency: 'USD',
          dataSource: 'YAHOO',
          symbol: 'MOCK',
          historicalData: []
        } as T;
      }
      throw new Error(`Mock: unhandled path ${path}`);
    }
  };
}

// --- Eval types ---
interface EvalCase {
  id: string;
  category: string;
  /** Fine-grained label for coverage matrix (e.g. "single_tool_equity", "prompt_injection") */
  subcategory?: string;
  /** Test difficulty: "straightforward" | "moderate" | "complex" */
  difficulty?: 'straightforward' | 'moderate' | 'complex';
  query: string;
  expectedTools: string[];
  /** Tools that are acceptable substitutes for expectedTools (agent made a valid choice) */
  acceptableAlternativeTools?: string[];
  expectedContains: string[];
  expectedNotContains: string[];
  /** null = don't check, true/false = assert verification.passed */
  expectedVerificationPassed: boolean | null;
  /** null = don't check, true = must contain disclaimer, false = must not */
  expectedDisclaimerPresent: boolean | null;
  /** Portfolio fixture set to use (default: 'balanced-growth') */
  portfolio?: string;
  /** null = don't check, true/false = assert hallucination.passed */
  expectedHallucinationPassed?: boolean | null;
}

interface EvalResult {
  id: string;
  category: string;
  subcategory: string;
  difficulty: string;
  query: string;
  portfolio: string;
  passed: boolean;
  failures: string[];
  toolCalls: string[];
  /** Number of extra tools called beyond expected + alternatives */
  extraTools: number;
  responseSnippet: string;
  /** Full response text (only populated in verbose mode) */
  fullResponse?: string;
  /** Raw tool call results with data (only populated in verbose mode) */
  toolCallDetails?: { name: string; success: boolean; data?: unknown }[];
  durationMs: number;
  verification: AgentResponse['verification'] | null;
  groundedness: GroundednessResult | null;
  tokenUsage: TokenUsage | null;
}

// --- CLI argument parsing ---
function parseArgs(argv: string[]): {
  category?: string;
  subcategory?: string;
  difficulty?: string;
  portfolio?: string;
  id?: string;
  verbose: boolean;
} {
  const args: Record<string, string> = {};
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--category' && argv[i + 1]) args.category = argv[++i];
    if (argv[i] === '--subcategory' && argv[i + 1])
      args.subcategory = argv[++i];
    if (argv[i] === '--difficulty' && argv[i + 1]) args.difficulty = argv[++i];
    if (argv[i] === '--portfolio' && argv[i + 1]) args.portfolio = argv[++i];
    if (argv[i] === '--id' && argv[i + 1]) args.id = argv[++i];
    if (argv[i] === '--verbose' || argv[i] === '-v') verbose = true;
  }
  return { ...args, verbose };
}

// --- Main ---
async function runEvals() {
  const casesPath = resolve(import.meta.dir, 'eval-cases.json');
  const allCases: EvalCase[] = JSON.parse(readFileSync(casesPath, 'utf-8'));

  // Apply CLI filters
  const args = parseArgs(process.argv.slice(2));
  let cases = allCases;
  if (args.category)
    cases = cases.filter((tc) => tc.category === args.category);
  if (args.subcategory)
    cases = cases.filter((tc) => tc.subcategory === args.subcategory);
  if (args.difficulty)
    cases = cases.filter((tc) => tc.difficulty === args.difficulty);
  if (args.portfolio)
    cases = cases.filter(
      (tc) => (tc.portfolio ?? 'balanced-growth') === args.portfolio
    );
  if (args.id) cases = cases.filter((tc) => tc.id === args.id);

  if (cases.length === 0) {
    console.error(
      `${c.red}${c.bold}ERROR:${c.reset} No eval cases match the given filters.`
    );
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      `${c.red}${c.bold}ERROR:${c.reset} OPENAI_API_KEY is required to run evals.`
    );
    process.exit(1);
  }

  const filterParts: string[] = [];
  if (args.category) filterParts.push(`category=${args.category}`);
  if (args.subcategory) filterParts.push(`subcategory=${args.subcategory}`);
  if (args.difficulty) filterParts.push(`difficulty=${args.difficulty}`);
  if (args.portfolio) filterParts.push(`portfolio=${args.portfolio}`);
  if (args.id) filterParts.push(`id=${args.id}`);
  const filterStr =
    filterParts.length > 0
      ? `  ${c.yellow}filters: ${filterParts.join(', ')}${c.reset}`
      : '';

  console.log(
    `\n${c.bold}═══════════════════════════════════════════════════${c.reset}`
  );
  console.log(
    `${c.bold}  Ghostfolio Agent Eval Suite${c.reset}  ${c.dim}(${cases.length}/${allCases.length} cases, ${new Set(cases.map((tc) => tc.portfolio ?? 'balanced-growth')).size} portfolios)${c.reset}`
  );
  if (filterStr) console.log(filterStr);
  console.log(
    `${c.bold}═══════════════════════════════════════════════════${c.reset}\n`
  );

  const results: EvalResult[] = [];
  const MOCK_JWT = 'eval-mock-jwt';

  console.log(`  ${c.dim}Concurrency: ${CONCURRENCY}${c.reset}\n`);

  // --- Single eval case runner (returns result, no console output) ---
  async function runSingleEval(tc: EvalCase): Promise<EvalResult> {
    const portfolio = tc.portfolio ?? 'balanced-growth';
    const failures: string[] = [];
    let toolCalls: string[] = [];
    let responseSnippet = '';
    let fullResponse: string | undefined;
    let toolCallDetails:
      | { name: string; success: boolean; data?: unknown }[]
      | undefined;
    let verification: AgentResponse['verification'] | null = null;
    let tokenUsage: TokenUsage | null = null;
    const startTime = Date.now();

    try {
      // Clean stale checkpointer state from previous runs to prevent
      // INVALID_TOOL_RESULTS errors from orphaned tool_calls.
      await deleteSession(`eval-${tc.id}`);

      const fixtures = loadFixtures(portfolio);
      const mockClient = createMockClient(fixtures);

      const result = await createAndRunAgent(
        MOCK_JWT,
        tc.query,
        `eval-${tc.id}`,
        {
          temperature: 0,
          maxTokens: 1024,
          client: mockClient
        }
      );

      toolCalls = result.toolCalls.map((t) => t.name);
      responseSnippet = result.response.substring(0, 200);
      verification = result.verification ?? null;
      tokenUsage = result.tokenUsage ?? null;
      const responseLower = result.response.toLowerCase();

      // Capture full data in verbose mode
      if (args.verbose) {
        fullResponse = result.response;
        toolCallDetails = result.toolCalls;
      }

      // --- Assertion: expected tools were called (or acceptable alternatives) ---
      const alternatives = tc.acceptableAlternativeTools ?? [];

      for (const expectedTool of tc.expectedTools) {
        if (!toolCalls.includes(expectedTool)) {
          const altUsed = alternatives.some((alt) => toolCalls.includes(alt));
          if (!altUsed) {
            failures.push(
              `Expected tool "${expectedTool}" (or alternatives: ${alternatives.join(', ') || 'none'}) not called. Got: [${toolCalls.join(', ')}]`
            );
          }
        }
      }

      // --- Assertion: expected keywords present ---
      // Supports "|" as OR (e.g., "BTC|Bitcoin" matches if either is present)
      for (const keyword of tc.expectedContains) {
        const alternatives = keyword.split('|');
        const found = alternatives.some((alt) =>
          responseLower.includes(alt.toLowerCase())
        );
        if (!found) {
          failures.push(`Missing expected keyword: "${keyword}"`);
        }
      }

      // --- Assertion: forbidden keywords absent ---
      for (const keyword of tc.expectedNotContains) {
        if (responseLower.includes(keyword.toLowerCase())) {
          failures.push(`Contains forbidden keyword: "${keyword}"`);
        }
      }

      // --- Assertion: verification passed/failed as expected ---
      if (tc.expectedVerificationPassed !== null && verification) {
        if (tc.expectedVerificationPassed && !verification.passed) {
          const violations = verification.violations
            .filter((v) => v.severity === 'error')
            .map((v) => v.rule)
            .join(', ');
          failures.push(
            `Verification should have passed but failed (errors: ${violations})`
          );
        }
        if (!tc.expectedVerificationPassed && verification.passed) {
          failures.push(
            'Verification should have failed but passed (expected a domain violation)'
          );
        }
      }

      // --- Assertion: disclaimer present/absent ---
      if (tc.expectedDisclaimerPresent !== null) {
        const hasDisclaimer = DISCLAIMER_PATTERN.test(result.response);
        if (tc.expectedDisclaimerPresent && !hasDisclaimer) {
          failures.push('Response should contain disclaimer but does not');
        }
      }

      // --- Assertion: hallucination check ---
      if (
        tc.expectedHallucinationPassed != null &&
        verification?.hallucination
      ) {
        if (
          tc.expectedHallucinationPassed &&
          !verification.hallucination.passed
        ) {
          const issues = verification.hallucination.issues
            .map((i) => `${i.type}: ${i.claimed}`)
            .join(', ');
          failures.push(
            `Hallucination check should have passed but found issues: ${issues}`
          );
        }
        if (
          !tc.expectedHallucinationPassed &&
          verification.hallucination.passed
        ) {
          failures.push(
            'Hallucination check should have found issues but passed cleanly'
          );
        }
      }
    } catch (error) {
      failures.push(
        `Exception: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const durationMs = Date.now() - startTime;
    const passed = failures.length === 0;

    // Count extra tools beyond expected + alternatives
    const allAcceptable = new Set([
      ...tc.expectedTools,
      ...(tc.acceptableAlternativeTools ?? [])
    ]);
    const extraTools =
      tc.expectedTools.length > 0
        ? toolCalls.filter((t) => !allAcceptable.has(t)).length
        : 0;

    return {
      id: tc.id,
      category: tc.category,
      subcategory: tc.subcategory ?? 'untagged',
      difficulty: tc.difficulty ?? 'untagged',
      query: tc.query,
      portfolio,
      passed,
      failures,
      toolCalls,
      extraTools,
      responseSnippet,
      fullResponse,
      toolCallDetails,
      durationMs,
      verification,
      groundedness: verification?.groundedness ?? null,
      tokenUsage
    };
  }

  // --- Print a single eval result ---
  function printResult(r: EvalResult, tc: EvalCase, index: number): void {
    const queryDisplay =
      tc.query.length > 60 ? tc.query.substring(0, 57) + '...' : tc.query;

    process.stdout.write(
      `${c.dim}[${index}/${cases.length}]${c.reset} ${categoryBadge(tc.category)} ${c.bold}${tc.id}${c.reset} ${c.dim}[${r.portfolio}]${c.reset} ${c.dim}${queryDisplay}${c.reset}\n`
    );

    const status = r.passed
      ? `${c.green}${c.bold}  ✓ PASS${c.reset}`
      : `${c.red}${c.bold}  ✗ FAIL${c.reset}`;
    const duration = `${c.dim}${r.durationMs}ms${c.reset}`;

    console.log(`${status}  ${duration}`);
    console.log(
      `  ${c.dim}tools:${c.reset}  ${toolMatch(tc.expectedTools, tc.acceptableAlternativeTools ?? [], r.toolCalls)}`
    );
    console.log(
      `  ${c.dim}verify:${c.reset} ${verificationSummary(r.verification)}`
    );

    // Show hallucination issues inline (regardless of pass/fail)
    const hallIssues = r.verification?.hallucination?.issues ?? [];
    if (hallIssues.length > 0) {
      console.log(
        `  ${c.yellow}halluc(${hallIssues.length}):${c.reset} ${hallIssues.map((i) => `${c.dim}${i.type}:${c.reset}${c.yellow}${i.claimed}${c.reset}`).join(', ')}`
      );

      // Verbose: full prompt, tool data, highlighted response, issue list
      if (args.verbose && r.fullResponse && r.toolCallDetails) {
        printVerboseDetails(
          r.query,
          hallIssues,
          r.fullResponse,
          r.toolCallDetails
        );
      }
    }

    if (!r.passed) {
      for (const f of r.failures) {
        console.log(`  ${c.red}→ ${f}${c.reset}`);
      }
    }

    console.log('');
  }

  /**
   * Highlight percentages, dollar amounts, and uppercase symbols (potential
   * tickers) in a block of text.  Symbols that appear in `knownSymbols` are
   * shown in green; unknown ones in yellow.
   */
  function highlightFinancials(
    text: string,
    knownSymbols: Set<string>
  ): string {
    // Order matters: match dollars first (they start with $), then %, then symbols.
    // We combine them into one regex so overlapping spans are handled naturally.
    return text.replace(
      /(\$\s*[\d,]+(?:\.\d+)?)|(\d+(?:\.\d+)?\s*%)|(\b[A-Z]{1,5}\b)/g,
      (match, dollar, pct, sym) => {
        if (dollar) return `${c.magenta}${c.bold}${dollar}${c.reset}`;
        if (pct) return `${c.cyan}${c.bold}${pct}${c.reset}`;
        if (sym) {
          if (COMMON_WORDS_SET.has(sym)) return match; // leave common words plain
          if (knownSymbols.has(sym))
            return `${c.green}${c.bold}${sym}${c.reset}`;
          return `${c.yellow}${c.bold}${sym}${c.reset}`;
        }
        return match;
      }
    );
  }

  // --- Verbose detail printer ---
  function printVerboseDetails(
    query: string,
    issues: {
      type: string;
      severity: string;
      claimed: string;
      actual?: string;
      description: string;
    }[],
    fullResponse: string,
    toolCallDetails: { name: string; success: boolean; data?: unknown }[]
  ): void {
    const PAD = '    ';
    const HDIV = `${PAD}${c.dim}${'═'.repeat(74)}${c.reset}`;
    const SDIV = `${PAD}${c.dim}${'─'.repeat(74)}${c.reset}`;

    // Collect known symbols from tool data for highlighting
    const knownSymbols = new Set<string>();
    for (const tc of toolCallDetails) {
      if (!tc.success || !tc.data) continue;
      const data = tc.data as any;
      if (Array.isArray(data.holdings)) {
        for (const h of data.holdings) {
          if (h.symbol) knownSymbols.add(h.symbol);
        }
      }
      if (data.holdings && !Array.isArray(data.holdings)) {
        for (const h of Object.values<any>(data.holdings)) {
          if (h.symbol) knownSymbols.add(h.symbol);
        }
      }
      if (data.symbol && typeof data.symbol === 'string') {
        knownSymbols.add(data.symbol);
      }
    }

    console.log(HDIV);

    // ── 1. PROMPT ──
    console.log(`${PAD}${c.bold}${c.blue}PROMPT${c.reset}`);
    console.log(`${PAD}${query}`);
    console.log(SDIV);

    // ── 2. TOOL DATA ──
    console.log(`${PAD}${c.bold}${c.blue}TOOL DATA${c.reset}`);
    for (const tc of toolCallDetails) {
      const icon = tc.success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
      console.log(`${PAD}${icon} ${c.cyan}${tc.name}${c.reset}`);
      if (tc.data) {
        const json = JSON.stringify(tc.data, null, 2);
        for (const line of json.split('\n')) {
          console.log(`${PAD}  ${c.dim}${line}${c.reset}`);
        }
      } else {
        console.log(`${PAD}  ${c.dim}(no data)${c.reset}`);
      }
    }
    console.log(SDIV);

    // ── 3. LLM RESPONSE (highlighted) ──
    console.log(`${PAD}${c.bold}${c.blue}LLM RESPONSE${c.reset}`);
    const highlighted = highlightFinancials(fullResponse, knownSymbols);
    for (const line of highlighted.split('\n')) {
      console.log(`${PAD}${line}`);
    }
    console.log(SDIV);

    // ── 4. ISSUES ──
    console.log(
      `${PAD}${c.bold}${c.blue}HALLUCINATION ISSUES (${issues.length})${c.reset}`
    );
    for (let idx = 0; idx < issues.length; idx++) {
      const issue = issues[idx];
      console.log(
        `${PAD}${c.yellow}${c.bold}[${idx + 1}] ${issue.type}${c.reset}`
      );
      console.log(`${PAD}  claimed: ${issue.claimed}`);
      if (issue.actual) {
        console.log(`${PAD}  actual:  ${issue.actual}`);
      }
      console.log(`${PAD}  ${c.dim}${issue.description}${c.reset}`);
    }

    console.log(HDIV);
  }

  // --- Run evals in batches with bounded concurrency ---
  let completed = 0;
  const wallClockStart = Date.now();

  for (let i = 0; i < cases.length; i += CONCURRENCY) {
    const batch = cases.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((tc) => runSingleEval(tc))
    );

    // Print results in case order after the batch completes
    for (let j = 0; j < batch.length; j++) {
      completed++;
      const settled = batchResults[j];

      if (settled.status === 'fulfilled') {
        const r = settled.value;
        results.push(r);
        printResult(r, batch[j], completed);
      } else {
        // Promise rejection (shouldn't happen since runSingleEval catches errors)
        const r: EvalResult = {
          id: batch[j].id,
          category: batch[j].category,
          subcategory: batch[j].subcategory ?? 'untagged',
          difficulty: batch[j].difficulty ?? 'untagged',
          query: batch[j].query,
          portfolio: batch[j].portfolio ?? 'balanced-growth',
          passed: false,
          failures: [`Unhandled rejection: ${settled.reason}`],
          toolCalls: [],
          extraTools: 0,
          responseSnippet: '',
          durationMs: 0,
          verification: null,
          groundedness: null,
          tokenUsage: null
        };
        results.push(r);
        printResult(r, batch[j], completed);
      }
    }
  }

  // --- Summary ---
  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.length - passCount;
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const wallClockMs = Date.now() - wallClockStart;

  console.log(
    `${c.bold}═══════════════════════════════════════════════════${c.reset}`
  );
  console.log(`${c.bold}  Results${c.reset}`);
  console.log(
    `${c.bold}═══════════════════════════════════════════════════${c.reset}`
  );

  const passRate = ((passCount / results.length) * 100).toFixed(1);
  const passRateColor =
    passCount === results.length
      ? c.green
      : failCount > results.length / 2
        ? c.red
        : c.yellow;

  console.log(
    `\n  ${c.bold}Total:${c.reset} ${results.length}  ${c.green}${c.bold}Pass: ${passCount}${c.reset}  ${failCount > 0 ? `${c.red}${c.bold}Fail: ${failCount}${c.reset}` : `${c.dim}Fail: 0${c.reset}`}  ${c.dim}Wall: ${(wallClockMs / 1000).toFixed(1)}s  Sum: ${(totalDuration / 1000).toFixed(1)}s${c.reset}`
  );
  console.log(`  ${c.bold}Pass rate: ${passRateColor}${passRate}%${c.reset}\n`);

  // Category breakdown
  const categories = [...new Set(results.map((r) => r.category))];

  console.log(`  ${c.bold}By category:${c.reset}`);
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPass = catResults.filter((r) => r.passed).length;
    const catColor = catPass === catResults.length ? c.green : c.yellow;
    console.log(
      `  ${categoryBadge(cat)} ${catColor}${catPass}/${catResults.length}${c.reset}`
    );
  }

  // Difficulty breakdown
  const difficulties = ['straightforward', 'moderate', 'complex'];
  const activeDifficulties = difficulties.filter((d) =>
    results.some((r) => r.difficulty === d)
  );
  if (activeDifficulties.length > 0) {
    console.log(`\n  ${c.bold}By difficulty:${c.reset}`);
    for (const diff of activeDifficulties) {
      const diffResults = results.filter((r) => r.difficulty === diff);
      const diffPass = diffResults.filter((r) => r.passed).length;
      const diffColor = diffPass === diffResults.length ? c.green : c.yellow;
      console.log(
        `  ${c.dim}[${diff}]${c.reset} ${diffColor}${diffPass}/${diffResults.length}${c.reset}`
      );
    }
  }

  // Coverage matrix: category x subcategory
  const subcategories = [...new Set(results.map((r) => r.subcategory))].sort();
  if (subcategories.length > 0) {
    console.log(
      `\n  ${c.bold}Coverage Matrix (category × subcategory):${c.reset}`
    );

    // Header
    const subColWidth = Math.max(...subcategories.map((s) => s.length), 12);
    const headerPad = ' '.repeat(subColWidth + 4);
    const catHeaders = categories.map((cat) => cat.slice(0, 8).padEnd(8));
    console.log(`  ${c.dim}${headerPad}${catHeaders.join('  ')}${c.reset}`);

    // Rows
    for (const sub of subcategories) {
      const subLabel = sub.padEnd(subColWidth);
      const cells = categories.map((cat) => {
        const matching = results.filter(
          (r) => r.category === cat && r.subcategory === sub
        );
        if (matching.length === 0) {
          return `${c.dim}   --   ${c.reset}`;
        }
        const pass = matching.filter((r) => r.passed).length;
        const color =
          pass === matching.length ? c.green : pass > 0 ? c.yellow : c.red;
        return `${color}${String(pass).padStart(2)}/${String(matching.length).padEnd(2)}   ${c.reset}`;
      });
      console.log(`  ${c.dim}  ${subLabel}${c.reset}  ${cells.join('  ')}`);
    }
  }

  // Portfolio breakdown
  const portfolios = [...new Set(results.map((r) => r.portfolio))];

  console.log(`\n  ${c.bold}By portfolio:${c.reset}`);
  for (const portfolio of portfolios) {
    const portResults = results.filter((r) => r.portfolio === portfolio);
    const portPass = portResults.filter((r) => r.passed).length;
    const portColor = portPass === portResults.length ? c.green : c.yellow;
    console.log(
      `  ${c.dim}[${portfolio}]${c.reset} ${portColor}${portPass}/${portResults.length}${c.reset}`
    );
  }

  // Confidence summary
  const confidenceResults = results.filter((r) => r.verification?.confidence);
  if (confidenceResults.length > 0) {
    const avgScore =
      confidenceResults.reduce(
        (sum, r) => sum + (r.verification?.confidence?.score ?? 0),
        0
      ) / confidenceResults.length;
    const levels = { high: 0, medium: 0, low: 0 };
    for (const r of confidenceResults) {
      const level = r.verification?.confidence?.level;
      if (level) levels[level]++;
    }
    console.log(
      `\n  ${c.bold}Confidence:${c.reset} ${c.dim}(thresholds: ${c.green}high${c.dim} ≥0.70  ${c.yellow}medium${c.dim} ≥0.40  ${c.red}low${c.dim} <0.40)${c.reset}`
    );
    console.log(
      `  avg score: ${avgScore.toFixed(2)}  ${c.green}high:${levels.high}${c.reset} ${c.yellow}med:${levels.medium}${c.reset} ${c.red}low:${levels.low}${c.reset}`
    );
  }

  // Hallucination summary
  const hallucinationResults = results.filter(
    (r) => r.verification?.hallucination
  );
  if (hallucinationResults.length > 0) {
    const hallPass = hallucinationResults.filter(
      (r) => r.verification?.hallucination?.passed
    ).length;
    const hallWarn = hallucinationResults.length - hallPass;
    console.log(
      `\n  ${c.bold}Hallucination:${c.reset} ${c.green}clean:${hallPass}${c.reset} ${c.yellow}warnings:${hallWarn}${c.reset}`
    );
  }

  // Tool Efficiency summary
  const toolResults = results.filter(
    (r) =>
      r.toolCalls.length > 0 ||
      allCases.find((tc) => tc.id === r.id)?.expectedTools?.length
  );
  const casesWithTools = results.filter(
    (r) => allCases.find((tc) => tc.id === r.id)?.expectedTools?.length
  );
  if (casesWithTools.length > 0) {
    const totalExtraTools = casesWithTools.reduce(
      (sum, r) => sum + r.extraTools,
      0
    );
    const casesWithExtras = casesWithTools.filter(
      (r) => r.extraTools > 0
    ).length;
    const exactMatchCount = casesWithTools.filter(
      (r) => r.extraTools === 0
    ).length;
    const efficiencyRate = (
      (exactMatchCount / casesWithTools.length) *
      100
    ).toFixed(1);
    const effColor =
      casesWithExtras === 0
        ? c.green
        : casesWithExtras <= 10
          ? c.yellow
          : c.red;

    console.log(
      `\n  ${c.bold}Tool Efficiency:${c.reset} ${c.dim}(lower extra tools = better)${c.reset}`
    );
    console.log(
      `  exact match: ${effColor}${exactMatchCount}/${casesWithTools.length} (${efficiencyRate}%)${c.reset}  extra calls: ${effColor}${totalExtraTools}${c.reset} across ${casesWithExtras} cases`
    );

    // Show which cases had extra tools
    if (casesWithExtras > 0) {
      const extraCases = casesWithTools
        .filter((r) => r.extraTools > 0)
        .map((r) => {
          const tc = allCases.find((tc) => tc.id === r.id);
          const expected = tc?.expectedTools ?? [];
          const allAcceptable = new Set([
            ...expected,
            ...(tc?.acceptableAlternativeTools ?? [])
          ]);
          const extras = r.toolCalls.filter((t) => !allAcceptable.has(t));
          return `${c.dim}${r.id}${c.reset}: ${c.yellow}+${extras.join(', +')}${c.reset}`;
        });
      console.log(`  ${extraCases.join('  ')}`);
    }
  }

  // Groundedness summary
  const groundednessResults = results.filter((r) => r.groundedness);
  if (groundednessResults.length > 0) {
    const avgAcc =
      groundednessResults.reduce(
        (sum, r) => sum + (r.groundedness?.accuracy.score ?? 0),
        0
      ) / groundednessResults.length;
    const avgPrec =
      groundednessResults.reduce(
        (sum, r) => sum + (r.groundedness?.precision.score ?? 0),
        0
      ) / groundednessResults.length;
    const avgGnd =
      groundednessResults.reduce(
        (sum, r) => sum + (r.groundedness?.groundedness.score ?? 0),
        0
      ) / groundednessResults.length;
    const avgOverall =
      groundednessResults.reduce(
        (sum, r) => sum + (r.groundedness?.overall ?? 0),
        0
      ) / groundednessResults.length;

    // Distribution
    const dist = { high: 0, medium: 0, low: 0 };
    for (const r of groundednessResults) {
      const o = r.groundedness?.overall ?? 0;
      if (o >= 0.8) dist.high++;
      else if (o >= 0.5) dist.medium++;
      else dist.low++;
    }

    console.log(`\n  ${c.bold}Groundedness:${c.reset}`);
    console.log(
      `  avg: acc:${avgAcc.toFixed(2)} prec:${avgPrec.toFixed(2)} gnd:${avgGnd.toFixed(2)} overall:${avgOverall.toFixed(2)}`
    );
    console.log(
      `  distribution: ${c.green}high(≥0.8):${dist.high}${c.reset} ${c.yellow}med(≥0.5):${dist.medium}${c.reset} ${c.red}low(<0.5):${dist.low}${c.reset}`
    );
  }

  // Token usage summary
  const tokenResults = results.filter((r) => r.tokenUsage);
  if (tokenResults.length > 0) {
    const totalTokens = tokenResults.reduce(
      (sum, r) => sum + (r.tokenUsage?.totalTokens ?? 0),
      0
    );
    const totalCost = tokenResults.reduce(
      (sum, r) => sum + (r.tokenUsage?.estimatedCost ?? 0),
      0
    );
    const avgTokensPerQuery = totalTokens / tokenResults.length;
    const avgCostPerQuery = totalCost / tokenResults.length;

    console.log(
      `\n  ${c.bold}Token Usage:${c.reset} ${c.dim}(estimated)${c.reset}`
    );
    console.log(
      `  total: ${totalTokens.toLocaleString()} tokens  $${totalCost.toFixed(4)}`
    );
    console.log(
      `  avg/query: ${Math.round(avgTokensPerQuery).toLocaleString()} tokens  $${avgCostPerQuery.toFixed(4)}`
    );
  }

  // Latency summary
  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  const SINGLE_TOOL_TARGET_MS = 5000;
  const MULTI_STEP_TARGET_MS = 15000;

  const allDurations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const singleToolDurations = results
    .filter((r) => r.toolCalls.length <= 1)
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);
  const multiStepDurations = results
    .filter((r) => r.toolCalls.length >= 2)
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);

  function latencyStats(sorted: number[]) {
    const avg =
      sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    return {
      avg,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      count: sorted.length
    };
  }

  const overallLatency = latencyStats(allDurations);
  const singleToolLatency = latencyStats(singleToolDurations);
  const multiStepLatency = latencyStats(multiStepDurations);

  const fmtS = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const singleToolWithinTarget = singleToolLatency.avg <= SINGLE_TOOL_TARGET_MS;
  const multiStepWithinTarget = multiStepLatency.avg <= MULTI_STEP_TARGET_MS;

  console.log(
    `\n  ${c.bold}Latency:${c.reset}  ${c.dim}(targets: single-tool <5s, multi-step <15s)${c.reset}`
  );
  console.log(
    `  overall:       avg ${fmtS(overallLatency.avg)}  p50 ${fmtS(overallLatency.p50)}  p95 ${fmtS(overallLatency.p95)}  (${overallLatency.count} queries)`
  );
  if (singleToolLatency.count > 0) {
    const stColor = singleToolWithinTarget ? c.green : c.red;
    const stIcon = singleToolWithinTarget ? '✓' : '✗';
    console.log(
      `  single-tool:   avg ${fmtS(singleToolLatency.avg)}  p50 ${fmtS(singleToolLatency.p50)}  p95 ${fmtS(singleToolLatency.p95)}  (${singleToolLatency.count} queries) ${stColor}${stIcon}${c.reset}`
    );
  }
  if (multiStepLatency.count > 0) {
    const msColor = multiStepWithinTarget ? c.green : c.red;
    const msIcon = multiStepWithinTarget ? '✓' : '✗';
    console.log(
      `  multi-step:    avg ${fmtS(multiStepLatency.avg)}  p50 ${fmtS(multiStepLatency.p50)}  p95 ${fmtS(multiStepLatency.p95)}  (${multiStepLatency.count} queries) ${msColor}${msIcon}${c.reset}`
    );
  }

  // Detailed failure section
  if (failCount > 0) {
    console.log(`\n${c.red}${c.bold}──── Failure Details ────${c.reset}\n`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(
        `${categoryBadge(r.category)} ${c.bold}${r.id}${c.reset} ${c.dim}[${r.portfolio}]${c.reset} "${r.query}"`
      );
      console.log(`  ${c.dim}tools called:${c.reset} ${toolList(r.toolCalls)}`);
      console.log(
        `  ${c.dim}response:${c.reset} ${r.responseSnippet.substring(0, 150)}...`
      );
      console.log(
        `  ${c.dim}verify:${c.reset}  ${verificationSummary(r.verification)}`
      );
      for (const f of r.failures) {
        console.log(`  ${c.red}✗ ${f}${c.reset}`);
      }
      console.log('');
    }
  }

  // --- Write JSON report (skip for single --id runs) ---
  if (!args.id) {
    const resultsDir = resolve(import.meta.dir, 'results');
    mkdirSync(resultsDir, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('Z', 'Z');
    const prefix = args.category ?? 'all';
    const filename = `${prefix}-${timestamp}.json`;

    // Build category breakdown
    const byCategory: Record<string, { passed: number; total: number }> = {};
    for (const cat of categories) {
      const catResults = results.filter((r) => r.category === cat);
      byCategory[cat] = {
        passed: catResults.filter((r) => r.passed).length,
        total: catResults.length
      };
    }

    // Build portfolio breakdown
    const byPortfolio: Record<string, { passed: number; total: number }> = {};
    for (const portfolio of portfolios) {
      const portResults = results.filter((r) => r.portfolio === portfolio);
      byPortfolio[portfolio] = {
        passed: portResults.filter((r) => r.passed).length,
        total: portResults.length
      };
    }

    // Build subcategory breakdown
    const bySubcategory: Record<string, { passed: number; total: number }> = {};
    for (const sub of subcategories) {
      const subResults = results.filter((r) => r.subcategory === sub);
      bySubcategory[sub] = {
        passed: subResults.filter((r) => r.passed).length,
        total: subResults.length
      };
    }

    // Build difficulty breakdown
    const byDifficulty: Record<string, { passed: number; total: number }> = {};
    for (const diff of activeDifficulties) {
      const diffResults = results.filter((r) => r.difficulty === diff);
      byDifficulty[diff] = {
        passed: diffResults.filter((r) => r.passed).length,
        total: diffResults.length
      };
    }

    // Build coverage matrix
    const coverageMatrix: Record<
      string,
      Record<string, { passed: number; total: number }>
    > = {};
    for (const sub of subcategories) {
      coverageMatrix[sub] = {};
      for (const cat of categories) {
        const matching = results.filter(
          (r) => r.category === cat && r.subcategory === sub
        );
        if (matching.length > 0) {
          coverageMatrix[sub][cat] = {
            passed: matching.filter((r) => r.passed).length,
            total: matching.length
          };
        }
      }
    }

    // Build confidence stats
    const confidenceStats =
      confidenceResults.length > 0
        ? {
            avgScore:
              confidenceResults.reduce(
                (sum, r) => sum + (r.verification?.confidence?.score ?? 0),
                0
              ) / confidenceResults.length,
            high: confidenceResults.filter(
              (r) => r.verification?.confidence?.level === 'high'
            ).length,
            medium: confidenceResults.filter(
              (r) => r.verification?.confidence?.level === 'medium'
            ).length,
            low: confidenceResults.filter(
              (r) => r.verification?.confidence?.level === 'low'
            ).length
          }
        : null;

    // Build hallucination stats
    const hallucinationStats =
      hallucinationResults.length > 0
        ? {
            clean: hallucinationResults.filter(
              (r) => r.verification?.hallucination?.passed
            ).length,
            warnings: hallucinationResults.filter(
              (r) => !r.verification?.hallucination?.passed
            ).length
          }
        : null;

    // Build groundedness stats
    const groundednessStats =
      groundednessResults.length > 0
        ? {
            avgAccuracy:
              groundednessResults.reduce(
                (sum, r) => sum + (r.groundedness?.accuracy.score ?? 0),
                0
              ) / groundednessResults.length,
            avgPrecision:
              groundednessResults.reduce(
                (sum, r) => sum + (r.groundedness?.precision.score ?? 0),
                0
              ) / groundednessResults.length,
            avgGroundedness:
              groundednessResults.reduce(
                (sum, r) => sum + (r.groundedness?.groundedness.score ?? 0),
                0
              ) / groundednessResults.length,
            avgOverall:
              groundednessResults.reduce(
                (sum, r) => sum + (r.groundedness?.overall ?? 0),
                0
              ) / groundednessResults.length,
            high: groundednessResults.filter(
              (r) => (r.groundedness?.overall ?? 0) >= 0.8
            ).length,
            medium: groundednessResults.filter(
              (r) =>
                (r.groundedness?.overall ?? 0) >= 0.5 &&
                (r.groundedness?.overall ?? 0) < 0.8
            ).length,
            low: groundednessResults.filter(
              (r) => (r.groundedness?.overall ?? 0) < 0.5
            ).length
          }
        : null;

    // Token usage stats for JSON report
    const tokenStats =
      tokenResults.length > 0
        ? {
            totalTokens: tokenResults.reduce(
              (sum, r) => sum + (r.tokenUsage?.totalTokens ?? 0),
              0
            ),
            totalCost: tokenResults.reduce(
              (sum, r) => sum + (r.tokenUsage?.estimatedCost ?? 0),
              0
            ),
            avgTokensPerQuery: Math.round(
              tokenResults.reduce(
                (sum, r) => sum + (r.tokenUsage?.totalTokens ?? 0),
                0
              ) / tokenResults.length
            ),
            avgCostPerQuery:
              Math.round(
                (tokenResults.reduce(
                  (sum, r) => sum + (r.tokenUsage?.estimatedCost ?? 0),
                  0
                ) /
                  tokenResults.length) *
                  1_000_000
              ) / 1_000_000
          }
        : null;

    const report = {
      timestamp: new Date().toISOString(),
      filters: {
        category: args.category ?? null,
        subcategory: args.subcategory ?? null,
        difficulty: args.difficulty ?? null,
        portfolio: args.portfolio ?? null
      },
      summary: {
        total: results.length,
        passed: passCount,
        failed: failCount,
        passRate: parseFloat(passRate),
        wallClockMs,
        totalDurationMs: totalDuration,
        concurrency: CONCURRENCY,
        latency: {
          overall: {
            avg: Math.round(overallLatency.avg),
            p50: Math.round(overallLatency.p50),
            p95: Math.round(overallLatency.p95),
            count: overallLatency.count
          },
          singleTool: {
            avg: Math.round(singleToolLatency.avg),
            p50: Math.round(singleToolLatency.p50),
            p95: Math.round(singleToolLatency.p95),
            count: singleToolLatency.count,
            targetMs: SINGLE_TOOL_TARGET_MS,
            withinTarget: singleToolWithinTarget
          },
          multiStep: {
            avg: Math.round(multiStepLatency.avg),
            p50: Math.round(multiStepLatency.p50),
            p95: Math.round(multiStepLatency.p95),
            count: multiStepLatency.count,
            targetMs: MULTI_STEP_TARGET_MS,
            withinTarget: multiStepWithinTarget
          }
        }
      },
      byCategory,
      bySubcategory,
      byDifficulty,
      byPortfolio,
      coverageMatrix,
      confidence: confidenceStats,
      hallucination: hallucinationStats,
      groundedness: groundednessStats,
      tokenUsage: tokenStats,
      toolEfficiency:
        casesWithTools.length > 0
          ? {
              exactMatchCount: casesWithTools.filter((r) => r.extraTools === 0)
                .length,
              totalCasesWithTools: casesWithTools.length,
              efficiencyRate: parseFloat(
                (
                  (casesWithTools.filter((r) => r.extraTools === 0).length /
                    casesWithTools.length) *
                  100
                ).toFixed(1)
              ),
              totalExtraToolCalls: casesWithTools.reduce(
                (sum, r) => sum + r.extraTools,
                0
              ),
              casesWithExtraTools: casesWithTools.filter(
                (r) => r.extraTools > 0
              ).length
            }
          : null,
      results: results.map((r) => ({
        id: r.id,
        category: r.category,
        subcategory: r.subcategory,
        difficulty: r.difficulty,
        query: r.query,
        portfolio: r.portfolio,
        passed: r.passed,
        failures: r.failures,
        toolCalls: r.toolCalls,
        extraTools: r.extraTools,
        responseSnippet: r.responseSnippet,
        durationMs: r.durationMs,
        verification: r.verification,
        groundedness: r.groundedness,
        tokenUsage: r.tokenUsage
      }))
    };

    const outputPath = resolve(resultsDir, filename);
    writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(
      `\n  ${c.dim}Results saved to:${c.reset} ${c.cyan}src/test/eval/results/${filename}${c.reset}\n`
    );
  }

  // Flush all LangSmith/LangChain callbacks before exiting
  await awaitAllCallbacks();

  process.exit(failCount > 0 ? 1 : 0);
}

runEvals();
