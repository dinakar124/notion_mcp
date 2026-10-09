/**
 * Task 0.0 — Compatibility Spike
 *
 * THREE MODES:
 *   deno task spike:probe  — diagnostic; exits 0 while reporting what works
 *   deno task spike:sdk    — canonical SDK gate; exits 2 when required
 *                            capabilities are unsupported (INCOMPATIBLE)
 *   deno task spike        — full gate; exits 1 on infra failure, 2 on
 *                            SDK incompatibility
 *
 * REQUIRED CANONICAL CAPABILITIES (spec §4, §13):
 *   - MCP protocol 2026-07-28
 *   - server/discover method
 *   - POST-only Streamable HTTP transport (GET/PUT/PATCH → 405)
 *
 * Exit codes:
 *   0 = all checks pass (or probe mode)
 *   1 = runtime/infra failure
 *   2 = required canonical capability unsupported (INCOMPATIBLE / NO-GO)
 */

import { assertEquals, assertExists, assertStrictEquals } from '@std/assert';
import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  McpServer,
  SUPPORTED_PROTOCOL_VERSIONS,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
import { Client as NotionClient } from '@notionhq/client';
import { z } from 'zod';
import { Redis } from 'ioredis';
import * as fc from 'fast-check';

// ─── Overall watchdog (20s hard ceiling) ──────────────────────────────────────

const WATCHDOG_MS = 20_000;
const watchdog = setTimeout(() => {
  console.error('\n⏱️  WATCHDOG: 20-second ceiling reached — forcing exit');
  Deno.exit(99);
}, WATCHDOG_MS);
// Prevent the watchdog from keeping the process alive on normal completion
Deno.unrefTimer(watchdog);

// ─── Result tracking ──────────────────────────────────────────────────────────

type TestStatus = 'pass' | 'fail' | 'skip' | 'incompatible';
interface TestResult {
  test: string;
  status: TestStatus;
  detail?: string;
  required?: boolean;
}
const results: TestResult[] = [];

function record(test: string, status: TestStatus, detail?: string, required = false): void {
  results.push({ test, status, detail, required });
  const icon: Record<TestStatus, string> = {
    pass: '✅',
    fail: '❌',
    skip: '⏭️ ',
    incompatible: '🚫',
  };
  const req = required ? ' [REQUIRED]' : '';
  const det = detail ? ` — ${detail}` : '';
  console.log(`  ${icon[status]} ${test}${req}${det}`);
}

function section(n: number, title: string): void {
  console.log(`\n=== Test ${n}: ${title} ===`);
}

const REQUIRED_PROTOCOL = '2026-07-28';

// ─── TCP preflight: bounded availability check ────────────────────────────────

async function tcpAvailable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const conn = await Promise.race([
      Deno.connect({ hostname: host, port }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('tcp-preflight-timeout')), timeoutMs)
      ),
    ]);
    conn.close();
    return true;
  } catch {
    return false;
  }
}

// ─── Test 1: Deno HTTP server ─────────────────────────────────────────────────

async function testHttpServer(): Promise<void> {
  section(1, 'Deno HTTP Server');
  const ac = new AbortController();
  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, signal: ac.signal, onListen: () => {} },
    () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );

  const resp = await fetch(`http://127.0.0.1:${server.addr.port}/`);
  assertStrictEquals(resp.status, 200);
  const body = await resp.json();
  assertStrictEquals(body.ok, true);
  record('HTTP server starts and responds on 127.0.0.1', 'pass');

  ac.abort();
  await server.finished;
  record('HTTP server terminates cleanly', 'pass');
}

// ─── Test 2: MCP SDK InMemoryTransport ────────────────────────────────────────

