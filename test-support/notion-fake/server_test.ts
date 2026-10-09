/**
 * Notion Fake — Comprehensive in-process tests
 *
 * Tests call handleRequest directly (no live server, no Docker required).
 * resetState() is called before each test for deterministic isolation.
 *
 * Covers every implemented route and error injection. All responses are
 * SYNTHETIC_FIXTURE provenance — these tests do NOT prove real Notion behavior.
 *
 * Run: deno test --allow-env test-support/notion-fake/server_test.ts
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertStringIncludes,
} from '@std/assert';
import { handleRequest, resetState } from './server.ts';

/** Build a Request targeting the fake's handler. */
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

const VERSION_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Notion-Version': '2026-03-11',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Health check ─────────────────────────────────────────────────────────────

Deno.test('GET /health returns ok', async () => {
  resetState();
  const resp = await handleRequest(req('/health'));
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.status, 'ok');
  assertEquals(body.service, 'notion-fake');
});

Deno.test('GET /health carries SYNTHETIC_FIXTURE provenance', async () => {
  resetState();
  const resp = await handleRequest(req('/health'));
  assertEquals(resp.headers.get('X-Fixture-Provenance'), 'SYNTHETIC_FIXTURE');
  assertEquals(resp.headers.get('X-Notion-Fake'), 'true');
});

// ── Admin: reset-sequence ────────────────────────────────────────────────────

Deno.test('POST /admin/reset-sequence resets counter to 0', async () => {
  resetState();
  // Advance counter
  await handleRequest(
    req('/v1/pages', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  // Reset via admin endpoint
  const resp = await handleRequest(req('/admin/reset-sequence', { method: 'POST' }));
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.reset, true);
  assertEquals(body.sequence, 0);
});

// ── Admin: clear-errors ──────────────────────────────────────────────────────

Deno.test('POST /admin/clear-errors clears injected errors', async () => {
  resetState();
  // Inject an error
  await handleRequest(
    req('/admin/inject-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 429, code: 'rate_limited', count: 100 }),
    }),
  );
  // Clear it
  const resp = await handleRequest(req('/admin/clear-errors', { method: 'POST' }));
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.cleared, true);
  // Subsequent API call should succeed
  const search = await handleRequest(
    req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals(search.status, 200);
});

// ── Admin: inject-error ──────────────────────────────────────────────────────

Deno.test('POST /admin/inject-error configures error injection', async () => {
  resetState();
  const resp = await handleRequest(
    req('/admin/inject-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 503, code: 'service_unavailable', count: 2 }),
    }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.injected, true);
  assertEquals(body.status, 503);
  assertEquals(body.code, 'service_unavailable');
  assertEquals(body.count, 2);
});

// ── OAuth token (no Notion-Version required) ─────────────────────────────────

Deno.test('/v1/oauth/token succeeds WITHOUT Notion-Version header', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: 'x' }),
    }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.access_token, 'ntn_fake_access_token_for_testing_only');
  assertEquals(body.token_type, 'bearer');
  assertEquals(body.refresh_token, 'ntn_fake_refresh_token_for_testing_only');
  assertEquals(body.bot_id, 'bot-fake-1111');
  assertEquals(body.workspace_name, 'Test Workspace');
  assertEquals(body.workspace_id, 'ws-fake-1111');
  assert(body.owner !== undefined, 'owner field must be present');
  assertStringIncludes(body.request_id, 'req-fake-');
});

Deno.test('/v1/oauth/token carries SYNTHETIC_FIXTURE provenance', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: 'x' }),
    }),
  );
  assertEquals(resp.headers.get('X-Fixture-Provenance'), 'SYNTHETIC_FIXTURE');
});

// ── Notion-Version enforcement ───────────────────────────────────────────────

Deno.test('/v1/search rejects request WITHOUT Notion-Version header', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.code, 'missing_version');
  assertEquals(body.object, 'error');
});

Deno.test('Notion-Version enforcement does not echo version in response', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals(resp.headers.get('Notion-Version'), null);
});

// ── POST /v1/search ──────────────────────────────────────────────────────────

Deno.test('POST /v1/search returns page list with deterministic shape', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.object, 'list');
  assertEquals(body.type, 'page_or_database');
  assertEquals(body.has_more, false);
  assertEquals(body.next_cursor, null);
  assertEquals(body.results.length, 1);
  assertEquals(body.results[0].object, 'page');
  assertEquals(body.results[0].id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

// ── GET /v1/pages/:id ────────────────────────────────────────────────────────

Deno.test('GET /v1/pages/:id returns canned page', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { headers: VERSION_HEADERS }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.object, 'page');
  assertEquals(body.id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assertEquals(body.archived, false);
  assertEquals(body.in_trash, false);
  assert(body.properties?.Name !== undefined, 'properties.Name must exist');
  assertEquals(body.properties.Name.type, 'title');
  assertEquals(body.parent.type, 'workspace');
});

// ── POST /v1/pages (create) ──────────────────────────────────────────────────

