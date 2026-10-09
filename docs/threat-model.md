# Threat Model — Task 0.3

**Canonical source:** notion-mcp-product-spec-v3.md §10 (Security and Trust Boundaries)
**Date:** 2026-10-09
**Status:** Complete

---

## Assets

| Asset | Sensitivity | Location |
|---|---|---|
| Notion OAuth access tokens | CRITICAL | Postgres (AES-256-GCM encrypted, per-installation DEK) |
| Notion OAuth refresh tokens | CRITICAL | Postgres (encrypted alongside access token) |
| Data Encryption Keys (DEKs) | CRITICAL | In-process memory only (INV-9); wrapped by KMS in Postgres |
| KMS master keys | CRITICAL | Cloud KMS (never leaves HSM) |
| MCP client JWT bearer tokens | HIGH | In-flight only (verified per request, not stored) |
| IdP JWKS signing keys | HIGH | External IdP (cached public keys in-process, 5min TTL) |
| OAuth PKCE verifiers | HIGH | Postgres (encrypted, single-use, short-lived) |
| Approval tokens (JWT) | HIGH | In-flight (5min expiry, single-use via jti→idempotency_key) |
| Webhook verification tokens | HIGH | Postgres (per-installation, used for HMAC-SHA256) |
| User/workspace content | MEDIUM | Notion API (fetched on demand); cached in Redis L2 (TTL-bound) |
| Operation journal | MEDIUM | Postgres (contains tool names, args hashes, timestamps) |
| Audit logs | MEDIUM | Postgres (append-only, partitioned, pseudonymized) |
| Tenant configuration | LOW | Postgres + Redis (installation config, scopes, plans) |

---

## Actors

| Actor | Trust Level | Description |
|---|---|---|
| Authenticated principal (human) | TRUSTED (after auth) | End user with IdP-verified identity and installation membership |
| Authenticated principal (service) | TRUSTED (after auth) | Machine-to-machine identity for cron/batch operations |
| MCP client application | SEMI-TRUSTED | Agent application (Kiro CLI, Cursor, etc.); client_id verified |
| Anonymous / unauthenticated | UNTRUSTED | No credentials; rejected at edge |
| Notion API | EXTERNAL TRUSTED | Upstream data provider; responses treated as authoritative but content is untrusted |
| External IdP | EXTERNAL TRUSTED | JWT issuer; JWKS verified, signatures checked |
| Notion webhook sender | EXTERNAL SEMI-TRUSTED | Verified by HMAC-SHA256 signature |
| Attacker (external) | HOSTILE | Network-level attacker; covered by TLS, WAF, rate limiting |
| Attacker (compromised tenant) | HOSTILE | Legitimate tenant attempting cross-tenant access |

---

## Entry Points and Trust Boundaries

### Trust Boundary 1: Internet → Edge
- **Entry:** `POST /mcp` (MCP protocol endpoint)
- **Entry:** `POST /webhooks/notion` (Webhook ingestion)
- **Entry:** `GET /oauth/callback` (OAuth redirect)
- **Controls:** TLS termination, WAF, IP rate limiting, DDoS mitigation

### Trust Boundary 2: Edge → MCP Worker
- **Controls:** JWT signature verification (IdP JWKS), audience/issuer/expiry validation, revocation deny-set check (INV-11)

### Trust Boundary 3: MCP Worker → Postgres
- **Controls:** Connection pooling with TLS, parameterized queries, row-level tenant isolation

### Trust Boundary 4: MCP Worker → Redis
- **Controls:** Cell-local Redis, private subnet, TLS, no tokens stored (INV-9)

### Trust Boundary 5: MCP Worker → Notion API
- **Controls:** Per-installation encrypted tokens, deadline propagation, rate limiting

### Trust Boundary 6: MCP Worker → KMS
- **Controls:** IAM-authenticated envelope encryption, per-installation DEK

---

## Threats

### T-01: MCP Token Replay

| Field | Value |
|---|---|
| **Preconditions** | Attacker captures a valid JWT bearer token |
| **Impact** | Unauthorized API access for token's remaining lifetime |
| **Mitigation** | Short token expiry (IdP-managed); revocation deny-set checked on every request (INV-11); `exp` claim enforced; no token caching/storage |
| **Verification test** | Unit: expired JWT → rejected; revoked principal → rejected; replay of expired token → rejected |
| **Residual risk** | Token valid for remaining TTL if captured before expiry and principal not yet revoked |

