/**
 * AI Trace Review
 *
 * Fetches a single LangSmith trace by ID and outputs a structured markdown
 * report designed for AI-assisted review of the agent's behavior.
 *
 * Ghostfolio-specific: includes query plan, verification pipeline results,
 * tool call artifacts, confidence scoring, and hallucination checks.
 *
 * Output:
 *   - artifacts/ai-trace-review.md  (full report)
 *   - stdout                        (same report)
 *
 * Usage:
 *   bun run scripts/ai-trace-review.ts <trace-id>
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

const traceId = process.argv[2];
if (!traceId) {
  console.error('Usage: bun run scripts/ai-trace-review.ts <trace-id>');
  process.exit(1);
}

const client = new Client();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Extract content from a message, handling LangChain lc:1 serialization. */
function extractContent(msg: Record<string, unknown>): string | null {
  // Top-level content
  if (msg.content != null && msg.content !== '') return formatJson(msg.content);
  // LangChain lc:1 serialization — content under kwargs
  const kwargs = msg.kwargs as Record<string, unknown> | undefined;
  if (kwargs?.content != null && kwargs.content !== '')
    return formatJson(kwargs.content);
  // Legacy — content under data
  const data = msg.data as Record<string, unknown> | undefined;
  if (data?.content != null && data.content !== '')
    return formatJson(data.content);
  return null;
}

/** Extract role from a message, handling LangChain lc:1 serialization. */
function extractRole(msg: Record<string, unknown>): string {
  if (msg.type && typeof msg.type === 'string' && msg.type !== 'constructor')
    return msg.type;
  if (msg.role && typeof msg.role === 'string') return msg.role;
  // LangChain lc:1 — derive role from id array (e.g. ["langchain_core", "messages", "HumanMessage"])
  const id = msg.id as string[] | undefined;
  if (Array.isArray(id)) {
    const className = id[id.length - 1];
    if (className?.includes('Human')) return 'human';
    if (className?.includes('AI')) return 'ai';
    if (className?.includes('System')) return 'system';
    if (className?.includes('Tool')) return 'tool';
  }
  return 'unknown';
}

function runLatencyMs(run: Run): string {
  if (!run.end_time || !run.start_time) return 'N/A';
  const ms =
    new Date(run.end_time).getTime() - new Date(run.start_time).getTime();
  return `${ms}ms`;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}

// ---------------------------------------------------------------------------
// Fetch trace and child runs
// ---------------------------------------------------------------------------

async function fetchTraceRuns(id: string): Promise<Run[]> {
  const runs: Run[] = [];
  for await (const run of client.listRuns({
    traceId: id,
    projectName: PROJECT_NAME
  })) {
    runs.push(run);
  }
  return runs.sort(
    (a, b) =>
      new Date(a.start_time ?? 0).getTime() -
      new Date(b.start_time ?? 0).getTime()
  );
}

// ---------------------------------------------------------------------------
// Extract data from runs
// ---------------------------------------------------------------------------

function extractSystemPrompt(llmRuns: Run[]): string | null {
  for (const run of llmRuns) {
    const messages = run.inputs?.messages;
    if (Array.isArray(messages)) {
      const flat = messages.flat();
      const systemMsg = flat.find(
        (m: Record<string, unknown>) => extractRole(m) === 'system'
      );
      if (systemMsg) {
        return extractContent(systemMsg as Record<string, unknown>) ?? null;
      }
    }
  }
  return null;
}

function extractUserPrompt(rootRun: Run, llmRuns: Run[]): string {
  // Check root run inputs (traceable wrapper)
  if (rootRun.inputs) {
    const inp = rootRun.inputs as Record<string, unknown>;
    // Our agent passes args positionally: [jwt, message, sessionId, options]
    if (Array.isArray(inp.args) && typeof inp.args[1] === 'string') {
      return inp.args[1];
    }
    if (inp.prompt && typeof inp.prompt === 'string') return inp.prompt;
  }

  // Fallback: find last human message in first LLM call
  if (llmRuns.length > 0) {
    const messages = llmRuns[0].inputs?.messages;
    if (Array.isArray(messages)) {
      const flat = messages.flat();
      const lastUser = [...flat]
        .reverse()
        .find((m: Record<string, unknown>) => {
          const role = extractRole(m);
          return role === 'human' || role === 'user';
        });
      if (lastUser) {
        return (
          extractContent(lastUser as Record<string, unknown>) ??
          formatJson(lastUser)
        );
      }
    }
  }

  return formatJson(rootRun.inputs);
}