Deno.test('POST /v1/pages returns deterministic UUID-shaped IDs', async () => {
  resetState();
  const r1 = await handleRequest(
    req('/v1/pages', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  const p1 = await r1.json();
  const r2 = await handleRequest(
    req('/v1/pages', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  const p2 = await r2.json();

  assertMatch(p1.id, UUID_RE);
  assertMatch(p2.id, UUID_RE);
  assertNotEquals(p1.id, p2.id);
  assertEquals(p1.id, '00000000-0000-4000-8000-000000000001');
  assertEquals(p2.id, '00000000-0000-4000-8000-000000000002');
  // Created page still has page object shape
  assertEquals(p1.object, 'page');
});

Deno.test('resetState restarts deterministic sequence', async () => {
  resetState();
  const r1 = await handleRequest(
    req('/v1/pages', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals((await r1.json()).id, '00000000-0000-4000-8000-000000000001');

  resetState();
  const r2 = await handleRequest(
    req('/v1/pages', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals((await r2.json()).id, '00000000-0000-4000-8000-000000000001');
});

// ── PATCH /v1/pages/:id (archive) ────────────────────────────────────────────

Deno.test('PATCH /v1/pages/:id merges body into canned page', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {
      method: 'PATCH',
      headers: VERSION_HEADERS,
      body: JSON.stringify({ archived: true }),
    }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.object, 'page');
  assertEquals(body.archived, true);
  assertEquals(body.id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

// ── GET /v1/blocks/:id/children ──────────────────────────────────────────────

Deno.test('GET /v1/blocks/:id/children returns canned blocks', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/blocks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/children', {
      headers: VERSION_HEADERS,
    }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.object, 'list');
  assertEquals(body.type, 'block');
  assertEquals(body.has_more, false);
  assertEquals(body.results.length, 2);
  assertEquals(body.results[0].type, 'paragraph');
  assertEquals(body.results[1].type, 'heading_2');
  assertEquals(body.results[0].id, '11111111-1111-1111-1111-111111111111');
});

// ── POST /v1/data_sources/:id/query ──────────────────────────────────────────

Deno.test('POST /v1/data_sources/:id/query returns page list', async () => {
  resetState();
  const resp = await handleRequest(
    req('/v1/data_sources/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/query', {
      method: 'POST',
      headers: VERSION_HEADERS,
      body: '{}',
    }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.object, 'list');
  assertEquals(body.type, 'page_or_data_source');
  assertEquals(body.has_more, false);
  assertEquals(body.results.length, 1);
  assertEquals(body.results[0].object, 'page');
});

// ── GET /v1/users ────────────────────────────────────────────────────────────

Deno.test('GET /v1/users returns user list', async () => {
  resetState();
  const resp = await handleRequest(req('/v1/users', { headers: VERSION_HEADERS }));
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.object, 'list');
  assertEquals(body.has_more, false);
  assertEquals(body.results.length, 1);
  assertEquals(body.results[0].object, 'user');
  assertEquals(body.results[0].id, 'user-1111');
  assertEquals(body.results[0].type, 'person');
  assertEquals(body.results[0].name, 'Test User');
  assertEquals(body.results[0].person.email, 'test@example.com');
});

// ── Fallback 404 ─────────────────────────────────────────────────────────────

Deno.test('unknown path returns 404 with error object', async () => {
  resetState();
  const resp = await handleRequest(req('/v1/nonexistent', { headers: VERSION_HEADERS }));
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.object, 'error');
  assertEquals(body.code, 'object_not_found');
  assertEquals(body.status, 404);
  assertStringIncludes(body.message, 'Not found');
  assertStringIncludes(body.message, '/v1/nonexistent');
});

Deno.test('unknown non-v1 path returns 404', async () => {
  resetState();
  const resp = await handleRequest(req('/totally-unknown'));
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.object, 'error');
  assertEquals(body.code, 'object_not_found');
});

// ── Error injection: 429 rate_limited ────────────────────────────────────────

Deno.test('429 error injection: one-shot returns 429 then recovers', async () => {
  resetState();
  // Inject a single 429
  await handleRequest(
    req('/admin/inject-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 429, code: 'rate_limited', count: 1 }),
    }),
  );

  // First API call gets 429
  const r1 = await handleRequest(
    req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals(r1.status, 429);
  assertEquals(r1.headers.get('X-Fixture-Provenance'), 'SYNTHETIC_FIXTURE');
  assertEquals(r1.headers.get('X-Notion-Fake'), 'true');
  const e1 = await r1.json();
  assertEquals(e1.object, 'error');
  assertEquals(e1.code, 'rate_limited');
  assertStringIncludes(e1.message, 'rate_limited');

  // Second call succeeds (recovered)
  const r2 = await handleRequest(
    req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals(r2.status, 200);
  assertEquals((await r2.json()).object, 'list');
});

// ── Error injection: 503 service_unavailable ─────────────────────────────────

Deno.test('503 error injection: multi-shot returns N errors then recovers', async () => {
  resetState();
  await handleRequest(
    req('/admin/inject-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 503, code: 'service_unavailable', count: 3 }),
    }),
  );

  // Three consecutive 503s with provenance
  for (let i = 0; i < 3; i++) {
    const r = await handleRequest(
      req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
    );
    assertEquals(r.status, 503, `iteration ${i} should be 503`);
    assertEquals(
      r.headers.get('X-Fixture-Provenance'),
      'SYNTHETIC_FIXTURE',
      `iteration ${i} provenance`,
    );
    assertEquals(r.headers.get('X-Notion-Fake'), 'true', `iteration ${i} X-Notion-Fake`);
    const body = await r.json();
    assertEquals(body.code, 'service_unavailable');
  }

  // Fourth call recovers
  const ok = await handleRequest(
    req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals(ok.status, 200);
});

// ── Error injection: 529 service_overload ────────────────────────────────────

Deno.test('529 error injection: returns overload error then recovers', async () => {
  resetState();
  await handleRequest(
    req('/admin/inject-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 529, code: 'service_overload', count: 2 }),
    }),
  );

  // Two 529s with provenance
  for (let i = 0; i < 2; i++) {
    const r = await handleRequest(
      req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
    );
    assertEquals(r.status, 529, `iteration ${i} should be 529`);
    assertEquals(
      r.headers.get('X-Fixture-Provenance'),
      'SYNTHETIC_FIXTURE',
      `iteration ${i} provenance`,
    );
    assertEquals(r.headers.get('X-Notion-Fake'), 'true', `iteration ${i} X-Notion-Fake`);
    assertEquals((await r.json()).code, 'service_overload');
  }

  // Third call recovers
  const ok = await handleRequest(
    req('/v1/search', { method: 'POST', headers: VERSION_HEADERS, body: '{}' }),
  );
  assertEquals(ok.status, 200);
});

// ── Error injection: only fires on /v1/ paths ────────────────────────────────

Deno.test('error injection does not affect non-v1 paths', async () => {
  resetState();
  await handleRequest(
    req('/admin/inject-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 429, code: 'rate_limited', count: 10 }),
    }),
  );

  // Health check is unaffected
  const health = await handleRequest(req('/health'));
  assertEquals(health.status, 200);
  assertEquals((await health.json()).status, 'ok');

  // Admin clear is also unaffected
  const clear = await handleRequest(req('/admin/clear-errors', { method: 'POST' }));
  assertEquals(clear.status, 200);
});

// ── Error injection affects different routes ─────────────────────────────────

Deno.test('error injection fires on any /v1/ route (pages, users, blocks)', async () => {
  resetState();
  await handleRequest(
    req('/admin/inject-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 503, code: 'service_unavailable', count: 3 }),
    }),
  );

  // First error on pages
  const r1 = await handleRequest(
    req('/v1/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { headers: VERSION_HEADERS }),
  );
  assertEquals(r1.status, 503);
  await r1.json(); // consume body

  // Second error on users
  const r2 = await handleRequest(req('/v1/users', { headers: VERSION_HEADERS }));
  assertEquals(r2.status, 503);
  await r2.json(); // consume body

  // Third error on blocks
  const r3 = await handleRequest(
    req('/v1/blocks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/children', {
      headers: VERSION_HEADERS,
    }),
  );
  assertEquals(r3.status, 503);
  await r3.json(); // consume body

  // Fourth call recovers
  const ok = await handleRequest(req('/v1/users', { headers: VERSION_HEADERS }));
  assertEquals(ok.status, 200);
});

// ── SYNTHETIC_FIXTURE provenance on all routes ───────────────────────────────

Deno.test('all route responses carry SYNTHETIC_FIXTURE provenance', async () => {
  resetState();

  const routes: Array<{ path: string; method?: string; body?: string }> = [
    { path: '/health' },
    { path: '/admin/reset-sequence', method: 'POST' },
    { path: '/v1/search', method: 'POST', body: '{}' },
    { path: '/v1/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    { path: '/v1/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', method: 'PATCH', body: '{}' },
    { path: '/v1/pages', method: 'POST', body: '{}' },
    { path: '/v1/blocks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/children' },
    {
      path: '/v1/data_sources/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/query',
      method: 'POST',
      body: '{}',
    },
    { path: '/v1/users' },
  ];

  for (const route of routes) {
    const resp = await handleRequest(
      req(route.path, {
        method: route.method,
        headers: VERSION_HEADERS,
        body: route.body,
      }),
    );
    assertEquals(
      resp.headers.get('X-Fixture-Provenance'),
      'SYNTHETIC_FIXTURE',
      `Missing provenance on ${route.method ?? 'GET'} ${route.path}`,
    );
    assertEquals(
      resp.headers.get('X-Notion-Fake'),
      'true',
      `Missing X-Notion-Fake on ${route.method ?? 'GET'} ${route.path}`,
    );
    await resp.json(); // consume body to avoid leak
  }
});
