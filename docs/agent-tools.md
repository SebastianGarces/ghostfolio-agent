# Agent Tool Reference

## Overview

The Ghostfolio agent exposes **7 read-only tools** to the LLM. Each tool wraps a Ghostfolio REST endpoint and returns data in LangChain's `content_and_artifact` response format:

- **Content** — formatted text for the LLM to reason over
- **Artifact** — structured JSON for the React chat widget to render charts/tables

All tools are created via the `createGhostfolioTool` factory (`apps/agent/src/server/tools/create-tool.ts`), which provides a uniform error boundary: any exception is caught and returned as `"Error calling <toolName>: <message>"` with a `null` artifact.

## Tool Summary

| Tool | Endpoint | Description |
| ---- | -------- | ----------- |
| `portfolio_analysis` | `GET /api/v1/portfolio/details` | Holdings, allocations, accounts, and portfolio summary |
| `performance_report` | `GET /api/v2/portfolio/performance` | Aggregate performance metrics and historical chart data |
| `risk_assessment` | `GET /api/v1/portfolio/report` | X-Ray analysis with pass/fail risk rules |
| `dividend_analysis` | `GET /api/v1/portfolio/dividends` | Dividend income history with optional grouping |
| `investment_history` | `GET /api/v1/portfolio/investments` | Investment contributions and consistency streaks |
| `market_data_lookup` | `GET /api/v1/symbol/lookup` + `GET /api/v1/symbol/{ds}/{sym}` | Current price and history for any ticker |
| `holdings_search` | `GET /api/v1/portfolio/holdings` | Search and filter portfolio holdings |

---

## portfolio_analysis

> Get comprehensive portfolio overview including holdings, allocation percentages, accounts, platforms, and summary. Use this for questions about portfolio composition, allocation, holdings, or net worth.

**Endpoint:** `GET /api/v1/portfolio/details`

### Input Schema

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `accounts` | `string?` | — | Comma-separated account IDs |
| `assetClasses` | `string?` | — | Comma-separated asset classes |
| `range` | `enum` | `'max'` | `1d`, `1y`, `5y`, `max`, `mtd`, `wtd`, `ytd` |
| `tags` | `string?` | — | Comma-separated tags |

### Output

**Text** includes holdings sorted by allocation (descending), account balances, and a portfolio summary with net worth, total investment, net performance, dividends, and fees.

**Widget data** (`type: 'portfolio_analysis'`):

- `holdings[]` — `symbol`, `name`, `allocation`, `value`, `netPerformance`, `netPerformancePercent`, `assetClass`, `assetSubClass`, `currency`
- `summary` — `currentNetWorth`, `totalInvestment`, `netPerformance`, `netPerformancePercent`, `dividend`, `fees`
- `accounts[]` — `name`, `value`, `currency`

### Example Queries

- "What is my portfolio allocation?"
- "Show me my current net worth and holdings"

---

## performance_report

> Get aggregate portfolio performance metrics including net performance, total investment, current net worth, and historical chart data. Do NOT use this to compare asset classes — use portfolio_analysis instead.

**Endpoint:** `GET /api/v2/portfolio/performance`

### Input Schema

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `accounts` | `string?` | — | Comma-separated account IDs |
| `assetClasses` | `string?` | — | Comma-separated asset classes |
| `range` | `enum` | `'max'` | `1d`, `1y`, `5y`, `max`, `mtd`, `wtd`, `ytd` |
| `tags` | `string?` | — | Comma-separated tags |
| `withExcludedAccounts` | `boolean?` | `false` | Include excluded accounts |

### Output

**Text** includes current net worth, total investment, net performance (with and without currency effect), annualized performance, first transaction date, and a chart summary (start/midpoint/end).

**Widget data** (`type: 'performance_report'`):

- `chart[]` — `date`, `netWorth`, `totalInvestment`
- `metrics` — `currentNetWorth`, `totalInvestment`, `netPerformance`, `netPerformancePercent`, `annualizedPercent`, `firstOrderDate`

### Example Queries

- "How has my portfolio performed this year?"
- "Show me my portfolio growth over the last 5 years"

---

## risk_assessment

> Run X-Ray analysis on the portfolio to identify risks. Returns risk categories with pass/fail rules covering currency concentration, asset class balance, account diversification, regional allocation, and fee analysis.

**Endpoint:** `GET /api/v1/portfolio/report`

### Input Schema

No parameters — this tool takes an empty input.

### Output

**Text** includes the overall score (rules passed / rules active) and each category with its pass/fail rules and evaluation descriptions. Inactive rules are omitted.

**Widget data** (`type: 'risk_assessment'`):

- `statistics` — `rulesPassed`, `rulesTotal`
- `categories[]` — `name`, `rules[]` with `name`, `passed`, `evaluation`

### Example Queries

- "Run a risk assessment on my portfolio"
- "What does the X-Ray analysis say about my diversification?"

---

## dividend_analysis

> Get dividend income history for the portfolio. Shows dividend payments received over time, optionally grouped by month or year.

**Endpoint:** `GET /api/v1/portfolio/dividends`

### Input Schema

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `accounts` | `string?` | — | Comma-separated account IDs |
| `assetClasses` | `string?` | — | Comma-separated asset classes |
| `groupBy` | `enum?` | — | `month` or `year` |
| `range` | `enum` | `'max'` | `1d`, `1y`, `5y`, `max`, `mtd`, `wtd`, `ytd` |
| `tags` | `string?` | — | Comma-separated tags |

### Output