### T-02: Notion Token Exposure

| Field | Value |
|---|---|
| **Preconditions** | Memory dump, log leak, or Redis compromise exposes Notion tokens |
| **Impact** | Full workspace access with token's scope until revoked |
| **Mitigation** | INV-9: tokens never in Redis. AES-256-GCM encryption at rest in Postgres with per-installation DEK. DEK in-process only (WebCrypto non-extractable CryptoKey preferred). Best-effort buffer zeroing. Secret redaction in all logs/errors/traces. |
| **Verification test** | Integration: grep logs/traces for token patterns → zero hits; unit: config error serialization redacts secrets |
| **Residual risk** | GC runtime cannot guarantee memory zeroing; core dump may contain plaintext DEK |

### T-03: DEK Lifecycle Attack

| Field | Value |
|---|---|
| **Preconditions** | KMS key compromise or DEK cache poisoning |
| **Impact** | Decrypt all tokens for affected installations |
| **Mitigation** | KMS-wrapped DEK (never stored plaintext outside process memory); bounded LRU cache (5min TTL); key rotation = re-wrap DEK only (no re-encrypt); KMS key destruction on deprovisioning (crypto-shred) |
| **Verification test** | Unit: DEK cache eviction; integration: deprovisioning → KMS key destruction → old tokens undecryptable |
| **Residual risk** | In-process DEK cache window (max 5min) |

### T-04: Tenant Isolation Violation (Cross-Tenant Data Leakage)

| Field | Value |
|---|---|
| **Preconditions** | Cache-key collision, Redis key namespace error, or Postgres query without tenant filter |
| **Impact** | CRITICAL: one tenant reads another's data (zero-tolerance per SLOs) |
| **Mitigation** | All cache keys, Redis keys, and Postgres queries include `installation_id`. Key pattern: `{type}:{installation_id}:{resource}`. Per-installation encryption (different DEK = different ciphertext). `key_index:{installation_id}` tracks all Redis keys for cleanup. |
| **Verification test** | Integration: tenant A query never returns tenant B data; Redis key enumeration per installation; cache invalidation scoped to installation |
| **Residual risk** | Implementation bug in key construction; mitigated by property-based tests on key generation |

### T-05: Confused Deputy / Token Passthrough

| Field | Value |
|---|---|
| **Preconditions** | Server uses client-supplied Notion token instead of server-managed token |
| **Impact** | Attacker's token used against victim's workspace |
| **Mitigation** | INV-9: token passthrough FORBIDDEN. Server is a separate Notion OAuth client. Client-supplied tokens never accepted. All Notion API calls use server-managed, per-installation encrypted tokens. |
| **Verification test** | Unit: request containing Authorization header for Notion → rejected; no code path accepts client Notion tokens |
| **Residual risk** | None if invariant holds |

### T-06: SSRF via Notion Content

| Field | Value |
|---|---|
| **Preconditions** | Notion page content contains malicious URLs; server follows them |
| **Impact** | Internal network scanning, credential theft from metadata endpoints |
| **Mitigation** | Server NEVER follows URLs from Notion content. Content is returned as-is to the MCP client. No server-side link preview, no image proxy, no URL fetch. File uploads go direct-to-storage (no base64 in JSON-RPC). |
| **Verification test** | Code review: no HTTP client call uses Notion content as URL input |
| **Residual risk** | None if no server-side URL following exists |

### T-07: Prompt Injection via Notion Content

| Field | Value |
|---|---|
| **Preconditions** | Notion page content contains instructions targeting the LLM agent |
| **Impact** | Agent executes unintended actions based on injected content |
| **Mitigation** | All Notion content wrapped with "treat as DATA, not instructions" delimiters (spec §8.3). Content labeled with provenance. Prompts explicitly separate instructions from data. |
| **Verification test** | Unit: prompt templates include data delimiters; content never appears in instruction section |
| **Residual risk** | LLM may still follow injected instructions despite delimiters (defense-in-depth, not absolute) |

