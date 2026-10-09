# Evidence Index — Notion MCP Server

**Date:** 2026-10-09 (updated 2026-10-09T07:41Z)
**Status:** Active — updated as evidence is gathered
**Note:** This file tracks provider/technical evidence only. Reward audit records belong in `docs/agent-reward-ledger.jsonl` per the agent reward protocol (currently inactive — no records until activation).

---

## Provenance Taxonomy

Evidence records use the following verification levels for provider/protocol facts:

| Level | Meaning |
|---|---|
| **SPEC_INTENT** | Canonical product specification or implementation plan states this as a requirement |
| **OFFICIAL_DOC** | Published official provider documentation with URL and access date |
| **REAL_API** | Observed response from a live provider API call |
| **CONFORMANCE** | Behavior verified against a conformance test suite |
| **SYNTHETIC_FIXTURE** | Test passing against a synthetic fake or fixture (not provider evidence) |
| **UNVERIFIED** | Claimed but not yet supported by any of the above levels |

Local execution evidence (commands run, exit codes, test pass counts) is recorded in the **Source** and **Source type** fields. It is not a provider verification level.

---

## Evidence Records

### E-001: Notion API 2026-03-11 Version Exists

| Field | Value |
|---|---|
| **Claim** | Notion API version 2026-03-11 exists and is the latest version |
| **Source type** | Official documentation |
| **Source** | https://developers.notion.com/reference/versioning |
| **Doc/API version** | 2026-03-11 |
| **Date accessed** | 2026-10-09 |
| **Section** | Versioning overview |
| **Verification level** | OFFICIAL_DOC |
| **Fixture path** | N/A |
| **Depends on** | All tools, all resources |
| **Uncertainty** | None |
| **Decision** | Use 2026-03-11 as target API version |

### E-002: Data Source Query Endpoint Path

| Field | Value |
|---|---|
| **Claim** | Correct path for querying structured data is `POST /v1/data_sources/{data_source_id}/query`, not deprecated `/v1/databases/{id}/query` |
| **Source type** | Official documentation |
| **Source** | https://developers.notion.com/reference/query-a-data-source |
| **Doc/API version** | 2026-03-11 |
| **Date accessed** | 2026-10-09 |
| **Section** | Data sources > Query a data source |
| **Verification level** | OFFICIAL_DOC |
| **Fixture path** | N/A |
| **Depends on** | notion_query_data_source tool |
| **Uncertainty** | None — endpoint confirmed with SDK code sample |
| **Decision** | Use data_sources path exclusively |

### E-003: OAuth Token Exchange Response Schema

| Field | Value |
|---|---|
| **Claim** | `POST /v1/oauth/token` documented response includes: access_token, token_type, refresh_token (string\|null), bot_id, workspace_icon, workspace_name, workspace_id, owner, duplicated_template_id, request_id. `expires_in` is NOT documented. |
| **Source type** | Official documentation |
| **Source** | https://developers.notion.com/reference/refresh-a-token |
| **Doc/API version** | 2026-03-11 |
| **Date accessed** | 2026-10-09 |
| **Section** | Authentication > Refresh a token |
| **Verification level** | OFFICIAL_DOC |
| **Fixture path** | N/A |
| **Depends on** | OAuth flow, token refresh, credential storage |
| **Uncertainty** | **CONFLICT with spec §5:** spec states `expires_in` is returned; official docs do not document it. Absence from documentation does not prove live responses never include the field. REAL_API observation is required to determine whether live `POST /v1/oauth/token` responses include `expires_in`. |
| **Decision** | UNRESOLVED. Implement refresh-on-401 as primary mechanism. If live response includes `expires_in`, honor it. If absent, do not invent a TTL. No specific TTL value is justified — the previously suggested "55-minute TTL" was invented without evidence and is withdrawn. |

### E-004: Webhook Signature Mechanism

| Field | Value |
|---|---|
| **Claim** | Webhooks use `X-Notion-Signature` header with `sha256=<hex_digest>` format, signed via HMAC-SHA256 using `verification_token` over raw request body |
| **Source type** | Official documentation |
| **Source** | https://developers.notion.com/reference/webhooks |
| **Doc/API version** | 2026-03-11 |
| **Date accessed** | 2026-10-09 |
| **Section** | Webhooks > Step 3 - Validating event payloads |
| **Verification level** | OFFICIAL_DOC |
| **Fixture path** | N/A |
| **Depends on** | Webhook ingestion (FLOW 3) |
| **Uncertainty** | None — SDK helper `verifyWebhookSignature()` confirmed in v5.23.0+ |
| **Decision** | Implement HMAC-SHA256 verification with constant-time comparison |

