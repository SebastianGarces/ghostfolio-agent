# AI Cost Analysis — Ghostfolio AI Agent

## Overview

This document captures the AI cost analysis for the Ghostfolio AI Agent, covering development spend, per-query costs, and production projections at various user tiers. Data is sourced from LangSmith traces (authoritative, server-side cost computation).

Last updated: 2026-03-02T00:01:45.501Z

To regenerate with current data:

```bash
cd apps/agent && bun run ai:cost-analysis
```

## Development Spend

| Metric             | Value |
| ------------------ | ----- |
| Total cost         | $12.774558 |
| Total tokens       | 13,031,250 |
| Input tokens       | 11,953,578 |
| Output tokens      | 1,077,672 |
| Total API calls    | 9,317 |
| Total chat queries | 4,995 |

## Per-Query Averages

| Metric           | Value |
| ---------------- | ----- |
| Avg tokens/query | 2,609 |
| Avg input tokens | 2,393 |
| Avg output tokens | 216 |
| Avg cost/query   | $0.002557 |

## Model Breakdown

| Model | Input Tokens | Output Tokens | Total Tokens | Cost | API Calls |
| ----- | ------------ | ------------- | ------------ | ---- | --------- |
| gpt-5.1 | 791,395 | 87,793 | 879,188 | $1.153654 | 488 |
| gpt-4o-mini | 6,775,024 | 705,991 | 7,481,015 | $1.139887 | 6,153 |
| gpt-4o | 4,387,159 | 283,888 | 4,671,047 | $10.481017 | 2,652 |
| MockSequentialChatModel | 0 | 0 | 0 | $0.000000 | 24 |

## Production Model Selection

The agent defaults to **gpt-4o** for highest quality responses. For cost-sensitive deployments:

- **gpt-4o** — Best quality, recommended for < 1,000 users
- **gpt-4o-mini** — ~94% cost reduction, suitable for high-volume deployments (> 10,000 users)

## Production Cost Projections

**Assumptions:**
- 5 queries per session (portfolio check-ins are brief)
- 12 sessions per user per month (a few times per week)
- = 60 queries/user/month

### Blended Average (current model mix)

| Users | Monthly Queries | Monthly Cost | Monthly Tokens | Cost/User |
| ----- | --------------- | ------------ | -------------- | --------- |
| 100 | 6,000 | $15.34 | 15,653,153 | $0.15 |
| 1,000 | 60,000 | $153.45 | 156,531,532 | $0.15 |
| 10,000 | 600,000 | $1534.48 | 1,565,315,315 | $0.15 |
| 100,000 | 6,000,000 | $15344.81 | 15,653,153,153 | $0.15 |

### Model Cost Comparison

| Model | Cost/Query | 100 users/mo | 1K users/mo | 10K users/mo | 100K users/mo |
| ----- | ---------- | ------------ | ----------- | ------------ | ------------- |
| gpt-5.1 | $0.000231 | $1.39 | $13.86 | $138.58 | $1385.77 |
| gpt-4o-mini | $0.000228 | $1.37 | $13.69 | $136.92 | $1369.23 |
| gpt-4o | $0.002098 | $12.59 | $125.90 | $1258.98 | $12589.81 |
| MockSequentialChatModel | $0.000000 | $0.00 | $0.00 | $0.00 | $0.00 |

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
| 100 | $15.34 | $25 | $40.34 | $0.40 |
| 1,000 | $153.45 | $25 | $178.45 | $0.18 |
| 10,000 | $1534.48 | $50 | $1584.48 | $0.16 |
| 100,000 | $15344.81 | $200 | $15544.81 | $0.16 |

_AI costs dominate at scale. The primary lever for cost reduction is model selection (gpt-4o-mini) or implementing query-level model routing._

## Data Source

- **LangSmith project**: `g4-ghostfolio-ai-agent`
- **Cost authority**: `run.total_cost` (computed server-side by LangSmith with current OpenAI pricing)
- **Script**: `apps/agent/scripts/ai-cost-analysis.ts`
- **Artifact**: `apps/agent/artifacts/ai-cost-analysis.json` (gitignored)
