/**
 * JWKS Issuer — In-process tests
 *
 * Tests call the issuer's handler directly (no live server, no Docker required).
 * A fresh issuer is created per test for key isolation.
 *
 * Covers: health, JWKS shape, sign, verify, tampered signature rejection,
 * expired token rejection, malformed token rejection, fallback 404.
 * Never exposes private key material.
 *
 * Run: deno test --allow-env test-support/jwks-issuer/server_test.ts
 */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createIssuer } from './server.ts';

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

/** Helper to decode a base64url segment. */
function base64UrlDecode(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return binary;
}

// ── Health ────────────────────────────────────────────────────────────────────

Deno.test('GET /health returns ok', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(req('/health'));
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.status, 'ok');
  assertEquals(body.service, 'jwks-issuer');
});

// ── JWKS shape ───────────────────────────────────────────────────────────────

Deno.test('GET /.well-known/jwks.json returns valid JWKS structure', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(req('/.well-known/jwks.json'));
  assertEquals(resp.status, 200);
  assertEquals(resp.headers.get('Content-Type'), 'application/json');

  const body = await resp.json();
  assertExists(body.keys, 'JWKS must have keys array');
  assertEquals(body.keys.length, 1);

  const key = body.keys[0];
  assertEquals(key.kid, 'test-key-1');
  assertEquals(key.alg, 'RS256');
  assertEquals(key.use, 'sig');
  assertEquals(key.kty, 'RSA');
  assertExists(key.n, 'public key modulus must be present');
  assertExists(key.e, 'public key exponent must be present');
});

Deno.test('JWKS does not expose private key material', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(req('/.well-known/jwks.json'));
  const body = await resp.json();
  const key = body.keys[0];

  // RSA private key components must NOT be present
  assertEquals(key.d, undefined, 'private exponent d must not be exposed');
  assertEquals(key.p, undefined, 'prime p must not be exposed');
  assertEquals(key.q, undefined, 'prime q must not be exposed');
  assertEquals(key.dp, undefined, 'dp must not be exposed');
  assertEquals(key.dq, undefined, 'dq must not be exposed');
  assertEquals(key.qi, undefined, 'qi must not be exposed');
});

// ── Sign custom claims ───────────────────────────────────────────────────────

Deno.test('POST /sign produces a valid three-part JWT', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(
    req('/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: 'test-user', role: 'admin' }),
    }),
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertExists(body.token, 'response must contain token');

  const parts = body.token.split('.');
  assertEquals(parts.length, 3, 'JWT must have three parts');

  // Decode header
  const header = JSON.parse(base64UrlDecode(parts[0]));
  assertEquals(header.alg, 'RS256');
  assertEquals(header.typ, 'JWT');
  assertEquals(header.kid, 'test-key-1');

  // Decode payload
  const payload = JSON.parse(base64UrlDecode(parts[1]));
  assertEquals(payload.sub, 'test-user');
  assertEquals(payload.role, 'admin');
  assertExists(payload.iat, 'iat must be present');
  assertExists(payload.exp, 'exp must be present');
  assertExists(payload.iss, 'iss must be present');
  assert(payload.exp > payload.iat, 'exp must be after iat');
});

Deno.test('signJwt includes custom safe claims', async () => {
  const issuer = await createIssuer('http://test-issuer:9999');
  const token = await issuer.signJwt({ sub: 'u1', scope: 'read:pages' });
  const parts = token.split('.');
  const payload = JSON.parse(base64UrlDecode(parts[1]!));
  assertEquals(payload.sub, 'u1');
  assertEquals(payload.scope, 'read:pages');
  assertEquals(payload.iss, 'http://test-issuer:9999');
});

// ── Verify valid token ───────────────────────────────────────────────────────

