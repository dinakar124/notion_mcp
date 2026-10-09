import { ProviderError, requestCancelled } from '../../domain/errors.ts';
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

/**
 * Authenticated Notion HTTP client with timeouts, cancellation, bounded retries of idempotent
 * requests and typed failures. A non-idempotent request is sent at most once.
 */
export class NotionHttpClient implements NotionTransport {
  constructor(
    private readonly options: NotionHttpClientOptions,
    private readonly deps: NotionHttpClientDeps,
  ) {}

  async request(request: NotionRequest, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 1;; attempt++) {
      if (signal.aborted) throw requestCancelled(false);

      let failure: ProviderError;
      let retrySignal: RetrySignal = {};

      try {
        const response = await this.send(request, signal);
        const text = await response.text();
        if (response.ok) return this.parseSuccess(request, response, text);
        failure = errorFromResponse(response, text, request.idempotent);
        retrySignal = {
          status: response.status,
          retryAfterHeader: response.headers.get('retry-after'),
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        failure = networkError(error, request.idempotent, signal.aborted);
      }

      if (signal.aborted) throw failure;
      const delayMs = this.deps.retryPolicy.delayBeforeRetry({
        attempt,
        idempotent: request.idempotent,
        ...retrySignal,
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

  private send(request: NotionRequest, signal: AbortSignal): Promise<Response> {
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
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]),
      redirect: 'error',
    });
  }

  private parseSuccess(request: NotionRequest, response: Response, text: string): unknown {
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw badResponse(
        sanitizeRequestId(response.headers.get('x-notion-request-id')),
        cause,
        !request.idempotent,
      );
    }
  }
}
