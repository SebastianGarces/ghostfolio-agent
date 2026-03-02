export interface GhostfolioClientOptions {
  timeout?: number;
  maxRetries?: number;
}

export class GhostfolioApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
    this.name = 'GhostfolioApiError';
  }
}

const ERROR_MAP: Record<number, { error: string; message: string }> = {
  401: { error: 'UNAUTHORIZED', message: 'Authentication failed' },
  403: { error: 'FORBIDDEN', message: 'Access denied' },
  404: { error: 'NOT_FOUND', message: 'Resource not found' }
};

const RETRY_BACKOFF_MS = 1000;

export class GhostfolioClient {
  private baseUrl: string;
  private jwt: string;
  private timeout: number;
  private maxRetries: number;

  constructor(
    jwt: string,
    baseUrl?: string,
    options?: GhostfolioClientOptions
  ) {
    this.jwt = jwt;
    this.baseUrl =
      baseUrl ?? process.env.GHOSTFOLIO_API_URL ?? 'http://localhost:3333';
    this.timeout = options?.timeout ?? 10000;
    this.maxRetries = options?.maxRetries ?? 1;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | boolean | undefined>
  ): Promise<T> {
    const url = this.buildUrl(path, params);

    return this.request<T>(url);
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | boolean | undefined>
  ): string {
    const url = new URL(path, this.baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async request<T>(url: string, retries = 0): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.jwt}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return (await response.json()) as T;
      }

      // Handle known client errors
      const knownError = ERROR_MAP[response.status];

      if (knownError) {
        throw new GhostfolioApiError(
          response.status,
          knownError.error,
          knownError.message
        );
      }

      // Handle 5xx server errors with retry
      if (response.status >= 500) {
        if (retries < this.maxRetries) {
          await this.sleep(RETRY_BACKOFF_MS);

          return this.request<T>(url, retries + 1);
        }

        throw new GhostfolioApiError(
          response.status,
          'SERVER_ERROR',
          'Ghostfolio server error'
        );
      }

      // Unhandled status codes
      throw new GhostfolioApiError(
        response.status,
        'SERVER_ERROR',
        `Unexpected status code: ${response.status}`
      );
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof GhostfolioApiError) {
        throw error;
      }

      // Handle abort / timeout errors
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (retries < this.maxRetries) {
          await this.sleep(RETRY_BACKOFF_MS);

          return this.request<T>(url, retries + 1);
        }

        throw new GhostfolioApiError(0, 'NETWORK_ERROR', 'Request timed out');
      }

      // Handle network errors
      if (retries < this.maxRetries) {
        await this.sleep(RETRY_BACKOFF_MS);

        return this.request<T>(url, retries + 1);
      }

      const message =
        error instanceof Error ? error.message : 'Unknown network error';

      throw new GhostfolioApiError(0, 'NETWORK_ERROR', message);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
