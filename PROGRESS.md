# Stage 0 Progress

**Objective:** Execute Stage 0 — Genome and Growth Environment
**Status:** IN PROGRESS — Checkpoint 0 NO-GO (gates remain open)
**Last updated:** 2026-10-09T07:41Z

---

## Task Status

### Task 0.0: SDK and Runtime Compatibility Spike
- **Status:** IN PROGRESS — protocol adapter feasibility proven; full dependency compatibility unverified
- **Artifact:** `DECISIONS.md`
- **What is proven (protocol feasibility):**
  - Deno 2.9.7 installed and running (`deno 2.9.7 stable, aarch64-apple-darwin`)
  - Pinned `@modelcontextprotocol/server@2.3.1` and `@modelcontextprotocol/core@2.3.1`
  - SDK-lag finding: server runtime exports `LATEST_PROTOCOL_VERSION = "2025-11-25"`, lacks native `server/discover`. Core schemas export modern shapes but are permissive.
  - `deno task spike:adapter`: 59 passed, 0 failed, <10s, loopback-only. Proves thin MCP 2026-07-28 adapter feasibility using core schemas as floor validation. Covers: stateless POST-only dispatch, server/discover, tools/list+call without initialize/session, MRTR elicitation round-trip, in-process SSE subscriptions/listen with acknowledged notification + requested tools/list_changed notification + periodic keepalive + client stream cancellation, header validation, core schema reuse, error codes. Does NOT prove production fanout, reconnection, durability, or multi-subscriber behavior.
  - Adapter 59/59 independently verified by read-only verifier `81609c8d`: format, lint, type-check, and runtime all passed; 0.40s execution; no skips. Stage 0 adapter feasibility is ACCEPTED. This does not prove production Task 2.7 conformance.
  - Legacy compatibility spike: probe exit 0 (diagnostic); SDK gate exit 2 (server-runtime incompatibility with stateless 2026-07-28); full gate exit 2 (PostgreSQL/Redis unavailable). Clean bounded termination.
- **What is NOT proven (dependency compatibility — OPEN):**
  - postgres.js Deno compatibility — not executed, exact latest version unverified
  - ioredis Deno compat via Node compat layer (Streams + Pub/Sub + Lua) — not executed
  - Full infra spike (Postgres + Redis + Deno together) — Docker unavailable
- **Decision:** Do NOT downgrade product spec. Reuse `@modelcontextprotocol/core` schemas; implement thin custom adapter at Task 2.7. No SDK fork.