function extractConversationHistory(llmRuns: Run[]): string | null {
  if (llmRuns.length === 0) return null;
  const messages = llmRuns[0].inputs?.messages;
  if (!Array.isArray(messages)) return null;

  const flat = messages.flat();
  const nonSystemNonLastUser = flat.filter(
    (m: Record<string, unknown>, idx: number) => {
      const role = extractRole(m);
      if (role === 'system') return false;
      if ((role === 'human' || role === 'user') && idx === flat.length - 1)
        return false;
      return true;
    }
  );

  if (nonSystemNonLastUser.length === 0) return null;

  return nonSystemNonLastUser
    .map((m: Record<string, unknown>) => {
      const role = extractRole(m);
      const content = extractContent(m) ?? '(none)';
      return `**${role}**: ${content}`;
    })
    .join('\n\n');
}

function extractFinalResponse(rootRun: Run): string {
  if (rootRun.outputs) {
    const out = rootRun.outputs as Record<string, unknown>;
    // Our agent returns { response, toolCalls, ... }
    if (out.response && typeof out.response === 'string') return out.response;
    if (out.text && typeof out.text === 'string') return out.text;
    if (typeof rootRun.outputs === 'string') return rootRun.outputs;
    return formatJson(rootRun.outputs);
  }
  return '(no output recorded)';
}

/** Extract Ghostfolio-specific metadata from root run outputs. */
function extractAgentMetadata(rootRun: Run): {
  sessionId?: string;
  routeType?: string;
  queryPlan?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
} {
  const meta = rootRun.metadata ?? {};
  const out = (rootRun.outputs ?? {}) as Record<string, unknown>;

  return {
    sessionId: (meta.session_id as string) ?? undefined,
    routeType: (out.routeType as string) ?? undefined,
    queryPlan: (out.queryPlan as Record<string, unknown>) ?? undefined,
    verification: (out.verification as Record<string, unknown>) ?? undefined,
    tokenUsage: (out.tokenUsage as Record<string, unknown>) ?? undefined
  };
}

// ---------------------------------------------------------------------------
// Group runs into execution steps
// ---------------------------------------------------------------------------

type ExecutionStep = {
  stepNumber: number;
  llmRun: Run | null;
  toolRuns: Run[];
};

