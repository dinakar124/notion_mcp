import { assert, assertEquals, assertRejects } from '@std/assert';
import { sanitizeRequestId } from '../../src/adapters/notion/notion-errors.ts';
import { parseRetryAfterMs, RetryPolicy } from '../../src/adapters/notion/retry-policy.ts';
import { ProviderError } from '../../src/domain/errors.ts';
import { JsonLogger } from '../../src/observability/logger.ts';
import {
  handleRequest as notionFake,
  resetState as resetNotionFake,
} from '../../test-support/notion-fake/server.ts';
import {
  buildClient,
  liveSignal,
  readRequest as read,
  ScriptedFetch,
  TOKEN,
  writeRequest as write,
} from '../support/notion-client-harness.ts';

Deno.test('client: sends auth, version and JSON headers, returns parsed body', async () => {
  const script = new ScriptedFetch([{ status: 200, body: { ok: true } }]);
  const { client } = buildClient(script.fetch);
  assertEquals(await client.request(write, liveSignal()), { ok: true });

  const { url, init } = script.calls[0]!;
  const headers = init.headers as Record<string, string>;
  assertEquals(url, 'https://api.notion.test/v1/pages');
  assertEquals(headers.Authorization, `Bearer ${TOKEN}`);
  assertEquals(headers['Notion-Version'], '2022-06-28');
  assertEquals(headers['Content-Type'], 'application/json');
  assertEquals(init.body, '{"a":1}');
  assertEquals(init.redirect, 'error');
});

Deno.test('client: 429 on a read is retried, honouring a bounded Retry-After', async () => {
  const script = new ScriptedFetch([
    { status: 429, headers: { 'retry-after': '1' } },
    { status: 200, body: { done: true } },
  ]);
  const { client, sleeps } = buildClient(script.fetch);
  assertEquals(await client.request(read, liveSignal()), { done: true });
  assertEquals(sleeps, [1000]);
  assertEquals(script.calls.length, 2);
});

Deno.test('client: 429 on a write sends exactly one POST and reports an uncertain outcome', async () => {
  const script = new ScriptedFetch([
    { status: 429, headers: { 'retry-after': '1', 'x-notion-request-id': 'req-w' } },
    { status: 200, body: { id: 'duplicate' } },
  ]);
  const { client, sleeps } = buildClient(script.fetch);
  const error = await assertRejects(() => client.request(write, liveSignal()), ProviderError);
  assertEquals(script.calls.length, 1);
  assertEquals(sleeps, []);
  assertEquals(
    [error.kind, error.outcomeUncertain, error.retryable, error.retryAfterMs, error.requestId],
    ['rate_limited', true, false, 1000, 'req-w'],
  );
});

Deno.test('client: Retry-After beyond the cap is not waited for; error carries retryAfterMs', async () => {
  const script = new ScriptedFetch([{
    status: 429,
    headers: { 'retry-after': '120', 'x-notion-request-id': 'req-1' },
  }]);
  const { client, sleeps } = buildClient(script.fetch);
  const error = await assertRejects(() => client.request(read, liveSignal()), ProviderError);
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
    const error = await assertRejects(() => client.request(read, liveSignal()), ProviderError);
    assertEquals([error.kind, error.retryable, error.outcomeUncertain], [
      'unavailable',
      true,
      false,
    ]);
    assertEquals(script.calls.length, 3);
    assertEquals(sleeps.length, 2);
    assert(sleeps.every((ms) => ms <= 2000));
  }
});

Deno.test('client: a write is sent once and uncertain unless the status proves rejection', async () => {
  const uncertain = [409, 429, 500, 502, 503, 504, 529];
  const rejected = [400, 401, 403, 404];
  for (const status of [...uncertain, ...rejected]) {
    const script = new ScriptedFetch([{ status }, { status: 200, body: {} }]);
    const { client, sleeps } = buildClient(script.fetch);
    const error = await assertRejects(() => client.request(write, liveSignal()), ProviderError);
    assertEquals(script.calls.length, 1, `status ${status}`);
    assertEquals(sleeps, [], `status ${status}`);
    assertEquals(error.outcomeUncertain, uncertain.includes(status), `status ${status}`);
    assertEquals(error.retryable && error.outcomeUncertain, false, `status ${status}`);
  }
});

Deno.test('client: network failure on a write is uncertain and not retried; on a read it is retried', async () => {
  const writeScript = new ScriptedFetch([new TypeError('connection reset')]);
  const writeError = await assertRejects(
    () => buildClient(writeScript.fetch).client.request(write, liveSignal()),
    ProviderError,
  );
  assertEquals([writeScript.calls.length, writeError.kind, writeError.outcomeUncertain], [
    1,
    'unavailable',
    true,
  ]);

  const readScript = new ScriptedFetch([new TypeError('reset'), { status: 200, body: { ok: 1 } }]);
  assertEquals(
    await buildClient(readScript.fetch).client.request(read, liveSignal()),
    { ok: 1 },
  );
});

Deno.test('client: a timeout maps to a timeout error that is uncertain for writes only', async () => {
  const timeout = () => new DOMException('timed out', 'TimeoutError');
  const writeError = await assertRejects(
    () => buildClient(new ScriptedFetch([timeout()]).fetch).client.request(write, liveSignal()),
    ProviderError,
  );
  assertEquals([writeError.kind, writeError.outcomeUncertain], ['timeout', true]);

  const readScript = new ScriptedFetch([timeout(), timeout(), timeout()]);
  const readError = await assertRejects(
    () => buildClient(readScript.fetch).client.request(read, liveSignal()),
    ProviderError,
  );
  assertEquals([readError.kind, readError.outcomeUncertain, readScript.calls.length], [
    'timeout',
    false,
    3,
  ]);
});