### E-005: Webhook Event Structure (page.content_updated)

| Field | Value |
|---|---|
| **Claim** | page.content_updated event contains: id, type, timestamp, workspace_id, data.parent, data.updated_blocks, accessible_by |
| **Source type** | Official documentation |
| **Source** | https://developers.notion.com/reference/webhooks/page-content-updated |
| **Doc/API version** | 2026-03-11 |
| **Date accessed** | 2026-10-09 |
| **Section** | Webhook events > Pages > Page content updated |
| **Verification level** | OFFICIAL_DOC |
| **Fixture path** | N/A |
| **Depends on** | Webhook processing, subscription notifications |
| **Uncertainty** | Event field is `id` (confirmed). Spec §FLOW 3 states `id: uuid` — matches. |
| **Decision** | Use `id` as the event identifier for deduplication |

### E-006: MCP SDK v2 and 2026-07-28 Spec Conformance

| Field | Value |
|---|---|
| **Claim** | `@modelcontextprotocol/server@2.3.1` does NOT natively implement MCP 2026-07-28. `@modelcontextprotocol/core@2.3.1` exports modern schemas (discover, subscriptions, MRTR) but they are permissive — accept but do not enforce all published wire fields. |
| **Source type** | Runtime inspection of pinned dependency |
| **Source** | `npm:@modelcontextprotocol/server@2.3.1` — exports `LATEST_PROTOCOL_VERSION = "2025-11-25"`; legacy handler lacks `server/discover`. `npm:@modelcontextprotocol/core@2.3.1` — exports `DiscoverRequestSchema`, `SubscriptionsListenRequestSchema`, `ElicitRequestParamsSchema`, etc. |
| **MCP 2026-07-28 spec** | [https://modelcontextprotocol.io/specification/2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) — published and current. Removes `initialize` and `Mcp-Session-Id`, requires stateless per-request metadata, mandatory `server/discover`, POST-only transport, `resultType`, MRTR, `subscriptions/listen`. |
| **Date accessed** | 2026-10-09 |
| **Verification level** | N/A (direct local runtime observation of the pinned SDK; not a provider claim) |
| **Depends on** | MCP transport (Task 2.7), protocol conformance (Checkpoint 2C) |
| **Uncertainty** | Core schemas may not enforce all 2026-07-28 wire fields. Adapter spike proves feasibility, not production conformance. |
| **Decision** | Do NOT downgrade product spec. Do NOT claim native SDK conformance. Reuse core schemas as floor validation; implement thin custom adapter at Task 2.7. No fork/monkey-patch. |

### E-007: Notion OAuth Refresh Token Rotation

| Field | Value |
|---|---|
| **Claim** | Each token refresh returns a NEW refresh_token and invalidates the previous one |
| **Source type** | Third-party documentation + official docs |
| **Source** | https://www.nango.dev/blog/notion-oauth-refresh-token-invalid-grant ; developers.notion.com/reference/refresh-a-token |
| **Date accessed** | 2026-10-09 |
| **Verification level** | OFFICIAL_DOC (refresh endpoint confirmed); UNVERIFIED for rotation behavior (needs REAL_API) |
| **Depends on** | Token refresh logic, concurrent refresh handling |
| **Uncertainty** | Rotation behavior confirmed by third-party; official docs describe the endpoint but rotation is implicit |
| **Decision** | Implement atomic refresh with optimistic locking; always store new refresh_token |

### E-008: Deno 2.9.7 Runtime

| Field | Value |
|---|---|
| **Claim** | Deno 2.9.7 is installed on host |
| **Source type** | Local command execution |
| **Source** | `deno --version` → `deno 2.9.7 (stable, release, aarch64-apple-darwin), v8 15.0.245.2-rusty, typescript 6.0.3` |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local tooling fact, not a provider claim) |
| **Depends on** | Runtime selection |
| **Uncertainty** | None |

### E-009: MCP 2026-07-28 Adapter Feasibility Spike

