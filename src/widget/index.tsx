import { createRoot } from 'react-dom/client';

import { ChatWidget } from './ChatWidget';

declare const __GHOSTFOLIO_AGENT_ORIGIN__: string | undefined;

function getAgentUrl(): string {
  // Injected by the agent server when serving widget.js
  if (typeof __GHOSTFOLIO_AGENT_ORIGIN__ === 'string') {
    return __GHOSTFOLIO_AGENT_ORIGIN__;
  }
  return '';
}

function getAuthKey(): string {
  const script =
    document.currentScript ??
    document.querySelector<HTMLScriptElement>('script[src*="/widget.js"]');
  return script?.getAttribute('data-auth-key') ?? 'auth-token';
}

function getJwt(authKey: string): string | null {
  try {
    return sessionStorage.getItem(authKey) ?? localStorage.getItem(authKey);
  } catch {
    return null;
  }
}

// Cache auth key immediately while document.currentScript is available
const AUTH_KEY = getAuthKey();
let root: ReturnType<typeof createRoot> | null = null;

function unmount() {
  if (root) {
    root.unmount();
    root = null;
  }
  document.getElementById('ghostfolio-agent-widget')?.remove();
}

function refresh() {
  const jwt = getJwt(AUTH_KEY);
  if (!jwt) {
    unmount();
    return;
  }

  const agentUrl = getAgentUrl();
  if (!agentUrl) {
    return;
  }

  // Already mounted — skip
  if (root) {
    return;
  }

  const container = document.createElement('div');
  container.id = 'ghostfolio-agent-widget';
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(<ChatWidget jwt={jwt} agentUrl={agentUrl} />);
}

// Initial mount
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', refresh);
} else {
  refresh();
}

// React to login/logout from Angular
window.addEventListener('ghostfolio-auth-changed', refresh);
