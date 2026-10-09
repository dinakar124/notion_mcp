# SDK and Runtime Decisions — Task 0.0

**Status:** In progress — protocol adapter feasibility proven (59/59); full dependency compatibility unverified
**Date:** 2026-10-09 (updated 2026-10-09T06:35Z)
**Canonical source:** notion-mcp-product-spec-v3.md §13 (Build Strategy), §4 (MCP Protocol)

---

## Runtime

| Field | Value |
|---|---|
| **Package/tool** | Deno |
| **Exact version** | 2.9.7 |
| **License** | MIT |
| **Required capability** | TypeScript-native runtime, HTTP server, npm compat, WebCrypto, lockfile |
| **Evidence checked** | GitHub releases (denoland/deno v2.9.7 released 2026-09-16); Deno 2.8+ passes 75%+ of Node test suite; native npm: specifier support confirmed. Installed on host: `deno 2.9.7 (stable, release, aarch64-apple-darwin)` |
| **Decision** | ADOPT |
| **Known limitation** | None — installed and verified on host |
| **Fallback** | Node.js 22 LTS with tsx |

---

## MCP Protocol SDK

| Field | Value |
|---|---|
| **Package/tool** | @modelcontextprotocol/server + @modelcontextprotocol/core (v2 line) |
| **Exact pinned version** | 2.3.1 (both server and core) |
| **License** | MIT |
| **Required capability** | 2026-07-28 Streamable HTTP, MRTR/InputRequiredResult, subscriptions/listen, request metadata headers, server/discover |
| **Deno compatibility** | ESM-first; Deno imports npm packages via `npm:` specifier. V2 SDK is ESM-native. |
| **Evidence checked** | Runtime inspection of pinned `@modelcontextprotocol/server@2.3.1`: exports `LATEST_PROTOCOL_VERSION = "2025-11-25"`; legacy handler does NOT implement `server/discover`. `@modelcontextprotocol/core@2.3.1`: exports modern schemas (DiscoverRequestSchema, SubscriptionsListenRequestSchema, ElicitRequestParamsSchema, etc.) but they are permissive — accept top-level `resultType`/`ttlMs`/`cacheScope` but do not require them. |
| **Decision** | PARTIAL ADOPT — reuse `@modelcontextprotocol/core` Zod schemas as floor validation for JSON-RPC parsing, tool/resource schema registration, and typed error codes. Do NOT use `@modelcontextprotocol/server` legacy handler for transport (it targets 2025-11-25 protocol, not 2026-07-28). Implement a thin custom MCP 2026-07-28 POST-only transport/dispatch adapter at Task 2.7, using core schemas underneath. No SDK fork or monkey-patch. |
| **SDK-lag finding** | The official SDK v2.3.1 server runtime lags the published 2026-07-28 spec: no native `server/discover`, no stateless POST-only enforcement, `LATEST_PROTOCOL_VERSION` is 2025-11-25. Core schemas export the modern shapes but are permissive. |
| **Adapter feasibility** | PROVEN at Stage 0: `deno task spike:adapter` — 59 tests passed, 0 failed, <10s, loopback-only. Tests cover: stateless POST-only dispatch, server/discover, tools/list+call without initialize/session, MRTR elicitation, subscription acknowledgment, header validation, core schema reuse, error codes. |
| **Production conformance** | NOT PROVEN — full MCP 2026-07-28 wire conformance is a Layer 2 / Checkpoint 2C concern |
| **Fallback** | If core schemas diverge from published spec, hand-roll Zod schemas from the [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28) directly |

---

## Notion SDK

| Field | Value |
|---|---|
| **Package/tool** | @notionhq/client |
| **Exact version** | 5.27.0 |
| **License** | MIT |
| **Required capability** | Notion API 2026-03-11, Data Sources API, OAuth token exchange/refresh, typed responses |
| **Deno compatibility** | Pure JS npm package; compatible via `npm:` specifier |
| **Evidence checked** | GitHub releases (makenotion/notion-sdk-js v5.27.0 released 2026-09-29); Algolia docs confirm "supports Notion API versions 2025-09-03 and 2026-03-11"; release notes confirm data sources, agents, sessions APIs |
| **Decision** | ADOPT — use as Notion API client behind a versioned NotionAdapter interface seam |
| **Data Sources API** | Confirmed: `POST /v1/data_sources/{data_source_id}/query` is the correct path for 2026-03-11 (deprecated: `/v1/databases/{id}/query`). SDK v5.25+ supports data sources. |
| **OAuth token refresh** | Confirmed: SDK supports OAuth token exchange. Token refresh fields need real-API verification (Task 0.1). |
| **Webhook types** | SDK does not handle webhook ingestion (server-side concern). Webhook signature and event types documented in Notion API reference — verified in Task 0.1. |
| **Known limitation** | v5.27.0 blocks tokens in browsers by default (irrelevant for server). Agent Skills API additions are not needed for our use case. |
| **Fallback** | Direct HTTP calls via fetch with typed response schemas |

