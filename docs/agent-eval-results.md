# Eval Results & Verification Rubric

This document consolidates eval results, model selection, the fact-check rubric, and scoring methodology used by the Ghostfolio agent's verification pipeline.

For how this fits into the overall architecture, see the [Agent Architecture](agent-architecture.md) doc (Tiers 4 & 5).

---

## Model Selection

### Decision

**gpt-4o-mini at temperature 0** is used for the primary agent LLM (`OPENAI_MODEL`).

### Experiment Results

Four model variants were evaluated across the full 68-case eval suite (run 2026-03-02):

| Variant               | Model       | Temp | Pass Rate | Accuracy | Precision | Groundedness | Confidence | P50  | P95   | Avg Tokens | Avg Cost |
| --------------------- | ----------- | ---- | --------- | -------- | --------- | ------------ | ---------- | ---- | ----- | ---------- | -------- |
| **Baseline (chosen)** | gpt-4o-mini | 0.0  | 98.5%     | 0.99     | 1.00      | 0.99         | 0.85       | 2.1s | 11.7s | 2,192      | $0.0004  |
| Higher-temp           | gpt-4o-mini | 0.3  | 97.1%     | 0.99     | 1.00      | 0.99         | 0.85       | 2.1s | 10.4s | 2,115      | $0.0004  |
| GPT-4o                | gpt-4o      | 0.0  | 95.6%     | 1.00     | 1.00      | 1.00         | 0.85       | 1.6s | 23.1s | 1,901      | $0.0057  |
| GPT-5.1               | gpt-5.1     | 0.0  | 92.6%     | 0.99     | 1.00      | 0.99         | 0.85       | 1.8s | 7.5s  | 1,940      | $0.0039  |

### Rationale

- **Baseline has the highest pass rate (98.5%)** — no variant achieves 100% anymore, but gpt-4o-mini at temp 0 still leads. Larger models (gpt-4o at 95.6%, gpt-5.1 at 92.6%) fail more cases, likely due to over-reasoning or deviating from the structured planner output format.
- **~14x cheaper** than gpt-4o ($0.0004 vs $0.0057 per query) with comparable groundedness (0.99 vs 1.00).
- **Temperature 0** chosen over 0.3 for deterministic, reproducible responses — temp 0 achieves a slightly higher pass rate (98.5% vs 97.1%).
- Fact-checking is fully deterministic (no LLM) — only the planner and synthesis nodes use the primary model.

---

## Latest Eval Results

Full eval suite run (68 cases) with gpt-4o-mini at temperature 0:

| Metric              | Value   |
| ------------------- | ------- |
| Total cases         | 68      |
| Pass rate           | 98.5%   |
| Accuracy (mean)     | 0.99    |
| Precision (mean)    | 1.00    |
| Groundedness (mean) | 0.99    |
| Confidence (mean)   | 0.85    |
| Latency (p50)       | 2.1s    |
| Latency (p95)       | 11.7s   |
| Avg tokens          | 2,192   |
| Cost/query (mean)   | $0.0004 |

---

## Eval Methodology

The eval suite tests the full agent pipeline (LLM + tools + verification) against **real LLM calls** with **mocked Ghostfolio API responses**. No live network calls are made to Ghostfolio — each portfolio is a self-contained fixture that the mock client routes by API path.

### Configuration

- **LLM temperature:** `0` (deterministic)
- **Max tokens:** `1024`
- **Default concurrency:** 3 cases in parallel (`EVAL_CONCURRENCY` env override)
- **Experiment concurrency:** 8

### Assertion Types

Each test case can assert up to 6 properties:

| Assertion              | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Tool calls**         | Each `expectedTools` entry must be called; `acceptableAlternativeTools` can substitute |
| **Keywords present**   | Response must contain every `expectedContains` substring (case-insensitive)  |
| **Keywords absent**    | Response must not contain any `expectedNotContains` substring               |
| **Verification passed** | `verification.passed` must match expected value (`null` = skip)            |
| **Disclaimer present** | Response must contain "informational purposes only" (`null` = skip)         |
| **Hallucination clean** | `verification.hallucination.passed` must match expected value (`null` = skip) |

### CLI Filters

