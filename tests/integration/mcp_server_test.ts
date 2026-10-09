import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  CallToolResultSchema,
  DiscoverResultSchema,
  JSONRPCErrorResponseSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/core';
import { FakeNotionGateway } from '../../src/adapters/fake/fake-notion-gateway.ts';
import { FAKE_PARENT_PAGE_ID } from '../../src/adapters/fake/seed-pages.ts';
import { buildTestApp, fakeGateway, McpTestClient, PROTOCOL } from '../support/mcp-test-client.ts';

const ROADMAP_ID = '11111111-1111-4111-8111-111111111102';
const NEW_PAGE_ID = '22222222-2222-4222-8222-222222222201';

function newClient(gateway: FakeNotionGateway = fakeGateway()) {
  const app = buildTestApp(gateway);
  return new McpTestClient(app.httpApp.handle);
}

Deno.test('GET /health reports service status', async () => {
  const app = buildTestApp();
  const response = await app.httpApp.handle(new Request('http://127.0.0.1/health'));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: 'ok',
    service: 'notion-mcp',
    version: '0.1.0',
    protocolVersion: PROTOCOL,
    notionMode: 'fake',
  });
});

Deno.test('server/discover advertises only what is implemented', async () => {
  const { status, body } = await newClient().call('server/discover');
  assertEquals(status, 200);
  assertEquals(body.id, 1);
  assertEquals(body.result.resultType, 'complete');
  assertEquals(body.result.supportedVersions, [PROTOCOL]);
  assertEquals(body.result.capabilities, { tools: {} });
  assertEquals(body.result.cacheScope, 'public');
  assert(body.result.ttlMs > 0);
  DiscoverResultSchema.parse(body.result);
});

Deno.test('tools/list returns the three tools with schemas and annotations', async () => {
  const { status, body } = await newClient().call('tools/list');
  assertEquals(status, 200);
  ListToolsResultSchema.parse(body.result);
  assertEquals(body.result.resultType, 'complete');
  assertEquals(body.result.cacheScope, 'public');
  const tools = body.result.tools as Array<
    {
      name: string;
      inputSchema: { type: string; required?: string[] };
      annotations: { readOnlyHint: boolean };
    }
  >;
  assertEquals(tools.map((t) => t.name), [
    'notion_search',
    'notion_fetch_page',
    'notion_create_page',
  ]);
  for (const tool of tools) assertEquals(tool.inputSchema.type, 'object');
  assertEquals(tools[0]!.annotations.readOnlyHint, true);
  assertEquals(tools[2]!.annotations.readOnlyHint, false);
  assertEquals(tools[2]!.inputSchema.required, ['parent_page_id', 'title']);
});

Deno.test('tools/call notion_search returns stable results with an indexing note', async () => {
  const { status, body } = await newClient().callTool('notion_search', { query: 'roadmap' });
  assertEquals(status, 200);
  CallToolResultSchema.parse(body.result);
  assertEquals(body.result.isError, false);
  assertEquals(body.result.ttlMs, 0);
  assertEquals(body.result.cacheScope, 'private');
  const data = body.result.structuredContent;
  assertEquals(data.count, 1);
  assertEquals(data.results[0], {
    id: ROADMAP_ID,
    title: 'Engineering roadmap',
    url: 'https://www.notion.so/fake-11111111111141118111111111111102',
    lastEditedTime: '2026-09-20T15:30:00.000Z',
  });
  assertEquals(data.indexing.consistency, 'eventual');
  assertStringIncludes(data.indexing.note, 'eventually consistent');
});

Deno.test('tools/call notion_fetch_page returns page metadata and text blocks', async () => {
  const { body } = await newClient().callTool('notion_fetch_page', { page_id: ROADMAP_ID });
  CallToolResultSchema.parse(body.result);
  const data = body.result.structuredContent;
  assertEquals(data.page.title, 'Engineering roadmap');
  assertEquals(data.page.archived, false);
  assertEquals(data.blockCount, 3);
  assertEquals(data.truncated, false);
  assertEquals(data.blocks[0].type, 'heading_1');
  assertEquals(Object.keys(data.blocks[0]).sort(), ['hasChildren', 'id', 'text', 'type']);
});