---

## PostgreSQL Driver

| Field | Value |
|---|---|
| **Package/tool** | postgres (postgres.js by porsager) |
| **Exact version** | 3.4.5 |
| **License** | Unlicense |
| **Required capability** | Deno-native, tagged template queries, connection pooling, transactions, LISTEN/NOTIFY |
| **Deno compatibility** | Explicitly supports Deno via `deno/` entrypoint. Deno docs recommend it. |
| **Evidence checked** | GitHub porsager/postgres README ("Fastest full featured PostgreSQL client for Node.js, Deno, Bun and CloudFlare"); Deno official docs link to postgres.js |
| **Decision** | ADOPT |
| **Known limitation** | Version number pending spike verification. Using 3.4.5 as latest known. |
| **Fallback** | deno-postgres (denodrivers/postgres) — Deno-native but less actively maintained |

---

## Redis Client

| Field | Value |
|---|---|
| **Package/tool** | ioredis |
| **Exact version** | 5.6.1 |
| **License** | MIT |
| **Required capability** | Redis Streams (XADD/XREADGROUP/XACK), Pub/Sub, Lua scripting (EVAL/EVALSHA), pipelining |
| **Deno compatibility** | Node-compatible npm package; works via Deno's npm: specifier + Node compat layer |
| **Evidence checked** | GitHub redis/ioredis README confirms: "supports Cluster, Sentinel, Streams, Pipelining, and of course Lua scripting, Redis Functions, Pub/Sub". Most widely used Redis client in JS ecosystem. |
| **Decision** | ADOPT — ioredis has the most complete feature set for our requirements (Streams + Pub/Sub + Lua all required) |
| **Known limitation** | Deno compat relies on Node compat layer (net, events modules). Spike must verify. |
| **Fallback** | denodrivers/redis (Deno-native, but Streams/Lua support less proven) or iuioiua/redis (Web Streams API based) |

---

## OpenTelemetry

| Field | Value |
|---|---|
| **Package/tool** | @opentelemetry/api + @opentelemetry/sdk-trace-base + @opentelemetry/resources + @opentelemetry/context-async-hooks |
| **Exact versions** | @opentelemetry/api@1.9.0, @opentelemetry/sdk-trace-base@2.12.0, @opentelemetry/resources@2.12.0, @opentelemetry/context-async-hooks@2.12.0 |
| **License** | Apache-2.0 |
| **Required capability** | Distributed tracing, metrics, log correlation |
| **Deno compatibility** | npm userland OTel stack works under Deno without `--unstable-otel`. Spike proven: `deno task spike:otel` — 10 passed, 0 failed, ~44ms. Permission only `OTEL_*` env vars. |
| **Evidence checked** | `deno task spike:otel`: in-memory exporter, resource attributes, span IDs, events/status/exception recording, async parent-child context propagation, clean shutdown — all verified. Deno `--unstable-otel` NOT required for npm userland stack. |
| **Decision** | ADOPT — use npm userland OTel stack (@opentelemetry/api + sdk-trace-base + resources + context-async-hooks). Production OTLP exporter, metrics, and logs deferred to Layer 4. |
| **Known limitation** | Production OTLP/metrics/logs not yet validated. In-memory exporter only at Stage 0. |
| **Fallback** | Deno native `--unstable-otel` if npm userland stack proves insufficient at scale |

---

## Validation

| Field | Value |
|---|---|
| **Package/tool** | Zod |
| **Exact version** | 4.6.5 |
| **License** | MIT |
| **Required capability** | Runtime schema validation, TypeScript type inference, strict unknown-field policy |
| **Deno compatibility** | Pure TypeScript; fully Deno-compatible |
| **Evidence checked** | Zod is the de facto validation library in the TS ecosystem; MCP SDK v2 uses Zod internally. Live pin in `deno.json`: `"zod": "npm:zod@4.6.5"`. |
| **Decision** | ADOPT |
| **Known limitation** | None identified |
| **Fallback** | Valibot (lighter) or ArkType |