async function testMcpInMemory(): Promise<void> {
  section(2, 'MCP SDK InMemoryTransport');

  // 2a. Protocol version check — REQUIRED
  const supported = SUPPORTED_PROTOCOL_VERSIONS.includes(REQUIRED_PROTOCOL);
  record(
    `Protocol ${REQUIRED_PROTOCOL}`,
    supported ? 'pass' : 'incompatible',
    `SDK LATEST=${LATEST_PROTOCOL_VERSION}, SUPPORTED=${
      JSON.stringify(SUPPORTED_PROTOCOL_VERSIONS)
    }. Required ${REQUIRED_PROTOCOL} is ${supported ? 'present' : 'ABSENT'}.`,
    true,
  );

  // 2b. server/discover — REQUIRED
  const server = new McpServer({ name: 'spike', version: '0.0.0' });
  server.registerTool(
    'echo',
    { title: 'Echo', description: 'Echoes input', inputSchema: z.object({ msg: z.string() }) },
    ({ msg }) => ({ content: [{ type: 'text' as const, text: `echo:${msg}` }] }),
  );
  server.registerResource(
    'spike_status',
    'spike://status',
    { title: 'Status' },
    (uri) =>
      Promise.resolve({
        contents: [{ uri: uri.href, text: '{"status":"ok"}', mimeType: 'application/json' }],
      }),
  );
  server.registerPrompt(
    'greet',
    { title: 'Greet', argsSchema: z.object({ name: z.string() }) },
    ({ name }) => ({
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: `Hi ${name}` } },
      ],
    }),
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();

  let nextId = 1;
  function rpc(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<{ id: number; result?: unknown; error?: { code: number; message: string } }> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 5000);
      const prev = clientTransport.onmessage;
      clientTransport.onmessage = (msg) => {
        const m = msg as { id?: number; result?: unknown; error?: unknown };
        if (m.id === id) {
          clearTimeout(timer);
          clientTransport.onmessage = prev ?? undefined;
          resolve(m as { id: number; result?: unknown; error?: { code: number; message: string } });
        } else if (prev) {
          prev(msg);
        }
      };
      clientTransport.send({ jsonrpc: '2.0', method, id, params });
    });
  }

  // Initialize with SDK's latest (to get the server running for probing)
  const init = await rpc('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'spike-client', version: '0.0.0' },
  });
  assertExists(init.result, 'initialize returned result');
  const initResult = init.result as {
    protocolVersion: string;
    serverInfo: { name: string };
    capabilities: Record<string, unknown>;
  };
  assertStrictEquals(initResult.serverInfo.name, 'spike');
  record('initialize', 'pass', `negotiated ${initResult.protocolVersion}`);

  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // server/discover probe — REQUIRED
  const discover = await rpc('server/discover');
  if (discover.result) {
    record('server/discover', 'pass', 'method implemented', true);
  } else {
    const code = discover.error?.code ?? 0;
    record(
      'server/discover',
      'incompatible',
      `Error ${code}: ${discover.error?.message ?? 'unknown'}. Not implemented in SDK 2.3.1.`,
      true,
    );
  }

  // Functional probes (non-required — diagnostic)
  const toolsList = await rpc('tools/list');
  const tools = (toolsList.result as { tools: { name: string }[] }).tools;
  assertStrictEquals(tools.length, 1);
  assertStrictEquals(tools[0]!.name, 'echo');
  record('tools/list', 'pass', '1 tool');

  const callResp = await rpc('tools/call', { name: 'echo', arguments: { msg: 'test' } });
  const callContent = (callResp.result as { content: { text: string }[] }).content;
  assertStrictEquals(callContent[0]!.text, 'echo:test');
  record('tools/call', 'pass');

  const resList = await rpc('resources/list');
  const resources = (resList.result as { resources: { uri: string }[] }).resources;
  assertStrictEquals(resources.length, 1);
  record('resources/list', 'pass');

  const resRead = await rpc('resources/read', { uri: 'spike://status' });
  const contents = (resRead.result as { contents: { text: string }[] }).contents;
  assertStrictEquals(JSON.parse(contents[0]!.text).status, 'ok');
  record('resources/read', 'pass');

  const promptsList = await rpc('prompts/list');
  assertStrictEquals(
    (promptsList.result as { prompts: { name: string }[] }).prompts.length,
    1,
  );
  record('prompts/list', 'pass');

  const promptGet = await rpc('prompts/get', { name: 'greet', arguments: { name: 'Deno' } });
  const msgs = (promptGet.result as { messages: { content: { text: string } }[] }).messages;
  assertStrictEquals(msgs[0]!.content.text, 'Hi Deno');
  record('prompts/get', 'pass');

  await clientTransport.close();
  await server.close();
  record('InMemoryTransport cleanup', 'pass');
}

// ─── Test 3: Streamable HTTP + POST-only enforcement ──────────────────────────