function buildExecutionSteps(allRuns: Run[]): ExecutionStep[] {
  const llmRuns = allRuns.filter((r) => r.run_type === 'llm');
  const toolRuns = allRuns.filter((r) => r.run_type === 'tool');

  if (llmRuns.length === 0) {
    if (toolRuns.length === 0) return [];
    return [{ stepNumber: 1, llmRun: null, toolRuns }];
  }

  const steps: ExecutionStep[] = [];

  for (let i = 0; i < llmRuns.length; i++) {
    const llm = llmRuns[i];
    const llmTime = new Date(llm.start_time ?? 0).getTime();
    const nextLlmTime =
      i + 1 < llmRuns.length
        ? new Date(llmRuns[i + 1].start_time ?? 0).getTime()
        : Infinity;

    const stepTools = toolRuns.filter((t) => {
      const time = new Date(t.start_time ?? 0).getTime();
      return time >= llmTime && time < nextLlmTime;
    });

    steps.push({
      stepNumber: i + 1,
      llmRun: llm,
      toolRuns: stepTools
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Render markdown report
// ---------------------------------------------------------------------------

function renderReport(rootRun: Run, allRuns: Run[]): string {
  const llmRuns = allRuns.filter((r) => r.run_type === 'llm');
  const toolRuns = allRuns.filter((r) => r.run_type === 'tool');
  const steps = buildExecutionSteps(allRuns);
  const agentMeta = extractAgentMetadata(rootRun);

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`# AI Trace Review: ${rootRun.trace_id}`);
  push('');

  // -- Metadata --
  push('## Trace Metadata');
  push('');
  push('| Field | Value |');
  push('|-------|-------|');
  push(`| Trace ID | \`${rootRun.trace_id}\` |`);
  push(`| Name | ${rootRun.name ?? 'N/A'} |`);
  push(`| Timestamp | ${rootRun.start_time ?? 'N/A'} |`);
  push(`| Latency | ${runLatencyMs(rootRun)} |`);
  push(
    `| Total Cost | ${rootRun.total_cost != null ? `$${rootRun.total_cost.toFixed(6)}` : 'N/A'} |`
  );
  push(`| Tags | ${rootRun.tags?.join(', ') || 'none'} |`);
  push(
    `| Runs | ${allRuns.length} total (${llmRuns.length} llm, ${toolRuns.length} tool) |`
  );
  if (agentMeta.sessionId) {
    push(`| Session ID | \`${agentMeta.sessionId}\` |`);
  }
  if (agentMeta.routeType) {
    push(`| Route Type | ${agentMeta.routeType} |`);
  }
  push('');

  // -- Query Plan (Ghostfolio-specific) --
  if (agentMeta.queryPlan) {
    push('## Query Plan');
    push('');
    const plan = agentMeta.queryPlan;
    if (plan.intent) push(`**Intent:** ${plan.intent}`);
    if (plan.reasoning) push(`**Reasoning:** ${plan.reasoning}`);
    push('');
    if (Array.isArray(plan.toolPlan)) {
      push('| # | Tool | Reason | Parameters |');
      push('|---|------|--------|------------|');
      for (const [i, t] of (
        plan.toolPlan as Record<string, unknown>[]
      ).entries()) {
        const params =
          Array.isArray(t.parameters) && t.parameters.length > 0
            ? t.parameters
                .map((p: Record<string, unknown>) => `${p.key}=${p.value}`)
                .join(', ')
            : '(none)';
        push(`| ${i + 1} | ${t.tool} | ${t.reason} | ${params} |`);
      }
      push('');
    }
  }

  // -- System prompt --
  push('## System Prompt');
  push('');
  const systemPrompt = extractSystemPrompt(llmRuns);
  if (systemPrompt) {
    push('<details><summary>System prompt (click to expand)</summary>');
    push('');
    push('```');
    push(systemPrompt);
    push('```');
    push('');
    push('</details>');
  } else {
    push('(not found in trace)');
  }
  push('');

  // -- Conversation history --
  const history = extractConversationHistory(llmRuns);
  if (history) {
    push('## Conversation History');
    push('');
    push(history);
    push('');
  }

  // -- User prompt --
  push('## User Prompt');
  push('');
  push('```');
  push(extractUserPrompt(rootRun, llmRuns));
  push('```');
  push('');

  // -- Execution steps --
  push('## Execution Steps');
  push('');

  for (const step of steps) {
    push(`### Step ${step.stepNumber}: LLM Call`);
    push('');

    if (step.llmRun) {
      const llm = step.llmRun;

      push('| Field | Value |');
      push('|-------|-------|');
      push(
        `| Model | ${llm.extra?.metadata?.ls_model_name ?? llm.name ?? 'N/A'} |`
      );
      push(`| Prompt tokens | ${llm.prompt_tokens ?? 'N/A'} |`);
      push(`| Completion tokens | ${llm.completion_tokens ?? 'N/A'} |`);
      push(
        `| Total tokens | ${(llm.prompt_tokens ?? 0) + (llm.completion_tokens ?? 0) || 'N/A'} |`
      );
      push(`| Latency | ${runLatencyMs(llm)} |`);
      if (llm.first_token_time) {
        const ttft =
          new Date(llm.first_token_time).getTime() -
          new Date(llm.start_time ?? 0).getTime();
        push(`| Time to first token | ${ttft}ms |`);
      }
      if (llm.total_cost != null) {
        push(`| Cost | $${llm.total_cost.toFixed(6)} |`);
      }
      push('');

      push('**Messages sent to model:**');
      push('');
      const messages = llm.inputs?.messages;
      if (Array.isArray(messages)) {
        const flat = messages.flat();
        for (const msg of flat as Array<Record<string, unknown>>) {
          const role = extractRole(msg);
          const contentStr = extractContent(msg) ?? '(none)';
          push(`<details><summary>${role}</summary>`);
          push('');
          push('```');
          push(contentStr);
          push('```');
          push('');
          push('</details>');
          push('');
        }
      } else {
        push('```json');
        push(formatJson(llm.inputs));
        push('```');
        push('');
      }

      push('**Model response:**');
      push('');
      push('```json');
      push(formatJson(llm.outputs));
      push('```');
      push('');
    } else {
      push('(no LLM run recorded for this step)');
      push('');
    }

    if (step.toolRuns.length > 0) {
      push(`### Step ${step.stepNumber}: Tool Executions`);
      push('');

      for (const tool of step.toolRuns) {
        push(`#### Tool: \`${tool.name}\``);
        push('');
        push(`- **Latency:** ${runLatencyMs(tool)}`);
        if (tool.error) {
          push(`- **Error:** ${tool.error}`);
        }
        push('');

        push('**Input:**');
        push('');
        push('```json');
        push(formatJson(tool.inputs));
        push('```');
        push('');

        push('**Output:**');
        push('');
        const outputStr = formatJson(tool.outputs);
        // Truncate very large tool outputs (e.g. portfolio data)
        if (outputStr.length > 3000) {
          push('```json');
          push(truncate(outputStr, 3000));
          push('```');
          push(`_(output truncated from ${outputStr.length} chars)_`);
        } else {
          push('```json');
          push(outputStr);
          push('```');
        }
        push('');
      }
    }
  }

  // -- Final response --
  push('## Final Response');
  push('');
  push('```');
  push(extractFinalResponse(rootRun));
  push('```');
  push('');

  // -- Verification Pipeline (Ghostfolio-specific) --
  if (agentMeta.verification) {
    push('## Verification Pipeline');
    push('');
    const v = agentMeta.verification;
    const passed = v.passed ? 'PASSED' : 'FAILED';
    push(`**Overall: ${passed}**`);
    push('');

    // Domain constraints
    if (Array.isArray(v.violations) && v.violations.length > 0) {
      push('### Domain Constraint Violations');
      push('');
      push('| Rule | Severity | Description |');
      push('|------|----------|-------------|');
      for (const viol of v.violations as Record<string, unknown>[]) {
        push(`| ${viol.rule} | ${viol.severity} | ${viol.description} |`);
      }
      push('');
    }

    // Output validation
    const ov = v.outputValidation as Record<string, unknown> | undefined;
    if (ov) {
      push(`### Output Validation: ${ov.passed ? 'PASSED' : 'FAILED'}`);
      push('');
      if (Array.isArray(ov.issues) && ov.issues.length > 0) {
        push('| Rule | Severity | Description |');
        push('|------|----------|-------------|');
        for (const issue of ov.issues as Record<string, unknown>[]) {
          push(`| ${issue.rule} | ${issue.severity} | ${issue.description} |`);
        }
        push('');
      }
    }

    // Confidence scoring
    const conf = v.confidence as Record<string, unknown> | undefined;
    if (conf) {
      push(`### Confidence: ${conf.score}/1.0 (${conf.level})`);
      push('');
      if (Array.isArray(conf.factors)) {
        push('| Factor | Score | Reason |');
        push('|--------|-------|--------|');
        for (const f of conf.factors as Record<string, unknown>[]) {
          push(`| ${f.name} | ${f.score} | ${f.reason} |`);
        }
        push('');
      }
    }

    // Hallucination detection
    const hall = v.hallucination as Record<string, unknown> | undefined;
    if (hall) {
      push(`### Hallucination Check: ${hall.passed ? 'PASSED' : 'FAILED'}`);
      push('');
      if (Array.isArray(hall.issues) && hall.issues.length > 0) {
        push('| Rule | Severity | Description |');
        push('|------|----------|-------------|');
        for (const issue of hall.issues as Record<string, unknown>[]) {
          push(`| ${issue.rule} | ${issue.severity} | ${issue.description} |`);
        }
        push('');
      }
    }

    // Groundedness scoring
    const gr = v.groundedness as Record<string, unknown> | undefined;
    if (gr) {
      push(`### Groundedness`);
      push('');
      push('| Metric | Score |');
      push('|--------|-------|');
      const accuracy = gr.accuracy as Record<string, unknown> | undefined;
      const precision = gr.precision as Record<string, unknown> | undefined;
      const groundedness = gr.groundedness as
        | Record<string, unknown>
        | undefined;
      if (accuracy) push(`| Accuracy | ${accuracy.score} |`);
      if (precision) push(`| Precision | ${precision.score} |`);
      if (groundedness) push(`| Groundedness | ${groundedness.score} |`);
      if (gr.overall != null) push(`| **Overall** | **${gr.overall}** |`);
      push('');
    }
  }

  // -- Analysis summary --
  push('## Analysis Summary');
  push('');

  const totalPromptTokens = llmRuns.reduce(
    (s, r) => s + (r.prompt_tokens ?? 0),
    0
  );
  const totalCompletionTokens = llmRuns.reduce(
    (s, r) => s + (r.completion_tokens ?? 0),
    0
  );
  const totalTokens = totalPromptTokens + totalCompletionTokens;

  const toolCallCounts = new Map<string, number>();
  const toolErrors: string[] = [];
  for (const tool of toolRuns) {
    toolCallCounts.set(tool.name, (toolCallCounts.get(tool.name) ?? 0) + 1);
    if (tool.error) {
      toolErrors.push(`${tool.name}: ${tool.error}`);
    }
  }

  // Detect duplicate tool calls (a key regression signal)
  const duplicateTools = [...toolCallCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => `${name} (${count}x)`);

  push('| Metric | Value |');
  push('|--------|-------|');
  push(`| Total steps | ${steps.length} |`);
  push(`| Total LLM calls | ${llmRuns.length} |`);
  push(`| Total tool calls | ${toolRuns.length} |`);
  push(`| Total prompt tokens | ${totalPromptTokens} |`);
  push(`| Total completion tokens | ${totalCompletionTokens} |`);
  push(`| Total tokens | ${totalTokens} |`);
  push(
    `| Total cost | ${rootRun.total_cost != null ? `$${rootRun.total_cost.toFixed(6)}` : 'N/A'} |`
  );
  push(
    `| Tokens per tool call | ${toolRuns.length > 0 ? Math.round(totalTokens / toolRuns.length) : 'N/A'} |`
  );
  push(
    `| Duplicate tool calls | ${duplicateTools.length > 0 ? duplicateTools.join(', ') : 'none'} |`
  );
  push(
    `| Tool errors | ${toolErrors.length > 0 ? toolErrors.length : 'none'} |`
  );
  if (agentMeta.routeType) {
    push(`| Route type | ${agentMeta.routeType} |`);
  }
  push('');

  if (toolCallCounts.size > 0) {
    push('### Tool Call Breakdown');
    push('');
    push('| Tool | Count |');
    push('|------|-------|');
    for (const [name, count] of toolCallCounts) {
      push(`| ${name} | ${count} |`);
    }
    push('');
  }

  // -- Diagnostic flags --
  const flags: string[] = [];
  if (duplicateTools.length > 0) {
    flags.push(
      `Duplicate tool calls detected: ${duplicateTools.join(', ')}. May indicate planner guidance loop.`
    );
  }
  if (toolErrors.length > 0) {
    flags.push(`${toolErrors.length} tool error(s): ${toolErrors.join('; ')}`);
  }
  const finalResponse = extractFinalResponse(rootRun);
  if (
    finalResponse.includes('unable to') ||
    finalResponse.includes('SAFE_FALLBACK')
  ) {
    flags.push(
      'Response contains fallback language — may indicate verification failure or empty LLM output.'
    );
  }
  if (llmRuns.length > 5) {
    flags.push(
      `High iteration count (${llmRuns.length} LLM calls) — possible agent looping.`
    );
  }

  if (flags.length > 0) {
    push('### Diagnostic Flags');
    push('');
    for (const flag of flags) {
      push(`- ${flag}`);
    }
    push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Fetching trace ${traceId}...\n`);

  const allRuns = await fetchTraceRuns(traceId);

  if (allRuns.length === 0) {
    console.error(`No runs found for trace ID ${traceId}`);
    process.exitCode = 1;
    return;
  }

  const rootRun = allRuns.find((r) => r.parent_run_id == null) ?? allRuns[0];
  const childRuns = allRuns.filter((r) => r.id !== rootRun.id);

  console.log(
    `Trace found: "${rootRun.name}" with ${allRuns.length} runs ` +
      `(${childRuns.filter((r) => r.run_type === 'llm').length} llm, ` +
      `${childRuns.filter((r) => r.run_type === 'tool').length} tool).\n`
  );

  const report = renderReport(rootRun, childRuns);

  const ROOT = resolve(import.meta.dir, '..');
  const artifactDir = join(ROOT, 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, 'ai-trace-review.md');
  await writeFile(artifactPath, report + '\n');

  console.log(report);
  console.log(`\n---\nArtifact saved to: ${artifactPath}`);
}

main().catch((err) => {
  console.error('AI Trace Review failed:', err);
  process.exitCode = 1;
});