---

## Property-Based Testing

| Field | Value |
|---|---|
| **Package/tool** | fast-check |
| **Exact version** | 3.23.2 |
| **License** | MIT |
| **Required capability** | Property-based test generation, shrinking, stateful testing |
| **Deno compatibility** | Pure TypeScript; works with Deno test runner. Gist by cdoremus demonstrates Deno usage. |
| **Evidence checked** | GitHub dubzzz/fast-check; community Deno usage gist; fast-check.dev docs confirm runner-agnostic |
| **Decision** | ADOPT — must prove running inside project in Task 0.4 |
| **Known limitation** | No native Deno test runner integration; works via standard import |
| **Fallback** | jsverify (less maintained) |

---

## Mutation Testing

| Field | Value |
|---|---|
| **Package/tool** | @stryker-mutator/core (StrykerJS) |
| **Exact version** | 9.6.1 |
| **License** | Apache-2.0 |
| **Required capability** | TypeScript mutation testing, CI integration, mutation score reporting |
| **Deno compatibility** | StrykerJS is Node/npm-oriented. Runs under host Node (not Deno runtime). Deno test runner invoked via Stryker command runner with `deno test --allow-env=__STRYKER_ACTIVE_MUTANT__,__STRYKER_MUTANT_COVERAGE__` — minimal permissions for injected instrumentation only; no read/network. |
| **Node compatibility** | Host Node 23.7 satisfies v9 engine requirement (>=20). v10 was rejected: transitive Babel 8 excludes Node 23, and npm audit showed vulnerabilities. |
| **Evidence checked** | `deno task test:mutation:tooling` — 55 mutants generated, 55 killed, 0 survived/no-coverage/errors, 100% mutation score, exit 0, ~2s, concurrency 1, 100% break threshold. npm ls valid; npm audit 0 vulnerabilities; exact qs override 6.16.0. |
| **Decision** | ADOPT — @stryker-mutator/core@9.6.1 with command runner, isolated under `tooling/mutation/`. Root npm package files removed; npm tree is isolated from Deno `nodeModulesDir: auto`. Stage 0 mutation-tool viability proven. Checkpoint 1 will require mutation on actual product cells under frozen acceptance contracts. |
| **Known limitation** | Stryker does not natively support Deno's test runner. Command runner bridges by shelling to `deno test`. Stryker v10 was attempted and rejected (unsupported transitive engines on Node 23, audit vulnerabilities). |
| **Fallback** | Manual mutation testing via custom script that applies AST transforms and runs `deno test`. Less feature-rich but Deno-native. |

---

## Secret Scanning

| Field | Value |
|---|---|
| **Package/tool** | Gitleaks |
| **Exact version** | 8.30.1 |
| **License** | MIT |
| **Required capability** | Git history scanning, working-tree scanning, CI integration, SARIF output |
| **Evidence checked** | GitHub gitleaks/gitleaks; blog post confirms v8.30.1 (March 2026) with composite rules, archive scanning, base64/hex/URL decoding |
| **Decision** | ADOPT — pin exact version in CI |
| **Known limitation** | Requires Go binary; GitHub Action available (gitleaks/gitleaks-action) |
| **Fallback** | Betterleaks (compatible config format) |

---

## Image/Container and Filesystem Scanning

| Field | Value |
|---|---|
| **Package/tool** | Trivy |
| **Exact version** | 0.75.0 (project-local arm64 binary; SHA-verified from official release) |
| **License** | Apache-2.0 |
| **Required capability** | Container vulnerability scanning, secret scanning in images, filesystem scanning |
| **Evidence checked** | Project-local official arm64 asset, manifest single source, exact archive + installed-binary SHA verified idempotently. `trivy filesystem` CRITICAL/HIGH 0 (after non-root fix). Image-layer scanning requires Docker runtime (not yet available). |
| **Decision** | ADOPT — filesystem scanning proven; image scanning deferred to Docker availability |
| **Known limitation** | Filesystem scan proven; Docker image-layer scan NOT proven (no container runtime). Distinguish filesystem Trivy from image-layer Trivy. |
| **Fallback** | Grype (Anchore) for vulnerability scanning |

