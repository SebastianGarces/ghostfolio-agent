# Ghostfolio AI Financial Agent — Build Checklist

**Project:** AgentForge — Building a Production-Ready Domain-Specific AI Agent
**Domain:** Finance (Ghostfolio)
**Date:** February 2025

---

## How to Read This Checklist

Each item follows this format:

- **ID**: `E{epic}.S{story}` for cross-referencing dependencies
- **Complexity**: S (< 1 hr), M (1-3 hrs), L (3-6 hrs)
- **MVP Gate**: Items marked with `[MVP]` are required to pass the 24-hour gate
- **Parallelizable**: Notes on which items can be worked on simultaneously

---

## Epic Summary

| #         | Epic                      | Stories | MVP?    | Depends On |
| --------- | ------------------------- | ------- | ------- | ---------- |
| E1        | Project Scaffolding       | 4       | Yes     | None       |
| E2        | Ghostfolio API Client     | 3       | Yes     | E1         |
| E3        | MVP Tools (3 core)        | 5       | Yes     | E2         |
| E4        | LangGraph Agent Setup     | 3       | Yes     | E3         |
| E5        | Elysia HTTP Server        | 5       | Yes     | E4         |
| E6        | React Chat Widget         | 6       | Yes     | E5         |
| E7        | Remaining Tools (4)       | 4       | No      | E2, E3.S1  |
| E8        | Verification Checks       | 6       | No      | E4         |
| E9        | Testing & Evals           | 4       | No      | E7, E8     |
| E10       | Observability (LangSmith) | 3       | No      | E4         |
| E11       | Docker & Deployment       | 5       | Partial | E5, E6     |
| E12       | Documentation             | 4       | No      | All        |
| **Total** |                           | **52**  |         |            |

---

## Dependency Graph & Critical Path

```
E1 (Scaffolding)
  |
  v
E2 (API Client) ----+-----> E7 (Remaining 4 tools)
  |                  |
  v                  |
E3 (MVP 3 tools) ---+
  |
  v
E4 (LangGraph Agent) -----> E8 (Verification) -----> E9 (Evals)
  |                                                     |
  v                                                     v
E5 (Elysia Server) --> E11 (Docker/Deploy)         E10 (Observability)
  |
  v
E6 (React Widget)
  |
  v
E11 (Docker/Deploy)
  |
  v
E12 (Documentation)
```

**Critical path for MVP (24-hour gate)**:

```
E1.S1-S3 → E2.S1 → E3.S1 → E3.S2+S3+S4 (parallel) → E4.S1 → E4.S2 → E5.S1+S2 → E6.S1-S4 → E6.S6 → E11.S1+S2
```

**Items that can run in parallel with the critical path**:

- E7 (remaining tools) can start after E2.S1, in parallel with E3-E6
- E8 (verification) can start after E4.S2
- E9 (evals) can start after E8 and E7
- E10 (observability) can start after E4.S2
- E12 (documentation) can be ongoing throughout

---

## Epic 1: Project Scaffolding & Configuration

**Goal**: Create the `apps/agent/` directory with Bun project, TypeScript config, and dependency management so that all subsequent work has a foundation.

**Dependencies**: None (this is the root)

### E1.S1 — Initialize Bun project with package.json `[MVP]`

**Complexity**: S

**Description**: Create `apps/agent/` directory tree and initialize with `bun init`. Configure `package.json` with project metadata, scripts (`dev`, `build`, `test`, `start`), and initial dependencies.

**Files to create**:

- `apps/agent/package.json`

**Dependencies to install**:

- `elysia` (HTTP framework)
- `@langchain/core`, `@langchain/openai`, `langchain` (AI framework)
- `zod` (schema validation)
- `react`, `react-dom` (widget)
- Dev: `@types/react`, `@types/react-dom`, `typescript`, `bun-types`

**Acceptance criteria**:

- `cd apps/agent && bun install` succeeds
- `bun run --help` shows configured scripts
- Project name is `@ghostfolio/agent`

---

### E1.S2 — Configure TypeScript for Bun runtime `[MVP]`

**Complexity**: S

**Description**: Create `tsconfig.json` configured for Bun's runtime (ESNext target, Bun module resolution). Set up path aliases so the agent can import from `@ghostfolio/common/*` (using relative paths to `../../libs/common/src/lib/*`).

**Files to create**:

- `apps/agent/tsconfig.json`

**Key reference**: The monorepo's `tsconfig.base.json` defines the path aliases:

```json
"@ghostfolio/common/*": ["libs/common/src/lib/*"]
```

The agent's tsconfig should extend or replicate this with paths adjusted for the `apps/agent/` base.

**Acceptance criteria**:

- `bun run tsc --noEmit` passes with zero errors
- Can import types like `PortfolioPosition`, `PortfolioDetails`, `PortfolioPerformanceResponse` from `@ghostfolio/common/interfaces`
- Can import types like `DateRange`, `GroupBy` from `@ghostfolio/common/types`

---

### E1.S3 — Create directory structure `[MVP]`

**Complexity**: S

**Description**: Create the full directory scaffold matching the architecture defined in the pre-search document.

**Directories to create**:

```
apps/agent/
  server/
    tools/
    verification/
  widget/
  test/
    fixtures/
    eval/
  dist/
```

**Acceptance criteria**:

- All directories exist
- A placeholder `apps/agent/server/index.ts` can be compiled by `bun run tsc --noEmit`

---

### E1.S4 — Add agent to monorepo .gitignore

**Complexity**: S

**Description**: Ensure `apps/agent/node_modules/`, `apps/agent/dist/`, and `apps/agent/.env` are excluded from version control.

**Files to modify**:

- `.gitignore` (add `apps/agent/node_modules/`, `apps/agent/dist/`, `apps/agent/.env`)

**Acceptance criteria**:

- `git status` does not show `apps/agent/node_modules/` after `bun install`

**Parallelization**: E1.S1 first, then E1.S2-S4 can be parallel.

---

## Epic 2: Ghostfolio API Client

**Goal**: Build the HTTP client that all 7 tools use to call Ghostfolio's REST API with JWT forwarding. This is the single most critical dependency — every tool depends on it.

**Dependencies**: E1 (project scaffolding)

### E2.S1 — Implement GhostfolioClient class with JWT forwarding `[MVP]`

**Complexity**: M

**Description**: Create `apps/agent/server/ghostfolio-client.ts` — a typed HTTP client that wraps `fetch()` to call Ghostfolio endpoints. The client must:

1. Accept a base URL from environment (`GHOSTFOLIO_API_URL`, default `http://localhost:3333`)
2. Forward the user's JWT as `Authorization: Bearer <token>` on every request
3. Handle HTTP errors (401 → auth error, 404 → not found, 5xx → server error)
4. Parse JSON responses with proper TypeScript typing
5. Support query parameter serialization (accounts, assetClasses, dataSource, range, symbol, tags, etc.)

