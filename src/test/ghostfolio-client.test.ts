import { afterEach, describe, expect, test } from 'bun:test';

import {
  GhostfolioApiError,
  GhostfolioClient
} from '../server/ghostfolio-client';

const BASE_URL = 'http://localhost:3333';
const TEST_JWT = 'test-jwt-token-123';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GhostfolioClient', () => {
  test('successful GET request returns parsed JSON', async () => {
    const mockData = { accounts: [{ id: '1', name: 'Test' }] };

    globalThis.fetch = async () => {
      return new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);
    const result = await client.get('/api/v1/account');

    expect(result).toEqual(mockData);
  });

  test('JWT header forwarding sends Authorization: Bearer <token>', async () => {
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      capturedHeaders = new Headers(init?.headers);

      return new Response(JSON.stringify({}), { status: 200 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);
    await client.get('/api/v1/account');

    expect(capturedHeaders?.get('Authorization')).toBe(`Bearer ${TEST_JWT}`);
    expect(capturedHeaders?.get('Content-Type')).toBe('application/json');
  });

  test('query param serialization appends params to URL and omits undefined', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url: string | URL | Request) => {
      capturedUrl = url.toString();

      return new Response(JSON.stringify({}), { status: 200 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);
    await client.get('/api/v1/portfolio', {
      range: '1y',
      includeHistorical: 'true',
      unusedParam: undefined
    });

    const parsedUrl = new URL(capturedUrl);

    expect(parsedUrl.searchParams.get('range')).toBe('1y');
    expect(parsedUrl.searchParams.get('includeHistorical')).toBe('true');
    expect(parsedUrl.searchParams.has('unusedParam')).toBe(false);
  });

  test('401 response throws GhostfolioApiError with UNAUTHORIZED', async () => {
    globalThis.fetch = async () => {
      return new Response('Unauthorized', { status: 401 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);

    try {
      await client.get('/api/v1/account');
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(GhostfolioApiError);

      const apiError = error as GhostfolioApiError;

      expect(apiError.statusCode).toBe(401);
      expect(apiError.errorCode).toBe('UNAUTHORIZED');
      expect(apiError.message).toBe('Authentication failed');
    }
  });

  test('403 response throws GhostfolioApiError with FORBIDDEN', async () => {
    globalThis.fetch = async () => {
      return new Response('Forbidden', { status: 403 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);

    try {
      await client.get('/api/v1/admin');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(GhostfolioApiError);

      const apiError = error as GhostfolioApiError;

      expect(apiError.statusCode).toBe(403);
      expect(apiError.errorCode).toBe('FORBIDDEN');
      expect(apiError.message).toBe('Access denied');
    }
  });

  test('404 response throws GhostfolioApiError with NOT_FOUND', async () => {
    globalThis.fetch = async () => {
      return new Response('Not Found', { status: 404 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);

    try {
      await client.get('/api/v1/nonexistent');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(GhostfolioApiError);

      const apiError = error as GhostfolioApiError;

      expect(apiError.statusCode).toBe(404);
      expect(apiError.errorCode).toBe('NOT_FOUND');
      expect(apiError.message).toBe('Resource not found');
    }
  });

  test('500 response retries once then throws SERVER_ERROR', async () => {
    let fetchCallCount = 0;

    globalThis.fetch = async () => {
      fetchCallCount++;

      return new Response('Internal Server Error', { status: 500 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL, {
      maxRetries: 1
    });

    try {
      await client.get('/api/v1/portfolio');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(GhostfolioApiError);

      const apiError = error as GhostfolioApiError;

      expect(apiError.statusCode).toBe(500);
      expect(apiError.errorCode).toBe('SERVER_ERROR');
      expect(apiError.message).toBe('Ghostfolio server error');
      // Initial request + 1 retry = 2 calls
      expect(fetchCallCount).toBe(2);
    }
  });

  test('request timeout throws NETWORK_ERROR', async () => {
    globalThis.fetch = async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      // Wait for the abort signal to fire
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
          });
        }
      });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL, {
      timeout: 50,
      maxRetries: 0
    });

    try {
      await client.get('/api/v1/portfolio');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(GhostfolioApiError);

      const apiError = error as GhostfolioApiError;

      expect(apiError.errorCode).toBe('NETWORK_ERROR');
      expect(apiError.message).toBe('Request timed out');
    }
  });

  test('boolean query params are serialized as strings', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url: string | URL | Request) => {
      capturedUrl = url.toString();

      return new Response(JSON.stringify({}), { status: 200 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);
    await client.get('/api/v1/portfolio', {
      includeHistorical: true,
      withExcludedAccounts: false
    });

    const parsedUrl = new URL(capturedUrl);

    expect(parsedUrl.searchParams.get('includeHistorical')).toBe('true');
    expect(parsedUrl.searchParams.get('withExcludedAccounts')).toBe('false');
  });

  test('empty params object does not append query string', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url: string | URL | Request) => {
      capturedUrl = url.toString();

      return new Response(JSON.stringify({}), { status: 200 });
    };

    const client = new GhostfolioClient(TEST_JWT, BASE_URL);
    await client.get('/api/v1/account', {});

    const parsedUrl = new URL(capturedUrl);

    expect(parsedUrl.search).toBe('');
    expect(capturedUrl).toBe(`${BASE_URL}/api/v1/account`);
  });
});
