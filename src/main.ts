import { cors } from '@elysiajs/cors';
import { Elysia, t } from 'elysia';

import {
  createAndRunAgent,
  deleteSession,
  getConversationHistory
} from './server/agent';
import { submitFeedback } from './server/feedback';
import { streamAgent } from './server/stream-agent';

const PORT = Number(process.env.AGENT_PORT ?? process.env.PORT ?? 3334);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'https://localhost:4200';
const GHOSTFOLIO_API_URL =
  process.env.GHOSTFOLIO_API_URL ?? 'http://localhost:3333';

const app = new Elysia()
  .use(
    cors({
      origin: CORS_ORIGIN,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    })
  )

  // Health check
  .get('/health', async () => {
    let ghostfolioReachable = false;
    try {
      const response = await fetch(`${GHOSTFOLIO_API_URL}/api/v1/info`, {
        signal: AbortSignal.timeout(5000)
      });
      ghostfolioReachable = response.ok;
    } catch {
      ghostfolioReachable = false;
    }
    return {
      status: 'ok',
      version: '0.1.0',
      ghostfolioReachable,
      timestamp: new Date().toISOString()
    };
  })

  // Chat endpoint
  .post(
    '/api/chat',
    async ({ body, headers, set }) => {
      const { message, sessionId } = body as {
        message: string;
        sessionId?: string;
      };
      const authHeader = headers['authorization'] ?? headers['Authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }

      const jwt = authHeader.slice(7);

      try {
        const result = await createAndRunAgent(
          jwt,
          message,
          sessionId ?? crypto.randomUUID()
        );
        return result;
      } catch (error) {
        console.error('Agent error:', error);
        set.status = 500;
        return {
          error: 'Agent processing failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1 }),
        sessionId: t.Optional(t.String())
      })
    }
  )

  // Streaming chat endpoint (SSE)
  .post(
    '/api/chat/stream',
    async ({ body, headers, set }) => {
      const { message, sessionId } = body as {
        message: string;
        sessionId?: string;
      };
      const authHeader = headers['authorization'] ?? headers['Authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }

      const jwt = authHeader.slice(7);
      const sid = sessionId ?? crypto.randomUUID();

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const event of streamAgent(jwt, message, sid)) {
              const sseText = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
              controller.enqueue(encoder.encode(sseText));
            }
          } catch (error) {
            const errEvent = `event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : 'Unknown error',
              code: 'AGENT_ERROR'
            })}\n\n`;
            controller.enqueue(encoder.encode(errEvent));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        }
      });
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1 }),
        sessionId: t.Optional(t.String())
      })
    }
  )

  // Conversation history
  .get(
    '/api/history',
    async ({ headers, set, query }) => {
      const authHeader = headers['authorization'] ?? headers['Authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }

      const sessionId = query.sessionId;
      if (!sessionId) {
        return { messages: [] };
      }

      const messages = await getConversationHistory(sessionId);
      return { messages };
    },
    {
      query: t.Object({
        sessionId: t.Optional(t.String())
      })
    }
  )

  // Delete a conversation session
  .delete(
    '/api/sessions/:sessionId',
    async ({ params, headers, set }) => {
      const authHeader = headers['authorization'] ?? headers['Authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }

      try {
        await deleteSession(params.sessionId);
        return { success: true };
      } catch (error) {
        console.error('Delete session error:', error);
        set.status = 500;
        return {
          error: 'Failed to delete session',
          message: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    },
    {
      params: t.Object({
        sessionId: t.String({ minLength: 1 })
      })
    }
  )

  // User feedback (thumbs up/down → LangSmith)
  .post(
    '/api/feedback',
    async ({ body, headers, set }) => {
      const authHeader = headers['authorization'] ?? headers['Authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }

      const { runId, score, comment } = body as {
        runId: string;
        score: number;
        comment?: string;
      };

      const result = await submitFeedback({ runId, score, comment });
      if (!result.success) {
        set.status = 502;
      }
      return result;
    },
    {
      body: t.Object({
        runId: t.String({ minLength: 1 }),
        score: t.Number({ minimum: 0, maximum: 1 }),
        comment: t.Optional(t.String())
      })
    }
  )

  // Serve widget.js static file, prepending the agent origin so the widget
  // knows where to send API requests regardless of how the script is loaded.
  .get('/widget.js', async ({ request, set }) => {
    try {
      const file = Bun.file(
        new URL('../dist/widget.js', import.meta.url).pathname
      );
      if (!(await file.exists())) {
        set.status = 404;
        return 'Widget not built. Run: bun run build-widget.ts';
      }
      const url = new URL(request.url);
      if (request.headers.get('x-forwarded-proto') === 'https') {
        url.protocol = 'https:';
      }
      const origin = url.origin;
      const js = await file.text();
      set.headers['content-type'] = 'application/javascript';
      set.headers['cache-control'] = 'public, max-age=3600';
      return `var __GHOSTFOLIO_AGENT_ORIGIN__=${JSON.stringify(origin)};\n${js}`;
    } catch {
      set.status = 500;
      return 'Error serving widget';
    }
  })

  .listen({ port: PORT, hostname: '0.0.0.0' });

console.log(`Ghostfolio AI Agent running on http://localhost:${PORT}`);
console.log(`Ghostfolio API: ${GHOSTFOLIO_API_URL}`);
console.log(`CORS origin: ${CORS_ORIGIN}`);
console.log(
  `LangSmith tracing: ${process.env.LANGCHAIN_TRACING_V2 === 'true' ? 'ENABLED' : 'DISABLED'}${process.env.LANGCHAIN_PROJECT ? ` (project: ${process.env.LANGCHAIN_PROJECT})` : ''}`
);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  app.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  app.stop();
  process.exit(0);
});

export type App = typeof app;
