import { Bot, Menu, Send, Square, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback
} from 'react';

import type { ContentBlock } from '../server/graph/content-blocks';
import { ChatSidebar } from './components/ChatSidebar';
import { BlockRenderer } from './components/blocks/BlockRenderer';
import {
  getCurrentSessionId,
  getMessageMetas,
  getSessions,
  removeSession,
  setCurrentSessionId,
  storeFeedback,
  storeRunId,
  upsertSession
} from './session-store';
import type { SessionEntry } from './session-store';
import { styles } from './styles';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
  toolCalls?: { name: string; success: boolean; data?: unknown }[];
  contentBlocks?: ContentBlock[];
  runId?: string;
  feedback?: 'up' | 'down';
}

interface ChatWidgetProps {
  jwt: string;
  agentUrl: string;
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- SSE Parser ---
interface ParsedSSEEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

function parseSSEChunk(buffer: string): {
  events: ParsedSSEEvent[];
  remaining: string;
} {
  const events: ParsedSSEEvent[] = [];
  const blocks = buffer.split('\n\n');

  // Last block may be incomplete
  const remaining = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventType = '';
    let eventData = '';

    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        eventData = line.slice(6);
      }
    }

    if (eventType && eventData) {
      try {
        events.push({ type: eventType, data: JSON.parse(eventData) });
      } catch {
        // skip malformed events
      }
    }
  }

  return { events, remaining };
}

// Typing dots indicator
function TypingDots() {
  return (
    <div style={styles.messageBubbleAgent}>
      <style>{`
        @keyframes typingFade {
          0%, 80%, 100% { opacity: 0.25; }
          40% { opacity: 1; }
        }
      `}</style>
      <span style={{ display: 'inline-flex', gap: '4px', padding: '2px 0' }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.6)',
              animation: `typingFade 1.4s infinite`,
              animationDelay: `${i * 0.2}s`
            }}
          />
        ))}
      </span>
    </div>
  );
}