Deno.test('POST /verify accepts a validly signed token', async () => {
  const issuer = await createIssuer();
  // Sign a token
  const signResp = await issuer.handleRequest(
    req('/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: 'verify-test' }),
    }),
  );
  const { token } = await signResp.json();

  // Verify it
  const verifyResp = await issuer.handleRequest(
    req('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  );
  assertEquals(verifyResp.status, 200);
  const result = await verifyResp.json();
  assertEquals(result.valid, true);
  assertExists(result.payload);
  assertEquals(result.payload.sub, 'verify-test');
});

Deno.test('verifyJwt directly accepts a valid token', async () => {
  const issuer = await createIssuer();
  const token = await issuer.signJwt({ sub: 'direct-verify' });
  const result = await issuer.verifyJwt(token);
  assertEquals(result.valid, true);
  assertEquals(result.payload?.sub, 'direct-verify');
});

// ── Reject tampered signature ────────────────────────────────────────────────

Deno.test('rejects token with tampered signature', async () => {
  const issuer = await createIssuer();
  const token = await issuer.signJwt({ sub: 'tamper-test' });

  // Tamper with the signature (flip characters)
  const parts = token.split('.');
  const tampered = parts[2]!.split('').reverse().join('');
  const badToken = `${parts[0]}.${parts[1]}.${tampered}`;

  const result = await issuer.verifyJwt(badToken);
  assertEquals(result.valid, false);
  assertExists(result.error);
});

// ── Reject expired token ─────────────────────────────────────────────────────

Deno.test('rejects expired token', async () => {
  const issuer = await createIssuer();
  // Sign with exp in the past
  const token = await issuer.signJwt({ sub: 'expired', exp: 1000000000 });
  const result = await issuer.verifyJwt(token);
  assertEquals(result.valid, false);
  assertEquals(result.error, 'Token expired');
});

// ── Reject malformed token ───────────────────────────────────────────────────

Deno.test('rejects malformed token (only two parts)', async () => {
  const issuer = await createIssuer();
  const result = await issuer.verifyJwt('header.payload');
  assertEquals(result.valid, false);
  assertEquals(result.error, 'Invalid token format');
});

Deno.test('rejects malformed token (empty string)', async () => {
  const issuer = await createIssuer();
  const result = await issuer.verifyJwt('');
  assertEquals(result.valid, false);
  assertEquals(result.error, 'Invalid token format');
});

Deno.test('rejects malformed token (garbage)', async () => {
  const issuer = await createIssuer();
  const result = await issuer.verifyJwt('a.b.c');
  assertEquals(result.valid, false);
  assertExists(result.error);
});

// ── Token signed by different issuer is rejected ─────────────────────────────

Deno.test('token signed by different issuer key is rejected', async () => {
  const issuer1 = await createIssuer();
  const issuer2 = await createIssuer();
  // Sign with issuer1, verify with issuer2 (different keys)
  const token = await issuer1.signJwt({ sub: 'cross-issuer' });
  const result = await issuer2.verifyJwt(token);
  assertEquals(result.valid, false);
  assertExists(result.error);
});

// ── Fallback 404 ─────────────────────────────────────────────────────────────

Deno.test('unknown path returns 404', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(req('/nonexistent'));
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.error, 'Not found');
});

Deno.test('GET /sign returns 404 (POST only)', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(req('/sign'));
  assertEquals(resp.status, 404);
});

Deno.test('GET /verify returns 404 (POST only)', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(req('/verify'));
  assertEquals(resp.status, 404);
});

// ── Malformed HTTP input: /verify ────────────────────────────────────────────

Deno.test('/verify with missing token field returns 400', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(
    req('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notToken: 'abc' }),
    }),
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.valid, false);
  assertExists(body.error);
});

Deno.test('/verify with numeric token returns 400', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(
    req('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 12345 }),
    }),
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.valid, false);
  assertExists(body.error);
});

Deno.test('/verify with non-JSON body returns 400', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(
    req('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    }),
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.valid, false);
  assertExists(body.error);
});

// ── Malformed HTTP input: /sign ──────────────────────────────────────────────

Deno.test('/sign with array payload returns 400', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(
    req('/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    }),
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertExists(body.error);
});

Deno.test('/sign with non-JSON body returns 400', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(
    req('/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    }),
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertExists(body.error);
});

Deno.test('/sign with null payload returns 400', async () => {
  const issuer = await createIssuer();
  const resp = await issuer.handleRequest(
    req('/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    }),
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertExists(body.error);
});
