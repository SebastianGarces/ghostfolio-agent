# AI Cost Analysis — Ghostfolio AI Agent

## Overview

This document captures the AI cost analysis for the Ghostfolio AI Agent, covering development spend, per-query costs, and production projections at various user tiers. Data is sourced from LangSmith traces (authoritative, server-side cost computation).

Last updated: 2026-03-02T04:36:04.469Z

To regenerate with current data:

```bash
cd apps/agent && bun run ai:cost-analysis
```

## Development Spend

| Metric             | Value |
| ------------------ | ----- |
| Total cost         | $14.707388 |
| Total tokens       | 16,562,227 |
| Input tokens       | 15,218,073 |
| Output tokens      | 1,344,154 |
| Total API calls    | 11,143 |
| Total chat queries | 6,440 |

## Per-Query Averages

| Metric           | Value |
| ---------------- | ----- |
| Avg tokens/query | 2,572 |
| Avg input tokens | 2,363 |
| Avg output tokens | 209 |
| Avg cost/query   | $0.002284 |

## Model Breakdown

| Model | Input Tokens | Output Tokens | Total Tokens | Cost | API Calls |
| ----- | ------------ | ------------- | ------------ | ---- | --------- |
| gpt-5.1 | 1,225,352 | 132,527 | 1,357,879 | $1.758240 | 734 |
| gpt-4o-mini | 9,173,656 | 896,075 | 10,069,731 | $1.464365 | 7,493 |
| gpt-4o | 4,819,065 | 315,552 | 5,134,617 | $11.484782 | 2,892 |
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
| 100 | 6,000 | $13.70 | 15,430,646 | $0.14 |
| 1,000 | 60,000 | $137.03 | 154,306,463 | $0.14 |
| 10,000 | 600,000 | $1370.25 | 1,543,064,627 | $0.14 |
| 100,000 | 6,000,000 | $13702.54 | 15,430,646,273 | $0.14 |

### Model Cost Comparison

| Model | Cost/Query | 100 users/mo | 1K users/mo | 10K users/mo | 100K users/mo |
| ----- | ---------- | ------------ | ----------- | ------------ | ------------- |
| gpt-5.1 | $0.000273 | $1.64 | $16.38 | $163.81 | $1638.11 |
| gpt-4o-mini | $0.000227 | $1.36 | $13.64 | $136.43 | $1364.32 |
| gpt-4o | $0.001783 | $10.70 | $107.00 | $1070.01 | $10700.11 |
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
| 100 | $13.70 | $25 | $38.70 | $0.39 |
| 1,000 | $137.03 | $25 | $162.03 | $0.16 |
| 10,000 | $1370.25 | $50 | $1420.25 | $0.14 |
| 100,000 | $13702.54 | $200 | $13902.54 | $0.14 |

_AI costs dominate at scale. The primary lever for cost reduction is model selection (gpt-4o-mini) or implementing query-level model routing._

## Data Source

- **LangSmith project**: `g4-ghostfolio-ai-agent`
- **Cost authority**: `run.total_cost` (computed server-side by LangSmith with current OpenAI pricing)
- **Script**: `apps/agent/scripts/ai-cost-analysis.ts`
- **Artifact**: `apps/agent/artifacts/ai-cost-analysis.json` (gitignored)
