const STORAGE_KEY = 'ghostfolio-agent-sessions';
const CURRENT_SESSION_KEY = 'ghostfolio-agent-current-session';
const RUN_IDS_KEY = 'ghostfolio-agent-run-ids';
const MAX_SESSIONS = 50;

export interface SessionEntry {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function readSessions(): SessionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionEntry[];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SessionEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function getSessions(): SessionEntry[] {
  return readSessions().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function upsertSession(sessionId: string, firstMessage?: string): void {
  const sessions = readSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);

  if (idx >= 0) {
    sessions[idx].updatedAt = Date.now();
    if (firstMessage && !sessions[idx].title) {
      sessions[idx].title = firstMessage.slice(0, 60);
    }
  } else {
    sessions.push({
      sessionId,
      title: firstMessage ? firstMessage.slice(0, 60) : '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  // Prune oldest if over cap
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  if (sessions.length > MAX_SESSIONS) {
    sessions.length = MAX_SESSIONS;
  }

  writeSessions(sessions);
}

export function removeSession(sessionId: string): void {
  const sessions = readSessions().filter((s) => s.sessionId !== sessionId);
  writeSessions(sessions);
  clearRunIds(sessionId);

  if (getCurrentSessionId() === sessionId) {
    localStorage.removeItem(CURRENT_SESSION_KEY);
  }
}

export function getCurrentSessionId(): string | null {
  return localStorage.getItem(CURRENT_SESSION_KEY);
}

export function setCurrentSessionId(sessionId: string): void {
  localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
}

// --- Agent message metadata (runId + feedback, per agent message) ---

export interface AgentMessageMeta {
  runId: string;
  feedback?: 'up' | 'down';
}

function readAllMeta(): Record<string, AgentMessageMeta[]> {
  try {
    const raw = localStorage.getItem(RUN_IDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migrate from old string[] format to AgentMessageMeta[]
    const result: Record<string, AgentMessageMeta[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'string' ? { runId: item } : item
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeAllMeta(data: Record<string, AgentMessageMeta[]>): void {
  localStorage.setItem(RUN_IDS_KEY, JSON.stringify(data));
}

/** Append metadata for the nth agent message in this session. */
export function storeRunId(sessionId: string, runId: string): void {
  const all = readAllMeta();
  if (!all[sessionId]) {
    all[sessionId] = [];
  }
  all[sessionId].push({ runId });
  writeAllMeta(all);
}

/** Get ordered metadata for a session (one per agent message, in order). */
export function getMessageMetas(sessionId: string): AgentMessageMeta[] {
  return readAllMeta()[sessionId] ?? [];
}

/** Persist feedback for the agent message at the given index. */
export function storeFeedback(
  sessionId: string,
  agentMsgIndex: number,
  feedback: 'up' | 'down'
): void {
  const all = readAllMeta();
  const metas = all[sessionId];
  if (metas && metas[agentMsgIndex]) {
    metas[agentMsgIndex].feedback = feedback;
    writeAllMeta(all);
  }
}

/** Remove all metadata for a session. */
export function clearRunIds(sessionId: string): void {
  const all = readAllMeta();
  delete all[sessionId];
  writeAllMeta(all);
}