```
bun run src/test/eval/run-evals.ts [options]
  --category  <name>     Filter by category
  --portfolio <name>     Filter by portfolio fixture
  --id        <id>       Run a single case (no JSON report written)
  --verbose / -v         Full response + tool data + hallucination details
```

---

## Test Case Breakdown

**68 total cases** across 5 categories and 5 portfolio fixtures.

### By Category

| Category     | Cases | Description                                                  |
| ------------ | ----- | ------------------------------------------------------------ |
| happy-path   | 28    | Standard single-tool queries across all 7 tools              |
| multi-tool   | 6     | Queries requiring 2–3 tools in a single response             |
| reasoning    | 8     | Cross-cutting analytical questions (comparisons, rankings)   |
| adversarial  | 12    | Buy/sell orders, predictions, jailbreak attempts — all should refuse |
| edge-case    | 14    | Empty input, greetings, random strings, foreign language, long queries |

### By Portfolio

| Portfolio            | Cases | Net Worth  | Holdings | Characteristics                                          |
| -------------------- | ----- | ---------- | -------- | -------------------------------------------------------- |
| balanced-growth      | 48    | $38,951    | 3        | Default portfolio. VTI/AAPL/BND mix, 12-month streak    |
| conservative-retiree | 4     | $200,000   | 5        | IRA with 45% fixed income, gold hedge, inflation protection |
| aggressive-growth    | 5     | $150,000   | 5        | 100% equities, NVDA/TSLA/ARKK/SOFI/PLTR, 21% annualized |
| dividend-income      | 3     | $200,000   | 5        | $8,490 annual dividends, VYM/SCHD/O/JNJ/PG              |
| crypto-heavy         | 8     | $50,000    | 5        | 80% crypto (BTC/ETH/SOL), 77% net performance, 35% annualized |

---

## Verification Pipeline Overview

The agent runs a 5-tier verification pipeline on every response:

| Tier | Check                                  | Blocking?    |
| ---- | -------------------------------------- | ------------ |
| 1    | Domain constraint validation           | Yes          |
| 2    | Prompt-injection / off-topic detection | Yes          |
| 3    | Confidence scoring                     | No           |
| 4    | Hallucination detection (deterministic) | No (warning) |
| 5    | Groundedness scoring (deterministic)    | No (warning) |

Tiers 4 and 5 are combined into a single deterministic function call (`factCheck()` in `fact-check.ts`). This document covers that pipeline in detail.

---

## Fact-Check Rubric (Deterministic Pipeline)

The fact-check pipeline extracts claims from structured `ContentBlock[]` arrays and compares them against a `SourceDataIndex` built from tool call data. No LLM is involved — all phases are deterministic. The pipeline classifies issues using four rules. See [`src/server/verification/fact-check.ts`](../apps/agent/src/server/verification/fact-check.ts).

### Issue Classification Rules

| Rule   | Type                  | Trigger                                                                                                         | Tolerance (do NOT flag)                                                                 |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **R1** | `percentage_mismatch` | Response states a percentage that differs from source by >1 percentage point                                    | Reasonable rounding (e.g. 35.5% -> "about 36%")                                         |
| **R2** | `amount_mismatch`     | Response states a dollar amount that differs from source by >1% relative                                        | Formatting differences (e.g. $50,000 vs 50000)                                          |
| **R3** | `symbol_not_in_data`  | Response mentions a financial symbol in the context of the portfolio that does not appear in source data        | General acronyms (ETF, USD, ROI, IPO, S&P, etc.) or common English words                |
| **R4** | `unsupported_claim`   | Response states a fact not derivable from source data (e.g. "beaten the S&P 500" when no benchmark data exists) | Subjective qualifiers ("well-diversified", "solid performance") or standard disclaimers |

All issues are emitted with `severity: 'warning'` — they never block the response.

### Issue Schema

Each issue returned by the pipeline has this shape (defined in [`fact-check-schema.ts`](../apps/agent/src/server/verification/fact-check-schema.ts)):

```typescript
{
  type: 'symbol_not_in_data' | 'percentage_mismatch' | 'amount_mismatch' | 'unsupported_claim',
  claimed: string,      // What the response claimed
  actual: string | null, // The correct value from source (null if not applicable)
  description: string    // Explanation of the mismatch
}
```

