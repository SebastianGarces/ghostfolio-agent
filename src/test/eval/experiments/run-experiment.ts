/**
 * Experiment runner — runs the full eval suite under different model configurations
 * and saves per-variant results for comparison.
 *
 * Usage:
 *   bun run experiment -- --variant baseline
 *   bun run experiment -- --all
 */
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import type { AgentResponse, TokenUsage } from '../../../server/agent';
import { createAndRunAgent } from '../../../server/agent';
import type { IGhostfolioClient } from '../../../server/tools/create-tool';
import type { GroundednessResult } from '../../../server/verification/groundedness-scoring';

// --- ANSI helpers ---
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

// --- Types ---
interface VariantConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

interface EvalCase {
  id: string;
  category: string;
  query: string;
  expectedTools: string[];
  acceptableAlternativeTools?: string[];
  expectedContains: string[];
  expectedNotContains: string[];
  expectedVerificationPassed: boolean | null;
  expectedDisclaimerPresent: boolean | null;
  portfolio?: string;
  expectedHallucinationPassed?: boolean | null;
}

interface EvalResult {
  id: string;
  category: string;
  query: string;
  portfolio: string;
  passed: boolean;
  failures: string[];
  toolCalls: string[];
  durationMs: number;
  verification: AgentResponse['verification'] | null;
  groundedness: GroundednessResult | null;
  tokenUsage: TokenUsage | null;
}

interface ExperimentResult {
  variant: string;
  config: VariantConfig;
  timestamp: string;
  metrics: {
    passRate: number;
    passCount: number;
    totalCount: number;
    groundedness: {
      accuracy: number;
      precision: number;
      groundedness: number;
      overall: number;
    };
    confidence: {
      avgScore: number;
      distribution: { high: number; medium: number; low: number };
    };
    latency: { mean: number; p50: number; p95: number };
    singleToolLatency?: {
      avg: number;
      p50: number;
      p95: number;
      count: number;
    };
    multiStepLatency?: {
      avg: number;
      p50: number;
      p95: number;
      count: number;
    };
    tokenUsage?: {
      totalTokens: number;
      totalCost: number;
      avgTokensPerQuery: number;
      avgCostPerQuery: number;
    };
  };
  cases: EvalResult[];
}

// --- Fixture loading (duplicated from run-evals.ts for standalone usage) ---
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

  const fixturesDir = resolve(import.meta.dir, '../../fixtures', portfolio);

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

function createMockClient(fixtures: FixtureSet): IGhostfolioClient {
  return {
    async get<T>(
      path: string,
      params?: Record<string, string | boolean | undefined>
    ): Promise<T> {
      if (path.includes('/portfolio/holdings'))
        return fixtures.portfolioHoldings as T;
      if (path.includes('/portfolio/details'))
        return fixtures.portfolioDetails as T;
      if (path.includes('/portfolio/performance'))
        return fixtures.portfolioPerformance as T;
      if (path.includes('/portfolio/report'))
        return fixtures.portfolioReport as T;
      if (path.includes('/portfolio/dividends'))
        return fixtures.portfolioDividends as T;
      if (path.includes('/portfolio/investments'))
        return fixtures.portfolioInvestments as T;
      if (path.includes('/symbol/lookup'))
        return {
          items: [
            {
              dataSource: 'YAHOO',
              symbol: (params?.query as string) ?? 'UNKNOWN',
              name: `Mock ${(params?.query as string) ?? 'Unknown'}`,
              currency: 'USD',
              assetClass: 'EQUITY',
              assetSubClass: 'STOCK'
            }
          ]
        } as T;
      if (path.includes('/symbol/'))
        return {
          marketPrice: 100.0,
          currency: 'USD',
          dataSource: 'YAHOO',
          symbol: 'MOCK',
          historicalData: []
        } as T;
      throw new Error(`Mock: unhandled path ${path}`);
    }
  };
}

// --- Eval runner ---
const DISCLAIMER_PATTERN = /informational purposes only/i;
const CONCURRENCY = parseInt(process.env.EVAL_CONCURRENCY ?? '8', 10);

