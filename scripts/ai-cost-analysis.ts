/**
 * AI Cost Analysis Script
 *
 * Queries LangSmith for all chat traces and LLM runs to produce:
 *  - Development spend totals (tokens, cost, API calls)
 *  - Per-query averages
 *  - Production cost projections at 100 / 1,000 / 10,000 / 100,000 user tiers
 *
 * Uses `run.total_cost` from LangSmith (authoritative, computed server-side
 * with current OpenAI pricing). No local cost estimation needed.
 *
 * Output:
 *  - artifacts/ai-cost-analysis.json    (machine-readable)
 *  - docs/ai-cost-analysis.md           (human-readable report)
 *  - stdout markdown summary            (console output)
 *
 * Usage:
 *   bun run scripts/ai-cost-analysis.ts
 *   (requires LANGCHAIN_API_KEY in env)
 */
import { Client, type Run } from 'langsmith';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const LANGCHAIN_API_KEY =
  process.env.LANGCHAIN_API_KEY ?? process.env.LANGSMITH_API_KEY;
const PROJECT_NAME =
  process.env.LANGCHAIN_PROJECT ??
  process.env.LANGSMITH_PROJECT ??
  'ghostfolio-ai-agent';

if (!LANGCHAIN_API_KEY) {
  console.error('Missing LANGCHAIN_API_KEY or LANGSMITH_API_KEY env var.');
  process.exit(1);
}

const client = new Client({
  callerOptions: {
    maxRetries: 6,
    maxConcurrency: 2
  }
});

// ---------------------------------------------------------------------------
// Configurable projection assumptions (Ghostfolio-specific)
// ---------------------------------------------------------------------------
/** Portfolio check-ins are brief — ~5 questions per session */
const QUERIES_PER_USER_PER_SESSION = 5;
/** Users check their portfolio a few times per week */
const SESSIONS_PER_USER_PER_MONTH = 12;
/** → 60 queries/user/month */
const USER_TIERS = [100, 1_000, 10_000, 100_000];

// ---------------------------------------------------------------------------
// Fetch all chat root traces
// ---------------------------------------------------------------------------

