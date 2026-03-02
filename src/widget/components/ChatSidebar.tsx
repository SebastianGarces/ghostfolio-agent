import { MessageSquarePlus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';

import type { SessionEntry } from '../session-store';

interface ChatSidebarProps {
  sessions: SessionEntry[];
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string) => void;
}

const sidebarStyles = {
  container: {
    width: '260px',
    minWidth: '260px',
    backgroundColor: '#1a1a1a',
    borderRight: '1px solid #333',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden'
  },
  newChatButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: '12px',
    padding: '10px 14px',
    backgroundColor: '#2a2a2a',
    color: '#ffffff',
    border: '1px solid #444',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s'
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0 8px 8px'
  },
  sessionItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.8)',
    transition: 'background-color 0.15s',
    gap: '8px',
    position: 'relative' as const,
    marginBottom: '2px'
  },
  sessionItemActive: {
    backgroundColor: '#2a2a2a'
  },
  sessionTitle: {
    flex: 1,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'color 0.15s'
  },
  emptyState: {
    textAlign: 'center' as const,
    color: 'rgba(255,255,255,0.3)',
    fontSize: '13px',
    padding: '20px 12px'
  }
};

export function ChatSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession
}: ChatSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div style={sidebarStyles.container}>
      <button
        style={sidebarStyles.newChatButton}
        onClick={onNewChat}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#333')}
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = '#2a2a2a')
        }
      >
        <MessageSquarePlus size={16} />
        New chat
      </button>

      <div style={sidebarStyles.sessionList}>
        {sessions.length === 0 && (
          <div style={sidebarStyles.emptyState}>No conversations yet</div>
        )}
        {sessions.map((session) => {
          const isActive = session.sessionId === currentSessionId;
          const isHovered = session.sessionId === hoveredId;
          return (
            <div
              key={session.sessionId}
              style={{
                ...sidebarStyles.sessionItem,
                ...(isActive || isHovered
                  ? sidebarStyles.sessionItemActive
                  : {})
              }}
              onClick={() => onSelectSession(session.sessionId)}
              onMouseEnter={() => setHoveredId(session.sessionId)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <span style={sidebarStyles.sessionTitle}>
                {session.title || 'New conversation'}
              </span>
              {(isHovered || isActive) && (
                <button
                  style={sidebarStyles.deleteButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.sessionId);
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = '#ef4444')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')
                  }
                  title="Delete conversation"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