async function runSingleEval(
  tc: EvalCase,
  config: VariantConfig
): Promise<EvalResult> {
  const portfolio = tc.portfolio ?? 'balanced-growth';
  const failures: string[] = [];
  let toolCalls: string[] = [];
  let verification: AgentResponse['verification'] | null = null;
  let tokenUsage: TokenUsage | null = null;
  const startTime = Date.now();

  try {
    const fixtures = loadFixtures(portfolio);
    const mockClient = createMockClient(fixtures);

    const result = await createAndRunAgent(
      'eval-mock-jwt',
      tc.query,
      `exp-${tc.id}-${Date.now()}`,
      {
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        client: mockClient
      }
    );

    toolCalls = result.toolCalls.map((t) => t.name);
    verification = result.verification ?? null;
    tokenUsage = result.tokenUsage ?? null;
    const responseLower = result.response.toLowerCase();

    // Tool assertions
    const alternatives = tc.acceptableAlternativeTools ?? [];
    for (const expectedTool of tc.expectedTools) {
      if (!toolCalls.includes(expectedTool)) {
        const altUsed = alternatives.some((alt) => toolCalls.includes(alt));
        if (!altUsed) {
          failures.push(
            `Expected tool "${expectedTool}" not called. Got: [${toolCalls.join(', ')}]`
          );
        }
      }
    }

    // Keyword assertions (supports pipe-delimited OR alternatives, e.g. "BTC|Bitcoin|crypto")
    for (const kw of tc.expectedContains) {
      const alternatives = kw.split('|');
      const found = alternatives.some((alt) =>
        responseLower.includes(alt.toLowerCase())
      );
      if (!found) failures.push(`Missing: "${kw}"`);
    }
    for (const kw of tc.expectedNotContains) {
      if (responseLower.includes(kw.toLowerCase()))
        failures.push(`Forbidden: "${kw}"`);
    }

    // Verification assertions
    if (tc.expectedVerificationPassed !== null && verification) {
      if (tc.expectedVerificationPassed && !verification.passed)
        failures.push('Verification should have passed');
      if (!tc.expectedVerificationPassed && verification.passed)
        failures.push('Verification should have failed');
    }

    if (tc.expectedDisclaimerPresent !== null) {
      const hasDisclaimer = DISCLAIMER_PATTERN.test(result.response);
      if (tc.expectedDisclaimerPresent && !hasDisclaimer)
        failures.push('Missing disclaimer');
    }

    if (tc.expectedHallucinationPassed != null && verification?.hallucination) {
      if (tc.expectedHallucinationPassed && !verification.hallucination.passed)
        failures.push('Hallucination check should have passed');
      if (!tc.expectedHallucinationPassed && verification.hallucination.passed)
        failures.push('Hallucination check should have found issues');
    }
  } catch (error) {
    failures.push(
      `Exception: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    id: tc.id,
    category: tc.category,
    query: tc.query,
    portfolio,
    passed: failures.length === 0,
    failures,
    toolCalls,
    durationMs: Date.now() - startTime,
    verification,
    groundedness: verification?.groundedness ?? null,
    tokenUsage
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runVariant(
  variantName: string,
  config: VariantConfig,
  cases: EvalCase[]
): Promise<ExperimentResult> {
  console.log(
    `\n${c.bold}Running variant: ${c.cyan}${variantName}${c.reset} ${c.dim}(model=${config.model}, temp=${config.temperature}, maxTokens=${config.maxTokens})${c.reset}`
  );

  const results: EvalResult[] = [];

  for (let i = 0; i < cases.length; i += CONCURRENCY) {
    const batch = cases.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((tc) => runSingleEval(tc, config))
    );

    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        const r = settled.value;
        const icon = r.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
        process.stdout.write(
          `  ${icon} ${r.id} ${c.dim}${r.durationMs}ms${c.reset}\n`
        );
        results.push(r);
      } else {
        console.log(`  ${c.red}✗ (rejected)${c.reset}`);
      }
    }
  }

  // Compute metrics
  const passCount = results.filter((r) => r.passed).length;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const mean =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

  const gndResults = results.filter((r) => r.groundedness);
  const avgAcc =
    gndResults.length > 0
      ? gndResults.reduce(
          (s, r) => s + (r.groundedness?.accuracy.score ?? 0),
          0
        ) / gndResults.length
      : 0;
  const avgPrec =
    gndResults.length > 0
      ? gndResults.reduce(
          (s, r) => s + (r.groundedness?.precision.score ?? 0),
          0
        ) / gndResults.length
      : 0;
  const avgGnd =
    gndResults.length > 0
      ? gndResults.reduce(
          (s, r) => s + (r.groundedness?.groundedness.score ?? 0),
          0
        ) / gndResults.length
      : 0;
  const avgGndOverall =
    gndResults.length > 0
      ? gndResults.reduce((s, r) => s + (r.groundedness?.overall ?? 0), 0) /
        gndResults.length
      : 0;

  const confResults = results.filter((r) => r.verification?.confidence);
  const avgConfScore =
    confResults.length > 0
      ? confResults.reduce(
          (s, r) => s + (r.verification?.confidence?.score ?? 0),
          0
        ) / confResults.length
      : 0;
  const confDist = { high: 0, medium: 0, low: 0 };
  for (const r of confResults) {
    const level = r.verification?.confidence?.level;
    if (level) confDist[level]++;
  }

  // Token usage metrics
  const tokenResults = results.filter((r) => r.tokenUsage);
  const tokenUsageMetrics =
    tokenResults.length > 0
      ? {
          totalTokens: tokenResults.reduce(
            (s, r) => s + (r.tokenUsage?.totalTokens ?? 0),
            0
          ),
          totalCost: tokenResults.reduce(
            (s, r) => s + (r.tokenUsage?.estimatedCost ?? 0),
            0
          ),
          avgTokensPerQuery: Math.round(
            tokenResults.reduce(
              (s, r) => s + (r.tokenUsage?.totalTokens ?? 0),
              0
            ) / tokenResults.length
          ),
          avgCostPerQuery:
            Math.round(
              (tokenResults.reduce(
                (s, r) => s + (r.tokenUsage?.estimatedCost ?? 0),
                0
              ) /
                tokenResults.length) *
                1_000_000
            ) / 1_000_000
        }
      : undefined;

  // Latency breakdown by tool call count
  const singleToolDurations = results
    .filter((r) => r.toolCalls.length <= 1)
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);
  const multiStepDurations = results
    .filter((r) => r.toolCalls.length >= 2)
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);

  function latencyGroup(sorted: number[]) {
    if (sorted.length === 0) return undefined;
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return {
      avg: Math.round(avg),
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      count: sorted.length
    };
  }

  const singleToolLatencyMetrics = latencyGroup(singleToolDurations);
  const multiStepLatencyMetrics = latencyGroup(multiStepDurations);

  const result: ExperimentResult = {
    variant: variantName,
    config,
    timestamp: new Date().toISOString(),
    metrics: {
      passRate: results.length > 0 ? passCount / results.length : 0,
      passCount,
      totalCount: results.length,
      groundedness: {
        accuracy: Math.round(avgAcc * 100) / 100,
        precision: Math.round(avgPrec * 100) / 100,
        groundedness: Math.round(avgGnd * 100) / 100,
        overall: Math.round(avgGndOverall * 100) / 100
      },
      confidence: {
        avgScore: Math.round(avgConfScore * 100) / 100,
        distribution: confDist
      },
      latency: {
        mean: Math.round(mean),
        p50: Math.round(percentile(durations, 50)),
        p95: Math.round(percentile(durations, 95))
      },
      singleToolLatency: singleToolLatencyMetrics,
      multiStepLatency: multiStepLatencyMetrics,
      tokenUsage: tokenUsageMetrics
    },
    cases: results
  };

  const costStr = tokenUsageMetrics
    ? ` tokens=${tokenUsageMetrics.avgTokensPerQuery} $${tokenUsageMetrics.avgCostPerQuery.toFixed(4)}/q`
    : '';
  console.log(
    `\n  ${c.bold}${variantName}:${c.reset} pass=${c.green}${passCount}/${results.length}${c.reset} (${(result.metrics.passRate * 100).toFixed(1)}%) p50=${result.metrics.latency.p50}ms p95=${result.metrics.latency.p95}ms${costStr}`
  );

  const fmtS = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  if (singleToolLatencyMetrics) {
    const stColor = singleToolLatencyMetrics.avg <= 5000 ? c.green : c.red;
    const stIcon = singleToolLatencyMetrics.avg <= 5000 ? '✓' : '✗';
    console.log(
      `  ${c.dim}single-tool:${c.reset} avg ${fmtS(singleToolLatencyMetrics.avg)}  p50 ${fmtS(singleToolLatencyMetrics.p50)}  p95 ${fmtS(singleToolLatencyMetrics.p95)}  (${singleToolLatencyMetrics.count} queries) ${stColor}${stIcon}${c.reset}`
    );
  }
  if (multiStepLatencyMetrics) {
    const msColor = multiStepLatencyMetrics.avg <= 15000 ? c.green : c.red;
    const msIcon = multiStepLatencyMetrics.avg <= 15000 ? '✓' : '✗';
    console.log(
      `  ${c.dim}multi-step:${c.reset}  avg ${fmtS(multiStepLatencyMetrics.avg)}  p50 ${fmtS(multiStepLatencyMetrics.p50)}  p95 ${fmtS(multiStepLatencyMetrics.p95)}  (${multiStepLatencyMetrics.count} queries) ${msColor}${msIcon}${c.reset}`
    );
  }

  return result;
}

// --- CLI ---
function parseExperimentArgs(argv: string[]): {
  variant?: string;
  all: boolean;
} {
  let variant: string | undefined;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--variant' && argv[i + 1]) variant = argv[++i];
    if (argv[i] === '--all') all = true;
  }
  return { variant, all };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(`${c.red}ERROR:${c.reset} OPENAI_API_KEY is required.`);
    process.exit(1);
  }

  const variantsPath = resolve(import.meta.dir, 'variants.json');
  const variants: Record<string, VariantConfig> = JSON.parse(
    readFileSync(variantsPath, 'utf-8')
  );

  const casesPath = resolve(import.meta.dir, '../eval-cases.json');
  const cases: EvalCase[] = JSON.parse(readFileSync(casesPath, 'utf-8'));

  const args = parseExperimentArgs(process.argv.slice(2));

  let variantNames: string[];
  if (args.all) {
    variantNames = Object.keys(variants);
  } else if (args.variant) {
    if (!variants[args.variant]) {
      console.error(
        `${c.red}ERROR:${c.reset} Unknown variant "${args.variant}". Available: ${Object.keys(variants).join(', ')}`
      );
      process.exit(1);
    }
    variantNames = [args.variant];
  } else {
    console.error(
      `${c.red}ERROR:${c.reset} Specify --variant <name> or --all. Available: ${Object.keys(variants).join(', ')}`
    );
    process.exit(1);
  }

  console.log(
    `${c.bold}═══════════════════════════════════════════════════${c.reset}`
  );
  console.log(
    `${c.bold}  Ghostfolio Agent Experiments${c.reset}  ${c.dim}(${variantNames.length} variant(s), ${cases.length} cases)${c.reset}`
  );
  console.log(
    `${c.bold}═══════════════════════════════════════════════════${c.reset}`
  );

  const resultsDir = resolve(import.meta.dir, 'results');
  mkdirSync(resultsDir, { recursive: true });

  for (const name of variantNames) {
    const result = await runVariant(name, variants[name], cases);

    const ts = result.timestamp.replace(/[:.]/g, '-');
    const outPath = resolve(resultsDir, `${name}-${ts}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`  ${c.dim}saved: ${outPath}${c.reset}`);
  }

  await awaitAllCallbacks();
  console.log(`\n${c.green}${c.bold}Done.${c.reset}`);
}

main().finally(() => {
  process.exit(0);
});
