/**
 * Local JWKS Issuer for Test JWT Issuance and Validation
 *
 * Signs JWTs with configurable claims and serves a JWKS endpoint.
 * For local development and CI testing only.
 *
 * Refactored: importing this module does NOT start a server.
 * Call createIssuer() to get an initialized handler with sign/verify.
 * The server starts only when run as main module.
 *
 * Endpoints:
 *   GET  /health                     — health check
 *   GET  /.well-known/jwks.json      — public JWKS
 *   POST /sign                       — sign a JWT with custom claims
 *   POST /verify                     — verify a JWT
 */

const KID = 'test-key-1';

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

/** The initialized issuer with handler, sign, and verify. */
export interface JwksIssuer {
  /** HTTP request handler — use directly for in-process testing. */
  handleRequest: (req: Request) => Promise<Response>;
  /** Sign a JWT with custom claims. Returns the compact JWT string. */
  signJwt: (claims: Record<string, unknown>) => Promise<string>;
  /** Verify a JWT. Returns validity, decoded payload, or error. */
  verifyJwt: (
    token: string,
  ) => Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string }>;
}

/**
 * Create an initialized JWKS issuer with non-extractable RSA keys.
 * Keys are generated fresh on each call. The returned handler is stateless
 * and safe for concurrent in-process use.
 *
 * @param issuerUrl - The issuer URL used in JWT `iss` claims (default: http://localhost:8081)
 */
export async function createIssuer(
  issuerUrl = 'http://localhost:8081',
): Promise<JwksIssuer> {
  // Generate RSA-2048 key pair — non-extractable private key
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false, // non-extractable: private key material cannot be exported
    ['sign', 'verify'],
  );

  // Export public key only for JWKS endpoint
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  async function signJwt(claims: Record<string, unknown>): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT', kid: KID };
    const now = Math.floor(Date.now() / 1000);
    const payload = { iat: now, exp: now + 3600, iss: issuerUrl, ...claims };

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

  async function verifyJwt(
    token: string,
  ): Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string }> {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, error: 'Invalid token format' };

    const headerB64 = parts[0]!;
    const payloadB64 = parts[1]!;
    const signatureB64 = parts[2]!;
    const signingInput = `${headerB64}.${payloadB64}`;

    try {
      const sigBytes = base64UrlDecode(signatureB64);
      const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        keyPair.publicKey,
        sigBytes.buffer as ArrayBuffer,
        new TextEncoder().encode(signingInput),
      );

      if (!valid) {
        return { valid: false, error: 'Signature verification failed' };
      }

      const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token expired' };
      }

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
        keys: [{ ...publicJwk, kid: KID, use: 'sig', alg: 'RS256' }],
      });
    }

    if (path === '/sign' && req.method === 'POST') {
      try {
        const claims = await req.json();
        if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
          return jsonResponse({ error: 'Invalid payload: expected JSON object' }, 400);
        }
        const token = await signJwt(claims);
        return jsonResponse({ token });
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }
    }

    if (path === '/verify' && req.method === 'POST') {
      try {
        const body = await req.json();
        if (typeof body !== 'object' || body === null || typeof body.token !== 'string') {
          return jsonResponse(
            { valid: false, error: 'Invalid payload: expected { token: string }' },
            400,
          );
        }
        const result = await verifyJwt(body.token);
        return jsonResponse(result);
      } catch {
        return jsonResponse({ valid: false, error: 'Invalid JSON body' }, 400);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }

  return { handleRequest, signJwt, verifyJwt };
}

// Only start the HTTP server when run as main module
if (import.meta.main) {
  const PORT = parseInt(Deno.env.get('PORT') ?? '8081');
  const HOST = Deno.env.get('HOST') ?? '127.0.0.1';
  const issuer = await createIssuer(`http://${HOST}:${PORT}`);
  Deno.serve({ port: PORT, hostname: HOST }, issuer.handleRequest);
  console.log(`JWKS Issuer running on http://${HOST}:${PORT}`);
}
