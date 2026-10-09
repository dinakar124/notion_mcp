import { assertEquals } from '@std/assert';
import { createRealNotionGateway } from '../../src/adapters/notion/create-real-gateway.ts';
import { loadConfig } from '../../src/config/config.ts';
import { silentLogger } from '../../src/observability/logger.ts';
import { buildTestApp, McpTestClient } from '../support/mcp-test-client.ts';

/**
 * Drives MCP -> tools -> RealNotionGateway -> NotionHttpClient with a stubbed network,
 * so the real adapter's request building and mapping are exercised without credentials.
 */

const PAGE_ID = '77777777-7777-4777-8777-777777777777';

function notionPage(title: string) {
  return {
    object: 'page',
    id: PAGE_ID,
    created_time: '2026-10-01T00:00:00.000Z',
    last_edited_time: '2026-10-02T00:00:00.000Z',
    archived: false,
    in_trash: false,
    url: 'https://www.notion.so/Wire-77777777',
    properties: {
      title: { id: 'title', type: 'title', title: [{ plain_text: title, type: 'text' }] },
    },
    created_by: { object: 'user', id: 'internal-user-id' },
  };
}

function wiredClient(handler: (url: URL, init: RequestInit) => Response) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const config = loadConfig({
    get: (name) => ({ NOTION_MODE: 'real', NOTION_TOKEN: 'secret_wire_test_token' })[name],
  });
  if (config.notion.mode !== 'real') throw new Error('expected real config');
  const gateway = createRealNotionGateway(config.notion, silentLogger, {
    fetch: (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, init: init ?? {} });
      return Promise.resolve(handler(url, init ?? {}));
    },
    sleep: () => Promise.resolve(),
  });
  return { client: new McpTestClient(buildTestApp(gateway, config).httpApp.handle), requests };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

Deno.test('real adapter wire: search maps provider results and hides provider internals', async () => {
  const { client, requests } = wiredClient(() =>
    json({ object: 'list', results: [notionPage('Wire page')], has_more: false, next_cursor: null })
  );
  const { body } = await client.callTool('notion_search', { query: 'wire' });

  assertEquals(body.result.structuredContent.results[0].title, 'Wire page');
  assertEquals(JSON.stringify(body).includes('internal-user-id'), false);
  assertEquals(requests[0]!.url.pathname, '/v1/search');
  const sent = JSON.parse(requests[0]!.init.body as string);
  assertEquals([sent.query, sent.page_size, sent.filter], ['wire', 10, {
    property: 'object',
    value: 'page',
  }]);
});

Deno.test('real adapter wire: fetch combines page and block children', async () => {
  const { client, requests } = wiredClient((url) =>
    url.pathname.endsWith('/children')
      ? json({
        results: [{
          id: 'b1',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [{ plain_text: 'Hello' }] },
        }],
        has_more: false,
        next_cursor: null,
      })
      : json(notionPage('Fetched'))
  );
  const { body } = await client.callTool('notion_fetch_page', { page_id: PAGE_ID });
  assertEquals(body.result.structuredContent.page.title, 'Fetched');
  assertEquals(body.result.structuredContent.blocks[0].text, 'Hello');
  assertEquals(requests.map((r) => r.url.pathname).sort(), [
    `/v1/blocks/${PAGE_ID}/children`,
    `/v1/pages/${PAGE_ID}`,
  ]);
});

Deno.test('real adapter wire: unconfirmed create sends nothing; confirmed create posts once', async () => {
  const { client, requests } = wiredClient(() => json(notionPage('Created')));
  const args = { parent_page_id: PAGE_ID, title: 'Created', content: 'body' };

  const refused = await client.callTool('notion_create_page', args);
  assertEquals(refused.body.result.structuredContent.error.code, 'CONFIRMATION_REQUIRED');
  assertEquals(requests.length, 0);

  const created = await client.callTool('notion_create_page', { ...args, confirm: true });
  assertEquals(
    created.body.result.structuredContent.page.url,
    'https://www.notion.so/Wire-77777777',
  );
  assertEquals(requests.length, 1);
  assertEquals(requests[0]!.url.pathname, '/v1/pages');
  assertEquals(requests[0]!.init.method, 'POST');
});