---

## Verification Process

The deterministic pipeline executes four phases in order:

1. **Build Source Data Index** — `buildSourceDataIndex()` extracts amounts, percentages, counts, and symbols from raw tool call artifacts into typed lookup maps (`SourceDataIndex`).
2. **Extract Claims** — `extractClaimsFromBlocks()` walks the structured `ContentBlock[]` array: `metric` blocks yield amounts/percentages via `parseMetricValue()`, `symbol` blocks yield symbol claims, and `text`/`list` blocks use regex fallback (`extractFallbackClaims()`).
3. **Verify Claims** — `verifyClaim()` compares each extracted claim against the `SourceDataIndex` using Jaccard token-overlap similarity with symbol-aware boosting. Each claim receives a verdict: `match`, `mismatch`, `not_in_source`, or `unverifiable`.
4. **Compute Scores** — `computeScores()` partitions verified claims by type and computes accuracy, precision, and groundedness scores from verdict counts. Mismatches are mapped to issue types (R1-R4).

---

## Scoring Dimensions

`computeScores()` returns three independent scores (0.0–1.0), computed deterministically from claim verdicts, which are combined into a weighted overall score.

| Dimension        | Weight | What It Measures                                    | Score Anchors                                                                                                                |
| ---------------- | ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Accuracy**     | 0.40   | Numeric claims (%, $) match source within tolerance | **1.0** = all match. **0.7–0.9** = minor rounding. **0.3–0.6** = multiple wrong numbers. **0.0–0.2** = mostly fabricated.    |
| **Precision**    | 0.35   | Financial symbols mentioned exist in source data    | **1.0** = all exist (or none mentioned). **0.5** = mix of known/unknown. **0.0** = all unknown.                              |
| **Groundedness** | 0.25   | Every claim is supported by source data             | **1.0** = fully supported. **0.5–0.8** = mostly grounded, 1–2 unsupported inferences. **0.0–0.4** = significant fabrication. |

**Overall score formula:**

```
overall = accuracy × 0.40 + precision × 0.35 + groundedness × 0.25
```

This calculation is in `computeScores()` in `fact-check.ts`.

---

## Edge Cases

| Condition                       | Behavior                                           |
| ------------------------------- | -------------------------------------------------- |
| No numeric claims in response   | `accuracyScore: 1.0`                               |
| No financial symbols mentioned  | `precisionScore: 1.0`                              |
| No source data provided (empty) | All scores `1.0`, no issues                        |
| Disclaimers and caveats         | Not treated as claims — not evaluated              |
| `{{component:*}}` placeholders  | Rendering directives — ignored entirely            |
| No tool calls made              | Short-circuit: default pass (all `1.0`)            |
| All tool calls failed           | Short-circuit: default pass (no ground truth)      |
| No claims extracted             | Short-circuit: default pass (nothing to verify)    |

---

## Source Data Format

The source data index is built from raw tool call artifacts by `buildSourceDataIndex()` in [`source-data-index.ts`](../apps/agent/src/server/verification/source-data-index.ts). For the synthesis node, `condenseArtifacts()` in [`condense-artifacts.ts`](../apps/agent/src/server/graph/condense-artifacts.ts) converts the same raw data into a compact text format (~300–500 tokens) for LLM consumption. Each tool type produces a labeled section:

```
[portfolio_analysis]
Net worth: 38951, Investment: 33500, Net perf: 5451 (16.2%)
AAPL (Apple Inc): alloc=35.0%, perf=24.5%, class=EQUITY
VTI (Vanguard Total Stock Market): alloc=45.0%, perf=12.3%, class=ETF
BND (Vanguard Total Bond Market): alloc=20.0%, perf=-2.4%, class=ETF

[performance_report]
Net worth: 38951, Investment: 33500, Net perf: 5451 (16.2%)

[dividend_analysis]
Total dividends: 370.25

[investment_history]
Total invested: 33500, current streak: 8 months
```

The pipeline compares extracted claims against this data. Supported tool types: `portfolio_analysis`, `performance_report`, `risk_assessment`, `holdings_search`, `market_data_lookup`, `dividend_analysis`, `investment_history`.

