import { assert, assertEquals, assertRejects } from '@std/assert';
import { NotionHttpClient } from '../../src/adapters/notion/notion-http-client.ts';
import { sanitizeRequestId } from '../../src/adapters/notion/notion-errors.ts';
import { parseRetryAfterMs, RetryPolicy } from '../../src/adapters/notion/retry-policy.ts';
import { ProviderError } from '../../src/domain/errors.ts';
import { JsonLogger, type Logger } from '../../src/observability/logger.ts';
import {
  handleRequest as notionFake,
  resetState as resetNotionFake,
} from '../../test-support/notion-fake/server.ts';

const TOKEN = 'secret_test_token_value_123';

interface ScriptedReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Fetch stub that replays scripted replies (or throws) and records each request. */
class ScriptedFetch {
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

function buildClient(fetchImpl: typeof fetch, logger: Logger = quietLogger()) {
  const sleeps: number[] = [];
  const client = new NotionHttpClient(
    { baseUrl: 'https://api.notion.test', token: TOKEN, apiVersion: '2022-06-28', timeoutMs: 5000 },
    {
      fetch: fetchImpl,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      retryPolicy: new RetryPolicy({
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 2000,
        random: () => 1,
      }),
      logger,
    },
  );
  return { client, sleeps };
}

function quietLogger(): Logger {
  return new JsonLogger('error', () => {});
}

const read = { method: 'GET', path: '/v1/pages/x', idempotent: true } as const;
const write = { method: 'POST', path: '/v1/pages', body: { a: 1 }, idempotent: false } as const;

Deno.test('client: sends auth, version and JSON headers, returns parsed body', async () => {
  const script = new ScriptedFetch([{ status: 200, body: { ok: true } }]);
  const { client } = buildClient(script.fetch);
  assertEquals(await client.request(write), { ok: true });

  const { url, init } = script.calls[0]!;
  const headers = init.headers as Record<string, string>;
  assertEquals(url, 'https://api.notion.test/v1/pages');
  assertEquals(headers.Authorization, `Bearer ${TOKEN}`);
  assertEquals(headers['Notion-Version'], '2022-06-28');
  assertEquals(headers['Content-Type'], 'application/json');
  assertEquals(init.body, '{"a":1}');
  assertEquals(init.redirect, 'error');
});

Deno.test('client: 429 is retried for reads and writes, honouring a bounded Retry-After', async () => {
  for (const request of [read, write]) {
    const script = new ScriptedFetch([
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 200, body: { done: true } },
    ]);
    const { client, sleeps } = buildClient(script.fetch);
    assertEquals(await client.request(request), { done: true });
    assertEquals(sleeps, [1000]);
  }
});

Deno.test('client: Retry-After beyond the cap is not waited for; error carries retryAfterMs', async () => {
  const script = new ScriptedFetch([{
    status: 429,
    headers: { 'retry-after': '120', 'x-notion-request-id': 'req-1' },
  }]);
  const { client, sleeps } = buildClient(script.fetch);
  const error = await assertRejects(() => client.request(read), ProviderError);
  assertEquals([error.kind, error.retryable, error.retryAfterMs, error.requestId], [
    'rate_limited',
    true,
    120_000,
    'req-1',
  ]);
  assertEquals(sleeps, []);
  assertEquals(script.calls.length, 1);
});

Deno.test('client: 503 and 529 are retried for idempotent reads, then give up after max attempts', async () => {
  for (const status of [503, 529]) {
    const script = new ScriptedFetch([{ status }, { status }, { status }]);
    const { client, sleeps } = buildClient(script.fetch);
    const error = await assertRejects(() => client.request(read), ProviderError);
    assertEquals([error.kind, error.retryable], ['unavailable', true]);
    assertEquals(script.calls.length, 3);
    assertEquals(sleeps.length, 2);
    assert(sleeps.every((ms) => ms <= 2000));
  }
});

Deno.test('client: 503 on a write is NOT retried and is flagged outcome-uncertain', async () => {
  const script = new ScriptedFetch([{ status: 503 }, { status: 200, body: {} }]);
  const { client } = buildClient(script.fetch);
  const error = await assertRejects(() => client.request(write), ProviderError);
  assertEquals(script.calls.length, 1);
  assertEquals([error.outcomeUncertain, error.retryable], [true, false]);
});

Deno.test('client: network failure on a write is not retried; on a read it is', async () => {
  const writeScript = new ScriptedFetch([new TypeError('connection reset')]);
  const writeError = await assertRejects(
    () => buildClient(writeScript.fetch).client.request(write),
    ProviderError,
  );
  assertEquals([writeScript.calls.length, writeError.kind, writeError.outcomeUncertain], [
    1,
    'unavailable',
    true,
  ]);

  const readScript = new ScriptedFetch([new TypeError('reset'), { status: 200, body: { ok: 1 } }]);
  assertEquals(await buildClient(readScript.fetch).client.request(read), { ok: 1 });
});