Deno.test('real adapter wire: provider failure is a typed tool error with sanitized request id', async () => {
  const { client } = wiredClient(() =>
    new Response(JSON.stringify({ code: 'object_not_found', message: 'raw provider text' }), {
      status: 404,
      headers: { 'x-notion-request-id': 'req-abc-123' },
    })
  );
  const { body } = await client.callTool('notion_fetch_page', { page_id: PAGE_ID });
  const error = body.result.structuredContent.error;
  assertEquals([body.result.isError, error.code, error.providerRequestId], [
    true,
    'PROVIDER_NOT_FOUND',
    'req-abc-123',
  ]);
  assertEquals(JSON.stringify(body).includes('raw provider text'), false);
});

Deno.test('real adapter wire: write that hits 503 reports uncertain outcome and is not retried', async () => {
  const { client, requests } = wiredClient(() => json({ code: 'service_unavailable' }, 503));
  const { body } = await client.callTool('notion_create_page', {
    parent_page_id: PAGE_ID,
    title: 'T',
    confirm: true,
  });
  assertEquals(requests.length, 1);
  assertEquals(body.result.structuredContent.error.outcomeUncertain, true);
  assertEquals(body.result.structuredContent.error.retryable, false);
});

Deno.test('real adapter wire: write that hits 429 is posted once and reported as uncertain', async () => {
  const { client, requests } = wiredClient(() =>
    new Response(JSON.stringify({ code: 'rate_limited' }), {
      status: 429,
      headers: { 'retry-after': '1' },
    })
  );
  const { body } = await client.callTool('notion_create_page', {
    parent_page_id: PAGE_ID,
    title: 'T',
    confirm: true,
  });
  const error = body.result.structuredContent.error;
  assertEquals(requests.length, 1);
  assertEquals(
    [error.code, error.outcomeUncertain, error.retryable, error.retryAfterMs],
    ['PROVIDER_RATE_LIMITED', true, false, 1000],
  );
});

Deno.test('real adapter wire: a read that hits 429 is retried and succeeds', async () => {
  let calls = 0;
  const { client, requests } = wiredClient(() =>
    ++calls === 1
      ? new Response('{}', { status: 429, headers: { 'retry-after': '1' } })
      : json({ object: 'list', results: [], has_more: false, next_cursor: null })
  );
  const { body } = await client.callTool('notion_search', { query: 'x' });
  assertEquals(body.result.isError, false);
  assertEquals(requests.length, 2);
});

Deno.test('real adapter wire: a client that is already gone causes no create request', async () => {
  const { client, requests } = wiredClient(() => json(notionPage('Created')));
  const { body } = await client.callTool(
    'notion_create_page',
    { parent_page_id: PAGE_ID, title: 'T', confirm: true },
    { signal: AbortSignal.abort() },
  );
  const error = body.result.structuredContent.error;
  assertEquals(requests.length, 0);
  assertEquals([error.code, error.outcomeUncertain], ['PROVIDER_CANCELLED', false]);
});

Deno.test('real adapter wire: disconnect after the write was sent is uncertain and never retried', async () => {
  const controller = new AbortController();
  const { client, requests } = wiredClient(() => {
    controller.abort();
    throw controller.signal.reason;
  });
  const { body } = await client.callTool(
    'notion_create_page',
    { parent_page_id: PAGE_ID, title: 'T', confirm: true },
    { signal: controller.signal },
  );
  const error = body.result.structuredContent.error;
  assertEquals(requests.length, 1);
  assertEquals(
    [error.code, error.outcomeUncertain, error.retryable],
    ['PROVIDER_CANCELLED', true, false],
  );
});

Deno.test('real adapter wire: created page whose response cannot be read is an uncertain bad_response', async () => {
  const { client, requests } = wiredClient(() => json({ object: 'page' }));
  const { body } = await client.callTool('notion_create_page', {
    parent_page_id: PAGE_ID,
    title: 'T',
    confirm: true,
  });
  const error = body.result.structuredContent.error;
  assertEquals(requests.length, 1);
  assertEquals([error.code, error.outcomeUncertain], ['PROVIDER_BAD_RESPONSE', true]);
});

Deno.test('real adapter wire: a text block without rich_text fails the fetch as bad_response', async () => {
  const { client } = wiredClient((url) =>
    url.pathname.endsWith('/children')
      ? json({
        results: [{ id: 'b1', type: 'paragraph', has_children: false }],
        has_more: false,
        next_cursor: null,
      })
      : json(notionPage('Fetched'))
  );
  const { body } = await client.callTool('notion_fetch_page', { page_id: PAGE_ID });
  assertEquals(
    [body.result.isError, body.result.structuredContent.error.code],
    [true, 'PROVIDER_BAD_RESPONSE'],
  );
});
