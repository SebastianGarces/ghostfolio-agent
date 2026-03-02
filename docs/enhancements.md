# Agent Enhancement Ideas

Ten LangGraph-based improvements for the Ghostfolio agent (`apps/agent/`), organized by priority. Four are implemented (#1, #2, #3, #4).

---

## High Priority

### 1. Intelligent Query Routing (Subgraphs)

**Status: Implemented.** The planner node classifies queries by intent and routes via conditional edges in `graph.ts`. Greetings/FAQs get an empty tool plan and go through `fastSynthesize` (no LLM), while analytical queries go through full `synthesize` with LLM. See `graph/planner.ts` and `graph/graph.ts`.

**Problem:** Simple greetings and FAQ questions go through the same heavy pipeline (LLM + tools + 5-check verification) as complex portfolio queries. This wastes tokens and adds latency.

**Solution:** Add a lightweight router node after the input guard that dispatches to one of three subgraphs:

- **Conversational path** — simple LLM call, skip tools and heavy verification for fast responses
- **Analytical path** — full pipeline with tools, verification, and confidence scoring
- **Clarification path** — if the query is ambiguous, ask a follow-up question before proceeding

```
START -> input_guard -> router -> [conversational | analytical | clarification] -> END
```

**Impact:** Cuts response times by 50%+ for simple queries.

---

### 2. Checkpointer for Conversation Persistence

**Status: Implemented.** `BunSqliteSaver` using `bun:sqlite` replaces `SessionMemoryManager`. See `checkpointer.ts`.

**Problem:** Current memory is in-process (`SessionMemoryManager` singleton with 30-min TTL). Server restart loses all conversations. No way to resume interrupted graph runs.

**Solution:** Use LangGraph's `MemorySaver` (or a PostgreSQL-backed checkpointer) to persist conversation state.

**Benefits:**

- Survive server restarts
- Resume interrupted runs (user closes tab mid-stream, reopens later)
- Enable named "thread" support — users can have multiple conversations
- Audit trail of all graph executions

---

## Medium Priority

### 3. Query Planning Node

**Status: Implemented.** The planner node (`graph/planner.ts`) classifies intent and produces a `QueryPlan` with structured output (intent, toolPlan, reasoning). Tools execute directly from the plan without an agent LLM loop. See `graph/execute-planned-tools.ts`.

**Problem:** The LLM gets a user message and immediately decides which tool(s) to call. For complex queries like "Compare my tech stocks performance vs bonds over the last year", it may call the wrong tool or miss that it needs multiple tools.

**Solution:** Add a planner node before the agent node that classifies query intent and produces a structured plan containing: intent type (analysis, lookup, comparison, general), required tools, and key parameters. The plan gets added to state and injected into the agent's context.

```
START -> input_guard -> planner -> agent -> tools -> agent -> verify -> END
```

**Impact:** Biggest reasoning improvement — especially for multi-step queries.

---

### 4. Parallel Tool Execution

**Status: Implemented.** `executePlannedTools` runs all planned tools concurrently via `Promise.all` in `graph/execute-planned-tools.ts`. Uses direct parallel execution rather than LangGraph's `Send` primitive, which achieves the same latency benefit with simpler code.

**Problem:** When the agent needs multiple tool calls (e.g., portfolio analysis + performance report for a comparison), they execute sequentially in the tool node.

**Solution:** ~~Use LangGraph's `Send` primitive to fan out tool calls to parallel workers, then aggregate results.~~ Implemented via `Promise.all` — all planned tools execute concurrently. Significantly cuts latency for multi-tool queries.

---

### 5. Retry Policies on Tool Failures

**Problem:** If a Ghostfolio API call fails (timeout, 5xx), the tool returns an error and the agent wastes a full LLM iteration deciding what to do.

**Solution:** Use LangGraph's built-in `retryPolicy` on the tool node — automatic retry with exponential backoff before surfacing errors to the agent. Minimal implementation effort since it's a native LangGraph feature.

---

### 6. Context Window Management

**Problem:** With 20-message history, the context window fills up quickly. Old tool results (which can be large JSON) waste tokens.

**Solution:** Add a summarization node that triggers when message count exceeds a threshold:

- Summarize older messages into a compact context paragraph
- Keep recent messages verbatim
- Strip large tool artifacts from history (they're already rendered as widgets)

---

### 7. Reflection / Self-Critique Loop

**Problem:** The agent sometimes gives a response that could be better structured or misses part of the user's question.

**Solution:** After the agent generates a response but before verification, add a reflection node that evaluates:

- Did we answer all parts of the question?
- Is the response well-structured for the query type?
- Should we cite more specific data points?

If reflection finds issues, loop back to the agent node with feedback. Cap at 1 reflection iteration to avoid latency.

---

## Lower Priority / UX

### 8. Human-in-the-Loop Confirmation Gate

**Problem:** The agent calls tools automatically. For sensitive operations (e.g., fetching full portfolio data), users might want to approve first.

**Solution:** Use LangGraph's `interrupt()` before executing tools that access sensitive data. The widget shows a "The agent wants to access your portfolio data — Allow?" prompt. On approval, the graph resumes via `Command`. Particularly valuable for building user trust in a financial application.

---

### 9. Streaming Verification Feedback

**Problem:** Verification runs after the full response is streamed. If it fails, the user sees the full response get replaced by a fallback — jarring UX.

**Solution:** Run verification checks incrementally using LangGraph's custom stream writers:

- Stream confidence indicators as tokens accumulate
- Show a small "verified" badge once verification completes
- If a check fails mid-stream, show a gentle inline warning rather than replacing everything

---

### 10. Progressive Widget Loading

**Problem:** Tool calls can take 2–5 seconds. The user sees "Analyzing portfolio..." with no intermediate feedback.

**Solution:** Use LangGraph's custom stream writers to emit partial widget data in stages:

- `tool_start` — show widget skeleton/loading state
- Partial data — show chart with loading overlay
- `tool_end` — reveal final widget

Requires the React widget to handle skeleton/partial/complete states for each embedded component.