### Task 0.1: Notion Endpoint Manifest
- **Status:** PARTIAL — OFFICIAL_DOC verified for key endpoints only; REAL_API verification pending
- **Artifact:** `docs/notion-endpoints.md`
- **Verified from official docs (2026-10-09):**
  - Data source query path: `POST /v1/data_sources/{data_source_id}/query` ([Notion API reference](https://developers.notion.com/reference/query-a-data-source))
  - OAuth token response schema — `expires_in` not documented (CONFLICT-001 UNRESOLVED; see note)
  - Webhook signature: X-Notion-Signature, HMAC-SHA256, sha256=<hex_digest> ([Notion webhooks reference](https://developers.notion.com/reference/webhooks))
  - Webhook events: page.content_updated structure confirmed
  - API version 2026-03-11 confirmed current ([Notion versioning](https://developers.notion.com/reference/versioning))
- **NOT done:** Real-provider verification for representative operations
- **Blocker (human/provider):** Test workspace + OAuth integration required

### Task 0.2: Test Environment
- **Status:** BLOCKED — requires human action
- **Artifact:** `docs/test-environment-setup.md`
- **Blocker (human/provider):** User must create Notion test workspace + public OAuth integration

### Task 0.3: Threat Model
- **Status:** COMPLETE (document authored, not externally reviewed)
- **Artifact:** `docs/threat-model.md`

### Task 0.4: Growth Environment
- **Status:** IN PROGRESS — Deno gates, support/integration, mutation, OTel, scanners all pass locally; Docker runtime/CI execution unavailable
- **Executed and passing:**
  - `deno fmt --check` — exit 0
  - `deno lint` — exit 0
  - `deno check` (type-check) — exit 0
  - `deno task test:unit` — 8 passed, 0 failed
  - `deno task test:support` — 47 passed (25 Notion fake + 22 JWKS issuer), 0 failed, no permissions required
  - `deno task test:integration` — 4 passed, 0 failed, no permissions required
  - `deno task test` (canonical gate command) — exit 0, groups unit 8 + support 47 + integration 4 = 59 tests, 0 failed
  - `deno task spike:adapter` — 59 passed, 0 failed (independently verified; Stage 0 feasibility ACCEPTED)
  - `deno task test:mutation:tooling` — 55 mutants generated, 55 killed, 0 survived/no-coverage/errors, 100% mutation score, exit 0, ~2s, concurrency 1. Uses @stryker-mutator/core@9.6.1 with command runner under `tooling/mutation/` (isolated from Deno nodeModulesDir). Mutation sandbox hygiene verified: ignorePatterns exclude .env/credentials/generated; cleanTempDir='always'; no stryker-tmp or sandbox .env copies after run.
  - `deno task spike:otel` — 10 passed, 0 failed, ~44ms. Permission only `OTEL_*` env vars. In-memory exporter, resource attributes, span IDs, events/status/exception, async parent-child context, clean shutdown. Deno `--unstable-otel` NOT required for npm userland stack. Production OTLP/metrics/logs deferred.
  - Gitleaks 8.30.1 — git history scan 0 findings; non-ignored worktree scan 0 findings (redacted output)
  - Trivy 0.75.0 filesystem scan — CRITICAL/HIGH 0 (after non-root Dockerfile fix). Image-layer scan NOT done (no Docker).
  - Syft 1.54.1 — CycloneDX SBOM generated, valid, 39 components. Scanner binaries excluded. Output gitignored.
  - actionlint 1.7.12 + ShellCheck 0.11.0 — CI workflow validation 0 findings
  - Deno 2.9.7 Dockerfiles: USER deno UID 1993, COPY --chown, Trivy clean. Immutable multi-arch digests pinned (Deno sha256:fa335a…e432, Postgres sha256:5660…e64c, Redis sha256:858f…3499). Registry digest resolution observed; actual Docker pull/build/health unverified.
- **Scanner bootstrap:** Project-local official arm64 assets installed via manifest single source with exact archive + installed-binary SHA verification, atomic replacement, version/hash idempotent checks. Homebrew system install was sandbox-blocked; project-local path accepted.
- **Notion fake coverage (25 tests):** Every currently implemented route + 429/503/529 error injection tested in-process. Preserves SYNTHETIC_FIXTURE provenance header. Proves fake behavior only, NOT real Notion API or Docker HTTP/container behavior.
- **JWKS issuer coverage (22 tests):** Health endpoint, JWKS public shape, non-exposure of private key fields, sign/verify round-trip, tampered token rejection, expiry enforcement, cross-key rejection, malformed HTTP payloads. Closes Stage 0 local JWKS behavior gate. Does NOT prove Docker container health or production auth middleware integration.
- **Growth integration (4 tests):** Both support handlers import without starting servers and compose in one Deno process. Fake ignores Bearer token — do NOT claim auth integration.
- **NOT executed / unavailable:**
  1. `docker compose up` — Docker runtime unavailable locally
  2. Compose service health checks — blocked on Docker
  3. Docker image build/pull — Dockerfiles authored with immutable digests; actual build/pull unverified
  4. Trivy image-layer scan — requires Docker runtime (filesystem scan done)
  5. GitHub Actions CI — statically validated (actionlint 0); never executed in CI

---

## Checkpoint 0 Gate Status: NO-GO

| Gate | Status | Evidence |
|---|---|---|
| SDK choice documented with version pins | ✅ PASS | `DECISIONS.md` |
| Executable spike proves runtime + deps work together | ❌ PARTIAL | Protocol adapter 59/59, OTel spike 10/10. postgres.js + ioredis Deno compat NOT proven (Docker unavailable). |
| Endpoint manifest: every tool mapped | ✅ PASS (OFFICIAL_DOC only) | `docs/notion-endpoints.md` |
| Endpoint manifest: verified against real API | ❌ NOT DONE | Blocked on test workspace |
| Test workspace: credentials, fixtures, cleanup | ❌ NOT DONE | Blocked on human action |
| Growth environment: `docker compose up` → all healthy | ❌ NOT DONE | Docker unavailable; Dockerfiles authored with immutable digests, Trivy clean |
| Growth environment: `deno task test` → green | ✅ PASS | 59 passed (unit 8 + support 47 + integration 4), 0 failed |
| Deterministic Notion fake responds to showcase endpoints | ✅ PASS (in-process, no Docker) | 25 tests: all implemented routes + error injection; SYNTHETIC_FIXTURE provenance preserved |
| Local JWKS issuer issues + validates test JWTs | ✅ PASS (local behavior, no Docker) | 22 in-process tests; Docker container health NOT proven |
| Gitleaks: zero findings | ✅ PASS | Git history 0 findings; non-ignored worktree 0 findings (redacted). Project-local binary 8.30.1. |
| CI skeleton: same commands as local | ⚠️ STATIC PASS; EXECUTION OPEN | actionlint 1.7.12 + ShellCheck 0.11.0: 0 findings. Actual GitHub Actions jobs have not run. |
| Threat model documented | ✅ PASS | `docs/threat-model.md` |
| Secret scanning active | ✅ PASS (local) | Gitleaks scan executed locally; CI Gitleaks step authored but not executed in CI |
| Mutation testing verified under Deno | ✅ PASS (tooling viability) | @stryker-mutator/core@9.6.1: 55/55 killed, 100%. Sandbox hygiene verified. CP-1 requires product cells. |
| Trivy filesystem scan: 0 CRITICAL/HIGH | ✅ PASS (filesystem only) | Trivy 0.75.0 filesystem scan 0 CRITICAL/HIGH. Image-layer scan NOT done (no Docker). |
| SBOM generation | ✅ PASS | Syft 1.54.1 CycloneDX valid, 39 components. Scanner binaries excluded. |
| OTel compatibility spike | ✅ PASS | `deno task spike:otel` 10/10; npm userland stack; no --unstable-otel needed |

---

## Conflicts with Canonical Spec

### CONFLICT-001: OAuth `expires_in`
- **Spec says:** OAuth returns `expires_in` (§5, Flow 2)
- **OFFICIAL_DOC says:** `POST /v1/oauth/token` documentation does NOT document `expires_in` ([Notion reference](https://developers.notion.com/reference/refresh-a-token), accessed 2026-10-09)
- **Status:** UNRESOLVED — absence from documentation does not prove live responses never include it. REAL_API observation required.
- **Implementation guidance:** Implement refresh-on-401 as primary mechanism. If live response includes `expires_in`, honor it. If absent, do not invent a TTL. No specific TTL value is justified.

### CONFLICT-002: Webhook event field name
- **Status:** RESOLVED — no actual conflict (`id` confirmed)

### CONFLICT-003: MCP SDK vs. 2026-07-28 spec
- **Status:** RESOLVED — custom adapter decision recorded in DECISIONS.md

---

## Decisions Made

See `DECISIONS.md` for full details. Key pins:
- Runtime: Deno 2.9.7 (installed)
- MCP SDK: `@modelcontextprotocol/server@2.3.1` + `@modelcontextprotocol/core@2.3.1` with custom adapter
- Notion SDK: @notionhq/client 5.27.0
- Postgres: postgres.js 3.4.5 (Deno compat UNVERIFIED)
- Redis: ioredis 5.6.1 (Deno compat UNVERIFIED)
- Validation: Zod 4.6.5
- Property testing: fast-check 3.23.2
- Mutation testing: @stryker-mutator/core 9.6.1 (Stage 0 viability PROVEN — 55/55 killed)
- OTel: @opentelemetry/api@1.9.0 + sdk-trace-base@2.12.0 + resources@2.12.0 + context-async-hooks@2.12.0 (spike 10/10)
- Secrets: Gitleaks 8.30.1 (0 findings)
- Scanning: Trivy 0.75.0 (filesystem CRITICAL/HIGH 0)
- SBOM: Syft 1.54.1 (CycloneDX valid, 39 components)
- CI lint: actionlint 1.7.12 + ShellCheck 0.11.0 (0 findings)

---

## Next Action

1. Docker install → `docker compose up -d` → service health → infra spike (postgres.js + ioredis under Deno)
2. Docker image build → Trivy image-layer scan
3. **Human action:** Notion test workspace + OAuth integration → REAL_API verification
