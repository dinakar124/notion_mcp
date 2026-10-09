import { NotionHttpClient } from '../../src/adapters/notion/notion-http-client.ts';
import type { NotionRequest } from '../../src/adapters/notion/notion-transport.ts';
import { RetryPolicy } from '../../src/adapters/notion/retry-policy.ts';
import { JsonLogger, type Logger } from '../../src/observability/logger.ts';

export const TOKEN = 'secret_test_token_value_123';

export interface ScriptedReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Fetch stub that replays scripted replies (or throws) and records each request. */
export class ScriptedFetch {
  readonly calls: Array<{ url: string; init: RequestInit }> = [];
  constructor(private readonly script: Array<ScriptedReply | Error>) {}

  readonly fetch: typeof fetch = (input, init) => {
    this.calls.push({ url: String(input), init: init ?? {} });
    const next = this.script.shift();
    if (next === undefined) throw new Error('script exhausted');
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(
      new Response(next.body === undefined ? '{}' : JSON.stringify(next.body), {
        status: next.status,
        headers: next.headers,
      }),
    );
  };
}

export interface ClientOptions {
  readonly logger?: Logger;
  readonly timeoutMs?: number;
  /** Runs when the client sleeps before a retry. */
  readonly onSleep?: () => void;
}

export function quietLogger(): Logger {
  return new JsonLogger('error', () => {});
}

/** A real client with a deterministic retry policy and a recorded, instant clock. */
export function buildClient(fetchImpl: typeof fetch, options: ClientOptions = {}) {
  const sleeps: number[] = [];
  const client = new NotionHttpClient(
    {
      baseUrl: 'https://api.notion.test',
      token: TOKEN,
      apiVersion: '2022-06-28',
      timeoutMs: options.timeoutMs ?? 5000,
    },
    {
      fetch: fetchImpl,
      sleep: (ms) => {
        sleeps.push(ms);
        options.onSleep?.();
        return Promise.resolve();
      },
      retryPolicy: new RetryPolicy({
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 2000,
        random: () => 1,
      }),
      logger: options.logger ?? quietLogger(),
    },
  );
  return { client, sleeps };
}

export const readRequest: NotionRequest = {
  method: 'GET',
  path: '/v1/pages/x',
  idempotent: true,
};
export const writeRequest: NotionRequest = {
  method: 'POST',
  path: '/v1/pages',
  body: { a: 1 },
  idempotent: false,
};

/** A signal that is never aborted. */
export const liveSignal = (): AbortSignal => new AbortController().signal;
