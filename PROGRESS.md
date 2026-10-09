# Stage 0 Progress

**Objective:** Execute Stage 0 — Genome and Growth Environment
**Status:** NEAR COMPLETE — blocked on Deno installation and real Notion workspace

---

## Completed Tasks

### Task 0.0: SDK and Runtime Compatibility Spike
- **Status:** COMPLETE (research + decisions; spike code written; execution pending Deno install)
- **Artifact:** `DECISIONS.md`
- **Evidence:** 12 tools evaluated with version pins, licenses, compatibility notes
- **Spike code:** `tests/spike/compatibility-spike.ts`
- **Blocker:** Deno 2.9.7 not installed on host

### Task 0.1: Notion Endpoint Manifest
- **Status:** COMPLETE (OFFICIAL_DOC verified; REAL_API pending)
- **Artifact:** `docs/notion-endpoints.md`
- **Verified from official docs (2026-10-09):**
  - Data source query path: `POST /v1/data_sources/{data_source_id}/query`
  - OAuth token response schema (NO expires_in — CONFLICT-001 recorded)
  - Webhook signature: X-Notion-Signature, HMAC-SHA256, sha256=<hex_digest>
  - Webhook events: page.content_updated structure confirmed
  - API version 2026-03-11 confirmed current
- **Blocker:** Real-provider verification requires test workspace (Task 0.2)

### Task 0.2: Test Environment
- **Status:** BLOCKED — requires human action
- **Artifact:** `docs/test-environment-setup.md`
- **Deliverables complete:** .env.example, .gitignore, environment configs documented
- **Blocker:** Need user to create Notion test workspace + public OAuth integration

### Task 0.3: Threat Model
- **Status:** COMPLETE
- **Artifact:** `docs/threat-model.md`
- **Coverage:** 20 threats, all with preconditions/impact/mitigation/verification/residual risk
- **Approval invariant documented**

### Task 0.4: Growth Environment
- **Status:** NEAR COMPLETE — scaffolded; execution pending Deno install
- **Artifacts:**
  - `deno.json` — pinned versions, all tasks defined
  - `compose.yaml` — Postgres 16.4, Redis 7.4, Notion Fake, JWKS Issuer
  - `test-support/notion-fake/server.ts` + Dockerfile
  - `test-support/jwks-issuer/server.ts` + Dockerfile
  - `tests/unit/foundation_test.ts` — proves test runner
  - `tests/unit/property_test.ts` — proves fast-check under Deno
  - `.github/workflows/pr-ci.yml` — deterministic CI
  - `.github/workflows/contract-ci.yml` — credential-gated, serialized
  - `test-support/fixtures/synthetic/notion-error-responses.json`
  - `docs/evidence-index.md`
- **Blockers:**
  1. Deno not installed — cannot run deno task check/lint/test
  2. StrykerJS Deno compat unverified (highest-risk tool decision)

---

## Human Blockers

1. **Install Deno 2.9.7:** `curl -fsSL https://deno.land/install.sh | sh` or `brew install deno`
2. **Create Notion test workspace:** See `docs/test-environment-setup.md`
3. **Create public OAuth integration:** See `docs/test-environment-setup.md`

---

## Files Created

| Path | Purpose |
|---|---|
| `DECISIONS.md` | SDK/runtime decisions with version pins |
| `deno.json` | Runtime config, tasks, dependencies |
| `.env.example` | Environment variable placeholders |
| `.gitignore` | Git exclusions |
| `compose.yaml` | Local dev services |
| `src/main.ts` | Entry point placeholder |
| `tests/unit/foundation_test.ts` | Test runner validation |
| `tests/unit/property_test.ts` | fast-check validation |
| `tests/spike/compatibility-spike.ts` | Disposable compat spike |
| `test-support/notion-fake/server.ts` | Deterministic Notion fake |
| `test-support/notion-fake/Dockerfile` | Notion fake container |
| `test-support/jwks-issuer/server.ts` | Local JWT issuer |
| `test-support/jwks-issuer/Dockerfile` | JWKS issuer container |
| `test-support/fixtures/synthetic/notion-error-responses.json` | Error fixtures |
| `migrations/001_bootstrap.sql` | Migration placeholder |
| `docs/notion-endpoints.md` | Endpoint manifest |
| `docs/threat-model.md` | Threat model |
| `docs/evidence-index.md` | Evidence tracking |
| `docs/test-environment-setup.md` | Test environment instructions |
| `.github/workflows/pr-ci.yml` | PR CI pipeline |
| `.github/workflows/contract-ci.yml` | Contract CI pipeline |
| `PROGRESS.md` | This file |

---

## Decisions Made

See `DECISIONS.md` for full details. Summary:
- Runtime: Deno 2.9.7
- MCP SDK: @modelcontextprotocol/sdk v2.0.0
- Notion SDK: @notionhq/client 5.27.0
- Postgres: postgres.js 3.4.5
- Redis: ioredis 5.6.1
- Validation: Zod 3.24.4
- Property testing: fast-check 3.23.2
- Mutation testing: StrykerJS 8.7.1 (HIGH RISK — Deno compat unverified)
- Secrets: Gitleaks 8.30.1
- Scanning: Trivy 0.71.0
- SBOM: Syft 1.42.0

---

## Conflicts with Canonical Spec

1. **CONFLICT-001:** Spec says OAuth returns `expires_in`; official docs do not show it. Decision: implement refresh-on-401 + configurable TTL.
2. **CONFLICT-002:** Spec says webhook event field is `id`; official docs confirm `id` — conflict resolved, no actual conflict.

---

## Next Action

Install Deno 2.9.7 → run `docker compose up -d` → run `deno task spike` → run `deno task test` → run `deno task check` + `deno task lint` + `deno task fmt:check` → init git repo → commit → report Checkpoint 0.