Deno.test('client: the configured timeout fires even when the caller never cancels', async () => {
  const hangUntilAborted: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    });
  const error = await assertRejects(
    () => buildClient(hangUntilAborted, { timeoutMs: 20 }).client.request(write, liveSignal()),
    ProviderError,
  );
  assertEquals([error.kind, error.outcomeUncertain], ['timeout', true]);
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
      () => buildClient(script.fetch).client.request(read, liveSignal()),
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
    () => buildClient(script.fetch).client.request(read, liveSignal()),
    ProviderError,
  );
  assertEquals(error.requestId, undefined);
  assertEquals(error.message.includes('leaked'), false);
  assertEquals(error.message.includes(TOKEN), false);
  assertEquals(error.message.includes('validation_error'), true);
});

Deno.test('client: a non-JSON success body is bad_response, uncertain only for a write', async () => {
  const html: typeof fetch = () =>
    Promise.resolve(
      new Response('<html>', { status: 200, headers: { 'x-notion-request-id': 'req-9' } }),
    );
  const readError = await assertRejects(
    () => buildClient(html).client.request(read, liveSignal()),
    ProviderError,
  );
  assertEquals([readError.kind, readError.requestId, readError.outcomeUncertain], [
    'bad_response',
    'req-9',
    false,
  ]);
  const writeError = await assertRejects(
    () => buildClient(html).client.request(write, liveSignal()),
    ProviderError,
  );
  assertEquals([writeError.kind, writeError.outcomeUncertain], ['bad_response', true]);
});

Deno.test('client: a signal aborted before the call sends nothing', async () => {
  for (const request of [read, write]) {
    const script = new ScriptedFetch([{ status: 200, body: {} }]);
    const error = await assertRejects(
      () => buildClient(script.fetch).client.request(request, AbortSignal.abort()),
      ProviderError,
    );
    assertEquals(script.calls.length, 0);
    assertEquals([error.kind, error.outcomeUncertain], ['cancelled', false]);
  }
});

Deno.test('client: the caller signal is combined with the timeout and reaches fetch', async () => {
  const controller = new AbortController();
  const script = new ScriptedFetch([{ status: 200, body: {} }]);
  await buildClient(script.fetch).client.request(read, controller.signal);

  const sent = script.calls[0]!.init.signal!;
  assertEquals(sent.aborted, false);
  assert(sent !== controller.signal);
  controller.abort();
  assertEquals(sent.aborted, true);
});

Deno.test('client: abort after a write was transmitted is uncertain and never retried', async () => {
  const controller = new AbortController();
  let calls = 0;
  const abortMidFlight: typeof fetch = (_input, init) => {
    calls++;
    controller.abort();
    return Promise.reject(init!.signal!.reason);
  };
  const { client, sleeps } = buildClient(abortMidFlight);
  const error = await assertRejects(() => client.request(write, controller.signal), ProviderError);
  assertEquals(calls, 1);
  assertEquals(sleeps, []);
  assertEquals([error.kind, error.outcomeUncertain, error.retryable], ['cancelled', true, false]);
});

Deno.test('client: abort during a read is not retried and is not uncertain', async () => {
  const controller = new AbortController();
  let calls = 0;
  const abortMidFlight: typeof fetch = (_input, init) => {
    calls++;
    controller.abort();
    return Promise.reject(init!.signal!.reason);
  };
  const { client, sleeps } = buildClient(abortMidFlight);
  const error = await assertRejects(() => client.request(read, controller.signal), ProviderError);
  assertEquals([calls, sleeps.length], [1, 0]);
  assertEquals([error.kind, error.outcomeUncertain], ['cancelled', false]);
});

Deno.test('client: abort while waiting to retry a read stops before the next attempt', async () => {
  const controller = new AbortController();
  const script = new ScriptedFetch([{ status: 503 }, { status: 200, body: { late: true } }]);
  const { client, sleeps } = buildClient(script.fetch, { onSleep: () => controller.abort() });
  const error = await assertRejects(() => client.request(read, controller.signal), ProviderError);
  assertEquals([script.calls.length, sleeps.length], [1, 1]);
  assertEquals(error.kind, 'cancelled');
});

Deno.test('client: retry logging never contains the token', async () => {
  const lines: string[] = [];
  const logger = new JsonLogger('debug', (line) => lines.push(line));
  const script = new ScriptedFetch([{ status: 429, headers: { 'retry-after': '1' } }, {
    status: 200,
  }]);
  await buildClient(script.fetch, { logger }).client.request(read, liveSignal());
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
    const error = await assertRejects(() => client.request(read, liveSignal()), ProviderError);
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

Deno.test('retry policy: only idempotent requests retry; a write never does, whatever the failure', () => {
  const policy = new RetryPolicy({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 500 });
  for (const status of [undefined, 429, 503, 529]) {
    assertEquals(
      policy.delayBeforeRetry({ attempt: 1, status, idempotent: true }) !== null,
      true,
      `read ${status}`,
    );
  }
  for (const status of [undefined, 409, 429, 500, 502, 503, 504, 529]) {
    assertEquals(
      policy.delayBeforeRetry({ attempt: 1, status, idempotent: false, retryAfterHeader: '0' }),
      null,
      `write ${status}`,
    );
  }
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
