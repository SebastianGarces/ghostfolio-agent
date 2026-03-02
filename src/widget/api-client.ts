export interface ChatResponse {
  response: string;
  toolCalls: { name: string; success: boolean }[];
  sessionId: string;
  runId?: string;
}

export interface ChatMessage {
  role: 'human' | 'ai';
  content: string;
}

export class AgentApiClient {
  private baseUrl: string;
  private jwt: string;

  constructor(jwt: string, baseUrl: string) {
    this.jwt = jwt;
    this.baseUrl = baseUrl;
  }

  async sendMessage(
    message: string,
    sessionId?: string
  ): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`
      },
      body: JSON.stringify({ message, sessionId })
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          'Session expired. Please refresh the page and log in again.'
        );
      }
      if (response.status === 429) {
        throw new Error(
          'Too many requests. Please wait a moment before trying again.'
        );
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message ?? `Server error (${response.status})`);
    }

    return response.json();
  }

  async submitFeedback(
    runId: string,
    score: number,
    comment?: string
  ): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`
      },
      body: JSON.stringify({ runId, score, comment })
    });

    return response.json();
  }

  async getHistory(sessionId: string): Promise<{ messages: ChatMessage[] }> {
    const response = await fetch(
      `${this.baseUrl}/api/history?sessionId=${encodeURIComponent(sessionId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.jwt}`
        }
      }
    );

    if (!response.ok) {
      return { messages: [] };
    }

    return response.json();
  }
}