| Field | Value |
|---|---|
| **Claim** | Thin custom MCP 2026-07-28 transport/dispatch adapter is feasible using `@modelcontextprotocol/core@2.3.1` schemas as floor validation |
| **Source type** | Local test execution |
| **Source** | `deno task spike:adapter` — 59 passed, 0 failed, <10s. Loopback network only (`--allow-net=127.0.0.1,localhost`). |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Fixture path** | `tests/spike/mcp-2026-adapter-spike.ts` |
| **Depends on** | Task 2.7 (production transport), Checkpoint 2C (production conformance) |
| **Covers** | Stateless POST-only dispatch, server/discover wire shape, tools/list + tools/call without initialize/session, MRTR elicitation round-trip (input_required → retry → complete, tampered/missing requestState rejection, cross-tool reuse rejection), in-process subscriptions/listen SSE (acknowledged notification, requested tools/list_changed notification delivery, periodic keepalive comments, client stream cancellation via reader.cancel), header validation (Mcp-Method, Mcp-Name, base64 encoding, Content-Type, Accept), core schema reuse, JSON-RPC error codes |
| **Uncertainty** | Proves in-process loopback feasibility only. Does NOT prove: production multi-subscriber fanout, durable reconnection/resynchronization, event pipeline integration, SSE slow-consumer eviction, deadline propagation through origin, auth middleware integration. Those are Layer 2 / Checkpoint 2C concerns. |
| **Independent verification** | Read-only verifier `81609c8d` independently ran format, lint, type-check, and `deno task spike:adapter`: 59 passed, 0 failed in 0.40s with no skips. Stage 0 adapter feasibility ACCEPTED; production conformance remains unproven. |
| **Decision** | Proceed with custom adapter approach at Task 2.7 |

### E-010: Deno Deterministic Gates and Canonical Test

| Field | Value |
|---|---|
| **Claim** | Repository-wide Deno format, lint, type-check pass; canonical `deno task test` passes all test groups |
| **Source type** | Local command execution |
| **Source** | `deno fmt --check` exit 0; `deno lint` exit 0; `deno check` exit 0; `deno task test` exit 0 — groups unit 8 + support 47 + integration 4 = 59 tests, 0 failed |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Depends on** | Checkpoint 0 gate: "`deno task test` → green" |
| **Uncertainty** | None for the gates that ran. Docker-dependent tasks remain unexecuted. |

### E-011: Notion Fake In-Process Tests

| Field | Value |
|---|---|
| **Claim** | Notion fake contract-fidelity tests pass in-process without Docker, covering all currently implemented routes and error injection |
| **Source type** | Local test execution against synthetic fake |
| **Source** | `deno task test:support` (Notion fake subset) — 25 passed, 0 failed, no permissions required |
| **Date executed** | 2026-10-09 |
| **Verification level** | SYNTHETIC_FIXTURE |
| **Fixture path** | `test-support/notion-fake/server_test.ts` |
| **Covers** | Every currently implemented route, OAuth endpoint header exemption, Notion-Version enforcement, deterministic UUID-shaped IDs, state reset, SYNTHETIC_FIXTURE provenance header, 429/503/529 error injection |
| **Uncertainty** | Tests exercise the fake's handleRequest directly (in-process). Does NOT prove the fake serves correct responses over HTTP in Docker, nor does it prove real Notion API behavior. |

### E-012: CI Workflow Static Validation

| Field | Value |
|---|---|
| **Claim** | CI workflows use immutable SHA action pins, Node 24 runner actions, safe all-secret validation, and image scan/SBOM steps |
| **Source type** | Static file inspection |
| **Source** | `.github/workflows/pr-ci.yml`, `.github/workflows/contract-ci.yml` |
| **Date inspected** | 2026-10-09 |
| **Verification level** | UNVERIFIED (workflow execution has not occurred in GitHub Actions) |
| **Static validation** | actionlint 1.7.12 + ShellCheck 0.11.0 executed locally: 0 findings. Immutable action SHA and input checks also passed. |
| **Uncertainty** | Workflow syntax and inline shell are statically validated. Actual jobs, service containers, image scans, and credential-gated contract execution remain unproven until CI runs. |

### E-013: Legacy Compatibility Spike Diagnostics

