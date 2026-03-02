/**
 * Compare experiment results from the results/ directory.
 *
 * Reads the most recent result file per variant and prints a comparison table.
 *
 * Usage: bun run experiment:compare
 */
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

interface ExperimentResult {
  variant: string;
  config: { model: string; temperature: number; maxTokens: number };
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
}

function pad(
  s: string,
  len: number,
  align: 'left' | 'center' = 'center'
): string {
  if (s.length >= len) return s.substring(0, len);
  const diff = len - s.length;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    return ' '.repeat(left) + s + ' '.repeat(diff - left);
  }
  return s + ' '.repeat(diff);
}

function padR(s: string, len: number): string {
  if (s.length >= len) return s.substring(0, len);
  return ' '.repeat(len - s.length) + s;
}

function main() {
  const resultsDir = resolve(import.meta.dir, 'results');

  let files: string[];
  try {
    files = readdirSync(resultsDir).filter((f) => f.endsWith('.json'));
  } catch {
    console.error(
      `${c.red}ERROR:${c.reset} No results directory found at ${resultsDir}`
    );
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(
      `${c.red}ERROR:${c.reset} No result files found in ${resultsDir}`
    );
    process.exit(1);
  }

  // Load all results, keep most recent per variant
  const byVariant = new Map<string, ExperimentResult>();

  for (const file of files) {
    try {
      const data: ExperimentResult = JSON.parse(
        readFileSync(resolve(resultsDir, file), 'utf-8')
      );
      const existing = byVariant.get(data.variant);
      if (!existing || data.timestamp > existing.timestamp) {
        byVariant.set(data.variant, data);
      }
    } catch {
      // Skip invalid files
    }
  }

  const variants = [...byVariant.values()].sort((a, b) =>
    a.variant.localeCompare(b.variant)
  );

  if (variants.length === 0) {
    console.error(`${c.red}ERROR:${c.reset} No valid result files found.`);
    process.exit(1);
  }

  // --- Print table ---
  const COL = {
    variant: 14,
    passRate: 11,
    accuracy: 10,
    precision: 10,
    groundedness: 14,
    confidence: 12,
    p50: 8,
    p95: 8,
    avg1: 8,
    avgN: 8,
    avgTokens: 11,
    avgCost: 10
  };

  const sep = `+${'-'.repeat(COL.variant + 2)}+${'-'.repeat(COL.passRate + 2)}+${'-'.repeat(COL.accuracy + 2)}+${'-'.repeat(COL.precision + 2)}+${'-'.repeat(COL.groundedness + 2)}+${'-'.repeat(COL.confidence + 2)}+${'-'.repeat(COL.p50 + 2)}+${'-'.repeat(COL.p95 + 2)}+${'-'.repeat(COL.avg1 + 2)}+${'-'.repeat(COL.avgN + 2)}+${'-'.repeat(COL.avgTokens + 2)}+${'-'.repeat(COL.avgCost + 2)}+`;

  console.log(
    `\n${c.bold}Experiment Comparison${c.reset} ${c.dim}(most recent run per variant)${c.reset}\n`
  );

  console.log(sep);
  console.log(
    `| ${pad('Variant', COL.variant)} | ${pad('Pass Rate', COL.passRate)} | ${pad('Accuracy', COL.accuracy)} | ${pad('Precision', COL.precision)} | ${pad('Groundedness', COL.groundedness)} | ${pad('Confidence', COL.confidence)} | ${pad('P50', COL.p50)} | ${pad('P95', COL.p95)} | ${pad('Avg-1', COL.avg1)} | ${pad('Avg-N', COL.avgN)} | ${pad('Avg Tokens', COL.avgTokens)} | ${pad('Avg Cost', COL.avgCost)} |`
  );
  console.log(sep);

  for (const v of variants) {
    const m = v.metrics;
    const passRateStr = `${(m.passRate * 100).toFixed(1)}%`;
    const accStr = m.groundedness.accuracy.toFixed(2);
    const precStr = m.groundedness.precision.toFixed(2);
    const gndStr = m.groundedness.overall.toFixed(2);
    const confStr = m.confidence.avgScore.toFixed(2);
    const p50Str = `${(m.latency.p50 / 1000).toFixed(1)}s`;
    const p95Str = `${(m.latency.p95 / 1000).toFixed(1)}s`;
    const avgTokensStr = m.tokenUsage
      ? m.tokenUsage.avgTokensPerQuery.toLocaleString()
      : 'N/A';
    const avgCostStr = m.tokenUsage
      ? `$${m.tokenUsage.avgCostPerQuery.toFixed(4)}`
      : 'N/A';

    const avg1Raw = m.singleToolLatency?.avg;
    const avgNRaw = m.multiStepLatency?.avg;
    const avg1Str = avg1Raw != null ? `${(avg1Raw / 1000).toFixed(1)}s` : 'N/A';
    const avgNStr = avgNRaw != null ? `${(avgNRaw / 1000).toFixed(1)}s` : 'N/A';
    const avg1Color =
      avg1Raw != null ? (avg1Raw <= 5000 ? c.green : c.red) : '';
    const avgNColor =
      avgNRaw != null ? (avgNRaw <= 15000 ? c.green : c.red) : '';

    const passColor =
      m.passRate >= 0.9 ? c.green : m.passRate >= 0.7 ? c.yellow : c.red;

    console.log(
      `| ${pad(v.variant, COL.variant)} | ${passColor}${padR(passRateStr, COL.passRate)}${c.reset} | ${padR(accStr, COL.accuracy)} | ${padR(precStr, COL.precision)} | ${padR(gndStr, COL.groundedness)} | ${padR(confStr, COL.confidence)} | ${padR(p50Str, COL.p50)} | ${padR(p95Str, COL.p95)} | ${avg1Color}${padR(avg1Str, COL.avg1)}${avg1Color ? c.reset : ''} | ${avgNColor}${padR(avgNStr, COL.avgN)}${avgNColor ? c.reset : ''} | ${padR(avgTokensStr, COL.avgTokens)} | ${padR(avgCostStr, COL.avgCost)} |`
    );
  }

  console.log(sep);

  // Model details
  console.log(`\n${c.dim}Variant configs:${c.reset}`);
  for (const v of variants) {
    console.log(
      `  ${c.cyan}${v.variant}${c.reset}: model=${v.config.model} temp=${v.config.temperature} maxTokens=${v.config.maxTokens} ${c.dim}(${v.timestamp})${c.reset}`
    );
  }
  console.log('');
}

main();