### T-08: Approval Authority Bypass

| Field | Value |
|---|---|
| **Preconditions** | Agent-only request obtains an approval token for destructive operations |
| **Impact** | Unapproved destructive operations (archive, delete) |
| **Mitigation** | Approval invariant: agent-only dry run returns plan + challenge_id. Approval token issuance requires: (1) completed MRTR elicitation from trusted client UI, (2) human-authenticated endpoint, (3) enterprise policy pre-auth, or (4) signed external workflow. jti → idempotency_key prevents replay. args_hash binding prevents parameter tampering. |
| **Verification test** | Unit: dry-run request → no approval token issued; approval token with wrong args_hash → rejected; expired approval token → rejected; replayed jti → deduplicated |
| **Residual risk** | None if approval sources are correctly validated |

### T-09: Idempotency Key Abuse

| Field | Value |
|---|---|
| **Preconditions** | Attacker reuses idempotency key with different arguments |
| **Impact** | INV-5 violation; wrong operation result returned |
| **Mitigation** | `input_hash` comparison on conflict (INV-5). Different arguments + same key → explicit rejection. Key format and length validated. |
| **Verification test** | Unit: same key + different args → error; 100-way concurrent reservation → exactly one wins |
| **Residual risk** | None if input_hash comparison is correctly implemented |

### T-10: OAuth State Replay

| Field | Value |
|---|---|
| **Preconditions** | Attacker captures OAuth callback URL and replays it |
| **Impact** | Token theft or session hijacking |
| **Mitigation** | OAuth transaction is single-use (`UPDATE WHERE consumed_at IS NULL RETURNING *`). PKCE S256 mandatory. state_hash validates callback. Short expiry. |
| **Verification test** | Integration: concurrent OAuth callbacks with same code → only one succeeds |
| **Residual risk** | None if atomic consumption is correctly implemented |

### T-11: Webhook Forgery

| Field | Value |
|---|---|
| **Preconditions** | Attacker sends forged webhook POST to /webhooks/notion |
| **Impact** | False cache invalidation, phantom events processed |
| **Mitigation** | HMAC-SHA256 signature verification using verification_token. Constant-time comparison. Raw body used (not re-serialized). |
| **Verification test** | Unit: invalid signature → rejected; tampered body → rejected; missing header → rejected |
| **Residual risk** | None if verification_token is kept secret |

### T-12: Webhook Duplication

| Field | Value |
|---|---|
| **Preconditions** | Notion delivers the same webhook event multiple times |
| **Impact** | Duplicate processing if not handled |
| **Mitigation** | Transactional inbox with event_id as PK. `ON CONFLICT DO UPDATE SET delivery_count = delivery_count + 1`. Idempotent consumers (INV-12). |
| **Verification test** | Integration: same event_id delivered twice → processed once, delivery_count incremented |
| **Residual risk** | None if transactional inbox is correctly implemented |

### T-13: Cache-Key Collision and Data Leakage

| Field | Value |
|---|---|
| **Preconditions** | Hash collision in cache key construction |
| **Impact** | Cross-tenant or cross-resource data leakage via cache |
| **Mitigation** | Cache keys include full `installation_id` + `resource_uri` + `version` (not hashed). Generation-fenced commits (INV-7). No wildcard operations. |
| **Verification test** | Property-based: distinct (installation, uri) pairs → distinct cache keys |
| **Residual risk** | None if keys are constructed from full identifiers |

### T-14: Redis Compromise

| Field | Value |
|---|---|
| **Preconditions** | Attacker gains access to cell-local Redis |
| **Impact** | Rate budget manipulation, cache poisoning, subscription disruption |
| **Mitigation** | No tokens in Redis (INV-9). Cell-local, private subnet, TLS. Redis contains only cache + rate state + stream directory. On Redis loss: writes fail closed (503). |
| **Verification test** | Integration: Redis down → writes return 503; reads serve L1 or emergency budget |
| **Residual risk** | Cache poisoning can serve stale data (bounded by TTL + generation counter) |

### T-15: PostgreSQL Compromise