**Key insight from codebase**: The Ghostfolio client app stores the JWT under the key `'auth-token'` in both `sessionStorage` and `localStorage` (see `apps/client/src/app/services/settings-storage.service.ts` line 5: `export const KEY_TOKEN = 'auth-token'`). The widget will read from the same storage key.

**Key insight from portfolio controller**: The endpoints use query param patterns like `?accounts=X&assetClasses=Y&range=max&tags=Z`. See `apps/api/src/app/portfolio/portfolio.controller.ts` lines 80-87 for the exact parameter names.

**Files to create**:

- `apps/agent/server/ghostfolio-client.ts`

**Acceptance criteria**:

- Can call `GET /api/v1/portfolio/details?range=max` with a valid JWT and receive typed response
- Returns structured error objects (not raw HTTP errors) for 401, 404, 5xx
- Query params with undefined values are omitted from the URL
- TypeScript types match the Ghostfolio common interfaces (`PortfolioDetails`, `PortfolioPerformanceResponse`, etc.)

---

### E2.S2 — Add retry logic and timeout handling

**Complexity**: S

**Description**: Add configurable retry (1 retry with exponential backoff) and request timeout (10 seconds default) to the GhostfolioClient. Log failed requests for debugging.

**Files to modify**:

- `apps/agent/server/ghostfolio-client.ts`

**Acceptance criteria**:

- Requests timeout after 10 seconds
- Failed requests are retried once with 1-second backoff
- Timeout and retry count are configurable via constructor options

---

### E2.S3 — Unit tests for GhostfolioClient `[MVP]`

**Complexity**: M

**Description**: Test the HTTP client with mocked responses. Cover: successful GET, query param serialization, JWT header forwarding, error handling (401, 404, 500), retry behavior, timeout.

**Files to create**:

- `apps/agent/test/ghostfolio-client.test.ts`

**Acceptance criteria**:

- 8+ test cases pass via `bun test`
- Tests use mocked HTTP (not real Ghostfolio instance)
- Verifies Authorization header is `Bearer <token>`

**Parallelization**: E2.S1 must come first. E2.S2 and E2.S3 can be parallel after E2.S1.

---

## Epic 3: MVP Tools (3 Core Tools for 24-Hour Gate)

**Goal**: Implement the 3 highest-value tools that wrap Ghostfolio REST endpoints. These are required for the MVP gate.

**Dependencies**: E2 (GhostfolioClient)

### E3.S1 — Tool base class / shared utility `[MVP]`

**Complexity**: S

**Description**: Create a shared utility or base pattern for tool creation. Each tool follows the same pattern: define a Zod input schema, call GhostfolioClient, validate response, return structured result. Create a helper `createGhostfolioTool()` factory function that wraps `DynamicStructuredTool` from LangChain.

**Files to create**:

- `apps/agent/server/tools/create-tool.ts`

**Key reference**: Each tool will use `DynamicStructuredTool` from `@langchain/core/tools` with Zod schemas for input validation. The tool receives a `GhostfolioClient` instance and the user's JWT at construction time.

**Acceptance criteria**:

- Factory function accepts: name, description, input schema (Zod), handler function
- Returns a `DynamicStructuredTool` instance
- Handler receives typed input and GhostfolioClient

---

### E3.S2 — Implement portfolio_analysis tool `[MVP]`

**Complexity**: M

**Description**: Wrap `GET /api/v1/portfolio/details`. This is the most-used tool — it returns the complete portfolio overview with holdings, accounts, platforms, markets, and summary.

**Ghostfolio endpoint**: `apps/api/src/app/portfolio/portfolio.controller.ts` lines 74-87

- Query params: `accounts`, `assetClasses`, `dataSource`, `range` (default `'max'`), `symbol`, `tags`, `withMarkets`
- Auth: `AuthGuard('jwt')` + `HasPermissionGuard`
- Response: `PortfolioDetails & { hasError: boolean }`

**Response interface**: `PortfolioDetails` from `libs/common/src/lib/interfaces/portfolio-details.interface.ts`:

- `accounts` — map of account ID to { balance, currency, name, valueInBaseCurrency }
- `holdings` — map of symbol to `PortfolioPosition`
- `platforms` — map of platform ID to { balance, currency, name, valueInBaseCurrency }
- `markets` / `marketsAdvanced` — market allocation breakdown
- `summary` — `PortfolioSummary` (when withSummary=true)

**PortfolioPosition fields** (from `libs/common/src/lib/interfaces/portfolio-position.interface.ts`):
`allocationInPercentage`, `assetClass`, `assetSubClass`, `countries`, `currency`, `grossPerformance`, `grossPerformancePercent`, `investment`, `marketPrice`, `name`, `netPerformance`, `netPerformancePercent`, `quantity`, `sectors`, `symbol`, `valueInBaseCurrency`, etc.

**Files to create**:

- `apps/agent/server/tools/portfolio-analysis.ts`

**Input schema (Zod)**:

```typescript
z.object({
  range: z
    .enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd'])
    .default('max')
    .describe('Time range for analysis'),
  accounts: z
    .string()
    .optional()
    .describe('Filter by account IDs (comma-separated)'),
  assetClasses: z
    .string()
    .optional()
    .describe('Filter by asset classes (comma-separated)'),
  tags: z.string().optional().describe('Filter by tags (comma-separated)')
});
```

**Acceptance criteria**:

- Tool calls `GET /api/v1/portfolio/details` with correct query params
- Returns holdings with: symbol, name, allocation %, asset class, currency, net performance, value
- Returns summary with: current net worth, total investment, gross/net performance
- Empty portfolio returns helpful message (not error)

---

### E3.S3 — Implement performance_report tool `[MVP]`

**Complexity**: M

**Description**: Wrap `GET /api/v2/portfolio/performance`. Returns performance metrics and chart data over specified time ranges.

**Ghostfolio endpoint**: `apps/api/src/app/portfolio/portfolio.controller.ts` lines 503-508

- **Note**: This is a v2 endpoint (`@Version('2')`). The API URL is `/api/v2/portfolio/performance`.
- Query params: `accounts`, `assetClasses`, `dataSource`, `range` (default `'max'`), `symbol`, `tags`, `withExcludedAccounts`
- Auth: `AuthGuard('jwt')` + `HasPermissionGuard`

**Response interface**: `PortfolioPerformanceResponse` from `libs/common/src/lib/interfaces/responses/portfolio-performance-response.interface.ts`:

- `chart`: `HistoricalDataItem[]` (date, netPerformanceInPercentage, netWorth, totalInvestment, value)
- `firstOrderDate`: Date
- `performance`: `PortfolioPerformance` (currentNetWorth, netPerformance, netPerformancePercentage, totalInvestment)

