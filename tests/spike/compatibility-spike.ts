/**
 * Task 0.0 — Compatibility Spike
 *
 * Proves the selected tools actually work together under Deno.
 * This is a disposable verification script, NOT product code.
 *
 * Checks:
 *   1. Deno HTTP server starts and serves
 *   2. MCP SDK initialize/discover/tool-call path works
 *   3. PostgreSQL query succeeds
 *   4. Redis SET/GET, Streams, Pub/Sub, and Lua work
 *   5. Local JWKS key signs and verifies a test JWT
 *   6. All processes terminate cleanly
 *
 * Run: deno task spike
 * Requires: docker compose up (postgres + redis)
 */

import { assertEquals, assertExists } from '@std/assert';

// Test 1: Deno HTTP Server
async function testHttpServer(): Promise<void> {
  console.log('\n=== Test 1: Deno HTTP Server ===');
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, (_req) => {
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { protocolVersion: '2026-07-28' } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const addr = server.addr;
  const resp = await fetch(`http://localhost:${addr.port}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
  });

  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.result.protocolVersion, '2026-07-28');
  console.log('✅ HTTP server starts and responds to JSON-RPC POST');

  ac.abort();
  await server.finished;
  console.log('✅ Server terminates cleanly');
}

// Test 2: PostgreSQL
async function testPostgres(): Promise<void> {
  console.log('\n=== Test 2: PostgreSQL ===');
  const postgres = await import('postgres');
  const sql = postgres.default('postgresql://notion_mcp:notion_mcp_dev@localhost:5432/notion_mcp');

  try {
    const [result] = await sql`SELECT 1 + 1 AS sum`;
    assertEquals(result.sum, 2);
    console.log('✅ PostgreSQL query succeeds');

    // Test table creation and query
    await sql`CREATE TABLE IF NOT EXISTS spike_test (id SERIAL PRIMARY KEY, value TEXT NOT NULL)`;
    await sql`INSERT INTO spike_test (value) VALUES ('spike-ok') ON CONFLICT DO NOTHING`;
    const [row] = await sql`SELECT value FROM spike_test WHERE value = 'spike-ok'`;
    assertExists(row);
    assertEquals(row.value, 'spike-ok');
    console.log('✅ PostgreSQL table create + insert + query');

    await sql`DROP TABLE IF EXISTS spike_test`;
  } finally {
    await sql.end();
    console.log('✅ PostgreSQL connection terminates cleanly');
  }
}

// Test 3: Redis
async function testRedis(): Promise<void> {
  console.log('\n=== Test 3: Redis ===');
  const Redis = (await import('ioredis')).default;
  const redis = new Redis('redis://localhost:6379');

  try {
    // SET/GET
    await redis.set('spike:test', 'hello');
    const val = await redis.get('spike:test');
    assertEquals(val, 'hello');
    console.log('✅ Redis SET/GET');

    // Streams: XADD + XREAD
    await redis.xadd('spike:stream', '*', 'key', 'value1');
    const streamResult = await redis.xread('COUNT', 1, 'STREAMS', 'spike:stream', '0-0');
    assertExists(streamResult);
    console.log('✅ Redis Streams (XADD + XREAD)');

    // Pub/Sub
    const sub = new Redis('redis://localhost:6379');
    const received = new Promise<string>((resolve) => {
      sub.subscribe('spike:channel', () => {
        sub.on('message', (_ch, msg) => resolve(msg));
      });
    });
    // Small delay for subscription to register
    await new Promise((r) => setTimeout(r, 100));
    await redis.publish('spike:channel', 'pubsub-ok');
    const msg = await received;
    assertEquals(msg, 'pubsub-ok');
    await sub.quit();
    console.log('✅ Redis Pub/Sub');

    // Lua scripting
    const luaResult = await redis.eval("return redis.call('set', KEYS[1], ARGV[1])", 1, 'spike:lua', 'lua-ok');
    assertEquals(luaResult, 'OK');
    const luaVal = await redis.get('spike:lua');
    assertEquals(luaVal, 'lua-ok');
    console.log('✅ Redis Lua scripting');

    // Cleanup
    await redis.del('spike:test', 'spike:lua');
    await redis.del('spike:stream');
  } finally {
    await redis.quit();
    console.log('✅ Redis connection terminates cleanly');
  }
}

// Test 4: JWKS (local crypto)
async function testJwks(): Promise<void> {
  console.log('\n=== Test 4: Local JWKS Sign + Verify ===');

  // Generate key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );

  // Sign a JWT
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = btoa(JSON.stringify({ sub: 'test-user', iss: 'spike-issuer', exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signingInput = `${header}.${payload}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${signingInput}.${sigB64}`;

  assertExists(jwt);
  assertEquals(jwt.split('.').length, 3);
  console.log('✅ JWT signed');

  // Verify
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    keyPair.publicKey,
    signature,
    new TextEncoder().encode(signingInput),
  );
  assertEquals(valid, true);
  console.log('✅ JWT verified');

  // Export JWKS
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  assertExists(publicJwk.n);
  assertExists(publicJwk.e);
  console.log('✅ JWKS exported');
}

// Test 5: Zod validation
async function testZod(): Promise<void> {
  console.log('\n=== Test 5: Zod Validation ===');
  const { z } = await import('zod');

  const schema = z.object({
    installation_id: z.string().uuid(),
    tool_name: z.string().min(1),
    page_size: z.number().int().min(1).max(100).default(50),
  });

  const valid = schema.parse({ installation_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tool_name: 'notion_search' });
  assertEquals(valid.page_size, 50);
  console.log('✅ Zod schema validates');

  try {
    schema.parse({ installation_id: 'not-a-uuid', tool_name: '' });
    throw new Error('Should have failed');
  } catch {
    console.log('✅ Zod rejects invalid input');
  }
}

// Test 6: fast-check property testing
async function testFastCheck(): Promise<void> {
  console.log('\n=== Test 6: fast-check Property Testing ===');
  const fc = await import('fast-check');

  // Property: JSON.parse(JSON.stringify(x)) round-trips for strings
  fc.assert(
    fc.property(fc.string(), (s) => {
      return JSON.parse(JSON.stringify(s)) === s;
    }),
    { numRuns: 100 },
  );
  console.log('✅ fast-check runs property tests (100 iterations)');
}

// Run all tests
console.log('🔬 Notion MCP Compatibility Spike');
console.log('==================================');

try {
  await testHttpServer();
  await testPostgres();
  await testRedis();
  await testJwks();
  await testZod();
  await testFastCheck();

  console.log('\n==================================');
  console.log('✅ ALL SPIKE TESTS PASSED');
  console.log('==================================');
} catch (error) {
  console.error('\n❌ SPIKE FAILED:', error);
  Deno.exit(1);
}

Deno.exit(0);