| Field | Value |
|---|---|
| **Claim** | Legacy compatibility spike exhibits clean bounded termination in all modes |
| **Source type** | Local command execution |
| **Source** | Probe mode: exit 0 (diagnostic pass). SDK gate: exit 2 (server-runtime direct incompatibility with stateless 2026-07-28). Full gate: exit 2 (PostgreSQL/Redis unavailable). |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Depends on** | Task 0.0 decision: SDK cannot be used directly for 2026-07-28 transport |
| **Uncertainty** | Full gate requires Docker for PostgreSQL/Redis — those remain blocked |

### E-014: JWKS Issuer In-Process Tests

| Field | Value |
|---|---|
| **Claim** | JWKS issuer local behavior tested in-process: health endpoint, JWKS public shape, private key non-exposure, sign/verify round-trip, tampered token rejection, expiry enforcement, cross-key rejection, malformed HTTP payloads |
| **Source type** | Local test execution |
| **Source** | `deno task test:support` (JWKS issuer subset) — 22 passed, 0 failed, no permissions required |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution of test support tooling, not a provider claim) |
| **Fixture path** | `test-support/jwks-issuer/server_test.ts` |
| **Covers** | Health/ready endpoint, JWKS document public shape (kid, kty, use, alg, n, e present), private field absence (d, p, q, dp, dq, qi), JWT sign + verify round-trip, tampered-signature rejection, expired-token rejection, cross-key-id rejection, malformed request handling |
| **Uncertainty** | Closes Stage 0 local JWKS issuer behavior gate. Does NOT prove Docker container health, HTTP-over-network serving, or production auth middleware integration. |
| **Gate impact** | Checkpoint 0 "Local JWKS issuer issues + validates test JWTs" — local behavior now PASS with Docker container caveat |

### E-015: Growth Integration Tests

| Field | Value |
|---|---|
| **Claim** | Notion fake and JWKS issuer handlers import and compose in a single Deno process without starting HTTP servers |
| **Source type** | Local test execution |
| **Source** | `deno task test:integration` — 4 passed, 0 failed, no permissions required |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Covers** | Both support handlers import without server startup; compose together in one Deno process |
| **Uncertainty** | Fake ignores Bearer token — do NOT claim auth integration. Does not prove Docker Compose orchestration or inter-service HTTP connectivity. |

### E-016: Mutation Tooling Viability (@stryker-mutator/core@9.6.1)

| Field | Value |
|---|---|
| **Claim** | Mutation testing tooling is viable for this project: @stryker-mutator/core@9.6.1 with command runner can generate and kill mutants against Deno test targets |
| **Source type** | Local test execution |
| **Source** | `deno task test:mutation:tooling` — 55 mutants generated, 55 killed, 0 survived/no-coverage/errors, 100% mutation score, exit 0, ~2s, concurrency 1, 100% break threshold |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Package pins** | @stryker-mutator/core@9.6.1; qs override 6.16.0; npm ls valid; npm audit 0 vulnerabilities |
| **Node compatibility** | Host Node 23.7 satisfies v9 engine requirement (>=20). v10 was rejected: transitive Babel 8 excludes Node 23 and npm audit showed vulnerabilities. |
| **Isolation** | Tooling isolated under `tooling/mutation/`. Root npm package files removed. npm tree is isolated from Deno `nodeModulesDir: auto`. |
| **Permissions** | Command runner uses `deno test --allow-env=__STRYKER_ACTIVE_MUTANT__,__STRYKER_MUTANT_COVERAGE__` only — minimal permissions for injected instrumentation; no read/network. |
| **Depends on** | Checkpoint 1 (mutation on actual product cells under frozen acceptance contracts) |
| **Uncertainty** | Closes Stage 0 mutation-tool viability ONLY. Checkpoint 1 still requires mutation on actual product cells. The 55/55 result is against the isolated `tests/mutation-fixture/` tooling fixture, not product cells. |
| **Rejected alternative** | @stryker-mutator/core@10.x — rejected due to unsupported transitive engines (Babel 8 excludes Node 23) and npm audit vulnerabilities. Do NOT present as accepted. |

### E-017: OpenTelemetry Deno Compatibility Spike

| Field | Value |
|---|---|
| **Claim** | npm userland OTel stack works under Deno without `--unstable-otel` |
| **Source type** | Local test execution |
| **Source** | `deno task spike:otel` — 10 passed, 0 failed, ~44ms. Permission only `OTEL_*` env vars. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Exact pins** | @opentelemetry/api@1.9.0, @opentelemetry/sdk-trace-base@2.12.0, @opentelemetry/resources@2.12.0, @opentelemetry/context-async-hooks@2.12.0 |
| **Covers** | In-memory exporter, resource attributes, span IDs, events/status/exception recording, async parent-child context propagation, clean shutdown |
| **Uncertainty** | Production OTLP exporter, metrics, and logs NOT validated. In-memory exporter only at Stage 0. |