async function fetchAllTraces(): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    projectName: PROJECT_NAME,
    isRoot: true,
    filter: 'has(tags, "chat")',
    select: ['id']
  })) {
    runs.push(run);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Fetch all LLM runs across the project for model breakdown
// ---------------------------------------------------------------------------

async function fetchLlmRuns(): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    projectName: PROJECT_NAME,
    runType: 'llm',
    select: [
      'id',
      'name',
      'prompt_tokens',
      'completion_tokens',
      'total_cost',
      'extra'
    ]
  })) {
    runs.push(run);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Fetching data from LangSmith (project: ${PROJECT_NAME})...\n`);

  // Fetch sequentially to avoid hitting LangSmith rate limits.
  // Each call paginates internally (~100 runs per page).
  const traces = await fetchAllTraces();
  const llmRuns = await fetchLlmRuns();

  const queries = traces.length;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;

  const modelStats = new Map<
    string,
    {
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      totalCost: number;
      count: number;
    }
  >();

  for (const run of llmRuns) {
    const input = run.prompt_tokens ?? 0;
    const output = run.completion_tokens ?? 0;
    const total = input + output;
    const cost = run.total_cost ?? 0;

    totalInputTokens += input;
    totalOutputTokens += output;
    totalTokens += total;
    totalCost += cost;

    const modelName = (run.extra as Record<string, unknown>)?.metadata
      ? (((
          (run.extra as Record<string, unknown>).metadata as Record<
            string,
            unknown
          >
        )?.ls_model_name as string) ?? run.name)
      : run.name;

    const existing = modelStats.get(modelName) ?? {
      model: modelName,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      count: 0
    };
    existing.inputTokens += input;
    existing.outputTokens += output;
    existing.totalTokens += total;
    existing.totalCost += cost;
    existing.count++;
    modelStats.set(modelName, existing);
  }

  const avgTokensPerQuery = queries > 0 ? totalTokens / queries : 0;
  const avgCostPerQuery = queries > 0 ? totalCost / queries : 0;
  const avgInputTokensPerQuery = queries > 0 ? totalInputTokens / queries : 0;
  const avgOutputTokensPerQuery = queries > 0 ? totalOutputTokens / queries : 0;

  const queriesPerUserPerMonth =
    QUERIES_PER_USER_PER_SESSION * SESSIONS_PER_USER_PER_MONTH;
  const projections = USER_TIERS.map((users) => {
    const monthlyQueries = users * queriesPerUserPerMonth;
    const monthlyCost = monthlyQueries * avgCostPerQuery;
    const monthlyTokens = monthlyQueries * avgTokensPerQuery;
    return {
      users,
      monthlyQueries,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      monthlyTokens: Math.round(monthlyTokens),
      costPerUser: Math.round((monthlyCost / users) * 100) / 100
    };
  });

  const modelBreakdown = Array.from(modelStats.values()).map((m) => ({
    model: m.model,
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    totalCost: Math.round(m.totalCost * 1_000_000) / 1_000_000,
    apiCalls: m.count
  }));

  const perModelProjections = Array.from(modelStats.values())
    .filter((m) => m.count >= 5)
    .map((m) => {
      const callsPerQuery = m.count / queries;
      const avgCostPerQ = queries > 0 ? m.totalCost / queries : 0;
      const avgTokensPerQ = queries > 0 ? m.totalTokens / queries : 0;
      const tiers = USER_TIERS.map((users) => {
        const monthlyQueries = users * queriesPerUserPerMonth;
        const monthlyCost = monthlyQueries * avgCostPerQ;
        const monthlyTokens = monthlyQueries * avgTokensPerQ;
        return {
          users,
          monthlyQueries,
          monthlyCost: Math.round(monthlyCost * 100) / 100,
          monthlyTokens: Math.round(monthlyTokens),
          costPerUser: Math.round((monthlyCost / users) * 100) / 100
        };
      });
      return {
        model: m.model,
        avgCallsPerQuery: Math.round(callsPerQuery * 100) / 100,
        avgCostPerQuery: Math.round(avgCostPerQ * 1_000_000) / 1_000_000,
        avgTokensPerQuery: Math.round(avgTokensPerQ),
        projections: tiers
      };
    });

  const artifact = {
    generatedAt: new Date().toISOString(),
    project: PROJECT_NAME,
    assumptions: {
      queriesPerUserPerSession: QUERIES_PER_USER_PER_SESSION,
      sessionsPerUserPerMonth: SESSIONS_PER_USER_PER_MONTH,
      queriesPerUserPerMonth: queriesPerUserPerMonth
    },
    devSpend: {
      totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalApiCalls: llmRuns.length,
      totalQueries: queries
    },
    perQuery: {
      avgTokens: Math.round(avgTokensPerQuery),
      avgInputTokens: Math.round(avgInputTokensPerQuery),
      avgOutputTokens: Math.round(avgOutputTokensPerQuery),
      avgCost: Math.round(avgCostPerQuery * 1_000_000) / 1_000_000
    },
    modelBreakdown,
    projections,
    perModelProjections
  };

  const AGENT_ROOT = resolve(import.meta.dir, '..');
  const artifactDir = join(AGENT_ROOT, 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, 'ai-cost-analysis.json');
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

  // -------------------------------------------------------------------------
  // Build per-model cost comparison row for the docs report
  // -------------------------------------------------------------------------
  const modelCostComparison = Array.from(modelStats.values()).map((m) => {
    const costPerQuery = queries > 0 ? m.totalCost / queries : 0;
    return USER_TIERS.reduce(
      (row, users) => {
        const monthlyCost = users * queriesPerUserPerMonth * costPerQuery;
        row[users] = `$${monthlyCost.toFixed(2)}`;
        return row;
      },
      {
        model: m.model,
        costPerQuery: `$${costPerQuery.toFixed(6)}`
      } as Record<string, string>
    );
  });

  // -------------------------------------------------------------------------
  // Write docs/ai-cost-analysis.md (full report with static + dynamic data)
  // -------------------------------------------------------------------------
  const docsPath = join(AGENT_ROOT, 'docs', 'ai-cost-analysis.md');
  const docsReport = `# AI Cost Analysis — Ghostfolio AI Agent

## Overview

This document captures the AI cost analysis for the Ghostfolio AI Agent, covering development spend, per-query costs, and production projections at various user tiers. Data is sourced from LangSmith traces (authoritative, server-side cost computation).

Last updated: ${artifact.generatedAt}

To regenerate with current data:

\`\`\`bash
cd apps/agent && bun run ai:cost-analysis
\`\`\`

## Development Spend

| Metric             | Value |
| ------------------ | ----- |
| Total cost         | $${artifact.devSpend.totalCost.toFixed(6)} |
| Total tokens       | ${artifact.devSpend.totalTokens.toLocaleString()} |
| Input tokens       | ${artifact.devSpend.totalInputTokens.toLocaleString()} |
| Output tokens      | ${artifact.devSpend.totalOutputTokens.toLocaleString()} |
| Total API calls    | ${artifact.devSpend.totalApiCalls.toLocaleString()} |
| Total chat queries | ${artifact.devSpend.totalQueries.toLocaleString()} |

## Per-Query Averages

| Metric           | Value |
| ---------------- | ----- |
| Avg tokens/query | ${artifact.perQuery.avgTokens.toLocaleString()} |
| Avg input tokens | ${artifact.perQuery.avgInputTokens.toLocaleString()} |
| Avg output tokens | ${artifact.perQuery.avgOutputTokens.toLocaleString()} |
| Avg cost/query   | $${artifact.perQuery.avgCost.toFixed(6)} |

## Model Breakdown

| Model | Input Tokens | Output Tokens | Total Tokens | Cost | API Calls |
| ----- | ------------ | ------------- | ------------ | ---- | --------- |
${modelBreakdown.map((m) => `| ${m.model} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${m.totalTokens.toLocaleString()} | $${m.totalCost.toFixed(6)} | ${m.apiCalls.toLocaleString()} |`).join('\n')}

## Production Model Selection

The agent defaults to **gpt-4o** for highest quality responses. For cost-sensitive deployments:

- **gpt-4o** — Best quality, recommended for < 1,000 users
- **gpt-4o-mini** — ~94% cost reduction, suitable for high-volume deployments (> 10,000 users)

## Production Cost Projections

**Assumptions:**
- ${QUERIES_PER_USER_PER_SESSION} queries per session (portfolio check-ins are brief)
- ${SESSIONS_PER_USER_PER_MONTH} sessions per user per month (a few times per week)
- = ${queriesPerUserPerMonth} queries/user/month

### Blended Average (current model mix)

| Users | Monthly Queries | Monthly Cost | Monthly Tokens | Cost/User |
| ----- | --------------- | ------------ | -------------- | --------- |
${projections.map((p) => `| ${p.users.toLocaleString()} | ${p.monthlyQueries.toLocaleString()} | $${p.monthlyCost.toFixed(2)} | ${p.monthlyTokens.toLocaleString()} | $${p.costPerUser.toFixed(2)} |`).join('\n')}

### Model Cost Comparison

| Model | Cost/Query | 100 users/mo | 1K users/mo | 10K users/mo | 100K users/mo |
| ----- | ---------- | ------------ | ----------- | ------------ | ------------- |
${modelCostComparison.map((m) => `| ${m.model} | ${m.costPerQuery} | ${m[100]} | ${m[1000]} | ${m[10000]} | ${m[100000]} |`).join('\n')}

## Optimization Opportunities

1. **Model downgrade**: Switch to gpt-4o-mini for simple queries (portfolio summary, holdings lookup) — ~94% cost savings
2. **Caching**: Cache portfolio data responses (TTL: 5 min) to reduce redundant API + LLM calls
3. **Prompt optimization**: Reduce system prompt size by moving static instructions to tool descriptions
4. **Streaming**: Stream responses to improve perceived latency without affecting token costs
5. **Token budgets**: Set per-user daily/monthly token limits to prevent runaway costs

## Infrastructure Costs (Railway)

| Service    | Plan    | Estimated Monthly Cost |
| ---------- | ------- | ---------------------- |
| Postgres   | Starter | $5                     |
| Redis      | Starter | $5                     |
| Ghostfolio | Starter | $5-10                  |
| Agent      | Starter | $5-10                  |
| **Total**  |         | **$20-30**             |

_Infrastructure costs are fixed and independent of user count (until compute/memory limits are hit)._

## Total Cost Estimates (AI + Infrastructure)

| Users   | AI Cost/mo | Infra Cost/mo | Total/mo | Per User/mo |
| ------- | ---------- | ------------- | -------- | ----------- |
${projections
  .map((p) => {
    const infra = p.users <= 1000 ? 25 : p.users <= 10000 ? 50 : 200;
    const total = p.monthlyCost + infra;
    const perUser = total / p.users;
    return `| ${p.users.toLocaleString()} | $${p.monthlyCost.toFixed(2)} | $${infra} | $${total.toFixed(2)} | $${perUser.toFixed(2)} |`;
  })
  .join('\n')}

_AI costs dominate at scale. The primary lever for cost reduction is model selection (gpt-4o-mini) or implementing query-level model routing._

## Data Source

- **LangSmith project**: \`${PROJECT_NAME}\`
- **Cost authority**: \`run.total_cost\` (computed server-side by LangSmith with current OpenAI pricing)
- **Script**: \`apps/agent/scripts/ai-cost-analysis.ts\`
- **Artifact**: \`apps/agent/artifacts/ai-cost-analysis.json\` (gitignored)
`;

  await writeFile(docsPath, docsReport);

  // -------------------------------------------------------------------------
  // Console output (summary)
  // -------------------------------------------------------------------------
  const md = `
# AI Cost Analysis Report — Ghostfolio AI Agent

Generated: ${artifact.generatedAt}
Project: ${artifact.project}

## Development Spend

| Metric | Value |
|--------|-------|
| Total cost | $${artifact.devSpend.totalCost.toFixed(6)} |
| Total tokens | ${artifact.devSpend.totalTokens.toLocaleString()} |
| Input tokens | ${artifact.devSpend.totalInputTokens.toLocaleString()} |
| Output tokens | ${artifact.devSpend.totalOutputTokens.toLocaleString()} |
| Total API calls | ${artifact.devSpend.totalApiCalls.toLocaleString()} |
| Total chat queries | ${artifact.devSpend.totalQueries.toLocaleString()} |

## Per-Query Averages

| Metric | Value |
|--------|-------|
| Avg tokens/query | ${artifact.perQuery.avgTokens.toLocaleString()} |
| Avg input tokens | ${artifact.perQuery.avgInputTokens.toLocaleString()} |
| Avg output tokens | ${artifact.perQuery.avgOutputTokens.toLocaleString()} |
| Avg cost/query | $${artifact.perQuery.avgCost.toFixed(6)} |

## Model Breakdown

| Model | Input Tokens | Output Tokens | Total Tokens | Cost | API Calls |
|-------|-------------|---------------|-------------|------|-----------|
${modelBreakdown.map((m) => `| ${m.model} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${m.totalTokens.toLocaleString()} | $${m.totalCost.toFixed(6)} | ${m.apiCalls.toLocaleString()} |`).join('\n')}

## Production Cost Projections (Blended Average)

Assumptions: ${QUERIES_PER_USER_PER_SESSION} queries/session, ${SESSIONS_PER_USER_PER_MONTH} sessions/month = ${queriesPerUserPerMonth} queries/user/month

| Users | Monthly Queries | Monthly Cost | Monthly Tokens | Cost/User |
|-------|----------------|--------------|----------------|-----------|
${projections.map((p) => `| ${p.users.toLocaleString()} | ${p.monthlyQueries.toLocaleString()} | $${p.monthlyCost.toFixed(2)} | ${p.monthlyTokens.toLocaleString()} | $${p.costPerUser.toFixed(2)} |`).join('\n')}

## Production Cost Projections by Model

${perModelProjections
  .map(
    (mp) => `### ${mp.model}

Avg cost/query: $${mp.avgCostPerQuery.toFixed(6)} | Avg tokens/query: ${mp.avgTokensPerQuery.toLocaleString()} | Avg calls/query: ${mp.avgCallsPerQuery}

| Users | Monthly Queries | Monthly Cost | Cost/User |
|-------|----------------|--------------|-----------|
${mp.projections.map((p) => `| ${p.users.toLocaleString()} | ${p.monthlyQueries.toLocaleString()} | $${p.monthlyCost.toFixed(2)} | $${p.costPerUser.toFixed(2)} |`).join('\n')}
`
  )
  .join('\n')}
---
Reports saved to:
  ${artifactPath}
  ${docsPath}
`;

  console.log(md);
}

main().catch((err) => {
  console.error('AI Cost Analysis failed:', err);
  process.exit(1);
});
