# Ghostfolio AI Agent

AI-powered portfolio assistant that connects to the [Ghostfolio](https://ghostfol.io) API. Consists of two parts:

1. **Server** — Bun + Elysia HTTP server that runs LangGraph agents
2. **Widget** — React floating chat UI, bundled as a standalone `widget.js`

## Quick Start

```bash
git clone https://github.com/SebastianGarces/ghostfolio-agent.git
cd ghostfolio-agent
bun install
cp .env.example .env        # fill in OPENAI_API_KEY
bun run dev
```

> Requires a running [Ghostfolio](https://ghostfol.io) instance (default: `http://localhost:3333`).

## Prerequisites

- [Bun](https://bun.sh) v1.2+
- A running [Ghostfolio](https://ghostfol.io) instance
- OpenAI API key

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

| Variable               | Required | Default                 | Description                      |
| ---------------------- | -------- | ----------------------- | -------------------------------- |
| `OPENAI_API_KEY`       | Yes      | —                       | OpenAI API key for LangChain     |
| `AGENT_PORT`           | No       | `3334`                  | Port the agent server listens on |
| `CORS_ORIGIN`          | No       | `http://localhost:4200` | Allowed CORS origin              |
| `GHOSTFOLIO_API_URL`   | No       | `http://localhost:3333` | Ghostfolio API base URL          |
| `AGENT_CHECKPOINT_DB`  | No       | `./data/checkpoints.db` | SQLite checkpoint database path  |
| `LANGCHAIN_TRACING_V2` | No       | `false`                 | Enable LangSmith tracing         |
| `LANGCHAIN_API_KEY`    | No       | —                       | LangSmith API key                |
| `LANGCHAIN_PROJECT`    | No       | `ghostfolio-ai-agent`   | LangSmith project name           |

## Connecting to Ghostfolio

The integration has two sides:

### Agent → Ghostfolio

Set `GHOSTFOLIO_API_URL` in your `.env` to point at your Ghostfolio API (e.g. `http://localhost:3333` for local dev).

### Ghostfolio → Widget

Add the widget script to your Ghostfolio client (or any web app):

```html
<script src="https://your-agent-url/widget.js"></script>
```

To use a custom JWT storage key (default is `auth-token`):

```html
<script
  data-auth-key="my-jwt-key"
  src="https://your-agent-url/widget.js"
></script>
```

The widget reads the user's Ghostfolio JWT from `sessionStorage` (or `localStorage`) and forwards it to the agent server, which proxies it to the Ghostfolio API. No separate auth system is needed.

## Architecture

```
┌─────────────────────────┐      ┌──────────────────────────┐
│  Your App               │      │  Agent Server (:3334)    │
│                         │      │                          │
│                         │      │  GET  /health            │
│  Loads:                 │      │  POST /api/chat          │
│  <script src=           │─────▶│  POST /api/chat/stream   │
│   ":3334/widget.js">    │      │  GET  /api/history       │
│                         │      │  DELETE /api/sessions/*  │
│                         │      │  POST /api/feedback      │
│                         │      │  GET  /widget.js         │
│                         │      │                          │
│  Widget sends JWT ──────│─────▶│  Forwards JWT to ──────┐ │
│  via Authorization      │      │  Ghostfolio API        │ │
└─────────────────────────┘      └───────────┬────────────│─┘
                                             │            │
                                  Checkpoints│            │
                                             ▼            │
                                 ┌────────────────┐       │
                                 │ SQLite (.db)   │       │
                                 └────────────────┘       │
                                 ┌────────────────────────▼─┐
                                 │  Ghostfolio API (:3333)  │
                                 │  /api/v1/portfolio/*     │
                                 └──────────────────────────┘
```

### How the widget discovers the agent

The agent server prepends `var __GHOSTFOLIO_AGENT_ORIGIN__="<origin>";` when serving `widget.js`. The widget reads this global to know where to send API requests. No DOM attributes or environment detection needed.

### Auth flow

1. User logs into Ghostfolio — JWT stored in `sessionStorage` under `auth-token`
2. Widget reads JWT from storage
3. Widget sends `Authorization: Bearer <jwt>` to agent server
4. Agent server forwards the same JWT to Ghostfolio API endpoints
5. No separate API key — CORS + JWT is sufficient

## Development

### Start the agent

```bash
bun run dev          # builds widget + starts server with --watch
```

> Make sure your Ghostfolio instance is running at the URL configured in `GHOSTFOLIO_API_URL`.

### Widget development (hot rebuild)

```bash
bun run dev:widget   # watches src/widget/ and rebuilds on change
```

### Standalone widget testing

Open `src/widget/dev.html` in a browser. Paste a Ghostfolio JWT and click "Load Widget" to test the chat without the full Ghostfolio app.

## Scripts

| Script              | Command                                                  | Description                                    |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `dev`               | `bun run build-widget.ts && bun run --watch src/main.ts` | Build widget + start server with hot reload    |
| `dev:widget`        | `bun run watch-widget.ts`                                | Watch and rebuild widget on file changes       |
| `build`             | `bun run build-widget.ts`                                | Production build of widget.js (IIFE, minified) |
| `test`              | `bun test`                                               | Run all tests (292 cases)                      |
| `eval`              | `dotenv -e .env -- bun run src/test/eval/run-evals.ts`   | Run evaluation suite against live agent        |
| `experiment`        | `dotenv -e .env -- bun run ...run-experiment.ts`         | Run model variant experiments                  |
| `experiment:compare`| `bun run ...compare-experiments.ts`                      | Compare experiment results                     |
| `ai:cost-analysis`  | `dotenv -e .env -- bun run scripts/ai-cost-analysis.ts`  | Generate AI cost report from LangSmith         |
| `trace-review`      | `dotenv -e .env -- bun run scripts/ai-trace-review.ts`   | Review a LangSmith trace                       |
| `start`             | `bun run src/main.ts`                                    | Start server (no watch, for production)        |

## Project Structure

```
├── src/
│   ├── main.ts                        # Elysia server entry point
│   ├── server/
│   │   ├── agent.ts                   # LangChain agent orchestration
│   │   ├── stream-agent.ts            # Streaming SSE response handler
│   │   ├── checkpointer.ts            # BunSqliteSaver — SQLite checkpoint persistence
│   │   ├── ghostfolio-client.ts       # Typed HTTP client for Ghostfolio API
│   │   ├── feedback.ts                # LangSmith feedback submission
│   │   ├── system-prompt.ts           # Agent system prompt
│   │   ├── graph/
│   │   │   ├── graph.ts               # LangGraph StateGraph builder
│   │   │   ├── state.ts               # AgentStateAnnotation definition
│   │   │   ├── nodes.ts               # Graph node functions
│   │   │   ├── planner.ts             # Query plan generation with Zod schemas
│   │   │   ├── execute-planned-tools.ts # Tool execution node
│   │   │   ├── synthesize.ts          # Response synthesis
│   │   │   ├── condense-artifacts.ts  # Artifact condensation
│   │   │   ├── content-blocks.ts      # Content block schema definitions
│   │   │   └── index.ts              # Graph exports
│   │   ├── tools/
│   │   │   ├── create-tool.ts         # Tool factory
│   │   │   ├── portfolio-analysis.ts  # Holdings & allocation
│   │   │   ├── performance-report.ts  # Returns & net worth
│   │   │   ├── dividend-analysis.ts   # Dividend income
│   │   │   ├── investment-history.ts  # Investment streaks
│   │   │   ├── holdings-search.ts     # Symbol search
│   │   │   ├── risk-assessment.ts     # Portfolio risks
│   │   │   ├── market-data.ts         # Current prices
│   │   │   └── index.ts              # Tool exports
│   │   └── verification/
│   │       ├── input-guard.ts         # Input validation & injection detection
│   │       ├── domain-constraints.ts  # Policy enforcement & leak checks
│   │       ├── fact-check.ts          # Output grounding against source data
│   │       ├── fact-check-schema.ts   # Fact-check Zod schemas
│   │       ├── hallucination-detection.ts # LLM hallucination scoring
│   │       ├── confidence-scoring.ts  # Response confidence scoring
│   │       ├── groundedness-scoring.ts # Groundedness analysis
│   │       ├── output-validation.ts   # Output rule enforcement
│   │       └── source-data-index.ts   # Data source tracking
│   ├── widget/
│   │   ├── index.tsx                  # Widget entry point (reads global, mounts React)
│   │   ├── ChatWidget.tsx             # Chat UI component with sidebar integration
│   │   ├── api-client.ts             # Widget API client
│   │   ├── session-store.ts           # localStorage-based session list manager
│   │   ├── styles.ts                  # Inline styles (no CSS dependencies)
│   │   ├── components/
│   │   │   ├── ChatSidebar.tsx        # Sidebar for session management
│   │   │   ├── WidgetCard.tsx         # Card wrapper component
│   │   │   ├── ChartTheme.ts         # Recharts theme constants
│   │   │   └── blocks/               # Content block renderers
│   │   │       ├── BlockRenderer.tsx  # Router for block types
│   │   │       ├── TextBlockView.tsx
│   │   │       ├── MetricBlockView.tsx
│   │   │       ├── MetricRowView.tsx
│   │   │       ├── ListBlockView.tsx
│   │   │       ├── SymbolBlockView.tsx
│   │   │       ├── HoldingsTableView.tsx
│   │   │       ├── AreaChartView.tsx
│   │   │       ├── BarChartView.tsx
│   │   │       ├── PieChartView.tsx
│   │   │       └── RuleStatusView.tsx
│   │   └── dev.html                   # Standalone test page
│   └── test/
│       ├── eval/                      # Evaluation suite (68 cases)
│       ├── fixtures/                  # 5 portfolio fixture sets
│       ├── graph/                     # Graph node unit tests
│       ├── tools/                     # Tool unit tests
│       └── verification/              # Verification unit tests
├── scripts/
│   ├── ai-cost-analysis.ts            # LangSmith cost report generator
│   └── ai-trace-review.ts            # LangSmith trace reviewer
├── docs/                              # Architecture & design docs
├── dist/
│   └── widget.js                      # Built widget (gitignored)
├── data/                              # SQLite checkpoint DB (gitignored)
├── build-widget.ts                    # Production widget build script
├── watch-widget.ts                    # Dev widget watcher
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
├── tsconfig.app.json
└── tsconfig.spec.json
```

## API Endpoints

| Method   | Path                          | Auth | Description                                    |
| -------- | ----------------------------- | ---- | ---------------------------------------------- |
| `GET`    | `/health`                     | None | Health check, includes Ghostfolio reachability |
| `POST`   | `/api/chat`                   | JWT  | Send a message, get agent response             |
| `POST`   | `/api/chat/stream`            | JWT  | Send a message, get streaming SSE response     |
| `GET`    | `/api/history?sessionId=<id>` | JWT  | Retrieve conversation history with tool data   |
| `DELETE` | `/api/sessions/:sessionId`    | JWT  | Delete a conversation session                  |
| `POST`   | `/api/feedback`               | JWT  | Submit thumbs up/down feedback to LangSmith    |
| `GET`    | `/widget.js`                  | None | Serve widget bundle (origin injected)          |

## Deployment

Build and run with Docker:

```bash
docker build -t ghostfolio-agent .
docker run -d \
  -p 3334:3334 \
  -e OPENAI_API_KEY=sk-... \
  -e GHOSTFOLIO_API_URL=http://your-ghostfolio:3333 \
  -e CORS_ORIGIN=https://your-ghostfolio-url.com \
  ghostfolio-agent
```

Set `CORS_ORIGIN` to the URL where your Ghostfolio client is hosted so the widget can communicate with the agent server.

For LangSmith observability in production, also pass:

```bash
  -e LANGCHAIN_TRACING_V2=true \
  -e LANGCHAIN_API_KEY=ls-... \
  -e LANGCHAIN_PROJECT=ghostfolio-ai-agent
```

## Standalone Widget Usage

The widget is designed to be embeddable in any app:

```html
<!-- Zero config — widget discovers agent URL from its own src -->
<script src="https://your-agent.example.com/widget.js"></script>

<!-- Custom JWT storage key (default: auth-token) -->
<script
  data-auth-key="my-jwt-key"
  src="https://your-agent.example.com/widget.js"
></script>
```

The host app just needs to store a valid Ghostfolio JWT in `sessionStorage` or `localStorage` under the configured key.

## Documentation

| Document             | Description                                           |
| -------------------- | ----------------------------------------------------- |
| [Architecture](docs/agent-architecture.md) | System design, graph topology, verification pipeline |
| [Tool Reference](docs/agent-tools.md) | 7 tools, their schemas, and Ghostfolio endpoints |
| [Eval Results](docs/agent-eval-results.md) | Model selection, eval methodology, verification rubric |
| [Cost Analysis](docs/ai-cost-analysis.md) | Token usage, per-query costs, production projections |
| [Build Checklist](docs/build-checklist.md) | Build and deploy checklist |
| [Pre-Search](docs/pre-search.md) | Initial research and planning document |

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)