### E-018: Scanner Toolchain Bootstrap

| Field | Value |
|---|---|
| **Claim** | Project-local scanner toolchain installed and verified: Gitleaks 8.30.1, Trivy 0.75.0, Syft 1.54.1, actionlint 1.7.12, ShellCheck 0.11.0 |
| **Source type** | Local binary installation and verification |
| **Source** | Official arm64 release assets; manifest single source; exact archive + installed-binary SHA verification; atomic replacement; version/hash verified idempotently. Homebrew system install was sandbox-blocked; project-local path accepted. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local tooling fact, not a provider claim) |
| **Uncertainty** | None for installation. Correctness of scan results depends on tool versions and rulesets. |

### E-019: Gitleaks Scan Results

| Field | Value |
|---|---|
| **Claim** | Gitleaks git history scan: 0 findings. Gitleaks non-ignored worktree scan: 0 findings. |
| **Source type** | Local scanner execution |
| **Source** | Gitleaks 8.30.1 project-local binary. Output redacted. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Gate impact** | Checkpoint 0 "Gitleaks: zero findings" — PASS |
| **Uncertainty** | None for the scan that ran. Does not cover future commits. |

### E-020: Trivy Filesystem Scan

| Field | Value |
|---|---|
| **Claim** | Trivy filesystem scan: 0 CRITICAL, 0 HIGH vulnerabilities (after non-root Dockerfile fix) |
| **Source type** | Local scanner execution |
| **Source** | Trivy 0.75.0 project-local binary. `trivy filesystem` mode. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Scope** | Filesystem scan ONLY. Does NOT include Docker image-layer scanning (no container runtime available). Distinguish filesystem Trivy from image-layer Trivy. |
| **Uncertainty** | Image-layer scan requires Docker runtime and remains open. |

### E-021: SBOM Generation

| Field | Value |
|---|---|
| **Claim** | CycloneDX SBOM generated, valid, 39 components. Scanner binaries excluded from SBOM. |
| **Source type** | Local tool execution |
| **Source** | Syft 1.54.1 project-local binary. Output gitignored. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Uncertainty** | Filesystem SBOM only; container SBOM requires Docker. |

### E-022: actionlint + ShellCheck CI Validation

| Field | Value |
|---|---|
| **Claim** | CI workflow files pass static validation with 0 findings |
| **Source type** | Local linter execution |
| **Source** | actionlint 1.7.12 + ShellCheck 0.11.0 project-local binaries. 0 findings across `.github/workflows/pr-ci.yml` and `.github/workflows/contract-ci.yml`. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Gate impact** | Checkpoint 0 "CI skeleton: same commands as local" — PASS (static). CI has never executed in GitHub Actions. |
| **Uncertainty** | Static validation only. Actual CI execution has never occurred. |

### E-023: Mutation Sandbox Hygiene

| Field | Value |
|---|---|
| **Claim** | Stryker 9.6.1 mutation runs leave no sandbox residue and do not copy .env or credentials |
| **Source type** | Local post-run verification |
| **Source** | ignorePatterns exclude .env/credentials/generated; cleanTempDir='always'; independently verified no stryker-tmp directory and no sandbox .env copies after run. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (local execution, not a provider claim) |
| **Uncertainty** | None for the current configuration. Future pattern changes need re-verification. |

### E-024: Container Dockerfile Immutable Digests

| Field | Value |
|---|---|
| **Claim** | Deno 2.9.7 Dockerfiles use USER deno UID 1993 with COPY --chown; base images pinned by immutable multi-arch digests |
| **Source type** | Static file inspection + Trivy scan |
| **Source** | Deno sha256:fa335a…e432; Postgres sha256:5660…e64c; Redis sha256:858f…3499. Registry digest resolution observed. Trivy image scan of Dockerfile layers: clean. |
| **Date executed** | 2026-10-09 |
| **Verification level** | N/A (static inspection; no Docker pull/build/run executed) |
| **Uncertainty** | Actual Docker pull, build, and container health remain unverified. Registry digest resolution was observed but no container runtime is available to pull/build. |

### E-025: REAL_API — Notion Search, Users, Bot Me

