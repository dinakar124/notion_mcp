/**
 * Stage 0 — Growth Environment Integration Test
 *
 * Proves Notion fake and JWKS issuer coexist in a single Deno process
 * without starting servers on import. Demonstrates composition: sign a
 * synthetic principal token with the JWKS issuer, then call the Notion
 * fake's search endpoint with that token as a Bearer header alongside
 * the required Notion-Version header.
 *
 * No real credentials, no provider calls, no network. All responses are
 * SYNTHETIC_FIXTURE provenance — this does NOT prove production auth.
 *
 * Run: deno test tests/integration/growth_environment_test.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import {
  handleRequest as notionHandle,
  resetState as notionReset,
} from '../../test-support/notion-fake/server.ts';
import { createIssuer } from '../../test-support/jwks-issuer/server.ts';

function req(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.headers,
    body: opts.body,
  });
}

Deno.test('both fakes import without starting servers', () => {
  // If import.meta.main guard works, we reach here without Deno.serve being called.
  // The test passing at all proves the guard works — a server start would bind
  // a port and (without --allow-net) fail the permission check.
  assertEquals(typeof notionHandle, 'function');
  assertEquals(typeof notionReset, 'function');
  assertEquals(typeof createIssuer, 'function');
});

Deno.test('JWKS issuer sign+verify round-trip in-process', async () => {
  const issuer = await createIssuer('http://test-issuer:0');
  const token = await issuer.signJwt({ sub: 'synthetic-principal', scope: 'notion:read' });
  const result = await issuer.verifyJwt(token);
  assertEquals(result.valid, true);
  assertEquals(result.payload?.sub, 'synthetic-principal');
  assertEquals(result.payload?.scope, 'notion:read');
});

Deno.test('Notion fake search returns deterministic SYNTHETIC_FIXTURE response', async () => {
  notionReset();
  const resp = await notionHandle(
    req('/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Notion-Version': '2026-03-11' },
      body: JSON.stringify({ query: 'test' }),
    }),
  );
  assertEquals(resp.status, 200);
  assertEquals(resp.headers.get('X-Fixture-Provenance'), 'SYNTHETIC_FIXTURE');
  assertEquals(resp.headers.get('X-Notion-Fake'), 'true');
  const body = await resp.json();
  assertEquals(body.object, 'list');
  assertEquals(body.results.length, 1);
  assertEquals(body.results[0].id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

Deno.test('composition: JWKS-signed token used as Bearer on Notion fake search', async () => {
  notionReset();
  const issuer = await createIssuer('http://test-issuer:0');

  // Sign a synthetic principal token
  const token = await issuer.signJwt({ sub: 'mcp-adapter', scope: 'notion:read' });
  assertExists(token);

  // Verify it independently
  const verified = await issuer.verifyJwt(token);
  assertEquals(verified.valid, true);

  // Use it as a Bearer header on the Notion fake — demonstrates the two services
  // compose in-process. The fake does not validate the token (that is the adapter's
  // job), but passing it proves the header path works without conflict.
  const resp = await notionHandle(
    req('/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Notion-Version': '2026-03-11',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: 'composed' }),
    }),
  );
  assertEquals(resp.status, 200);
  assertEquals(resp.headers.get('X-Fixture-Provenance'), 'SYNTHETIC_FIXTURE');
  const body = await resp.json();
  assertEquals(body.object, 'list');
  assertEquals(body.results[0].object, 'page');
});
