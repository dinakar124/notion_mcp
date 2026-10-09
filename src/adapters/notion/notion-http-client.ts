import { ProviderError } from '../../domain/errors.ts';
import type { Logger } from '../../observability/logger.ts';
import {
  badResponse,
  errorFromResponse,
  networkError,
  sanitizeRequestId,
} from './notion-errors.ts';
import type { NotionRequest, NotionTransport } from './notion-transport.ts';
import type { RetryPolicy } from './retry-policy.ts';

export interface NotionHttpClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly apiVersion: string;
  readonly timeoutMs: number;
}

export interface NotionHttpClientDeps {
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly retryPolicy: RetryPolicy;
  readonly logger: Logger;
}

interface RetrySignal {
  status?: number;
  retryAfterHeader?: string | null;
}

/** Authenticated Notion HTTP client with timeouts, bounded retries and typed failures. */
export class NotionHttpClient implements NotionTransport {
  constructor(
    private readonly options: NotionHttpClientOptions,
    private readonly deps: NotionHttpClientDeps,
  ) {}

  async request(request: NotionRequest): Promise<unknown> {
    for (let attempt = 1;; attempt++) {
      let failure: ProviderError;
      let signal: RetrySignal = {};

      try {
        const response = await this.send(request);
        const text = await response.text();
        if (response.ok) return this.parseSuccess(response, text);
        failure = errorFromResponse(response, text, request.idempotent);
        signal = {
          status: response.status,
          retryAfterHeader: response.headers.get('retry-after'),
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        failure = networkError(error, request.idempotent);
      }

      const delayMs = this.deps.retryPolicy.delayBeforeRetry({
        attempt,
        idempotent: request.idempotent,
        ...signal,
      });
      if (delayMs === null) throw failure;
      this.deps.logger.warn('notion.retry', {
        attempt,
        delayMs,
        code: failure.code,
        providerRequestId: failure.requestId,
      });
      await this.deps.sleep(delayMs);
    }
  }

  private send(request: NotionRequest): Promise<Response> {
    const hasBody = request.body !== undefined;
    return this.deps.fetch(`${this.options.baseUrl}${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        'Notion-Version': this.options.apiVersion,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(this.options.timeoutMs),
      redirect: 'error',
    });
  }

  private parseSuccess(response: Response, text: string): unknown {
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw badResponse(sanitizeRequestId(response.headers.get('x-notion-request-id')), cause);
    }
  }
}