Deno.test('notion_fetch_page accepts a dashless page id', async () => {
  const { body } = await newClient().callTool('notion_fetch_page', {
    page_id: ROADMAP_ID.replaceAll('-', '').toUpperCase(),
  });
  assertEquals(body.result.structuredContent.page.id, ROADMAP_ID);
});

Deno.test('notion_create_page with confirm=true creates a fetchable page with id and URL', async () => {
  const gateway = fakeGateway({
    newId: () => NEW_PAGE_ID,
    now: () => new Date('2026-10-09T12:00:00.000Z'),
  });
  const client = newClient(gateway);

  const created = await client.callTool('notion_create_page', {
    parent_page_id: FAKE_PARENT_PAGE_ID,
    title: 'Interview notes',
    content: 'First paragraph.\n\nSecond paragraph.',
    confirm: true,
  });
  assertEquals(created.status, 200);
  CallToolResultSchema.parse(created.body.result);
  assertEquals(created.body.result.isError, false);
  const page = created.body.result.structuredContent.page;
  assertEquals(page.id, NEW_PAGE_ID);
  assertEquals(page.title, 'Interview notes');
  assertStringIncludes(page.url, 'notion.so');

  const fetched = await client.callTool('notion_fetch_page', { page_id: NEW_PAGE_ID });
  const blocks = fetched.body.result.structuredContent.blocks;
  assertEquals(blocks.map((b: { text: string }) => b.text), [
    'First paragraph.',
    'Second paragraph.',
  ]);
});

Deno.test('notion_create_page without confirm fails closed and writes nothing', async () => {
  const gateway = fakeGateway({ newId: () => NEW_PAGE_ID });
  const client = newClient(gateway);

  for (const args of [{}, { confirm: false }]) {
    const { status, body } = await client.callTool('notion_create_page', {
      parent_page_id: FAKE_PARENT_PAGE_ID,
      title: 'Should not exist',
      ...args,
    });
    assertEquals(status, 200);
    assertEquals(body.result.isError, true);
    assertEquals(body.result.structuredContent.error.code, 'CONFIRMATION_REQUIRED');
  }
  const missing = await client.callTool('notion_fetch_page', { page_id: NEW_PAGE_ID });
  assertEquals(missing.body.result.structuredContent.error.code, 'PROVIDER_NOT_FOUND');
});

Deno.test('notion_create_page rejects a non-boolean confirm', async () => {
  const { status, body } = await newClient().callTool('notion_create_page', {
    parent_page_id: FAKE_PARENT_PAGE_ID,
    title: 'x',
    confirm: 'true',
  });
  assertEquals(status, 400);
  assertEquals(body.error.code, -32602);
});

Deno.test('a new page is fetchable at once but searchable only after the index lag', async () => {
  let nowMs = Date.parse('2026-10-09T12:00:00.000Z');
  const gateway = fakeGateway({
    newId: () => NEW_PAGE_ID,
    now: () => new Date(nowMs),
    searchIndexLagMs: 60_000,
  });
  const client = newClient(gateway);
  await client.callTool('notion_create_page', {
    parent_page_id: FAKE_PARENT_PAGE_ID,
    title: 'Fresh page',
    confirm: true,
  });

  const early = await client.callTool('notion_search', { query: 'Fresh page' });
  assertEquals(early.body.result.structuredContent.count, 0);
  assertEquals(early.body.result.structuredContent.indexing.consistency, 'eventual');

  nowMs += 61_000;
  const later = await client.callTool('notion_search', { query: 'Fresh page' });
  assertEquals(later.body.result.structuredContent.count, 1);
});

Deno.test('provider failures surface as typed tool errors without leaking internals', async () => {
  const { status, body } = await newClient().callTool('notion_fetch_page', {
    page_id: '99999999-9999-4999-8999-999999999999',
  });
  assertEquals(status, 200);
  CallToolResultSchema.parse(body.result);
  assertEquals(body.result.isError, true);
  assertEquals(body.result.structuredContent.error.code, 'PROVIDER_NOT_FOUND');
  assertEquals(body.result.structuredContent.error.retryable, false);
});