| Field | Value |
|---|---|
| **Claim** | Notion API search, users list, and bot self-identification verified against live workspace |
| **Source type** | Real API observation |
| **Source** | `POST /v1/search` → 200 (empty list, `type: "page_or_data_source"`); `GET /v1/users` → 200 (3 users: 1 person, 2 bots); `GET /v1/users/me` → 200 (bot with workspace owner) |
| **Doc/API version** | 2022-06-28 (SDK default Notion-Version) |
| **Date accessed** | 2026-10-09T08:17Z |
| **Verification level** | REAL_API |
| **Fixture path** | `test-support/fixtures/real-notion/search-empty.json`, `test-support/fixtures/real-notion/users-list.json`, `test-support/fixtures/real-notion/users-me-bot.json` |
| **Depends on** | All Notion tools, contract tests |
| **Observations** | 1. Search returns `type: "page_or_data_source"` (not `page_or_database` as older docs suggest). 2. Empty results when no content shared with integration — confirms access-control model. 3. Internal integration can enumerate workspace users. 4. `x-notion-request-id` header present on all responses. 5. No `retry-after` or `x-rate-limit-*` headers on successful requests. |
| **Uncertainty** | CRUD (page create/update/archive) not yet verified — integration needs a page shared with it. OAuth flow not yet verified (requires public integration redirect). |

### E-026: REAL_API — Internal Integration Cannot Create Workspace-Level Pages

| Field | Value |
|---|---|
| **Claim** | Internal integrations cannot create pages with `parent: {type: "workspace"}` — returns 400 validation_error |
| **Source type** | Real API observation |
| **Source** | `POST /v1/pages` with `parent: {type: "workspace", workspace: true}` → 400: "Provide a `parent.page_id` or `parent.database_id` parameter to create a page, or use a public integration with `insert_content` capability." |
| **Doc/API version** | 2022-06-28 |
| **Date accessed** | 2026-10-09T08:17Z |
| **Verification level** | REAL_API |
| **Fixture path** | `test-support/fixtures/real-notion/error-workspace-parent-internal-integration.json` |
| **Depends on** | Contract test setup, test cleanup procedure |
| **Design impact** | Contract tests must use a parent page shared with the integration, not workspace-level pages. Test environment setup doc updated accordingly. |

### E-027: Notion SDK Client Verification (REAL_API)

| Field | Value |
|---|---|
| **Claim** | `@notionhq/client@5.27.0` successfully connects to live Notion API: search, users.list, users.me all return valid typed responses |
| **Source type** | Real SDK + API interaction |
| **Source** | Deno script using `Client` constructor with auth token; all SDK methods returned typed objects matching documented schemas |
| **Date accessed** | 2026-10-09T08:17Z |
| **Verification level** | REAL_API |
| **Observations** | SDK correctly sends `Notion-Version` header; auth header sent as `Bearer <token>`; all namespaces functional (pages, databases, blocks, users, comments, oauth, search) |

### E-028: Full Validation Pipeline

| Field | Value |
|---|---|
| **Claim** | Complete deterministic validation pipeline passes: check, lint, fmt, test (59), spike:sdk (30 pass, 2 expected incompatible), mutation (55/55 killed, 100%), gitleaks (0 leaks), trivy (0 critical/high), SBOM (45 components), actionlint (0 findings) |
| **Source type** | Local command execution |
| **Date executed** | 2026-10-09T08:20Z |
| **Verification level** | N/A (local execution) |
| **Commands** | `deno task check` exit 0; `deno task lint` exit 0; `deno task fmt:check` exit 0; `deno task test` exit 0 (59 pass); `deno task spike:sdk` exit 2 (expected: 2026-07-28 not in SDK); `deno task test:mutation:tooling` exit 0 (100%); `deno task scan:secrets` exit 0; `deno task scan:fs` exit 0; `deno task sbom` exit 0; `deno task actionlint` exit 0 |

---

## Evidence Precedence

**For product intent:**
1. Canonical product specification (SPEC_INTENT)
2. Canonical implementation plan
3. Explicit user decision
4. Everything else

**For external provider behavior:**
1. Current real API observation (REAL_API)
2. Current official provider documentation (OFFICIAL_DOC)
3. Versioned official SDK behavior
4. Sanitized historical fixture
5. Synthetic fixture (SYNTHETIC_FIXTURE)