**Files to create**:

- `apps/agent/server/tools/performance-report.ts`

**Input schema (Zod)**:

```typescript
z.object({
  range: z
    .enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd'])
    .default('max')
    .describe('Time range'),
  accounts: z.string().optional().describe('Filter by account IDs'),
  assetClasses: z.string().optional().describe('Filter by asset classes'),
  tags: z.string().optional().describe('Filter by tags'),
  withExcludedAccounts: z
    .boolean()
    .default(false)
    .describe('Include excluded accounts')
});
```

**Acceptance criteria**:

- Tool calls `GET /api/v2/portfolio/performance` (note: v2!)
- Returns performance metrics: net performance absolute + %, current net worth, total investment
- Summarizes chart data (condense to key data points, not raw array)
- Handles "no data for range" gracefully

---

### E3.S4 — Implement risk_assessment tool `[MVP]`

**Complexity**: M

**Description**: Wrap `GET /api/v1/portfolio/report`. Returns the X-Ray analysis with risk categories and rules.

**Ghostfolio endpoint**: `apps/api/src/app/portfolio/portfolio.controller.ts` lines 616-641

- No query params (only optional `X-Impersonation-Id` header)
- Auth: `AuthGuard('jwt')` + `HasPermissionGuard`

**Response interface**: `PortfolioReportResponse`:

- `xRay.categories[]`: each has `key`, `name`, `rules[]`
- `xRay.statistics`: `rulesActiveCount`, `rulesFulfilledCount`
- Each `PortfolioReportRule` (from `libs/common/src/lib/interfaces/portfolio-report-rule.interface.ts`): `key`, `name`, `isActive`, `value` (pass/fail), `evaluation` (text explanation)

**Files to create**:

- `apps/agent/server/tools/risk-assessment.ts`

**Input schema (Zod)**:

```typescript
z.object({}); // No input params needed
```

**Acceptance criteria**:

- Tool calls `GET /api/v1/portfolio/report`
- Returns categories with pass/fail status for each rule
- Returns statistics (rules fulfilled / rules active)
- Formats rule evaluations into readable text

---

### E3.S5 — Unit tests for 3 MVP tools `[MVP]`

**Complexity**: M

**Description**: Write unit tests for all 3 tools using mocked GhostfolioClient responses. Each tool needs tests for: successful response, empty data, error responses.

**Files to create**:

- `apps/agent/test/tools/portfolio-analysis.test.ts`
- `apps/agent/test/tools/performance-report.test.ts`
- `apps/agent/test/tools/risk-assessment.test.ts`
- `apps/agent/test/fixtures/portfolio-details.json`
- `apps/agent/test/fixtures/portfolio-performance.json`
- `apps/agent/test/fixtures/portfolio-report.json`

**Acceptance criteria**:

- 5+ tests per tool (15+ total)
- All pass via `bun test`
- Fixtures use realistic data that matches Ghostfolio's actual response shapes

**Parallelization**: E3.S1 first, then E3.S2, E3.S3, E3.S4 can all be built in parallel. E3.S5 follows all tools.

---

## Epic 4: LangGraph Agent Setup

**Goal**: Wire the LangGraph agent with ChatOpenAI, system prompt, tool binding, and conversation memory.

**Dependencies**: E3 (at least the 3 MVP tools)

### E4.S1 — Define the system prompt `[MVP]`

**Complexity**: M

**Description**: Write the system prompt that defines the agent's persona, capabilities, constraints, and output format.

**Key constraints to encode** (from pre-search verification design):

- Agent is a read-only portfolio analyst
- Never suggest specific buy/sell actions
- Never predict future returns with specific numbers
- Always note that analysis is not financial advice
- Only reference data from the user's actual portfolio
- Use the user's base currency for all monetary values

**Reference**: The existing AI prompt in `apps/api/src/app/endpoints/ai/ai.service.ts` lines 155-167 shows Ghostfolio's current prompt style:

```
"You are a neutral financial assistant. Please analyze the following investment portfolio..."
```

**Files to create**:

- `apps/agent/server/system-prompt.ts`

**Acceptance criteria**:

- Exported as a template string function that accepts `{ baseCurrency: string, language?: string }`
- Includes all domain constraints
- Includes tool usage instructions
- Includes output format guidance (structured sections, data-grounded claims)

---

### E4.S2 — Create the LangGraph agent with tool binding `[MVP]`

**Complexity**: L

**Description**: Build the core agent module that creates a `ChatOpenAI` instance, binds the tools, and handles the agent execution via a LangGraph StateGraph.

**Architecture**:

- `ChatOpenAI` with model `gpt-4o`, temperature 0.1, max tokens 2048
- Bind all available tools via `.bindTools()`
- Use LangGraph `StateGraph` with chatModel → tools cycle (replaces `AgentExecutor`)
- Accept user JWT and pass it through to tool constructors
- LangSmith callback handler for tracing (env-variable-gated)

**Files to create**:

- `apps/agent/server/agent.ts`

**Acceptance criteria**:

- `createAgent(jwt: string)` returns an executable agent
- Agent can receive a natural language query and invoke the correct tool
- Agent synthesizes tool results into a coherent response
- OpenAI API key read from `OPENAI_API_KEY` env var
- Temperature, model, max tokens are configurable via env vars

---

### E4.S3 — Add conversation memory (per-session) `[MVP]`

**Complexity**: M

**Description**: Implement conversation memory so multi-turn conversations work. Use a custom `SessionMemoryManager` (sliding window + TTL), keyed by a session identifier derived from the JWT.

**Key decision**: Memory is in-process (Map keyed by session ID). Acceptable for demo scale (~100 users). Memory should be bounded (max 20 messages per session) and have a TTL (30 minutes).

**Files to modify**:

- `apps/agent/server/agent.ts` (add memory to agent execution)

**Files to create**:

- `apps/agent/server/memory.ts` (session memory manager)

**Acceptance criteria**:

- Second message in a conversation can reference context from the first
- Memory is isolated per user (different JWTs get different memory)
- Memory has a max length (20 messages) and TTL (30 min)
- Session cleanup on TTL expiry (no memory leaks)

**Parallelization**: E4.S1 can be done independently. E4.S2 depends on E4.S1 and E3. E4.S3 depends on E4.S2.

---

## Epic 5: Elysia HTTP Server

**Goal**: Create the Elysia server that exposes the chat API, serves the widget, and handles CORS/auth.

**Dependencies**: E4 (agent setup)

### E5.S1 — Create Elysia server entry point with health check `[MVP]`

**Complexity**: M

**Description**: Set up the Elysia HTTP server on port 3334. Include a `GET /health` endpoint that verifies the agent can reach the Ghostfolio API.

**Files to create**:

- `apps/agent/server/index.ts`

**Acceptance criteria**:

- `bun run apps/agent/server/index.ts` starts server on port 3334
- `GET /health` returns `{ status: 'ok', ghostfolioReachable: true/false }`
- CORS configured to accept requests from Ghostfolio's origin (configurable via `CORS_ORIGIN` env var)
- Graceful shutdown on SIGTERM

---

### E5.S2 — Implement POST /api/chat endpoint `[MVP]`

**Complexity**: M

**Description**: The primary endpoint for the chat widget. Accepts a message, extracts the JWT from the Authorization header, runs the agent, and returns the response.

**Request format**:

```json
{
  "message": "How is my portfolio allocated?",
  "sessionId": "optional-session-id"
}
```

**Response format**:

```json
{
  "response": "Your portfolio is allocated as follows...",
  "toolCalls": [{ "name": "portfolio_analysis", "success": true }],
  "confidence": 0.92,
  "sessionId": "abc123"
}
```

**Files to modify**:

- `apps/agent/server/index.ts` (add route)

**Acceptance criteria**:

- Extracts JWT from `Authorization: Bearer <token>` header
- Returns 401 if no JWT provided
- Returns structured response with agent output and metadata
- Handles agent errors gracefully (returns 500 with message, not stack trace)
- Request body validated with Elysia's built-in validation (or Zod)

---

### E5.S3 — Implement GET /api/history endpoint

**Complexity**: S

**Description**: Returns conversation history for a session. Used by the widget to restore context when re-opened.

**Files to modify**:

- `apps/agent/server/index.ts` (add route)

**Acceptance criteria**:

- Returns message history for the authenticated user's session
- Returns empty array if no history exists
- Requires valid JWT

---

### E5.S4 — Implement GET /widget.js static file serving `[MVP]`

**Complexity**: S

**Description**: Serve the built React widget bundle as a static file. The `<script>` tag in Ghostfolio's `index.html` will load this.

**Files to modify**:

- `apps/agent/server/index.ts` (add static file route)

**Acceptance criteria**:

- `GET /widget.js` returns the bundled widget JavaScript
- Content-Type is `application/javascript`
- Correct CORS headers for cross-origin script loading

---

### E5.S5 — Add rate limiting middleware

**Complexity**: S

**Description**: Implement per-user rate limiting (20 requests/minute) as Elysia middleware.

**Files to create**:

- `apps/agent/server/middleware/rate-limiter.ts`

**Files to modify**:

- `apps/agent/server/index.ts` (apply middleware)

**Acceptance criteria**:

- Users are rate-limited to 20 requests/minute
- Returns 429 Too Many Requests when exceeded
- Rate limits are per-user (keyed by JWT subject, not by IP)

**Parallelization**: E5.S1 first. E5.S2, E5.S3, E5.S4, E5.S5 can all be parallel after E5.S1.

---

## Epic 6: React Chat Widget

**Goal**: Build a floating chat button + sliding panel that mounts into Ghostfolio's Angular UI and communicates with the agent backend.

**Dependencies**: E5 (server routes must be defined, but widget and server can be co-developed)

### E6.S1 — Create React widget entry point and DOM mounting `[MVP]`

**Complexity**: M

**Description**: Create the widget entry point that reads the JWT from browser storage, creates a mount point div, and renders the React app. The widget must be self-contained — a single `<script>` tag should make everything work.

**Key insight**: Ghostfolio stores the JWT at key `'auth-token'` in `sessionStorage` (primary) and `localStorage` (if "stay signed in" is checked). See `apps/client/src/app/services/settings-storage.service.ts` line 5 and `apps/client/src/app/services/token-storage.service.ts` lines 17-21.

**Files to create**:

- `apps/agent/widget/index.tsx` (entry point: reads JWT, mounts React)

**Acceptance criteria**:

- Script creates a `<div id="ghostfolio-agent-widget">` at the end of `<body>`
- Reads JWT from `sessionStorage.getItem('auth-token') || localStorage.getItem('auth-token')`
- Only renders the widget if a JWT is found (no widget for logged-out users)
- Widget is unmounted cleanly if the script is removed

---

### E6.S2 — Build ChatWidget component with floating button `[MVP]`

**Complexity**: L

**Description**: The main UI component. A floating action button (bottom-right corner) that opens a sliding chat panel.

**Files to create**:

- `apps/agent/widget/ChatWidget.tsx`
- `apps/agent/widget/styles.ts` (CSS-in-JS / inline styles to avoid conflicts with Ghostfolio's Angular CSS)

**UI requirements**:

- Floating button: fixed position, bottom-right, z-index high enough to overlay Ghostfolio
- Chat panel: slides up from button, ~400px wide x ~600px tall
- Message bubbles: user messages right-aligned, agent messages left-aligned
- Loading indicator while waiting for response
- Markdown rendering for agent responses (basic: bold, lists, tables)
- Auto-scroll to latest message
- Close button to collapse panel

**Acceptance criteria**:

- Widget renders without conflicting with Ghostfolio's Angular styles
- Chat panel opens/closes smoothly
- Messages display correctly with basic formatting
- Loading state shown during API call
- Works on both desktop and mobile viewports

---

### E6.S3 — Implement API communication in widget `[MVP]`

**Complexity**: M

**Description**: Wire the widget to call `POST /api/chat` on the agent server, passing the JWT and user message.

**Files to create**:

- `apps/agent/widget/api-client.ts`

**Files to modify**:

- `apps/agent/widget/ChatWidget.tsx` (integrate API calls)

**Acceptance criteria**:

- Messages sent to `POST {AGENT_URL}/api/chat` with `Authorization: Bearer <jwt>`
- Agent URL configurable via `data-agent-url` attribute on the `<script>` tag, defaulting to `window.location.origin.replace(':3333', ':3334')` or similar heuristic
- Responses displayed in chat
- Error states shown in UI (network error, 401, 429, 500)
- Session ID maintained across messages

---

### E6.S4 — Bundle widget with Bun `[MVP]`

**Complexity**: M

**Description**: Configure Bun's bundler to compile the React widget into a single `dist/widget.js` file that can be loaded via `<script>` tag.

**Files to create**:

- `apps/agent/build-widget.ts` (Bun build script)

**Build configuration**:

- Entry: `apps/agent/widget/index.tsx`
- Output: `apps/agent/dist/widget.js`
- Format: IIFE (immediately invoked, no module system required)
- External: none (bundle React and ReactDOM into the file)
- Minify: true for production
- Target: browser

**Acceptance criteria**:

- `bun run build-widget.ts` produces `dist/widget.js`
- File is self-contained (no external dependencies needed at runtime)
- File size < 200KB gzipped
- Can be loaded via `<script src="...">` in any HTML page

---

### E6.S5 — Create dev.html for standalone widget testing

**Complexity**: S

**Description**: An HTML file for developing/testing the widget in isolation, without running the full Ghostfolio app.

**Files to create**:

- `apps/agent/widget/dev.html`

**Acceptance criteria**:

- Opening in a browser shows the chat widget
- Can interact with the widget (assuming agent server is running)
- Sets a mock JWT in sessionStorage for testing

---

### E6.S6 — Add script tag to Ghostfolio's index.html `[MVP]`

**Complexity**: S

**Description**: Add the `<script>` tag that loads the widget into Ghostfolio's Angular UI.

**File to modify**: `apps/client/src/index.html`

**Current state** (lines 52-53):

```html
<body>
  <gf-root></gf-root>
</body>
```

**Target state**:

```html
<body>
  <gf-root></gf-root>
  <script
    data-agent-url="${agentUrl}"
    defer
    src="${agentUrl}/widget.js"
  ></script>
</body>
```

The `${agentUrl}` will be resolved at build time or configured via environment. For development: `http://localhost:3334`.

**Acceptance criteria**:

- Widget loads when Ghostfolio app is accessed
- Widget does not render if the script fails to load (no broken UI)
- Widget does not render if user is not logged in (no JWT)

**Parallelization**: E6.S1 first. E6.S2 and E6.S3 can be parallel. E6.S4 after S2+S3. E6.S5 and E6.S6 can be parallel after E6.S4.

---

## Epic 7: Remaining Tools (4 Additional Tools)

**Goal**: Complete the full 7-tool suite by adding holdings_search, market_data_lookup, dividend_analysis, and investment_history.

**Dependencies**: E2 (GhostfolioClient), E3.S1 (tool factory). Can be started in parallel with E4-E6.

### E7.S1 — Implement holdings_search tool

**Complexity**: M

**Description**: Wrap `GET /api/v1/portfolio/holdings`. Returns filtered portfolio holdings.

**Ghostfolio endpoint**: `apps/api/src/app/portfolio/portfolio.controller.ts` lines 397-431

- Query params: `accounts`, `assetClasses`, `dataSource`, `holdingType`, `query` (search text), `range`, `symbol`, `tags`
- Response: `PortfolioHoldingsResponse` = `{ holdings: PortfolioPosition[] }`

**Files to create**:

- `apps/agent/server/tools/holdings-search.ts`
- `apps/agent/test/tools/holdings-search.test.ts`
- `apps/agent/test/fixtures/portfolio-holdings.json`

**Input schema (Zod)**:

```typescript
z.object({
  query: z
    .string()
    .optional()
    .describe('Search query for holdings by name or symbol'),
  assetClasses: z
    .string()
    .optional()
    .describe('Filter by asset class (e.g., EQUITY, FIXED_INCOME)'),
  holdingType: z.string().optional().describe('Filter by holding type'),
  range: z.enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd']).default('max'),
  tags: z.string().optional()
});
```

**Acceptance criteria**:

- Returns array of holdings matching filters
- Search by text query filters by symbol or name
- Empty results return helpful message

---

### E7.S2 — Implement market_data_lookup tool

**Complexity**: M

**Description**: Wrap `GET /api/v1/market-data/:dataSource/:symbol`. Returns asset profile and market data for a specific symbol.

**Ghostfolio endpoint**: `apps/api/src/app/endpoints/market-data/market-data.controller.ts` lines 90-131

- URL params: `dataSource`, `symbol`
- Response: `MarketDataDetailsResponse` = `{ assetProfile: Partial<EnhancedSymbolProfile>, marketData: MarketData[] }`

**Files to create**:

- `apps/agent/server/tools/market-data-lookup.ts`
- `apps/agent/test/tools/market-data-lookup.test.ts`
- `apps/agent/test/fixtures/market-data-details.json`

**Input schema (Zod)**:

```typescript
z.object({
  dataSource: z.string().describe('Data source (e.g., YAHOO)'),
  symbol: z.string().describe('Ticker symbol (e.g., AAPL)')
});
```

**Acceptance criteria**:

- Returns asset profile (name, currency, asset class, sectors)
- Returns recent market data prices
- "Symbol not found" handled gracefully (404 from Ghostfolio)

---

### E7.S3 — Implement dividend_analysis tool

**Complexity**: M

**Description**: Wrap `GET /api/v1/portfolio/dividends`. Returns dividend history and analysis.

**Ghostfolio endpoint**: `apps/api/src/app/portfolio/portfolio.controller.ts` lines 299-368

- Query params: `accounts`, `assetClasses`, `dataSource`, `groupBy` (`'month'` | `'year'`), `range`, `symbol`, `tags`
- Response: `PortfolioDividendsResponse` = `{ dividends: InvestmentItem[] }`
- `InvestmentItem` = `{ date: string, investment: number }`

**Files to create**:

- `apps/agent/server/tools/dividend-analysis.ts`
- `apps/agent/test/tools/dividend-analysis.test.ts`
- `apps/agent/test/fixtures/portfolio-dividends.json`

**Input schema (Zod)**:

```typescript
z.object({
  range: z.enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd']).default('max'),
  groupBy: z
    .enum(['month', 'year'])
    .optional()
    .describe('Group dividends by month or year'),
  accounts: z.string().optional(),
  assetClasses: z.string().optional(),
  tags: z.string().optional()
});
```

**Acceptance criteria**:

- Returns dividend history grouped by period
- Calculates total dividends over the range
- "No dividends" handled gracefully

---

### E7.S4 — Implement investment_history tool

**Complexity**: M

**Description**: Wrap `GET /api/v1/portfolio/investments`. Returns investment amounts over time and consistency streaks.

**Ghostfolio endpoint**: `apps/api/src/app/portfolio/portfolio.controller.ts` lines 433-501

- Query params: `accounts`, `assetClasses`, `dataSource`, `groupBy` (`'month'` | `'year'`), `range`, `symbol`, `tags`
- Response: `PortfolioInvestmentsResponse` = `{ investments: InvestmentItem[], streaks: { currentStreak: number, longestStreak: number } }`

**Files to create**:

- `apps/agent/server/tools/investment-history.ts`
- `apps/agent/test/tools/investment-history.test.ts`
- `apps/agent/test/fixtures/portfolio-investments.json`

**Input schema (Zod)**:

```typescript
z.object({
  range: z.enum(['1d', '1y', '5y', 'max', 'mtd', 'wtd', 'ytd']).default('max'),
  groupBy: z
    .enum(['month', 'year'])
    .optional()
    .describe('Group investments by month or year'),
  accounts: z.string().optional(),
  assetClasses: z.string().optional(),
  tags: z.string().optional()
});
```

**Acceptance criteria**:

- Returns investment history over time
- Returns streak info (current + longest consecutive investment periods)
- Summarizes total invested over the range

**Parallelization**: All 4 tools (E7.S1-S4) can be built in parallel once E2 and E3.S1 are done.

---

## Epic 8: Verification Checks

**Goal**: Implement the 4 verification checks that ensure agent response quality and safety.

**Dependencies**: E4 (agent setup — verification wraps agent output)

### E8.S1 — Implement Output Validation (Zod schemas for tool outputs)

**Complexity**: M

**Description**: Add Zod output schemas to each tool that validate the Ghostfolio API response before passing it to the LLM. Catches malformed data, missing fields, type mismatches.

**Files to create**:

- `apps/agent/server/verification/output-validator.ts`

**Files to modify**:

- Each tool file in `apps/agent/server/tools/` (add output validation)

**Acceptance criteria**:

- Each tool's response is validated against a Zod schema before being returned
- Validation failures are logged and result in a graceful error (not a crash)
- Partial data is accepted with warnings (e.g., some fields null but core data present)

---

### E8.S2 — Implement Confidence Scoring

**Complexity**: M

**Description**: Post-processing step that scores agent responses 0-1 based on: number of tool calls that succeeded, data completeness, query clarity.

**Files to create**:

- `apps/agent/server/verification/confidence-scorer.ts`

**Scoring algorithm**:

- Base score: 0.5
- +0.2 if all tool calls succeeded
- -0.2 per failed tool call
- +0.1 if response references specific data points
- +0.1 if query was unambiguous
- -0.1 if response includes hedging language ("I'm not sure...")
- Clamp to [0, 1]

**Acceptance criteria**:

- Returns a score between 0 and 1
- Responses with confidence < 0.6 include a warning message
- Score is included in the API response

---

### E8.S3 — Implement Domain Constraints checker

**Complexity**: M

**Description**: Post-processing filter that enforces financial domain rules on agent output. Checks for forbidden patterns and required patterns.

**Files to create**:

- `apps/agent/server/verification/domain-constraints.ts`

**Rules to enforce**:

1. Response must not contain phrases like "buy", "sell", "you should invest in", "I recommend purchasing"
2. Response must not predict specific future returns ("will return 15%")
3. If response discusses portfolio composition, it must match actual holdings
4. Response should include a disclaimer (appended if missing)

**Acceptance criteria**:

- Catches buy/sell recommendations and replaces with disclaimer
- Catches specific return predictions
- Appends standard disclaimer if not present
- Returns a list of triggered constraints for logging

---

### E8.S4 — Implement Hallucination Detection

**Complexity**: L

**Description**: Cross-references claims in the agent's response against actual API data. Extracts mentioned symbols, percentages, and values from the response text, then verifies them against the tool call results.

**Files to create**:

- `apps/agent/server/verification/hallucination-detector.ts`

**Detection strategy**:

1. Extract symbols mentioned in agent text (regex: uppercase 1-5 letter words)
2. Verify each symbol exists in the tool results
3. Extract percentages and dollar amounts
4. Cross-reference with actual values (tolerance: 1% for percentages, 1% for amounts)
5. Flag discrepancies

**Acceptance criteria**:

- Detects when agent mentions a symbol not in the user's portfolio
- Detects when agent states wrong allocation percentages (>1% deviation)
- Returns list of detected issues
- Issues are logged but do not block the response (warning, not error)

---

### E8.S5 — Integrate verification pipeline into agent flow

**Complexity**: M

**Description**: Wire all 4 verification checks into the agent execution pipeline. After the agent generates a response, run: output validation → domain constraints → hallucination detection → confidence scoring.

**Files to modify**:

- `apps/agent/server/agent.ts` (add verification as post-processing step)

**Files to create**:

- `apps/agent/server/verification/pipeline.ts` (orchestrates all checks)

**Acceptance criteria**:

- All 4 checks run on every agent response
- Verification results included in API response metadata
- Failed output validation causes tool retry (once)
- Domain constraint violations are auto-corrected
- Hallucination warnings are added to the response
- Confidence score is always present

---

### E8.S6 — Unit tests for verification checks

**Complexity**: M

**Files to create**:

- `apps/agent/test/verification/output-validator.test.ts`
- `apps/agent/test/verification/confidence-scorer.test.ts`
- `apps/agent/test/verification/domain-constraints.test.ts`
- `apps/agent/test/verification/hallucination-detector.test.ts`

**Acceptance criteria**:

- 5+ tests per check (20+ total)
- Tests cover: passing cases, failing cases, edge cases
- Domain constraints tests include adversarial prompts

**Parallelization**: E8.S1, E8.S2, E8.S3, E8.S4 can all be built in parallel. E8.S5 depends on all four. E8.S6 can be parallel with E8.S5.

---

## Epic 9: Testing & Evaluations

**Goal**: Build the evaluation framework with 50+ test cases across 4 synthetic portfolios. Run baseline evals.

**Dependencies**: E4 (agent) + E7 (all tools) + E8 (verification)

### E9.S1 — Create synthetic portfolio fixtures (4 portfolios)

**Complexity**: L

**Description**: Create realistic mocked API response fixtures for 4 distinct portfolio archetypes. Each fixture set must include responses for all 7 API endpoints.

**Portfolios** (from pre-search):

1. **Conservative Retiree**: 60% fixed income, 30% equity, 10% cash
2. **Aggressive Growth**: 80% equity (tech-heavy), 15% crypto, 5% alternatives
3. **Dividend Income**: REITs, dividend aristocrats, utilities, US-heavy
4. **Crypto-Heavy**: 60% crypto, 40% equity, high volatility

**Files to create**:

- `apps/agent/test/fixtures/conservative-portfolio.json`
- `apps/agent/test/fixtures/aggressive-portfolio.json`
- `apps/agent/test/fixtures/dividend-portfolio.json`
- `apps/agent/test/fixtures/crypto-portfolio.json`

Each file contains mock responses for: `portfolio/details`, `portfolio/performance`, `portfolio/report`, `portfolio/holdings`, `portfolio/dividends`, `portfolio/investments`, and a `market-data` lookup example.

**Acceptance criteria**:

- Each fixture matches the exact response interfaces from `@ghostfolio/common/interfaces`
- Portfolios have distinct risk profiles and compositions
- Data is internally consistent (allocations sum to ~100%, performance matches holdings)

---

### E9.S2 — Create eval test case dataset (50+ cases)

**Complexity**: L

**Description**: Write the evaluation dataset as JSON files organized by category.

**Files to create**:

- `apps/agent/test/eval/happy-path.json` (20+ cases)
- `apps/agent/test/eval/edge-cases.json` (10+ cases)
- `apps/agent/test/eval/adversarial.json` (10+ cases)
- `apps/agent/test/eval/multi-step.json` (10+ cases)

**Test case format**:

```json
{
  "id": "hp-001",
  "category": "happy-path",
  "portfolio": "conservative",
  "query": "What is my portfolio allocation?",
  "expectedTools": ["portfolio_analysis"],
  "expectedOutputContains": ["fixed income", "equity", "allocation"],
  "expectedOutputNotContains": ["buy", "sell", "recommend"],
  "minConfidence": 0.7
}
```

**Acceptance criteria**:

- 50+ test cases total
- Every tool is covered by at least 3 test cases
- Adversarial cases include: prompt injection, out-of-scope requests, buy/sell requests
- Multi-step cases require 2+ tool calls

---

### E9.S3 — Build eval runner

**Complexity**: M

**Description**: Create a script that runs the eval dataset against the agent (with mocked Ghostfolio API) and generates a pass/fail report.

**Files to create**:

- `apps/agent/test/eval/run-evals.ts`

**Acceptance criteria**:

- Runs all 50+ test cases against the agent
- Scores each case (tool selection correct, output contains expected, confidence threshold met)
- Generates summary: total pass rate, per-category pass rate, failures list
- Can be run via `bun run test/eval/run-evals.ts`
- Results outputtable in a format compatible with LangSmith datasets

---

### E9.S4 — Run baseline eval and document results

**Complexity**: M

**Description**: Execute the eval suite, record the baseline pass rates, and document areas for improvement.

**Files to create**:

- `apps/agent/test/eval/baseline-results.json`

**Acceptance criteria**:

- Baseline eval completed with all 50+ cases
- Pass rate targets documented: >90% correctness, >95% tool selection, 100% safety
- Failure analysis documented for any failing cases

**Parallelization**: E9.S1 first. E9.S2 can be parallel with E9.S1. E9.S3 after S1+S2. E9.S4 after E9.S3.

---

## Epic 10: Observability (LangSmith Integration)

**Goal**: Integrate LangSmith for tracing, metrics, and feedback collection.

**Dependencies**: E4 (agent setup)

### E10.S1 — Configure LangSmith callback handler ✅

**Complexity**: S

**Description**: Enable automatic LangSmith tracing by setting environment variables and adding the callback handler to the agent.

**Files to modify**:

- `apps/agent/server/agent.ts` (add LangSmith callback)

**Environment variables**:

```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=<key>
LANGCHAIN_PROJECT=ghostfolio-ai-agent
```

**Acceptance criteria**:

- Every agent invocation creates a trace in LangSmith
- Traces include: input query, LLM reasoning, tool calls, tool results, final output
- Tracing is disabled gracefully if env vars are not set
- No PII (names, emails) in traces — only portfolio data summaries

---

### E10.S2 — Add custom metadata to traces ✅

**Complexity**: S

**Description**: Tag LangSmith traces with custom metadata: user session ID, tools used, confidence score, verification results, latency breakdown.

**Files to modify**:

- `apps/agent/server/agent.ts`

**Acceptance criteria**:

- Each trace tagged with: `sessionId`, `toolsUsed[]`, `confidence`, `latencyMs`
- Can filter traces in LangSmith dashboard by these tags

---

### E10.S3 — Implement user feedback endpoint ✅

**Complexity**: M

**Description**: Add `POST /api/feedback` endpoint that accepts thumbs up/down and sends it to LangSmith's Feedback API, associated with the specific run trace.

**Files to modify**:

- `apps/agent/server/index.ts` (add route)

**Files to create**:

- `apps/agent/server/feedback.ts` (LangSmith feedback integration)

**Widget changes**:

- `apps/agent/widget/ChatWidget.tsx` (add thumbs up/down buttons per message)

**Acceptance criteria**:

- Thumbs up/down buttons visible on each agent response in the widget
- Clicking sends feedback to agent backend
- Backend associates feedback with the LangSmith run trace
- Optional free-text feedback field

**Parallelization**: E10.S1 and E10.S2 can be parallel. E10.S3 depends on E10.S1.

---

## Epic 11: Docker & Deployment

**Goal**: Containerize the agent service and configure deployment to Railway.

**Dependencies**: E5 (server), E6 (widget build)

### E11.S1 — Create Dockerfile for agent service `[MVP]`

**Complexity**: M

**Description**: Multi-stage Dockerfile using `oven/bun:1-alpine` as base. Build the widget, then run the server.

**Files to create**:

- `apps/agent/Dockerfile`

**Dockerfile stages**:

1. Builder: install deps, build widget (`bun run build-widget.ts`)
2. Runtime: copy server code + built widget, expose port 3334, run `bun run server/index.ts`

**Acceptance criteria**:

- `docker build -t ghostfolio-agent apps/agent/` succeeds
- `docker run -p 3334:3334 ghostfolio-agent` starts the server
- Container size < 200MB
- Health check works (`GET /health`)

---

### E11.S2 — Add agent service to docker-compose.yml `[MVP]`

**Complexity**: S

**Description**: Add the agent service to the existing Docker Compose configuration.

**Files to modify**:

- `docker/docker-compose.yml`

**Service definition**:

```yaml
agent:
  build:
    context: ../apps/agent
    dockerfile: Dockerfile
  container_name: gf-agent
  restart: unless-stopped
  init: true
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true
  ports:
    - 3334:3334
  environment:
    - GHOSTFOLIO_API_URL=http://ghostfolio:3333
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - LANGCHAIN_TRACING_V2=${LANGCHAIN_TRACING_V2:-false}
    - LANGCHAIN_API_KEY=${LANGCHAIN_API_KEY:-}
    - LANGCHAIN_PROJECT=${LANGCHAIN_PROJECT:-ghostfolio-ai-agent}
    - CORS_ORIGIN=http://localhost:3333
  depends_on:
    ghostfolio:
      condition: service_healthy
  healthcheck:
    test: ['CMD-SHELL', 'curl -f http://localhost:3334/health']
    interval: 10s
    timeout: 5s
    retries: 5
```

**Acceptance criteria**:

- `docker compose -f docker/docker-compose.yml up` starts all 4 services
- Agent service waits for Ghostfolio to be healthy before starting
- Agent can reach Ghostfolio at `http://ghostfolio:3333`

---

### E11.S3 — Add agent env vars to .env.example

**Complexity**: S

**Description**: Document the new environment variables needed for the agent service.

**Files to modify**:

- `.env.example` (add agent-specific vars)

**Variables to add**:

```
# AI Agent
OPENAI_API_KEY=<INSERT_OPENAI_API_KEY>
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=<INSERT_LANGSMITH_API_KEY>
LANGCHAIN_PROJECT=ghostfolio-ai-agent
```

**Acceptance criteria**:

- All agent env vars documented in `.env.example`
- Comments explain what each variable does

---

### E11.S4 — Configure Railway deployment

**Complexity**: M

**Description**: Deploy to Railway as 4 separate services. Railway does **not** use docker-compose — each service runs independently. PostgreSQL and Redis are managed plugins (no Dockerfile needed).

**Railway architecture**:

| Service        | Type           | How to create                                                                                             |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | Managed plugin | One-click in Railway dashboard. Auto-injects `DATABASE_URL` into linked services. No Dockerfile.          |
| **Redis**      | Managed plugin | One-click in Railway dashboard. Auto-injects `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`. No Dockerfile. |
| **Ghostfolio** | Custom service | Deploy from repo. Dockerfile path: `Dockerfile` (root). Root directory: `/`.                              |
| **Agent**      | Custom service | Deploy from repo. Dockerfile path: `Dockerfile`. Root directory: `apps/agent`.                            |

**Setup steps in Railway**:

1. Create a new Railway project
2. Add PostgreSQL plugin (one click) — provides `DATABASE_URL`
3. Add Redis plugin (one click) — provides `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
4. Add Ghostfolio service → point to repo, root dir `/`, Dockerfile path `Dockerfile`
5. Link PostgreSQL + Redis plugins to Ghostfolio service (auto-injects env vars)
6. Set remaining Ghostfolio env vars: `ACCESS_TOKEN_SALT`, `JWT_SECRET_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, etc.
7. Add Agent service → point to same repo, root dir `apps/agent`, Dockerfile path `Dockerfile`
8. Set Agent env vars: `GHOSTFOLIO_API_URL`, `OPENAI_API_KEY`, `LANGCHAIN_*`, `CORS_ORIGIN`

**Internal networking**: Railway gives each service a private URL. The agent connects to Ghostfolio via:

```
GHOSTFOLIO_API_URL=http://ghostfolio.railway.internal:3333
```

Not `http://ghostfolio:3333` (that's docker-compose only).

**Key difference from docker-compose**:

- No docker-compose file used on Railway — it's local dev only
- No changes needed to the existing Ghostfolio `Dockerfile` — it works as-is
- Managed plugins handle PostgreSQL/Redis (backups, scaling, credentials)
- Env vars set per-service in Railway dashboard, not `.env` files

**Files to create**:

- `apps/agent/railway.toml` (optional — Railway can auto-detect from Dockerfile, but explicit config is clearer)

**Example `railway.toml`**:

```toml
[build]
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

**Acceptance criteria**:

- Agent deploys to Railway as a separate service
- Agent connects to Ghostfolio via Railway internal networking (`*.railway.internal`)
- Health check configured at `/health`
- Environment variables set via Railway dashboard
- Agent service: 256MB RAM limit
- PostgreSQL and Redis are managed plugins (not custom containers)
- Ghostfolio's existing `Dockerfile` is unchanged

---

### E11.S5 — Add agent build/test to CI/CD pipeline

**Complexity**: M

**Description**: Extend the GitHub Actions workflow to also lint, test, and build the agent.

**File to modify**: `.github/workflows/build-code.yml`

**New steps** (added after existing steps):

```yaml
- name: Install Bun
  uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest

- name: Install agent dependencies
  working-directory: apps/agent
  run: bun install

- name: Run agent tests
  working-directory: apps/agent
  run: bun test

- name: Build agent widget
  working-directory: apps/agent
  run: bun run build-widget.ts
```

**Acceptance criteria**:

- CI runs agent tests on every PR
- CI builds the widget on every PR
- Agent test failures block the PR
- CI does not break existing Ghostfolio tests

**Parallelization**: E11.S1 and E11.S2 are sequential (S1 first). E11.S3 can be parallel. E11.S4 after E11.S1. E11.S5 can be parallel with all.

---

## Epic 12: Documentation

**Goal**: Comprehensive documentation for setup, architecture, tool reference, and open source usage.

**Dependencies**: All other epics (documentation reflects final state)

### E12.S1 — Agent README

**Complexity**: M

**Description**: Create README for the agent project covering: what it does, architecture overview, prerequisites (Bun, OpenAI API key), setup instructions, development workflow, deployment guide.

**Files to create**:

- `apps/agent/README.md`

**Acceptance criteria**:

- New contributor can set up and run the agent from scratch following the README
- Includes: prerequisites, install steps, env var setup, dev commands, production deployment
- Architecture diagram (ASCII or Mermaid)

---

### E12.S2 — Tool reference documentation ✅

**Complexity**: M

**Description**: Document each of the 7 tools: name, description, Ghostfolio endpoint, input schema, output format, example queries.

**Files to create**:

- `docs/agent-tools.md`

**Acceptance criteria**:

- Each tool has: name, purpose, endpoint, input params, output fields, 2+ example queries
- Includes which Ghostfolio interface types are used

---

### E12.S3 — Architecture decision document ✅

**Complexity**: M

**Description**: Formalize the architecture decisions: why Bun, why Elysia, why standalone service (not NestJS module), why LangGraph, verification strategy.

**Files to create**:

- `docs/agent-architecture.md`

**Acceptance criteria**:

- Documents all major architecture decisions with rationale
- References the pre-search document
- Includes trade-offs considered

---

### E12.S4 — Eval results documentation ✅

**Complexity**: S

**Description**: Document the eval results: methodology, test case distribution, pass rates by category, known failures, improvement plan.

**Files to create**:

- `docs/agent-eval-results.md`

**Acceptance criteria**:

- Includes eval methodology and test case breakdown
- Shows pass rates by category
- Documents known failure patterns and planned improvements

**Parallelization**: All E12 stories can be worked on in parallel once their subject epics are complete.

---

## Critical Files Reference

These existing files are key references for implementation:

| File                                                               | Relevance                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `apps/api/src/app/portfolio/portfolio.controller.ts`               | All 6 portfolio REST endpoints — exact query params, guards, response types |
| `libs/common/src/lib/interfaces/portfolio-position.interface.ts`   | Core data model (30+ fields) every tool's output must match                 |
| `libs/common/src/lib/interfaces/responses/`                        | All response interfaces (PortfolioPerformanceResponse, etc.)                |
| `apps/client/src/app/services/token-storage.service.ts`            | JWT storage key (`'auth-token'`) widget must read                           |
| `apps/client/src/app/services/settings-storage.service.ts`         | `KEY_TOKEN = 'auth-token'` constant                                         |
| `apps/api/src/app/endpoints/ai/ai.service.ts`                      | Existing AI prompt patterns and portfolio data formatting                   |
| `apps/api/src/app/endpoints/market-data/market-data.controller.ts` | Market data endpoint for market_data_lookup tool                            |
| `docker/docker-compose.yml`                                        | Current Docker infrastructure (3 services) to extend                        |
| `.github/workflows/build-code.yml`                                 | CI/CD pipeline to extend with agent build/test                              |
| `.env.example`                                                     | Environment variable documentation to extend                                |
