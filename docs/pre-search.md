# Pre-Search: Ghostfolio AI Financial Agent

**Project:** AgentForge — Building a Production-Ready Domain-Specific AI Agent
**Domain:** Finance (Ghostfolio)
**Date:** February 2025

---

## Phase 1: Define Your Constraints

### 1. Domain Selection

**Domain:** Finance — Wealth Management & Portfolio Analysis

**Repository:** [Ghostfolio](https://github.com/ghostfolio/ghostfolio) — An open-source wealth management platform built with NestJS, Angular, PostgreSQL, and Redis.

**Why Ghostfolio:**

- Full TypeScript monorepo (NestJS backend + Angular 21 frontend)
- Already has AI scaffolding: Vercel AI SDK (`ai` v4.3.16) + OpenRouter provider, with a dedicated AI module at `apps/api/src/app/endpoints/ai/`
- Clean NestJS service layer with rich financial calculations already implemented (portfolio performance, dividends, holdings, X-Ray risk analysis)
- Prisma ORM with PostgreSQL — type-safe schema with well-defined financial models
- Simple Docker deployment (3 services: API, PostgreSQL, Redis)
- Existing services map directly to agent tools with minimal wrapping

**Specific Use Cases:**

1. **Portfolio Analysis** — "How is my portfolio allocated? Am I over-concentrated in any sector?"
2. **Performance Tracking** — "What's my return over the past year? How does it compare to benchmarks?"
3. **Risk Assessment** — "Run an X-Ray on my portfolio. What risks should I address?"
4. **Dividend Analysis** — "What dividends have I received? What's my yield?"
5. **Holdings Search** — "Show me my tech stocks" or "What's my largest position?"
6. **Market Data** — "What's the current price of AAPL?"
7. **Investment Patterns** — "Have I been investing consistently? Show my investment streaks."

**Verification Requirements:**

- Financial data must be sourced from the user's actual portfolio (no hallucinated positions)
- Performance metrics must match Ghostfolio's own calculations (TWR/MWR)
- Agent must never suggest specific buy/sell actions (read-only analysis, not financial advice)
- All claims about portfolio composition must be cross-referenced against the database

**Data Sources:**

- Ghostfolio's PostgreSQL database (user portfolios, transactions, holdings)
- Market data providers already integrated: Yahoo Finance, CoinGecko, Alpha Vantage, EOD Historical Data, Financial Modeling Prep
- Calculated metrics from Ghostfolio's portfolio calculator (TWR, MWR, ROI)
- X-Ray rules engine (14 rules across 8 risk categories)

---

### 2. Scale & Performance

**Expected Query Volume:** Demo/evaluation scale — ~100 concurrent users maximum

**Latency Targets:**

| Query Type                                                          | Target       |
| ------------------------------------------------------------------- | ------------ |
| Single-tool queries (e.g., "What's AAPL's price?")                  | < 5 seconds  |
| Multi-step queries (e.g., "Analyze my portfolio and assess risks")  | < 15 seconds |
| Complex analysis (e.g., full X-Ray + performance + recommendations) | < 30 seconds |

**Concurrent User Requirements:** Low — this is a demo deployment for project evaluation. The existing Bull queue + Redis architecture can handle the load.

**Cost Constraints:**

- Using GPT-4o via OpenAI API (user has existing credits)
- Estimated cost per query: ~$0.01-0.05 (depending on tool chain length)
- Target: Stay under $50/month for demo usage
- Optimization: Cache portfolio snapshots (Ghostfolio already does this via Redis), minimize redundant LLM calls

---

### 3. Reliability Requirements

**Cost of a Wrong Answer:**

- **Medium-High** — Users may make financial decisions based on agent output
- Mitigation: Agent provides analysis only, never actionable trading instructions
- All responses include a disclaimer that this is not financial advice
- Data-grounded: Every claim references actual portfolio data

**Non-Negotiable Verification:**

- Portfolio data accuracy — agent responses must match what Ghostfolio shows in its UI
- Symbol validation — agent must not reference holdings the user doesn't own
- Mathematical consistency — percentages must add up, returns must be correctly calculated

**Human-in-the-Loop:**

- No automatic actions — agent is purely analytical (read-only)
- User can thumbs-up/down responses for feedback
- High-risk assessments flagged with confidence scores

**Audit/Compliance:**

- All agent interactions logged via LangSmith (full trace: input → reasoning → tool calls → output)
- No PII stored in LangSmith traces (portfolio data stays in Ghostfolio DB, only summaries sent to LLM)
- User data isolated by JWT authentication — agent can only access the authenticated user's portfolio

---

### 4. Team & Skill Constraints

**Agent Frameworks:** Started with LangChain.js, migrated to LangGraph.js for StateGraph-based orchestration. Strong JavaScript/TypeScript foundation. LangGraph's TypeScript SDK builds on LangChain with declarative graph abstractions.

**Domain Experience:** Familiar with investment concepts (portfolios, asset allocation, performance metrics, diversification). Ghostfolio's financial model is well-structured with clear TypeScript interfaces.

**Testing Frameworks:** Experienced with Jest (Ghostfolio's existing test framework). LangSmith evals are new but integrate cleanly with existing test infrastructure.

**Tech Stack Familiarity:**

- TypeScript: Strong ✅
- Bun/Elysia: Comfortable ✅ (TypeScript-native, lightweight HTTP framework)
- React: Strong ✅ (for chat widget)
- NestJS: Strong ✅ (Ghostfolio's backend — read-only integration via API)
- Docker: Comfortable ✅
- LangGraph.js / LangChain.js: Comfortable ✅
- LangSmith: Learning 🟡

---

## Phase 2: Architecture Discovery

### 5. Agent Framework Selection

**Choice: LangGraph.js** (migrated from LangChain.js)

**Why LangGraph.js over alternatives:**

| Framework            | Pros                                                                                                    | Cons                                                                  | Decision                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **LangGraph.js** ✅  | StateGraph orchestration, built-in message annotation, streaming support, native LangSmith integration  | Steeper learning curve than plain LangChain                           | **Selected** — declarative graph replaced manual agent loop, better streaming  |
| LangChain.js         | Rich tool abstraction, built-in memory, output parsers, native LangSmith integration, eval helpers      | Manual agent loop, less structured streaming                          | Foundation layer — LangGraph builds on top of LangChain.js                     |
| Vercel AI SDK        | Already in Ghostfolio, lightweight, native tool-calling                                                 | No built-in eval, less structured memory, weaker observability story  | Good for simple cases, insufficient for eval requirements                      |
| Custom               | Full control                                                                                            | Too much work to build memory, tool abstraction, tracing from scratch | Not practical for 1-week sprint                                                |

**Architecture: Standalone Agent Service with Floating Chat Widget**

- Separate Bun/Elysia service (`apps/agent/`) calling Ghostfolio's existing REST API
- One LangGraph agent with `StateGraph` (chatModel → tools cycle) running inside the Elysia server
- `ChatOpenAI` as the LLM backbone
- `BunSqliteSaver` checkpointer for persistent multi-turn conversation history (SQLite, thread-based isolation)
- `DynamicStructuredTool` for each of the 7 tools with Zod schemas
- LangSmith callback handler for automatic tracing
- React floating chat widget bundled via Bun, injected into Ghostfolio's Angular UI

**Why Standalone Instead of NestJS Module:**

- Avoids Angular chat UI development (biggest risk to 24hr MVP gate — assignment recommends "React, Next.js, or Streamlit for rapid prototyping")
- No complex NestJS dependency injection wiring (PortfolioService requires 13 injected dependencies)
- Dramatically easier to test — mock HTTP responses instead of NestJS DI container
- Better open source story — any Ghostfolio instance can deploy the agent alongside, no fork required
- All 7 planned tools map to existing REST endpoints; no new backend code needed in Ghostfolio
- Still lives in the forked repo at `apps/agent/`, imports `@ghostfolio/common` types
- Independently deployable — with proper documentation, any Ghostfolio user can install the agent as a standalone service or add the widget `<script>` tag to their existing instance, regardless of whether this fork is merged upstream

**State Management:**

- Conversation history via LangGraph checkpointer (`BunSqliteSaver`) with SQLite persistence
- Session list managed client-side in widget localStorage
- Portfolio data fetched fresh from Ghostfolio REST API on each tool call
- User context (userId, baseCurrency, language) derived from forwarded JWT token

**Integration Point:**

- New directory: `apps/agent/` in the Ghostfolio monorepo
- Elysia server (Bun runtime) exposes: `POST /api/chat`, `POST /api/chat/stream`, `GET /api/history`, `DELETE /api/sessions/:id`, `POST /api/feedback`, `GET /widget.js`
- Calls Ghostfolio's existing API endpoints (`GET /api/v1/portfolio/*`) with forwarded Bearer JWT
- React floating chat widget injected into Ghostfolio's Angular UI via `<script>` tag in `index.html`

**Authentication Flow:**

- Widget reads existing Ghostfolio JWT from browser storage (`sessionStorage.getItem('auth-token')`)
- Forwards JWT to agent backend: `Authorization: Bearer <token>`
- Agent backend forwards same JWT to Ghostfolio API for user-scoped data access
- No separate auth system needed — piggybacks on Ghostfolio's existing authentication

---

### 6. LLM Selection

**Choice: GPT-4o via OpenAI API**

**Why GPT-4o:**

- Excellent function/tool calling support (native OpenAI function calling)
- Strong reasoning for multi-step financial analysis
- Good cost/performance ratio (~$2.50/1M input tokens, ~$10/1M output tokens)
- User has existing OpenAI API credits for this project
- Well-tested with LangChain.js (`@langchain/openai` package)

**Configuration:**

```
Model: gpt-4o
Temperature: 0.0 (planner, deterministic) / 0.3 (synthesis, slight creativity for explanations)
Max tokens: 2048 (sufficient for detailed analysis responses)
```

**Context Window:** 128K tokens — more than enough for portfolio summaries + conversation history

**Fallback Strategy:**

- Primary: GPT-4o
- Fallback: GPT-4o-mini for simpler queries (cost optimization)
- Future: Could swap to Claude via the existing OpenRouter integration if needed

---

### 7. Tool Design

**7 Tools — All calling Ghostfolio's existing REST API endpoints:**

Each tool is a `DynamicStructuredTool` in LangChain.js that makes an authenticated HTTP request to Ghostfolio's API, forwarding the user's JWT token.

#### Tool 1: `portfolio_analysis`

- **Purpose:** Get comprehensive portfolio overview with holdings, allocation, and summary
- **Ghostfolio Endpoint:** `GET /api/v1/portfolio/details`
- **Input Schema:** `{ dateRange?: string, filters?: { accounts?, assetClasses?, tags? } }`
- **Output:** Holdings map (symbol → allocation %, value, asset class, sector, country), account breakdown, total value, currency
- **Error Handling:** HTTP 200 with empty holdings → return empty portfolio message; HTTP 401 → auth error; HTTP 5xx → retry once then graceful error

#### Tool 2: `performance_report`

- **Purpose:** Get portfolio performance metrics over specified time ranges
- **Ghostfolio Endpoint:** `GET /api/v2/portfolio/performance`
- **Input Schema:** `{ dateRange: 'today' | 'wtd' | 'mtd' | 'ytd' | '1y' | '5y' | 'max' }`
- **Output:** Net performance (absolute + %), gross performance, currency effect, chart data points
- **Error Handling:** Return "insufficient data" if no transactions exist for the date range

#### Tool 3: `risk_assessment`

- **Purpose:** Run Ghostfolio's X-Ray analysis on the portfolio
- **Ghostfolio Endpoint:** `GET /api/v1/portfolio/report`
- **Input Schema:** `{}` (no params — analyzes full portfolio)
- **Output:** 8 risk categories with 14 rules, each with pass/fail evaluation and configurable thresholds:
  - Liquidity (buying power)
  - Emergency fund setup
  - Currency cluster risk (base currency concentration)
  - Asset class cluster risk (equity/fixed income balance)
  - Account cluster risk (single account concentration)
  - Economic market cluster risk (developed/emerging)
  - Regional market cluster risk (5 regions)
  - Fee ratio analysis
- **Error Handling:** Return partial results if some rules can't be evaluated

#### Tool 4: `holdings_search`

- **Purpose:** Search and filter portfolio holdings by name, symbol, or attributes
- **Ghostfolio Endpoint:** `GET /api/v1/portfolio/holdings`
- **Input Schema:** `{ query?: string, assetClass?: string, assetSubClass?: string, tags?: string[] }`
- **Output:** Array of matching holdings with key metrics (value, allocation %, performance)
- **Error Handling:** Return empty results with helpful message if no matches

#### Tool 5: `market_data_lookup`

- **Purpose:** Get current market prices for symbols
- **Ghostfolio Endpoint:** `GET /api/v1/data-providers/ghostfolio/quotes`
- **Input Schema:** `{ symbols: string[], dataSource?: string }`
- **Output:** Current price, currency for each symbol
- **Error Handling:** Return "symbol not found" for invalid tickers, partial results for mixed valid/invalid

#### Tool 6: `dividend_analysis`

- **Purpose:** Get dividend history and yield analysis
- **Ghostfolio Endpoint:** `GET /api/v1/portfolio/dividends`
- **Input Schema:** `{ dateRange?: string, groupBy?: 'month' | 'year' }`
- **Output:** Dividend payments over time, total dividends, yield calculation
- **Error Handling:** Return "no dividends" message if portfolio has no dividend-paying holdings

#### Tool 7: `investment_history`

- **Purpose:** Get investment pattern analysis and consistency streaks
- **Ghostfolio Endpoint:** `GET /api/v1/portfolio/investments`
- **Input Schema:** `{ dateRange?: string, groupBy?: 'day' | 'month' | 'year', savingsRate?: number }`
- **Output:** Investment amounts over time, current streak (months/years of consistent investing), savings rate comparison
- **Error Handling:** Return basic history even if streak calculation fails

**External API Dependencies:**

- OpenAI API (GPT-4o) — for LLM reasoning
- Ghostfolio REST API — all financial data accessed via authenticated HTTP calls (Bearer JWT)
- Market data providers (Yahoo Finance, CoinGecko, etc.) — accessed indirectly through Ghostfolio's API, not called directly

**Mock vs Real Data:**

- Development: Use Ghostfolio's seed data + synthetic portfolio fixtures (mocked API responses as JSON)
- Testing: Fully mocked Ghostfolio API responses via HTTP fixtures (Bun test runner)
- Production: Real user portfolio data via Ghostfolio's REST API (backed by PostgreSQL)

---

### 8. Observability Strategy

**Choice: LangSmith**

**Why LangSmith:**

- Native integration with LangChain.js (zero-config callback handler)
- User already has an account
- Covers all requirements: tracing, evals, datasets, cost tracking, prompt management

**Implementation:**

| Capability           | LangSmith Feature     | Implementation                                                                                                                                     |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace Logging**    | Run traces            | Automatic via LangSmith callback — every agent invocation traced with: input query → LLM reasoning → tool selections → tool results → final output |
| **Latency Tracking** | Run duration metrics  | Built-in per-step timing in traces. Custom tags for: LLM call time, tool execution time, total response time                                       |
| **Error Tracking**   | Error traces          | Failed runs automatically captured with stack traces. Custom metadata for error categories (tool failure, LLM error, validation error)             |
| **Token Usage**      | Token counts          | Automatic input/output token counting per LLM call. Aggregated cost tracking via OpenAI pricing                                                    |
| **Eval Results**     | Datasets + Evaluators | Eval datasets stored in LangSmith. Run evaluations programmatically. Track pass rates over time                                                    |
| **User Feedback**    | Feedback API          | Thumbs up/down from UI → LangSmith feedback API. Associate feedback with specific run traces                                                       |

**Metrics We'll Track:**

- Agent response latency (p50, p95)
- Tool call success rate per tool
- Token usage per query (input + output)
- Eval pass rate (target: >80%)
- User satisfaction (thumbs up/down ratio)
- Cost per query

**Configuration:**

```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=<langsmith-api-key>
LANGCHAIN_PROJECT=ghostfolio-ai-agent
```

---

### 9. Eval Approach

**Dataset: 50+ test cases across 4 synthetic portfolios**

**Synthetic Portfolios:**

| Portfolio                | Description                               | Key Characteristics                                              |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------- |
| **Conservative Retiree** | Bonds, dividend stocks, cash              | 60% fixed income, 30% equity, 10% cash. Low risk, income-focused |
| **Aggressive Growth**    | Tech stocks, emerging markets, crypto     | 80% equity, 15% crypto, 5% alternatives. High concentration risk |
| **Dividend Income**      | REITs, dividend aristocrats, utilities    | High dividend yield, moderate diversification, US-heavy          |
| **Crypto-Heavy**         | Bitcoin, Ethereum, altcoins + some stocks | 60% crypto, 40% equity. High volatility, currency risk           |

**Test Case Distribution:**

| Category        | Count | Examples                                                                                                   |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| **Happy Path**  | 20+   | "What's my portfolio allocation?" → correct breakdown. "Show my YTD performance" → accurate metrics.       |
| **Edge Cases**  | 10+   | Empty portfolio, single holding, zero dividends, all-cash, extreme date ranges                             |
| **Adversarial** | 10+   | "Buy AAPL for me", prompt injection attempts, requests for specific investment advice, nonsensical queries |
| **Multi-Step**  | 10+   | "Analyze my portfolio, then assess risks, and suggest improvements" → chains multiple tools correctly      |

**Each test case includes:**

- Input query (natural language)
- Expected tool calls (which tools should be invoked, in what order)
- Expected output characteristics (contains certain data, avoids certain claims)
- Pass/fail criteria (automated scoring via LangSmith evaluators)

**Eval Types:**

| Eval Type          | Method                                            | Target                           |
| ------------------ | ------------------------------------------------- | -------------------------------- |
| **Correctness**    | Compare agent output against known portfolio data | >90% factual accuracy            |
| **Tool Selection** | Verify correct tools chosen for each query type   | >95% correct tool selection      |
| **Tool Execution** | Verify tool calls succeed with valid parameters   | >95% success rate                |
| **Safety**         | Check agent refuses harmful/out-of-scope requests | 100% refusal rate                |
| **Consistency**    | Run same query 3x, compare outputs                | >90% consistency                 |
| **Edge Cases**     | Graceful handling of missing data, invalid input  | 100% no crashes                  |
| **Latency**        | Measure end-to-end response time                  | <5s single-tool, <15s multi-step |

**Automated Evaluation Pipeline:**

1. Seed test database with synthetic portfolios
2. Run eval dataset through agent via LangSmith
3. Score with custom evaluators (correctness, tool selection, safety)
4. Generate report with pass rates and failure analysis
5. Track regression across code changes

---

### 10. Verification Design

**4 Verification Checks:**

#### Check 1: Confidence Scoring

- **What:** Assign a confidence score (0-1) to each agent response
- **How:** Based on: number of tool calls that succeeded, data completeness, query clarity
- **Threshold:** Responses with confidence < 0.6 include a warning: "I'm not fully confident in this analysis. Please verify the data."
- **Implementation:** Post-processing step after agent response generation

#### Check 2: Output Validation (Zod Schemas)

- **What:** Validate tool outputs match expected schemas before passing to LLM
- **How:** Each tool defines a Zod output schema. Tool results validated before inclusion in agent context
- **Catches:** Malformed data, missing required fields, type mismatches
- **Implementation:** Validation layer in each `DynamicStructuredTool` wrapper

#### Check 3: Hallucination Detection

- **What:** Cross-reference agent claims against actual portfolio data from Ghostfolio API
- **How:** Post-response check: extract mentioned symbols, percentages, values → call Ghostfolio API → compare
- **Catches:** Agent claiming holdings that don't exist, wrong allocation percentages, fabricated performance numbers
- **Implementation:** Verification service that parses agent output and queries Ghostfolio's portfolio endpoints for ground truth

#### Check 4: Domain Constraints

- **What:** Enforce financial domain rules on agent behavior
- **Rules:**
  - Never suggest specific buy/sell actions
  - Never predict future returns with specific numbers
  - Always mention that analysis is not financial advice
  - Validate that mentioned symbols exist in user's portfolio (or are valid market tickers for market_data_lookup)
  - Flag unrealistic return projections (>100% annual)
- **Implementation:** System prompt constraints + post-processing filter

---

## Phase 3: Post-Stack Refinement

### 11. Failure Mode Analysis

| Failure Scenario                                     | Handling Strategy                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Tool execution fails** (DB error, service timeout) | Return graceful error message: "I couldn't retrieve your portfolio data right now. Please try again." Log error to LangSmith trace.   |
| **LLM API error** (rate limit, timeout, outage)      | Retry once with exponential backoff. If still failing, return: "I'm temporarily unable to process your request."                      |
| **Ambiguous query**                                  | Agent asks clarifying question: "Could you specify which time period you're interested in?"                                           |
| **Out-of-scope request**                             | Politely decline: "I can help with portfolio analysis, but I can't execute trades or provide specific investment advice."             |
| **Empty portfolio**                                  | Detect early, return helpful onboarding: "Your portfolio is empty. Add some transactions in Ghostfolio to get started with analysis." |
| **Market data unavailable**                          | Return last known data with timestamp: "Showing last available price from [date]. Market data may be delayed."                        |

**Rate Limiting:**

- OpenAI API: Implement token bucket rate limiter in the agent service
- Ghostfolio API: Respect existing rate limits; agent adds minimal overhead (7 endpoints, read-only)
- User queries: Max 20 queries/minute per user (via Elysia middleware)

**Graceful Degradation:**

- If LLM is down → return cached analysis if available
- If market data provider is down → use last cached prices
- If single tool fails in a multi-tool chain → continue with available data, note the gap

---

### 12. Security Considerations

**Prompt Injection Prevention:**

- System prompt is fixed and not user-modifiable
- User input sanitized before inclusion in prompts
- Tool outputs are structured (Zod-validated), not raw strings injected into prompts
- Agent has no write access to Ghostfolio data (read-only tools only)

**Data Leakage Risks:**

- Portfolio data sent to OpenAI API for analysis — acceptable for demo (user opt-in)
- LangSmith traces may contain portfolio summaries — configurable trace detail level
- No PII (name, email, SSN) included in LLM prompts — only portfolio data (holdings, amounts)

**API Key Management:**

- `OPENAI_API_KEY` — environment variable on agent service, never in source code
- `LANGCHAIN_API_KEY` — environment variable for LangSmith
- `GHOSTFOLIO_API_URL` — internal URL for Ghostfolio API (not a secret)
- Ghostfolio secrets (`JWT_SECRET_KEY`, `ACCESS_TOKEN_SALT`) — remain on Ghostfolio service only; agent service never has direct DB access
- Railway environment variables for deployment (encrypted at rest)

**CORS & Widget Security:**

- Agent service CORS configured to accept requests only from Ghostfolio's domain
- Widget reads JWT from same-origin `localStorage`/`sessionStorage` — no cross-origin storage access
- Widget communicates with agent backend via HTTPS in production

**Audit Logging:**

- Every agent interaction traced in LangSmith (who queried, what tools were called, what was returned)
- Ghostfolio's existing analytics tracking (user activity counts, country)
- Elysia request logging for agent API-level audit trail

---

### 13. Testing Strategy

**Unit Tests (Bun test runner — per tool):**

- Mock Ghostfolio API responses with HTTP fixtures (JSON files from `test/fixtures/`)
- Test each tool independently: valid input → expected output, invalid input → graceful error
- Test Zod schema validation for each tool's input/output
- Test JWT forwarding logic in `ghostfolio-client.ts`
- 21 test files: 7 tool tests, 5 graph tests, 7 verification tests, 1 client test, 1 integration test

**Integration Tests (agent flows):**

- Spin up agent with mocked Ghostfolio API (using MSW or similar HTTP mock)
- Send natural language queries, verify correct tool selection and response format
- Test multi-turn conversations (memory persistence)
- Test error propagation (HTTP errors from Ghostfolio → user-friendly messages)
- Test auth flow (missing JWT → error, valid JWT → data returned)
- 69-case eval suite covers integration flows (see `eval-cases.json`)

**Adversarial Testing:**

- Prompt injection attempts (included in eval dataset)
- Out-of-scope requests (trading, personal advice)
- Malformed inputs (empty strings, very long queries, special characters)
- Included in the 50+ eval test cases

**Regression Testing:**

- LangSmith dataset comparison across code changes
- Snapshot tests for tool output schemas
- CI pipeline: `bun test` → eval run → compare pass rates

---

### 14. Open Source Planning

**What We'll Release:**

- Forked Ghostfolio repo with AI agent enhancement at `apps/agent/`
- Standalone agent service (Bun + Elysia) with floating React chat widget
- Eval dataset: 50+ test cases as JSON fixtures
- Setup guide specific to the AI agent features

**Independent Deployment Story:**

- The agent communicates with Ghostfolio entirely via its public REST API — it has zero coupling to Ghostfolio's internals
- Any Ghostfolio user can deploy the agent alongside their existing instance by: (1) running the agent Docker container pointed at their Ghostfolio URL, and (2) adding a single `<script>` tag to load the chat widget
- This works whether or not the fork is ever merged into Ghostfolio's main repo — the agent is a companion service, not a patch
- Could be published as an npm package or standalone Docker image for even easier adoption

**Licensing:**

- AGPLv3 (matching Ghostfolio's license)

**Documentation:**

- README section covering AI agent setup (Bun, API keys, LangSmith config, connecting to Ghostfolio)
- Architecture decision document (this presearch doc)
- Tool reference (descriptions, schemas, examples)
- Eval results summary

**Repository Structure (new files):**

```
ghostfolio/
├── apps/agent/                      # New standalone agent service
│   ├── server/
│   │   ├── index.ts                 # Elysia server entry point (Bun runtime)
│   │   ├── agent.ts                 # LangGraph agent setup (ChatOpenAI + StateGraph)
│   │   ├── ghostfolio-client.ts     # HTTP client for Ghostfolio API (JWT forwarding)
│   │   ├── tools/                   # 7 tool definitions (HTTP calls to Ghostfolio)
│   │   │   ├── portfolio-analysis.ts
│   │   │   ├── performance-report.ts
│   │   │   ├── risk-assessment.ts
│   │   │   ├── holdings-search.ts
│   │   │   ├── market-data-lookup.ts
│   │   │   ├── dividend-analysis.ts
│   │   │   └── investment-history.ts
│   │   └── verification/            # Verification checks
│   │       ├── confidence-scorer.ts
│   │       ├── output-validator.ts
│   │       ├── hallucination-detector.ts
│   │       └── domain-constraints.ts
│   ├── widget/
│   │   ├── ChatWidget.tsx           # Floating chat button + sliding panel (React)
│   │   ├── index.tsx                # Widget entry point (reads JWT, mounts to DOM)
│   │   └── dev.html                 # Dev file for testing widget in browser
│   ├── dist/
│   │   └── widget.js                # Built widget bundle (served as static file)
│   ├── test/
│   │   ├── fixtures/                # Synthetic portfolio data (mocked API responses)
│   │   │   ├── conservative-portfolio.json
│   │   │   ├── aggressive-portfolio.json
│   │   │   ├── dividend-portfolio.json
│   │   │   └── crypto-portfolio.json
│   │   └── eval/                    # Eval test cases
│   │       ├── happy-path.json
│   │       ├── edge-cases.json
│   │       ├── adversarial.json
│   │       └── multi-step.json
│   ├── Dockerfile                   # Bun-based Docker image
│   ├── package.json
│   └── tsconfig.json
├── apps/client/src/index.html       # Modified: add <script> tag for widget.js
├── docker/docker-compose.yml        # Modified: add agent service
└── docs/
    ├── pre-search.md                # This document
    └── architecture.md              # Agent architecture doc
```

---

### 15. Deployment & Operations

**Hosting: Railway**

**Services:**
| Service | Railway Config |
|---------|---------------|
| Ghostfolio App (NestJS + Angular) | Docker container, port 3333, 512MB RAM |
| AI Agent Service (Bun + Elysia) | Docker container, port 3334, 256MB RAM |
| PostgreSQL 15 | Railway managed plugin, 1GB storage |
| Redis | Railway managed plugin |

**Network Configuration:**

- Agent service connects to Ghostfolio API via internal Railway networking (`http://ghostfolio:3333`)
- Widget loaded by browser from agent service's public URL
- CORS configured on agent service to allow requests from Ghostfolio's domain

**Environment Variables (Railway):**

```
# Ghostfolio Core (on Ghostfolio service)
DATABASE_URL=postgresql://...
REDIS_HOST=...
REDIS_PORT=6379
REDIS_PASSWORD=...
ACCESS_TOKEN_SALT=...
JWT_SECRET_KEY=...

# AI Agent (on Agent service)
GHOSTFOLIO_API_URL=http://ghostfolio:3333  # Internal Railway URL
OPENAI_API_KEY=...
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=...
LANGCHAIN_PROJECT=ghostfolio-ai-agent
```

**Docker Compose (development):**

```yaml
services:
  ghostfolio:
    # ... existing Ghostfolio config ...
    ports:
      - 3333:3333

  agent:
    build:
      context: ./apps/agent
      dockerfile: Dockerfile
    ports:
      - 3334:3334
    environment:
      - GHOSTFOLIO_API_URL=http://ghostfolio:3333
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - LANGCHAIN_TRACING_V2=true
      - LANGCHAIN_API_KEY=${LANGCHAIN_API_KEY}
      - LANGCHAIN_PROJECT=ghostfolio-ai-agent
    depends_on:
      - ghostfolio
```

**CI/CD:**

- GitHub Actions: lint → test → build → deploy to Railway on push to `main`
- Separate build targets for Ghostfolio and Agent service
- Eval run on PR (via LangSmith CI integration)

**Health Monitoring:**

- `GET /api/v1/health` — existing Ghostfolio health check
- `GET /health` — agent service health check (verifies Ghostfolio API reachability)
- Railway built-in metrics (CPU, memory, request count)
- LangSmith dashboard for agent-specific metrics

**Rollback Strategy:**

- Railway automatic rollback on failed health checks (per service)
- Agent service can be rolled back independently of Ghostfolio
- Git-based rollback (revert commit, auto-deploy previous version)

---

### 16. Iteration Planning

**User Feedback Collection:**

- Thumbs up/down buttons on each agent response
- Feedback stored via LangSmith Feedback API, associated with run traces
- Optional free-text feedback field

**Eval-Driven Improvement Cycle:**

1. Run eval suite → identify failing test cases
2. Analyze failure patterns in LangSmith traces
3. Adjust: system prompt, tool descriptions, or verification logic
4. Re-run evals → confirm improvement without regression
5. Deploy

**Feature Prioritization:**
| Priority | Feature | Timeline |
|----------|---------|----------|
| P0 (MVP) | 3 core tools, React chat widget, Elysia backend, deployed | Day 1 (24hrs) |
| P1 | All 7 tools, conversation memory, verification | Day 2-3 |
| P2 | Eval framework (50+ tests), LangSmith integration | Day 3-4 |
| P3 | Observability dashboard, feedback UI, widget polish | Day 5-6 |
| P4 | Open source prep, docs, demo video | Day 7 |

**MVP Tools (first 3 for 24-hour gate):**

1. `portfolio_analysis` — highest value, most common query type
2. `performance_report` — users always want to know their returns
3. `risk_assessment` — demonstrates domain-specific verification

---

## Build Strategy (Priority Order)

1. **Day 1 (MVP gate):**
   - Set up `apps/agent/` with Bun + Elysia server (1 hr)
   - Build Ghostfolio API client with JWT forwarding (1 hr)
   - Implement 3 tool functions wrapping Ghostfolio API endpoints (2 hrs)
   - Wire LangGraph agent with `ChatOpenAI` + `StateGraph` + `DynamicStructuredTool` (2 hrs)
   - Build React floating chat widget + bundle via Bun (2 hrs)
   - Add `<script>` tag to Ghostfolio's `index.html` (15 min)
   - Docker setup + deploy Ghostfolio + Agent to Railway (2 hrs)
   - 5 basic eval test cases (1 hr)
   - Total: ~10 hours, well within 24hr gate
2. **Day 2:** Add remaining 4 tools, implement conversation memory (custom `SessionMemoryManager`), add LangSmith tracing
3. **Day 3:** Build verification layer (4 checks), refine system prompt, start eval dataset
4. **Day 4:** Complete 50+ eval test cases, run first eval baseline, polish chat widget UI
5. **Day 5:** Iterate on agent based on eval failures, add thumbs up/down feedback mechanism
6. **Day 6:** Observability dashboard review, cost analysis, documentation
7. **Day 7:** Open source prep, demo video, final submission polish