Deno.test('negative: unknown tool and invalid arguments are -32602 protocol errors', async () => {
  const client = newClient();
  const unknown = await client.callTool('notion_delete_everything', {});
  assertEquals([unknown.status, unknown.body.error.code], [400, -32602]);

  const invalid = await client.callTool('notion_fetch_page', { page_id: 'not-a-uuid' });
  assertEquals([invalid.status, invalid.body.error.code], [400, -32602]);
  assertStringIncludes(JSON.stringify(invalid.body.error.data), 'page_id');

  const wrongType = await client.callTool('notion_search', { query: 5 });
  assertEquals(wrongType.body.error.code, -32602);

  const tooMany = await client.callTool('notion_search', { query: 'a', limit: 1000 });
  assertEquals(tooMany.body.error.code, -32602);
});

Deno.test('negative: unknown method is -32601', async () => {
  const { status, body } = await newClient().call('resources/list');
  assertEquals([status, body.error.code], [404, -32601]);
  JSONRPCErrorResponseSchema.parse(body);
});

Deno.test('negative: wrong HTTP method and wrong paths', async () => {
  const app = buildTestApp();
  const get = await app.httpApp.handle(new Request('http://127.0.0.1/mcp'));
  assertEquals(get.status, 405);
  assertEquals(get.headers.get('Allow'), 'POST');
  await get.body?.cancel();

  const put = await app.httpApp.handle(new Request('http://127.0.0.1/mcp', { method: 'PUT' }));
  assertEquals(put.status, 405);
  await put.body?.cancel();

  const postHealth = await app.httpApp.handle(
    new Request('http://127.0.0.1/health', { method: 'POST' }),
  );
  assertEquals(postHealth.status, 405);
  await postHealth.body?.cancel();

  const client = new McpTestClient(app.httpApp.handle);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  for (const path of ['/anything', '/mcp/', '/mcp%2F', '/MCP', '/health/x']) {
    const response = await client.post(path, {}, headers);
    assertEquals(response.status, 404, path);
  }
});

Deno.test('negative: origin, content type and accept', async () => {
  const client = newClient();
  const evil = await client.call('server/discover', {}, {
    headers: { Origin: 'https://evil.example' },
  });
  assertEquals([evil.status, evil.body.error.code], [403, -32000]);

  const noOrigin = await client.call('server/discover');
  assertEquals(noOrigin.status, 200);

  for (const contentType of ['text/plain', 'application/jsonx', 'application/json-seq']) {
    const response = await client.call('server/discover', {}, {
      headers: { 'Content-Type': contentType },
    });
    assertEquals(response.status, 400, contentType);
    assertEquals(response.body.error.code, -32700);
  }
  const charset = await client.call('server/discover', {}, {
    headers: { 'Content-Type': 'Application/JSON; charset=utf-8' },
  });
  assertEquals(charset.status, 200);

  for (
    const accept of [
      'application/json',
      'text/event-stream',
      '*/*',
      'application/json;q=0, text/event-stream',
    ]
  ) {
    const response = await client.call('server/discover', {}, { headers: { Accept: accept } });
    assertEquals(response.status, 400, accept);
  }
});

Deno.test('negative: allowed origin from configuration is accepted', async () => {
  const { testConfig } = await import('../support/mcp-test-client.ts');
  const app = buildTestApp(
    fakeGateway(),
    testConfig({ MCP_ALLOWED_ORIGINS: 'http://localhost:6274' }),
  );
  const client = new McpTestClient(app.httpApp.handle);
  const ok = await client.call('server/discover', {}, {
    headers: { Origin: 'http://localhost:6274' },
  });
  assertEquals(ok.status, 200);
  const other = await client.call('server/discover', {}, {
    headers: { Origin: 'http://localhost:6275' },
  });
  assertEquals(other.status, 403);
});

Deno.test('negative: protocol version and required _meta', async () => {
  const client = newClient();

  const missingHeader = await client.call('server/discover', {}, {
    headers: { 'MCP-Protocol-Version': null },
  });
  assertEquals([missingHeader.status, missingHeader.body.error.code], [400, -32020]);

  const missingMeta = await client.call('server/discover', {}, { meta: null });
  assertEquals([missingMeta.status, missingMeta.body.error.code], [400, -32020]);

  const mismatch = await client.call('server/discover', {}, {
    headers: { 'MCP-Protocol-Version': '2025-06-18' },
  });
  assertEquals([mismatch.status, mismatch.body.error.code], [400, -32020]);

  const unsupported = await client.call('server/discover', {}, {
    headers: { 'MCP-Protocol-Version': '2025-06-18' },
    meta: {
      'io.modelcontextprotocol/protocolVersion': '2025-06-18',
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  });
  assertEquals([unsupported.status, unsupported.body.error.code], [400, -32022]);
  assertEquals(unsupported.body.error.data, { supported: [PROTOCOL] });

  const noCapabilities = await client.call('server/discover', {}, {
    meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL },
  });
  assertEquals([noCapabilities.status, noCapabilities.body.error.code], [400, -32021]);
});

