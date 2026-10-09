/**
 * Local JWKS Issuer for Test JWT Issuance and Validation
 *
 * Signs JWTs with configurable claims and serves a JWKS endpoint.
 * For local development and CI testing only.
 *
 * Endpoints:
 *   GET  /health                     — health check
 *   GET  /.well-known/jwks.json      — public JWKS
 *   POST /sign                       — sign a JWT with custom claims
 *   POST /verify                     — verify a JWT
 */

const PORT = parseInt(Deno.env.get('PORT') ?? '8081');
const HOST = Deno.env.get('HOST') ?? '127.0.0.1';

// Generate RSA-2048 key pair at startup
let keyPair: CryptoKeyPair;
let jwk: JsonWebKey;
const KID = 'test-key-1';

async function initKeys(): Promise<void> {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 3600, iss: `http://${HOST}:${PORT}`, ...claims };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyJwt(token: string): Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, error: 'Invalid token format' };

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  try {
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      keyPair.publicKey,
      base64UrlDecode(signatureB64),
      new TextEncoder().encode(signingInput),
    );

    if (!valid) return { valid: false, error: 'Signature verification failed' };

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) return { valid: false, error: 'Token expired' };

    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: `Verification error: ${(e as Error).message}` };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/health') {
    return jsonResponse({ status: 'ok', service: 'jwks-issuer' });
  }

  if (path === '/.well-known/jwks.json') {
    return jsonResponse({
      keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }],
    });
  }

  if (path === '/sign' && req.method === 'POST') {
    const claims = await req.json();
    const token = await signJwt(claims);
    return jsonResponse({ token });
  }

  if (path === '/verify' && req.method === 'POST') {
    const { token } = await req.json();
    const result = await verifyJwt(token);
    return jsonResponse(result);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

await initKeys();
Deno.serve({ port: PORT, hostname: HOST }, handleRequest);
console.log(`JWKS Issuer running on http://${HOST}:${PORT}`);