**Text** includes total dividend income, event count, date range, and either annual totals (when `groupBy: 'year'`) or a chronological list. Lists longer than 10 entries are summarized (first 3, midpoint, last 3).

**Widget data** (`type: 'dividend_analysis'`):

- `totalDividends` — sum of all dividend payments
- `dividends[]` — `date`, `amount`
- `dateRange` — e.g. `"2020-01-15 to 2024-12-31"`

### Example Queries

- "How much dividend income did I receive last year?"
- "Show me my dividends grouped by year"

---

## investment_history

> Get investment contribution history for the portfolio. Shows how much was invested over time and investment consistency streaks.

**Endpoint:** `GET /api/v1/portfolio/investments`

### Input Schema

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `accounts` | `string?` | — | Comma-separated account IDs |
| `assetClasses` | `string?` | — | Comma-separated asset classes |
| `groupBy` | `enum?` | — | `month` or `year` |
| `range` | `enum` | `'max'` | `1d`, `1y`, `5y`, `max`, `mtd`, `wtd`, `ytd` |
| `tags` | `string?` | — | Comma-separated tags |

### Output

**Text** includes total invested, event count, date range, consistency streaks (current and longest), and a chronological timeline. Lists longer than 10 entries are summarized.

**Widget data** (`type: 'investment_history'`):

- `totalInvested` — sum of all contributions
- `investments[]` — `date`, `amount`
- `streaks` — `current`, `longest` (or `null`)
- `dateRange` — e.g. `"2022-01-15 to 2024-12-31"`

### Example Queries

- "Show me my investment history over the last year"
- "What is my investment consistency streak?"

---

## market_data_lookup

> Look up the current market price of any stock, ETF, cryptocurrency, or other financial instrument by its ticker symbol.

**Endpoints (two-step):**

1. `GET /api/v1/symbol/lookup?query={symbol}` — symbol search
2. `GET /api/v1/symbol/{dataSource}/{symbol}` — price and optional history

### Input Schema

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `symbol` | `string` | _(required)_ | Ticker symbol (e.g. `TSLA`, `AAPL`, `BTC`) |
| `includeHistoricalData` | `number?` | `0` | Days of historical price data to include |

### Symbol Resolution

The tool resolves the best match from lookup results using this priority:

1. Exact symbol match (case-insensitive) where `assetSubClass !== 'CRYPTOCURRENCY'`
2. Exact symbol match of any asset type
3. First result as fallback

### Output

**Text** includes current price, currency, data source, asset class/sub-class, and optional historical prices.

**Widget data** (`type: 'market_data_lookup'`):

- `name`, `symbol`, `price`, `currency`, `assetClass`, `assetSubClass`
- `historicalData[]` — `date`, `price`

### Example Queries

- "What is the current price of AAPL?"
- "Show me Tesla's stock price history for the last 30 days"

---

## holdings_search

> Search and filter portfolio holdings. Returns a list of holdings matching the specified criteria including allocation, value, and performance.

**Endpoint:** `GET /api/v1/portfolio/holdings`

### Input Schema

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `query` | `string?` | — | Search by name, symbol, asset class, or sub-class |
| `accounts` | `string?` | — | Comma-separated account IDs |
| `assetClasses` | `string?` | — | Comma-separated asset classes (e.g. `EQUITY,FIXED_INCOME`) |
| `holdingType` | `string?` | — | Filter by holding type |
| `range` | `enum` | `'max'` | `1d`, `1y`, `5y`, `max`, `mtd`, `wtd`, `ytd` |
| `tags` | `string?` | — | Comma-separated tags |

**Note:** The `query` field is applied client-side (not forwarded to the API). All search terms must match at least one of `symbol`, `name`, `assetClass`, or `assetSubClass` (AND logic across terms).

### Output

**Text** lists matching holdings with allocation, value, performance, and asset class. Lists longer than 10 entries are summarized (first 5, last 2).

**Widget data** (`type: 'holdings_search'`):

- `query` — the search query (or `null`)
- `holdings[]` — `symbol`, `name`, `allocation`, `value`, `netPerformance`, `netPerformancePercent`, `quantity`, `assetClass`, `assetSubClass`, `currency`

### Example Queries

- "Do I have any cryptocurrency holdings?"
- "Search for my equity ETF positions"

---

## Common Patterns

### Shared Filters

Five tools (`portfolio_analysis`, `performance_report`, `dividend_analysis`, `investment_history`, `holdings_search`) accept the same set of filters:

| Filter | Description |
| ------ | ----------- |
| `accounts` | Comma-separated account IDs to restrict results |
| `assetClasses` | Comma-separated asset classes (e.g. `EQUITY`, `FIXED_INCOME`) |
| `tags` | Comma-separated tags for filtering |
| `range` | Time range enum, defaults to `'max'` |

### Time Range Enum

All tools with a `range` field accept the same values:

| Value | Meaning |
| ----- | ------- |
| `1d` | 1 day |
| `wtd` | Week to date |
| `mtd` | Month to date |
| `ytd` | Year to date |
| `1y` | 1 year |
| `5y` | 5 years |
| `max` | All time (default) |

### Error Handling

All errors are caught at the `createGhostfolioTool` factory level. Individual tool handlers do not need their own try/catch. On error, the tool returns:

- **Content:** `"Error calling <toolName>: <message>"`
- **Artifact:** `null`

The `GhostfolioClient` provides typed errors (`GhostfolioApiError`) with `statusCode`, `errorCode`, and `message` for HTTP failures (401, 403, 404, 5xx), timeouts, and network errors.