Deno.test('negative: Mcp-Method and Mcp-Name headers must match the body', async () => {
  const client = newClient();

  const missingMethod = await client.call('tools/list', {}, { headers: { 'Mcp-Method': null } });
  assertEquals([missingMethod.status, missingMethod.body.error.code], [400, -32020]);

  const wrongMethod = await client.call('tools/list', {}, {
    headers: { 'Mcp-Method': 'server/discover' },
  });
  assertEquals([wrongMethod.status, wrongMethod.body.error.code], [400, -32020]);

  const params = { name: 'notion_search', arguments: { query: 'x' } };
  const missingName = await client.call('tools/call', params, { headers: { 'Mcp-Name': null } });
  assertEquals([missingName.status, missingName.body.error.code], [400, -32020]);

  const wrongName = await client.call('tools/call', params, {
    headers: { 'Mcp-Name': 'notion_fetch_page' },
  });
  assertEquals([wrongName.status, wrongName.body.error.code], [400, -32020]);

  const encoded = `=?base64?${btoa('notion_search')}?=`;
  const base64Name = await client.call('tools/call', params, { headers: { 'Mcp-Name': encoded } });
  assertEquals(base64Name.status, 200);

  const badBase64 = await client.call('tools/call', params, {
    headers: { 'Mcp-Name': '=?base64?!!!?=' },
  });
  assertEquals([badBase64.status, badBase64.body.error.code], [400, -32020]);

  const noBodyName = await client.call('tools/call', {}, {
    headers: { 'Mcp-Name': 'notion_search' },
  });
  assertEquals([noBodyName.status, noBodyName.body.error.code], [400, -32602]);
});

Deno.test('negative: malformed JSON-RPC envelopes', async () => {
  const client = newClient();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL,
    'Mcp-Method': 'server/discover',
  };

  const garbage = await client.post('/mcp', '{not json', headers);
  assertEquals([garbage.status, garbage.body.error.code], [400, -32700]);

  const batch = await client.post(
    '/mcp',
    [{ jsonrpc: '2.0', id: 1, method: 'server/discover' }],
    headers,
  );
  assertEquals([batch.status, batch.body.error.code], [400, -32600]);

  const response = await client.post('/mcp', { jsonrpc: '2.0', id: 1, result: {} }, headers);
  assertEquals([response.status, response.body.error.code], [400, -32600]);

  const wrongVersion = await client.post('/mcp', {
    jsonrpc: '1.0',
    id: 1,
    method: 'server/discover',
  }, headers);
  assertEquals([wrongVersion.status, wrongVersion.body.error.code], [400, -32600]);

  const noMethod = await client.post('/mcp', { jsonrpc: '2.0', id: 1 }, headers);
  assertEquals([noMethod.status, noMethod.body.error.code], [400, -32600]);

  const notification = await client.post('/mcp', {
    jsonrpc: '2.0',
    method: 'server/discover',
    params: {},
  }, headers);
  assertEquals([notification.status, notification.body.error.code], [400, -32601]);

  const initialize = await client.call('initialize');
  assertEquals([initialize.status, initialize.body.error.code], [404, -32601]);

  const idType = await client.call('server/discover', {}, { id: { nested: true } });
  assertEquals([idType.status, idType.body.error.code], [400, -32600]);

  const stringId = await client.call('server/discover', {}, { id: 'abc' });
  assertEquals(stringId.body.id, 'abc');
});

Deno.test('negative: oversized request bodies are rejected with 413', async () => {
  const client = newClient();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL,
    'Mcp-Method': 'server/discover',
  };
  const huge = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'server/discover',
    pad: 'x'.repeat(1_100_000),
  });
  const response = await client.post('/mcp', huge, headers);
  assertEquals(response.status, 413);
});

Deno.test('negative: Mcp-Session-Id is neither required nor honoured', async () => {
  const client = newClient();
  const withSession = await client.call('server/discover', {}, {
    headers: { 'Mcp-Session-Id': 'abc' },
  });
  assertEquals(withSession.status, 200);
});