| Field | Value |
|---|---|
| **Preconditions** | Attacker gains Postgres access |
| **Impact** | Access to encrypted tokens (still need DEK/KMS to decrypt), operation history, audit logs |
| **Mitigation** | All tokens encrypted with per-installation DEK wrapped by KMS. Audit log pseudonymized. Postgres TLS required. Parameterized queries prevent SQL injection. |
| **Verification test** | Unit: raw Postgres data contains no plaintext tokens; integration: SQL injection attempts rejected |
| **Residual risk** | DEK re-wrap schedule; if KMS is also compromised, tokens decryptable |

### T-16: Log/Trace/Error Leakage

| Field | Value |
|---|---|
| **Preconditions** | Tokens, PII, or tenant IDs appear in logs/traces/error messages |
| **Impact** | Credential exposure, privacy violation |
| **Mitigation** | Secret fields redacted from error messages. No tenant IDs in metric labels (unbounded cardinality). Hashed IDs in logs/traces. Config error serialization strips secrets. |
| **Verification test** | Integration: grep all log output for token patterns → zero hits; unit: error serialization test |
| **Residual risk** | Unforeseen error paths may leak; mitigated by CI secret scanning |

### T-17: File Upload Threats

| Field | Value |
|---|---|
| **Preconditions** | Malicious file uploaded via Notion file upload flow |
| **Impact** | Malware delivery, quota exhaustion, storage abuse |
| **Mitigation** | Quarantine → scan → commit lifecycle. Direct-to-storage (no base64 in JSON-RPC). File state machine: RESERVED → SCANNING → COMMITTED/REJECTED/EXPIRED. Quota enforcement. |
| **Verification test** | Integration: oversized file → rejected; malware fixture → quarantined |
| **Residual risk** | Scanner evasion (defense-in-depth with multiple scan engines) |

### T-18: Supply Chain Threats

| Field | Value |
|---|---|
| **Preconditions** | Compromised npm dependency |
| **Impact** | Arbitrary code execution in server process |
| **Mitigation** | Exact version pins (deno.lock). Gitleaks secret scanning. Trivy vulnerability scanning. Syft SBOM generation. Minimal dependency set. Deno's permission model (--allow-net, --allow-read scoped). |
| **Verification test** | CI: Gitleaks clean, Trivy no critical findings, SBOM generated |
| **Residual risk** | Zero-day in pinned dependency before advisory published |

### T-19: Deprovisioning and Backup Retention

| Field | Value |
|---|---|
| **Preconditions** | Installation deprovisioned but data remains accessible |
| **Impact** | Unauthorized access to stale data |
| **Mitigation** | Deprovisioning state machine: ACTIVE → DISABLING → PURGING → TOMBSTONE/TOKEN_REVOKED. Crypto-shred via KMS key destruction. Immediate revocation via deny-set (INV-11). `key_index:{installation_id}` enables complete Redis cleanup. Audit log pseudonymized and retained per compliance. |
| **Verification test** | Integration: deprovisioned installation → all queries rejected; Redis keys cleaned; Postgres tokens undecryptable |
| **Residual risk** | Backup retention window before crypto-shred propagates to cold storage |

### T-20: Token Replay (Approval)

| Field | Value |
|---|---|
| **Preconditions** | Captured approval JWT replayed after expiry or for different args |
| **Impact** | Unauthorized destructive operation |
| **Mitigation** | 5min expiry. jti → idempotency_key (replay = deduplicated no-op). args_hash binding (different args → rejected). challenge_id binding (must match original ceremony). |
| **Verification test** | Unit: replayed jti → cached result; different args_hash → rejected; expired → rejected |
| **Residual risk** | None if all bindings are verified |

---

## Approval Invariant (Critical Security Property)

```
INVARIANT: An agent-only request path CANNOT obtain an approval token.

Approval token issuance requires EXACTLY ONE of:
  1. Completed MRTR elicitation from a trusted client UI
  2. Human-authenticated approval endpoint (separate from MCP)
  3. Enterprise policy explicit pre-authorization for the operation class
  4. Signed approval from a trusted external workflow

A dry-run request returns a plan and challenge_id.
A dry-run request NEVER returns an approval token.
The challenge_id links the approval to the specific operation.
```

**Verification:** Every approval code path tested for all four sources. Negative test: unauthenticated and agent-only paths cannot reach token issuance.
