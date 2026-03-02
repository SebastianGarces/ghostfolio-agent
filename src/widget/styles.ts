export const styles = {
  // Floating action button — bottom-left, square-rounded
  fab: {
    position: 'fixed' as const,
    bottom: '24px',
    left: '24px',
    width: '56px',
    height: '56px',
    borderRadius: '12px',
    backgroundColor: '#303030',
    color: '#ffffff',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    zIndex: 10000,
    transition: 'transform 0.2s, box-shadow 0.2s',
    fontSize: '24px'
  },
  fabHover: {
    transform: 'scale(1.05)',
    boxShadow: '0 6px 16px rgba(0,0,0,0.3)'
  },

  // Backdrop overlay behind panel
  backdrop: {
    position: 'fixed' as const,
    inset: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 10000
  },

  // Chat panel — centered, near-fullscreen
  panel: {
    position: 'fixed' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'calc(100vw - 64px)',
    height: 'calc(100vh - 64px)',
    maxWidth: '1200px',
    backgroundColor: '#1e1e1e',
    borderRadius: '16px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 10001,
    overflow: 'hidden',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },

  // Header
  header: {
    padding: '16px',
    backgroundColor: '#2a2a2a',
    color: '#ffffff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '16px',
    fontWeight: 600
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#ffffff',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Messages area
  messagesContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },

  // Message bubbles
  messageBubbleUser: {
    alignSelf: 'flex-end' as const,
    backgroundColor: '#36CFCC',
    color: '#000000',
    padding: '10px 14px',
    borderRadius: '16px 16px 4px 16px',
    maxWidth: '80%',
    fontSize: '14px',
    lineHeight: '1.4',
    wordBreak: 'break-word' as const
  },
  messageBubbleAgent: {
    alignSelf: 'flex-start' as const,
    backgroundColor: '#2a2a2a',
    color: 'rgba(255,255,255,0.9)',
    padding: '10px 14px',
    borderRadius: '16px 16px 16px 4px',
    maxWidth: '85%',
    minWidth: '320px',
    fontSize: '14px',
    lineHeight: '1.4',
    wordBreak: 'break-word' as const
  },

  // Tool call chips
  toolCallsContainer: {
    alignSelf: 'flex-start' as const,
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    marginTop: '-4px',
    paddingLeft: '4px'
  },
  toolCallChip: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '8px',
    backgroundColor: 'rgba(54, 207, 204, 0.15)',
    color: '#36CFCC',
    border: '1px solid rgba(54, 207, 204, 0.3)'
  },
  toolCallChipError: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#ef4444',
    border: '1px solid rgba(239, 68, 68, 0.3)'
  },
  toolCallChipPending: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 193, 7, 0.15)',
    color: '#ffc107',
    border: '1px solid rgba(255, 193, 7, 0.3)'
  },

  // Widget container (for tool data visualizations)
  widgetContainer: {
    alignSelf: 'flex-start' as const,
    maxWidth: '85%',
    width: '100%'
  },

  // Loading indicator
  loadingDots: {
    alignSelf: 'flex-start' as const,
    backgroundColor: '#2a2a2a',
    padding: '12px 18px',
    borderRadius: '16px',
    fontSize: '14px',
    color: 'rgba(255,255,255,0.5)'
  },
  streamingIndicator: {
    display: 'inline-block',
    width: '6px',
    height: '14px',
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginLeft: '2px',
    verticalAlign: 'text-bottom'
  },

  // Input area
  inputContainer: {
    padding: '12px 16px',
    borderTop: '1px solid #333333',
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    border: '1px solid #444444',
    borderRadius: '24px',
    fontSize: '14px',
    outline: 'none',
    fontFamily: 'inherit',
    backgroundColor: '#2a2a2a',
    color: '#ffffff'
  },
  sendButton: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#36CFCC',
    color: '#000000',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    flexShrink: 0
  },
  sendButtonDisabled: {
    backgroundColor: '#444444',
    cursor: 'not-allowed'
  },

  // Welcome message
  welcomeMessage: {
    textAlign: 'center' as const,
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px',
    padding: '20px',
    lineHeight: '1.5'
  },

  // Feedback row (thumbs up/down)
  feedbackRow: {
    alignSelf: 'flex-start' as const,
    display: 'flex',
    gap: '4px',
    marginTop: '-4px',
    paddingLeft: '4px'
  },
  feedbackButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s'
  },
  feedbackButtonActive: {
    color: '#36CFCC',
    cursor: 'default'
  },
  feedbackButtonActiveDown: {
    color: '#ef4444',
    cursor: 'default'
  },
  feedbackCommentRow: {
    alignSelf: 'flex-start' as const,
    display: 'flex',
    gap: '6px',
    paddingLeft: '4px',
    maxWidth: '85%',
    width: '100%'
  },
  feedbackCommentInput: {
    flex: 1,
    padding: '6px 10px',
    border: '1px solid #444444',
    borderRadius: '8px',
    fontSize: '12px',
    outline: 'none',
    fontFamily: 'inherit',
    backgroundColor: '#2a2a2a',
    color: '#ffffff'
  },
  feedbackCommentSubmit: {
    padding: '6px 12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#36CFCC',
    color: '#000000',
    fontSize: '12px',
    cursor: 'pointer',
    flexShrink: 0
  },

  // Panel body — two-column layout (sidebar + chat area)
  panelBody: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },

  // Chat area — main column next to sidebar
  chatArea: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minWidth: 0
  },

  // Sidebar toggle button in header (mobile)
  sidebarToggle: {
    background: 'none',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '4px',
    marginRight: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Mobile responsive overrides
  panelMobile: {
    width: 'calc(100vw - 16px)',
    height: 'calc(100vh - 16px)'
  }
};