---

## SBOM Generation

| Field | Value |
|---|---|
| **Package/tool** | Syft (Anchore) |
| **Exact version** | 1.54.1 (project-local arm64 binary; SHA-verified from official release) |
| **License** | Apache-2.0 |
| **Required capability** | CycloneDX or SPDX SBOM generation from filesystem/container |
| **Evidence checked** | CycloneDX SBOM generated, valid, 39 components. Scanner binaries excluded from SBOM. Output gitignored. |
| **Decision** | ADOPT — generate SBOM in CI alongside Trivy |
| **Known limitation** | Separate binary; not integrated with Deno toolchain. SBOM generated from filesystem only; container SBOM requires Docker. |
| **Fallback** | Trivy can also generate SBOMs (trivy fs --format cyclonedx) |

---

## Summary Table

| Tool | Version | License | Decision | Deno Compat | Risk |
|---|---|---|---|---|---|
| Deno | 2.9.7 | MIT | ADOPT | N/A (is runtime) | LOW — installed and verified |
| MCP SDK v2 | server@2.3.1 + core@2.3.1 | MIT | PARTIAL ADOPT + custom adapter | npm: specifier | MEDIUM — SDK lags spec; adapter feasibility proven |
| @notionhq/client | 5.27.0 | MIT | ADOPT | npm: specifier | LOW |
| postgres.js | 3.4.5 | Unlicense | ADOPT | Native Deno support | MEDIUM — Deno compat unverified |
| ioredis | 5.6.1 | MIT | ADOPT | npm: compat layer | MEDIUM — Deno compat unverified |
| @opentelemetry/* | api@1.9.0, sdk-trace-base@2.12.0, resources@2.12.0, context-async-hooks@2.12.0 | Apache-2.0 | ADOPT | npm userland (no --unstable-otel) | LOW — spike 10/10 proven |
| Zod | 4.6.5 | MIT | ADOPT | Pure TS | LOW |
| fast-check | 3.23.2 | MIT | ADOPT | Pure TS | LOW — proven in 0.4 |
| StrykerJS | @stryker-mutator/core@9.6.1 | Apache-2.0 | ADOPT (command runner) | Via host Node 23.7 | LOW — Stage 0 viability proven (55/55 killed) |
| Gitleaks | 8.30.1 | MIT | ADOPT | N/A (project-local binary) | LOW — 0 findings (git history + worktree) |
| Trivy | 0.75.0 | Apache-2.0 | ADOPT | N/A (project-local binary) | LOW — filesystem CRITICAL/HIGH 0; image scan deferred |
| Syft | 1.54.1 | Apache-2.0 | ADOPT | N/A (project-local binary) | LOW — CycloneDX SBOM valid, 39 components |
| actionlint | 1.7.12 | MIT | ADOPT | N/A (project-local binary) | LOW — 0 findings with ShellCheck |
| ShellCheck | 0.11.0 | GPL-3.0 | ADOPT | N/A (project-local binary) | LOW — used by actionlint |

---

## Deviations from Canonical Specification

1. **MCP SDK does not natively conform to 2026-07-28 spec.** The pinned `@modelcontextprotocol/server@2.3.1` exports `LATEST_PROTOCOL_VERSION = "2025-11-25"` and its legacy handler lacks `server/discover`. Decision: do NOT downgrade product spec; do NOT claim native SDK conformance. Use `@modelcontextprotocol/core@2.3.1` schemas as floor validation and implement a thin custom adapter at Task 2.7. No SDK fork. Adapter feasibility proven at Stage 0 (59/59 spike tests). Production conformance is Checkpoint 2C.

## Unresolved

1. **ioredis Deno compat** — Streams + Pub/Sub + Lua through Deno's Node compat layer needs infra spike verification.
2. **Exact postgres.js version** — 3.4.5 is best known; spike will confirm latest available via npm.
3. **OAuth `expires_in` / refresh token rotation** — OFFICIAL_DOC does not document `expires_in`; rotation behavior confirmed by third-party only (REAL_API needed). No invented TTL values.
4. **Docker image-layer scanning** — Trivy filesystem scan proven; image-layer scan requires Docker runtime.
5. **CI execution** — Workflows statically validated (actionlint 0 findings); never executed in GitHub Actions.