export function ChatWidget({ jwt, agentUrl }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[] | null>(
    null
  );
  const [streamingToolCalls, setStreamingToolCalls] = useState<
    { name: string; success: boolean; data?: unknown }[]
  >([]);
  const [pendingTools, setPendingTools] = useState<string[]>([]);
  const [awaitingSynthesis, setAwaitingSynthesis] = useState(false);
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState<{
    msgId: string;
    text: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyLoadedRef = useRef<Set<string>>(new Set());
  // In-memory cache of full Message[] per session so switching back preserves toolCalls/runId
  const messageCacheRef = useRef<Map<string, Message[]>>(new Map());

  // Check if mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  // Initialize session ID from localStorage or create new one
  useEffect(() => {
    const stored = getCurrentSessionId();
    if (stored) {
      setSessionId(stored);
    } else {
      const newId = crypto.randomUUID();
      setSessionId(newId);
      setCurrentSessionId(newId);
    }
    setSessions(getSessions());
    setSidebarOpen(!isMobile);
  }, []);

  const refreshSessionList = useCallback(() => {
    setSessions(getSessions());
  }, []);

  // Load conversation history for a session
  const loadSession = useCallback(
    async (sid: string) => {
      if (historyLoadedRef.current.has(sid)) return;

      try {
        const response = await fetch(
          `${agentUrl}/api/history?sessionId=${encodeURIComponent(sid)}`,
          {
            headers: { Authorization: `Bearer ${jwt}` }
          }
        );
        if (!response.ok) return;

        const data = await response.json();
        if (data.messages && data.messages.length > 0) {
          // Restore stored metadata for agent messages (runId + feedback state)
          const storedMetas = getMessageMetas(sid);
          let agentMsgIdx = 0;

          const loaded: Message[] = data.messages.map(
            (m: {
              role: 'human' | 'ai';
              content: string;
              toolCalls?: { name: string; success: boolean; data?: unknown }[];
              contentBlocks?: ContentBlock[];
            }) => {
              const isAgent = m.role === 'ai';
              const meta = isAgent ? storedMetas[agentMsgIdx++] : undefined;
              return {
                id: crypto.randomUUID(),
                role: isAgent ? 'agent' : 'user',
                content: m.content,
                timestamp: Date.now(),
                ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
                ...(m.contentBlocks ? { contentBlocks: m.contentBlocks } : {}),
                ...(meta?.runId ? { runId: meta.runId } : {}),
                ...(meta?.feedback ? { feedback: meta.feedback } : {})
              };
            }
          );
          setMessages(loaded);
        } else {
          setMessages([]);
        }
        historyLoadedRef.current.add(sid);
      } catch {
        // Failed to load history — start fresh
        setMessages([]);
      }
    },
    [agentUrl, jwt]
  );

  // Keep message cache in sync with current session
  useEffect(() => {
    if (sessionId && messages.length > 0) {
      messageCacheRef.current.set(sessionId, messages);
    }
  }, [sessionId, messages]);

  // Auto-load history when panel opens
  useEffect(() => {
    if (isOpen && sessionId && messages.length === 0) {
      loadSession(sessionId);
    }
  }, [isOpen, sessionId]);

  // Auto-scroll to bottom when new messages or streaming state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    messages,
    streamingBlocks,
    streamingToolCalls,
    pendingTools,
    awaitingSynthesis
  ]);

  // Focus input and scroll to bottom when panel opens (before paint)
  useLayoutEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView();
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleNewChat = useCallback(() => {
    // Save current messages before switching
    if (sessionId && messages.length > 0) {
      messageCacheRef.current.set(sessionId, messages);
    }
    const newId = crypto.randomUUID();
    setSessionId(newId);
    setCurrentSessionId(newId);
    setMessages([]);
    historyLoadedRef.current.delete(newId);
    refreshSessionList();
    inputRef.current?.focus();
  }, [sessionId, messages, refreshSessionList]);

  const handleSelectSession = useCallback(
    (sid: string) => {
      if (sid === sessionId) return;
      // Save current messages to cache before switching
      if (sessionId && messages.length > 0) {
        messageCacheRef.current.set(sessionId, messages);
      }
      setSessionId(sid);
      setCurrentSessionId(sid);
      // Restore from in-memory cache (preserves toolCalls/runId) or load from backend
      const cached = messageCacheRef.current.get(sid);
      if (cached) {
        setMessages(cached);
      } else {
        setMessages([]);
        historyLoadedRef.current.delete(sid);
        loadSession(sid);
      }
      refreshSessionList();
      if (isMobile) setSidebarOpen(false);
    },
    [sessionId, messages, loadSession, refreshSessionList, isMobile]
  );

  const handleDeleteSession = useCallback(
    (sid: string) => {
      removeSession(sid);
      messageCacheRef.current.delete(sid);
      historyLoadedRef.current.delete(sid);

      // Fire-and-forget backend deletion
      fetch(`${agentUrl}/api/sessions/${encodeURIComponent(sid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${jwt}` }
      }).catch(() => {
        // silently swallow errors
      });

      if (sid === sessionId) {
        handleNewChat();
      } else {
        refreshSessionList();
      }
    },
    [agentUrl, jwt, sessionId, handleNewChat, refreshSessionList]
  );

  const sendMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading || isStreaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setIsStreaming(false);
    setStreamingBlocks(null);
    setStreamingToolCalls([]);
    setPendingTools([]);
    setAwaitingSynthesis(false);
    setStreamRunId(null);

    // Track session in localStorage
    upsertSession(sessionId, text);
    refreshSessionList();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Try streaming endpoint first
      const response = await fetch(`${agentUrl}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`
        },
        body: JSON.stringify({ message: text, sessionId }),
        signal: controller.signal
      });

      // If streaming endpoint doesn't exist, fall back to non-streaming
      if (response.status === 404) {
        const fallbackResponse = await fetch(`${agentUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`
          },
          body: JSON.stringify({ message: text, sessionId }),
          signal: controller.signal
        });

        if (!fallbackResponse.ok) {
          throw new Error(
            fallbackResponse.status === 401
              ? 'Session expired. Please refresh the page.'
              : `Error: ${fallbackResponse.statusText}`
          );
        }

        const data = await fallbackResponse.json();
        const agentMessage: Message = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: data.response ?? 'No response received.',
          timestamp: Date.now(),
          toolCalls: data.toolCalls,
          contentBlocks: data.contentBlocks,
          runId: data.runId
        };
        setMessages((prev) => [...prev, agentMessage]);
        if (data.runId) storeRunId(sessionId, data.runId);
        if (data.sessionId) setSessionId(data.sessionId);
        return;
      }

      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? 'Session expired. Please refresh the page.'
            : response.status === 429
              ? 'Too many requests. Please wait a moment.'
              : `Error: ${response.statusText}`
        );
      }

      // Stream SSE response
      setIsLoading(false);
      setIsStreaming(true);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedToolCalls: {
        name: string;
        success: boolean;
        data?: unknown;
      }[] = [];
      let accumulatedBlocks: ContentBlock[] | null = null;
      let runId: string | undefined;
      let finalText: string | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEChunk(buffer);
        buffer = remaining;

        for (const event of events) {
          switch (event.type) {
            case 'session':
              if (event.data.sessionId) {
                setSessionId(event.data.sessionId);
              }
              if (event.data.runId) {
                runId = event.data.runId;
                setStreamRunId(event.data.runId);
              }
              break;

            case 'tool_start':
              setPendingTools((prev) => [...prev, event.data.name]);
              break;

            case 'tool_end':
              setPendingTools((prev) =>
                prev.filter((n) => n !== event.data.name)
              );
              accumulatedToolCalls = [
                ...accumulatedToolCalls,
                {
                  name: event.data.name,
                  success: event.data.success,
                  data: event.data.data
                }
              ];
              setStreamingToolCalls([...accumulatedToolCalls]);
              // Show typing dots after tools complete while waiting for synthesis
              setAwaitingSynthesis(true);
              break;

            case 'blocks_delta':
              accumulatedBlocks = event.data.blocks;
              setStreamingBlocks(accumulatedBlocks);
              setAwaitingSynthesis(false);
              break;

            case 'blocks':
              accumulatedBlocks = event.data.blocks;
              setStreamingBlocks(accumulatedBlocks);
              setAwaitingSynthesis(false);
              break;

            case 'done':
              finalText = event.data.response;
              break;

            case 'error':
              throw new Error(event.data.message || 'Agent processing failed');
          }
        }
      }

      // Finalize: convert streaming state to a completed message
      const agentMessage: Message = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: finalText ?? '',
        timestamp: Date.now(),
        toolCalls:
          accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        contentBlocks: accumulatedBlocks ?? undefined,
        runId
      };
      setMessages((prev) => [...prev, agentMessage]);
      if (runId) storeRunId(sessionId, runId);
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // User cancelled — finalize with whatever we have
        const agentMessage: Message = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: 'Response cancelled.',
          timestamp: Date.now(),
          toolCalls:
            streamingToolCalls.length > 0 ? streamingToolCalls : undefined
        };
        setMessages((prev) => [...prev, agentMessage]);
      } else {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'agent',
          content:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred.',
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingBlocks(null);
      setStreamingToolCalls([]);
      setPendingTools([]);
      setAwaitingSynthesis(false);
      setStreamRunId(null);
      abortRef.current = null;
    }
  }, [
    inputValue,
    isLoading,
    isStreaming,
    jwt,
    agentUrl,
    sessionId,
    streamingToolCalls,
    refreshSessionList
  ]);

  const handleFeedback = useCallback(
    (msgId: string, direction: 'up' | 'down', runId: string) => {
      // Optimistic UI update
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === msgId ? { ...m, feedback: direction } : m
        );

        // Persist feedback state to localStorage
        const agentMsgIndex = updated
          .filter((m) => m.role === 'agent')
          .findIndex((m) => m.id === msgId);
        if (agentMsgIndex >= 0) {
          storeFeedback(sessionId, agentMsgIndex, direction);
        }

        return updated;
      });

      if (direction === 'down') {
        setFeedbackComment({ msgId, text: '' });
      } else {
        setFeedbackComment(null);
      }

      // Fire-and-forget
      fetch(`${agentUrl}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`
        },
        body: JSON.stringify({
          runId,
          score: direction === 'up' ? 1 : 0
        })
      }).catch(() => {
        // silently swallow errors
      });
    },
    [agentUrl, jwt, sessionId]
  );

  const handleFeedbackComment = useCallback(() => {
    if (!feedbackComment?.text.trim()) return;
    const msg = messages.find((m) => m.id === feedbackComment.msgId);
    if (!msg?.runId) return;

    // Fire-and-forget comment update
    fetch(`${agentUrl}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        runId: msg.runId,
        score: 0,
        comment: feedbackComment.text.trim()
      })
    }).catch(() => {
      // silently swallow errors
    });

    setFeedbackComment(null);
  }, [feedbackComment, messages, agentUrl, jwt]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Render agent message content — blocks if available, plain text fallback
  const renderAgentContent = (msg: Message) => {
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      return (
        <BlockRenderer blocks={msg.contentBlocks} toolCalls={msg.toolCalls} />
      );
    }
    // Fallback: plain text
    return <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>;
  };

  return (
    <>
      {/* Backdrop + Chat Panel */}
      {isOpen && (
        <>
          <div style={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div
            style={{
              ...styles.panel,
              ...(isMobile ? styles.panelMobile : {})
            }}
          >
            {/* Header */}
            <div style={styles.header}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {isMobile && (
                  <button
                    style={styles.sidebarToggle}
                    onClick={() => setSidebarOpen((prev) => !prev)}
                    title="Toggle sidebar"
                  >
                    <Menu size={20} />
                  </button>
                )}
                <span>Ghostfolio AI Assistant</span>
              </div>
              <button
                style={styles.closeButton}
                onClick={() => setIsOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            {/* Body — sidebar + chat area */}
            <div style={styles.panelBody}>
              {/* Sidebar */}
              {sidebarOpen && (
                <ChatSidebar
                  sessions={sessions}
                  currentSessionId={sessionId}
                  onSelectSession={handleSelectSession}
                  onNewChat={handleNewChat}
                  onDeleteSession={handleDeleteSession}
                />
              )}

              {/* Chat area */}
              <div style={styles.chatArea}>
                {/* Messages */}
                <div style={styles.messagesContainer}>
                  {messages.length === 0 && !isStreaming && !isLoading && (
                    <div style={styles.welcomeMessage}>
                      Hi! I can help you analyze your portfolio. Try asking:
                      <br />
                      <br />
                      &quot;How is my portfolio allocated?&quot;
                      <br />
                      &quot;What&apos;s my performance this year?&quot;
                      <br />
                      &quot;Run an X-Ray on my portfolio&quot;
                    </div>
                  )}
                  {messages.map((msg) => (
                    <React.Fragment key={msg.id}>
                      <div
                        style={
                          msg.role === 'user'
                            ? styles.messageBubbleUser
                            : styles.messageBubbleAgent
                        }
                      >
                        {msg.role === 'agent'
                          ? renderAgentContent(msg)
                          : msg.content}
                      </div>
                      {msg.role === 'agent' &&
                        msg.toolCalls &&
                        msg.toolCalls.length > 0 && (
                          <div style={styles.toolCallsContainer}>
                            {msg.toolCalls.map((tc, i) => (
                              <span
                                key={i}
                                style={{
                                  ...styles.toolCallChip,
                                  ...(tc.success
                                    ? {}
                                    : styles.toolCallChipError)
                                }}
                              >
                                {formatToolName(tc.name)}{' '}
                                {tc.success ? '\u2713' : '\u2717'}
                              </span>
                            ))}
                          </div>
                        )}
                      {msg.role === 'agent' && msg.runId && (
                        <div style={styles.feedbackRow}>
                          <button
                            style={{
                              ...styles.feedbackButton,
                              ...(msg.feedback === 'up'
                                ? styles.feedbackButtonActive
                                : {})
                            }}
                            onClick={() =>
                              handleFeedback(msg.id, 'up', msg.runId!)
                            }
                            disabled={!!msg.feedback}
                            title="Helpful"
                          >
                            <ThumbsUp size={14} />
                          </button>
                          <button
                            style={{
                              ...styles.feedbackButton,
                              ...(msg.feedback === 'down'
                                ? styles.feedbackButtonActiveDown
                                : {})
                            }}
                            onClick={() =>
                              handleFeedback(msg.id, 'down', msg.runId!)
                            }
                            disabled={!!msg.feedback}
                            title="Not helpful"
                          >
                            <ThumbsDown size={14} />
                          </button>
                        </div>
                      )}
                      {feedbackComment?.msgId === msg.id && (
                        <div style={styles.feedbackCommentRow}>
                          <input
                            style={styles.feedbackCommentInput}
                            value={feedbackComment.text}
                            onChange={(e) =>
                              setFeedbackComment({
                                ...feedbackComment,
                                text: e.target.value
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleFeedbackComment();
                              }
                            }}
                            placeholder="What went wrong? (optional)"
                            autoFocus
                          />
                          <button
                            style={styles.feedbackCommentSubmit}
                            onClick={handleFeedbackComment}
                          >
                            Send
                          </button>
                        </div>
                      )}
                    </React.Fragment>
                  ))}

                  {/* Streaming state (in progress) */}
                  {isStreaming && (
                    <>
                      {/* Pending tool indicators */}
                      {pendingTools.length > 0 && (
                        <div style={styles.toolCallsContainer}>
                          {pendingTools.map((name) => (
                            <span key={name} style={styles.toolCallChipPending}>
                              {formatToolName(name)} ...
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Completed tool chips during streaming */}
                      {streamingToolCalls.length > 0 && (
                        <div style={styles.toolCallsContainer}>
                          {streamingToolCalls.map((tc, i) => (
                            <span
                              key={i}
                              style={{
                                ...styles.toolCallChip,
                                ...(tc.success ? {} : styles.toolCallChipError)
                              }}
                            >
                              {formatToolName(tc.name)}{' '}
                              {tc.success ? '\u2713' : '\u2717'}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Typing dots while awaiting synthesis or before content arrives */}
                      {(awaitingSynthesis ||
                        (!streamingBlocks?.length && !pendingTools.length)) && (
                        <TypingDots />
                      )}
                      {/* Render blocks progressively as they arrive */}
                      {streamingBlocks && streamingBlocks.length > 0 && (
                        <div style={styles.messageBubbleAgent}>
                          <BlockRenderer
                            blocks={streamingBlocks}
                            toolCalls={streamingToolCalls}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {isLoading && !isStreaming && <TypingDots />}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div style={styles.inputContainer}>
                  <input
                    ref={inputRef}
                    style={styles.input}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your portfolio..."
                    disabled={isLoading || isStreaming}
                  />
                  {isStreaming ? (
                    <button
                      style={{
                        ...styles.sendButton,
                        backgroundColor: '#ef4444'
                      }}
                      onClick={stopStreaming}
                      title="Stop generating"
                    >
                      <Square size={14} />
                    </button>
                  ) : (
                    <button
                      style={{
                        ...styles.sendButton,
                        ...(isLoading || !inputValue.trim()
                          ? styles.sendButtonDisabled
                          : {})
                      }}
                      onClick={sendMessage}
                      disabled={isLoading || !inputValue.trim()}
                    >
                      <Send size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Floating Action Button */}
      <button
        style={styles.fab}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={(e) =>
          Object.assign(e.currentTarget.style, styles.fabHover)
        }
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.boxShadow = styles.fab.boxShadow;
        }}
        title={isOpen ? 'Close assistant' : 'Open AI assistant'}
      >
        {isOpen ? <X size={24} /> : <Bot size={24} />}
      </button>
    </>
  );
}