Deno.test('client: timeouts map to a timeout error', async () => {
  const timeout = new DOMException('timed out', 'TimeoutError');
  const script = new ScriptedFetch([timeout]);
  const error = await assertRejects(
    () => buildClient(script.fetch).client.request(write),
    ProviderError,
  );
  assertEquals(error.kind, 'timeout');
});

Deno.test('client: status codes map to typed kinds without retrying client errors', async () => {
  const cases: Array<[number, string]> = [
    [400, 'invalid_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
  ];
  for (const [status, kind] of cases) {
    const script = new ScriptedFetch([{
      status,
      body: { code: 'object_not_found', message: 'private detail' },
    }]);
    const error = await assertRejects(
      () => buildClient(script.fetch).client.request(read),
      ProviderError,
    );
    assertEquals(error.kind, kind);
    assertEquals(script.calls.length, 1);
  }
});

Deno.test('client: upstream messages and unsafe request ids are never copied into errors', async () => {
  const script = new ScriptedFetch([{
    status: 400,
    body: { code: 'validation_error', message: 'leaked <b>workspace</b> detail ' + TOKEN },
    headers: { 'x-notion-request-id': 'bad id; with spaces' },
  }]);
  const error = await assertRejects(
    () => buildClient(script.fetch).client.request(read),
    ProviderError,
  );
  assertEquals(error.requestId, undefined);
  assertEquals(error.message.includes('leaked'), false);
  assertEquals(error.message.includes(TOKEN), false);
  assertEquals(error.message.includes('validation_error'), true);
});

Deno.test('client: non-JSON success bodies become bad_response', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response('<html>', { status: 200, headers: { 'x-notion-request-id': 'req-9' } }),
    );
  const error = await assertRejects(
    () => buildClient(fetchImpl).client.request(read),
    ProviderError,
  );
  assertEquals([error.kind, error.requestId], ['bad_response', 'req-9']);
});

Deno.test('client: retry logging never contains the token', async () => {
  const lines: string[] = [];
  const logger = new JsonLogger('debug', (line) => lines.push(line));
  const script = new ScriptedFetch([{ status: 429, headers: { 'retry-after': '1' } }, {
    status: 200,
  }]);
  await buildClient(script.fetch, logger).client.request(read);
  assert(lines.length > 0);
  assertEquals(lines.some((line) => line.includes(TOKEN)), false);
});

Deno.test('client against the in-process Notion fake: injected 429/503/529 are classified', async () => {
  const fakeFetch: typeof fetch = (input, init) => notionFake(new Request(input, init));
  for (
    const [status, code, kind] of [[429, 'rate_limited', 'rate_limited'], [
      503,
      'service_unavailable',
      'unavailable',
    ], [529, 'overloaded', 'unavailable']] as const
  ) {
    resetNotionFake();
    await notionFake(
      new Request('http://fake/admin/inject-error', {
        method: 'POST',
        body: JSON.stringify({ status, code, count: 5 }),
      }),
    );
    const { client } = buildClient(
      (input, init) =>
        fakeFetch(String(input).replace('https://api.notion.test', 'http://fake'), init),
    );
    const error = await assertRejects(() => client.request(read), ProviderError);
    assertEquals(error.kind, kind);
  }
  resetNotionFake();
});

Deno.test('retry policy: exponential backoff is capped and jittered deterministically', () => {
  const policy = new RetryPolicy({
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs: 500,
    random: () => 0,
  });
  const delays = [1, 2, 3, 4].map((attempt) =>
    policy.delayBeforeRetry({ attempt, status: 503, idempotent: true })
  );
  assertEquals(delays, [50, 100, 200, 250]);
  assertEquals(policy.delayBeforeRetry({ attempt: 5, status: 503, idempotent: true }), null);
  assertEquals(policy.delayBeforeRetry({ attempt: 1, status: 500, idempotent: true }), null);
  assertEquals(policy.delayBeforeRetry({ attempt: 1, status: 404, idempotent: true }), null);
});

Deno.test('Retry-After parsing accepts seconds only and sanitizeRequestId accepts tokens only', () => {
  assertEquals(parseRetryAfterMs('2'), 2000);
  assertEquals(parseRetryAfterMs('0.5'), 500);
  for (const bad of [null, undefined, '', 'soon', '-1', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
    assertEquals(parseRetryAfterMs(bad), null);
  }
  assertEquals(sanitizeRequestId('0a1b-2c3d'), '0a1b-2c3d');
  assertEquals(sanitizeRequestId('a'.repeat(65)), undefined);
  assertEquals(sanitizeRequestId('x;y'), undefined);
  assertEquals(sanitizeRequestId(null), undefined);
});