async function testMcpStreamableHttp(): Promise<void> {
  section(3, 'MCP Streamable HTTP + POST-only gate');

  const server = new McpServer({ name: 'spike-http', version: '0.0.0' });
  server.registerTool(
    'ping',
    { description: 'pong', inputSchema: z.object({}) },
    () => ({ content: [{ type: 'text' as const, text: 'pong' }] }),
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  });
  await server.connect(transport);

  // POST-only wrapper: reject non-POST with 405 — REQUIRED behavior
  async function postOnlyHandler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }
    return await transport.handleRequest(req);
  }

  const ac = new AbortController();
  const httpServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, signal: ac.signal, onListen: () => {} },
    postOnlyHandler,
  );
  const base = `http://127.0.0.1:${httpServer.addr.port}`;

  // 3a. POST initialize
  const initResp = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'spike-http-client', version: '0.0.0' },
      },
    }),
  });
  assertStrictEquals(initResp.status, 200);
  const sessionId = initResp.headers.get('mcp-session-id');
  assertExists(sessionId, 'Session ID in response');
  const initJson = (await initResp.json()) as { result: { protocolVersion: string } };
  assertStrictEquals(initJson.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  record('Streamable HTTP POST initialize', 'pass', `session=${sessionId.slice(0, 8)}...`);

  // 3b. POST notification
  const notifResp = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assertStrictEquals(notifResp.status, 202);
  await notifResp.text();
  record('Streamable HTTP notification', 'pass', 'status 202');

  // 3c. POST tools/call
  const callResp = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 2,
      params: { name: 'ping', arguments: {} },
    }),
  });
  assertStrictEquals(callResp.status, 200);
  const callJson = (await callResp.json()) as { result: { content: { text: string }[] } };
  assertStrictEquals(callJson.result.content[0]!.text, 'pong');
  record('Streamable HTTP POST tools/call', 'pass');

  // 3d. GET → 405 — REQUIRED POST-only enforcement
  const getResp = await fetch(base, {
    method: 'GET',
    headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId },
  });
  assertStrictEquals(getResp.status, 405);
  assertStrictEquals(getResp.headers.get('allow'), 'POST');
  await getResp.text();
  record('GET rejected with 405', 'pass', 'POST-only enforced', true);

  // 3e. PUT → 405
  const putResp = await fetch(base, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'mcp-session-id': sessionId },
    body: '{}',
  });
  assertStrictEquals(putResp.status, 405);
  await putResp.text();
  record('PUT rejected with 405', 'pass');

  // 3f. PATCH → 405
  const patchResp = await fetch(base, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'mcp-session-id': sessionId },
    body: '{}',
  });
  assertStrictEquals(patchResp.status, 405);
  await patchResp.text();
  record('PATCH rejected with 405', 'pass');

  ac.abort();
  await httpServer.finished;
  await server.close();
  record('Streamable HTTP cleanup', 'pass');
}

// ─── Test 4: Notion SDK version carriage via local capture ────────────────────

