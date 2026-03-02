# Ghostfolio AI Agent <!-- v1 -->

AI-powered portfolio assistant that connects to the Ghostfolio API. Consists of two parts:

1. **Server** -- Bun + Elysia HTTP server that runs LangGraph agents
2. **Widget** -- React floating chat UI, bundled as a standalone `widget.js`

## Deliverables

| Deliverable              | Link                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Pre-Search Document      | [docs/pre-search.md](docs/pre-search.md)                                                       |
| Agent Architecture Doc   | [docs/agent-architecture.md](docs/agent-architecture.md)                                       |
| Tool Reference           | [docs/agent-tools.md](docs/agent-tools.md)                                                     |
| Eval Results (68 cases)  | [docs/agent-eval-results.md](docs/agent-eval-results.md)                                       |
| AI Cost Analysis         | [docs/ai-cost-analysis.md](docs/ai-cost-analysis.md)                                           |
| Build Checklist          | [docs/build-checklist.md](docs/build-checklist.md)                                             |
| Eval Dataset (68 cases)  | [src/test/eval/eval-cases.json](src/test/eval/eval-cases.json)                                 |
| Open Source Contribution | [github.com/SebastianGarces/ghostfolio](https://github.com/SebastianGarces/ghostfolio)         |
| Deployed Application     | [ghostfolio-production-1b6c.up.railway.app](https://ghostfolio-production-1b6c.up.railway.app) |
| Demo Video               | _TODO_                                                                                         |
| Social Post              | _TODO_                                                                                         |

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
| `OPENAI_API_KEY`       | Yes      | --                      | OpenAI API key for LangChain     |
| `AGENT_PORT`           | No       | `3334`                  | Port the agent server listens on |
| `CORS_ORIGIN`          | No       | `http://localhost:4200` | Allowed CORS origin              |
| `GHOSTFOLIO_API_URL`   | No       | `http://localhost:3333` | Ghostfolio API base URL          |
| `AGENT_CHECKPOINT_DB`  | No       | `./data/checkpoints.db` | SQLite checkpoint database path  |
| `LANGCHAIN_TRACING_V2` | No       | `false`                 | Enable LangSmith tracing         |
| `LANGCHAIN_API_KEY`    | No       | --                      | LangSmith API key                |
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

1. User logs into Ghostfolio -- JWT stored in `sessionStorage` under `auth-token`
2. Widget reads JWT from storage
3. Widget sends `Authorization: Bearer <jwt>` to agent server
4. Agent server forwards the same JWT to Ghostfolio API endpoints
5. No separate API key -- CORS + JWT is sufficient

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

| Script       | Command                                                  | Description                                    |
| ------------ | -------------------------------------------------------- | ---------------------------------------------- |
| `dev`        | `bun run build-widget.ts && bun run --watch src/main.ts` | Build widget + start server with hot reload    |
| `dev:widget` | `bun run watch-widget.ts`                                | Watch and rebuild widget on file changes       |
| `build`      | `bun run build-widget.ts`                                | Production build of widget.js (IIFE, minified) |
| `test`       | `bun test`                                               | Run all tests                                  |
| `start`      | `bun run src/main.ts`                                    | Start server (no watch, for production)        |

## Project Structure

```
├── src/
│   ├── main.ts                    # Elysia server entry point
│   ├── server/
│   │   ├── agent.ts               # LangChain agent setup
│   │   ├── checkpointer.ts        # BunSqliteSaver — SQLite checkpoint persistence
│   │   ├── ghostfolio-client.ts   # Typed HTTP client for Ghostfolio API
│   │   ├── system-prompt.ts       # Agent system prompt
│   │   ├── graph/
│   │   │   ├── graph.ts           # LangGraph StateGraph builder
│   │   │   ├── router.ts          # Heuristic query router (conversational vs analytical)
│   │   │   ├── conversational.ts  # Lightweight conversational path node
│   │   │   ├── state.ts           # AgentStateAnnotation definition
│   │   │   └── index.ts           # Graph exports
│   │   └── tools/
│   │       ├── create-tool.ts     # Tool factory
│   │       ├── performance-report.ts
│   │       ├── portfolio-analysis.ts
│   │       └── risk-assessment.ts
│   ├── widget/
│   │   ├── index.tsx              # Widget entry point (reads global, mounts React)
│   │   ├── ChatWidget.tsx         # Chat UI component with sidebar integration
│   │   ├── styles.ts              # Inline styles (no CSS dependencies)
│   │   ├── session-store.ts       # localStorage-based session list manager
│   │   ├── api-client.ts          # Widget API client
│   │   ├── components/
│   │   │   └── ChatSidebar.tsx    # Sidebar component for session management
│   │   └── dev.html               # Standalone test page
│   └── test/                      # Test files
├── dist/
│   └── widget.js                  # Built widget (gitignored)
├── build-widget.ts                # Production widget build script
├── watch-widget.ts                # Dev widget watcher
├── Dockerfile
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
<!-- Zero config -- widget discovers agent URL from its own src -->
<script src="https://your-agent.example.com/widget.js"></script>

<!-- Custom JWT storage key (default: auth-token) -->
<script
  data-auth-key="my-jwt-key"
  src="https://your-agent.example.com/widget.js"
></script>
```

The host app just needs to store a valid Ghostfolio JWT in `sessionStorage` or `localStorage` under the configured key.