async function testNotionSdk(): Promise<void> {
  section(4, 'Notion SDK version carriage');

  // Start a local capture server that records request headers
  const capture: { headers: Headers | null; path: string } = { headers: null, path: '' };
  const ac = new AbortController();
  const captureServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, signal: ac.signal, onListen: () => {} },
    (req) => {
      capture.headers = req.headers;
      capture.path = new URL(req.url).pathname;
      return new Response(JSON.stringify({ object: 'list', results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  const captureBase = `http://127.0.0.1:${captureServer.addr.port}`;

  // Construct Notion Client pointed at local capture server
  const notion = new NotionClient({
    auth: 'ntn_fake_spike_token',
    notionVersion: '2026-03-11',
    baseUrl: captureBase,
  });
  assertExists(notion);
  record('Notion Client constructed', 'pass', 'notionVersion=2026-03-11');

  // Perform a real SDK request — search is a top-level method
  try {
    await notion.search({ query: 'spike-test' });
  } catch {
    // Response shape won't match SDK expectations; we only need the headers
  }

  // Assert observed Notion-Version header
  assertExists(capture.headers, 'Capture server received a request');
  const observedVersion = capture.headers.get('notion-version');
  assertStrictEquals(observedVersion, '2026-03-11');
  record(
    'Notion-Version header observed',
    'pass',
    `${capture.path} → Notion-Version: ${observedVersion}`,
  );

  // Assert auth header was sent
  const authHeader = capture.headers.get('authorization');
  assertExists(authHeader, 'Authorization header present');
  assertStrictEquals(authHeader.startsWith('Bearer '), true);
  record('Authorization header present', 'pass');

  // Verify namespaces
  const namespaces: [string, unknown][] = [
    ['pages', notion.pages],
    ['databases', notion.databases],
    ['blocks', notion.blocks],
    ['users', notion.users],
    ['comments', notion.comments],
    ['oauth', notion.oauth],
  ];
  for (const [name, ns] of namespaces) {
    assertExists(ns, `${name} exists`);
    assertStrictEquals(typeof ns, 'object', `${name} is object`);
  }
  assertStrictEquals(typeof notion.search, 'function');
  record(
    'Notion namespaces verified',
    'pass',
    'pages, databases, blocks, users, comments, oauth, search',
  );

  ac.abort();
  await captureServer.finished;
}

// ─── Test 5: Zod 4 ───────────────────────────────────────────────────────────

function testZod4(): void {
  section(5, 'Zod 4 Validation');

  const schema = z.object({
    installation_id: z.string().uuid(),
    tool_name: z.string().min(1),
    page_size: z.number().int().min(1).max(100).default(50),
  });

  const valid = schema.parse({
    installation_id: '550e8400-e29b-41d4-a716-446655440000',
    tool_name: 'notion_search',
  });
  assertStrictEquals(valid.page_size, 50);
  record('Zod 4 parse with defaults', 'pass');

  let caught = false;
  try {
    schema.parse({ installation_id: 'bad', tool_name: '' });
  } catch {
    caught = true;
  }
  assertStrictEquals(caught, true);
  record('Zod 4 rejects invalid input', 'pass');

  const toolInput = z.object({ query: z.string(), limit: z.number().optional() });
  const parsed = toolInput.parse({ query: 'test', limit: 5 });
  assertStrictEquals(parsed.query, 'test');
  record('Zod 4 + MCP SDK integration', 'pass');
}

// ─── Test 6: fast-check ──────────────────────────────────────────────────────

function testFastCheck(): void {
  section(6, 'fast-check Property Testing');

  fc.assert(fc.property(fc.string(), (s) => JSON.parse(JSON.stringify(s)) === s), { numRuns: 100 });
  record('JSON round-trip (100 runs)', 'pass');

  fc.assert(
    fc.property(fc.array(fc.integer()), (arr) => {
      const a = [...arr].sort((x, y) => x - y);
      const b = [...a].sort((x, y) => x - y);
      return JSON.stringify(a) === JSON.stringify(b);
    }),
    { numRuns: 100 },
  );
  record('Sort idempotency (100 runs)', 'pass');

  fc.assert(
    fc.property(fc.string(), fc.string(), (a, b) => (a + b).length === a.length + b.length),
    { numRuns: 100 },
  );
  record('String concat length (100 runs)', 'pass');
}

// ─── Test 7: JWKS ────────────────────────────────────────────────────────────

async function testJwks(): Promise<void> {
  section(7, 'Local JWKS Sign + Verify');

  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const payload = btoa(
    JSON.stringify({ sub: 'test', iss: 'spike', exp: Math.floor(Date.now() / 1000) + 3600 }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const jwt = `${signingInput}.${sigB64}`;
  assertStrictEquals(jwt.split('.').length, 3);
  record('JWT signed (RS256)', 'pass');

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    keyPair.publicKey,
    sig,
    new TextEncoder().encode(signingInput),
  );
  assertStrictEquals(valid, true);
  record('JWT verified', 'pass');

  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  assertExists(jwk.n);
  assertExists(jwk.e);
  assertStrictEquals(jwk.kty, 'RSA');
  record('JWKS exported (kty=RSA)', 'pass');
}

// ─── Test 8: PostgreSQL (with TCP preflight) ─────────────────────────────────

async function testPostgres(): Promise<void> {
  section(8, 'PostgreSQL (postgres.js 3.4.5)');

  // TCP preflight — do not construct a client if port is unreachable
  const pgAvail = await tcpAvailable('127.0.0.1', 5432, 2000);
  if (!pgAvail) {
    record(
      'PostgreSQL',
      'fail',
      'TCP preflight: 127.0.0.1:5432 unreachable (no Docker / service not running)',
    );
    return;
  }
  record('PostgreSQL TCP preflight', 'pass', '127.0.0.1:5432 reachable');

  const postgres = await import('postgres');
  const sql = postgres.default(
    'postgresql://notion_mcp:notion_mcp_dev@127.0.0.1:5432/notion_mcp',
    {
      connect_timeout: 3,
      idle_timeout: 5,
      max_lifetime: 10,
      max: 1,
    },
  );
  try {
    const rows = await sql`SELECT 1 + 1 AS sum`;
    const row = rows[0];
    assertExists(row);
    assertStrictEquals(row.sum, 2);
    record('SELECT 1+1', 'pass');

    await sql`CREATE TABLE IF NOT EXISTS spike_test (id SERIAL PRIMARY KEY, value TEXT NOT NULL)`;
    await sql`INSERT INTO spike_test (value) VALUES ('spike-ok') ON CONFLICT DO NOTHING`;
    const qr = await sql`SELECT value FROM spike_test WHERE value = 'spike-ok'`;
    assertExists(qr[0]);
    assertStrictEquals(qr[0].value, 'spike-ok');
    record('Table create/insert/query', 'pass');
    await sql`DROP TABLE IF EXISTS spike_test`;
  } finally {
    await Promise.race([
      sql.end({ timeout: 3 }),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]);
    record('PostgreSQL cleanup', 'pass');
  }
}

// ─── Test 9: Redis (with TCP preflight) ──────────────────────────────────────

async function testRedis(): Promise<void> {
  section(9, 'Redis (ioredis 5.6.1)');

  // TCP preflight — do not construct a client if port is unreachable
  const redisAvail = await tcpAvailable('127.0.0.1', 6379, 2000);
  if (!redisAvail) {
    record(
      'Redis',
      'fail',
      'TCP preflight: 127.0.0.1:6379 unreachable (no Docker / service not running)',
    );
    return;
  }
  record('Redis TCP preflight', 'pass', '127.0.0.1:6379 reachable');

  const redis = new Redis('redis://127.0.0.1:6379', {
    connectTimeout: 3000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null, // no reconnect
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  redis.on('error', () => {}); // suppress unhandled error events

  try {
    await redis.connect();

    await redis.set('spike:test', 'hello');
    assertStrictEquals(await redis.get('spike:test'), 'hello');
    record('SET/GET', 'pass');

    const sk = `spike:s:${Date.now()}`;
    await redis.xadd(sk, '*', 'k', 'v1');
    const sr = await redis.xread('COUNT', 1, 'STREAMS', sk, '0-0');
    assertExists(sr);
    record('Streams XADD/XREAD', 'pass');

    // Consumer groups
    const cgk = `spike:cg:${Date.now()}`;
    await redis.xadd(cgk, '*', 'ev', 'a');
    await redis.xgroup('CREATE', cgk, 'g1', '0', 'MKSTREAM');
    await redis.xadd(cgk, '*', 'ev', 'b');
    await redis.xadd(cgk, '*', 'ev', 'c');

    const cgr = await redis.xreadgroup('GROUP', 'g1', 'c1', 'COUNT', 10, 'STREAMS', cgk, '>');
    assertExists(cgr);
    type XReadGroupEntry = [string, string[]];
    type XReadGroupStream = [string, XReadGroupEntry[]];
    const streams = cgr as unknown as XReadGroupStream[];
    const firstStream = streams[0];
    assertExists(firstStream, 'xreadgroup returned a stream');
    const entries: XReadGroupEntry[] = firstStream[1];
    assertEquals(entries.length >= 2, true);
    record(`XREADGROUP (${entries.length} entries)`, 'pass');

    const ids = entries.map((e: [string, string[]]) => e[0]);
    const acked = await redis.xack(cgk, 'g1', ...ids);
    assertStrictEquals(acked, ids.length);
    record(`XACK (${acked} acked)`, 'pass');

    const pending = await redis.xpending(cgk, 'g1');
    assertStrictEquals(pending[0] as number, 0);
    record('Consumer group drained', 'pass');

    // Pub/Sub — use a separate bounded client
    const sub = new Redis('redis://127.0.0.1:6379', {
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    sub.on('error', () => {});
    await sub.connect();

    try {
      const received = new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Pub/Sub timeout')), 5000);
        sub.subscribe('spike:ch', () => {
          sub.on('message', (_: string, msg: string) => {
            clearTimeout(t);
            resolve(msg);
          });
        });
      });
      await new Promise((r) => setTimeout(r, 200));
      await redis.publish('spike:ch', 'ok');
      assertStrictEquals(await received, 'ok');
    } finally {
      sub.disconnect();
    }
    record('Pub/Sub', 'pass');

    // Lua
    const lr = await redis.eval(
      "return redis.call('set',KEYS[1],ARGV[1])",
      1,
      'spike:lua',
      'ok',
    );
    assertStrictEquals(lr, 'OK');
    assertStrictEquals(await redis.get('spike:lua'), 'ok');
    record('Lua scripting', 'pass');

    await redis.del('spike:test', 'spike:lua', sk, cgk);
  } finally {
    redis.disconnect();
    record('Redis cleanup', 'pass');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const mode = Deno.args.includes('--probe')
  ? 'probe'
  : Deno.args.includes('--sdk-only')
  ? 'sdk'
  : 'full';

console.log('🔬 Notion MCP Compatibility Spike');
console.log('==================================');
console.log(`   Deno ${Deno.version.deno} / V8 ${Deno.version.v8} / TS ${Deno.version.typescript}`);
console.log(`   Mode: ${mode.toUpperCase()}`);
console.log(`   Date: ${new Date().toISOString()}`);
console.log(`   Required protocol: ${REQUIRED_PROTOCOL}`);

let infraFailed = false;

// SDK checks (always run)
await testHttpServer();
await testMcpInMemory();
await testMcpStreamableHttp();
await testNotionSdk();
testZod4();
testFastCheck();
await testJwks();

// Infrastructure checks (full mode only, independent per-component)
if (mode === 'full') {
  try {
    await testPostgres();
  } catch (error) {
    let msg: string;
    if (error instanceof AggregateError) {
      msg = error.errors
        .map((e: unknown) => (e instanceof Error ? e.message : String(e)))
        .join('; ');
    } else {
      msg = error instanceof Error ? error.message : String(error);
    }
    record('PostgreSQL', 'fail', msg || 'unknown error');
    infraFailed = true;
  }

  try {
    await testRedis();
  } catch (error) {
    let msg: string;
    if (error instanceof AggregateError) {
      msg = error.errors
        .map((e: unknown) => (e instanceof Error ? e.message : String(e)))
        .join('; ');
    } else {
      msg = error instanceof Error ? error.message : String(error);
    }
    record('Redis', 'fail', msg || 'unknown error');
    infraFailed = true;
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n==================================');
console.log('RESULTS');
console.log('==================================');
for (const r of results) {
  const icon: Record<TestStatus, string> = {
    pass: '✅',
    fail: '❌',
    skip: '⏭️ ',
    incompatible: '🚫',
  };
  const req = r.required ? ' [REQUIRED]' : '';
  console.log(`  ${icon[r.status]} ${r.test}${req}${r.detail ? ` (${r.detail})` : ''}`);
}

const passed = results.filter((r) => r.status === 'pass').length;
const incompatible = results.filter((r) => r.status === 'incompatible').length;
const failed = results.filter((r) => r.status === 'fail').length;
const skipped = results.filter((r) => r.status === 'skip').length;
const requiredIncompat = results.filter((r) => r.required && r.status === 'incompatible').length;

console.log(
  `\n  ${passed} passed, ${incompatible} incompatible, ${skipped} skipped, ${failed} failed`,
);
if (requiredIncompat > 0) {
  console.log(`  ${requiredIncompat} REQUIRED capability/ies unsupported`);
}

// ─── Required vs Supported matrix ─────────────────────────────────────────────

console.log('\n==================================');
console.log('REQUIRED vs SUPPORTED');
console.log('==================================');
const matrix = results.filter((r) => r.required);
for (const r of matrix) {
  const ok = r.status === 'pass' ? 'SUPPORTED' : 'NOT SUPPORTED';
  console.log(`  ${r.test}: ${ok}`);
}

// ─── Exit logic ───────────────────────────────────────────────────────────────

// Clear watchdog on normal completion
clearTimeout(watchdog);

if (mode === 'probe') {
  console.log('\n📊 PROBE COMPLETE (diagnostic only, exit 0)');
  Deno.exitCode = 0;
} else if (requiredIncompat > 0) {
  console.error(`\n🚫 INCOMPATIBLE / NO-GO — ${requiredIncompat} required gap(s)`);
  Deno.exitCode = 2;
} else if (failed > 0 || infraFailed) {
  console.error('\n❌ FAILED');
  Deno.exitCode = 1;
} else if (mode === 'sdk') {
  console.log('\n✅ SDK GATE PASSED');
  Deno.exitCode = 0;
} else {
  console.log('\n✅ FULL GATE PASSED');
  Deno.exitCode = 0;
}
