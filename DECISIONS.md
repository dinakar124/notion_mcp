# SDK and Runtime Decisions — Task 0.0

**Status:** Complete (pending executable spike — Deno not installed on host)
**Date:** 2026-10-09
**Canonical source:** notion-mcp-product-spec-v3.md §13 (Build Strategy), §4 (MCP Protocol)

---

## Runtime

| Field | Value |
|---|---|
| **Package/tool** | Deno |
| **Exact version** | 2.9.7 |
| **License** | MIT |
| **Required capability** | TypeScript-native runtime, HTTP server, npm compat, WebCrypto, lockfile |
| **Evidence checked** | GitHub releases (denoland/deno v2.9.7 released 2026-09-16); Deno 2.8+ passes 75%+ of Node test suite; native npm: specifier support confirmed |
| **Decision** | ADOPT |
| **Known limitation** | Not installed on current host — requires `curl -fsSL https://deno.land/install.sh \| sh` or `brew install deno` |
| **Fallback** | Node.js 22 LTS with tsx |

---

## MCP Protocol SDK

| Field | Value |
|---|---|
| **Package/tool** | @modelcontextprotocol/sdk (v2 line: @modelcontextprotocol/core, @modelcontextprotocol/server, @modelcontextprotocol/client) |
| **Exact version** | 2.0.0 (v2 stable, released alongside 2026-07-28 spec) |
| **License** | MIT |
| **Required capability** | 2026-07-28 Streamable HTTP, MRTR/InputRequiredResult, subscriptions/listen, request metadata headers, server/discover |
| **Deno compatibility** | ESM-first; Deno imports npm packages via `npm:` specifier. V2 SDK is ESM-native. |
| **Evidence checked** | GitHub typescript-sdk README ("v2 is the stable release line, released alongside the 2026-07-28 spec"); v2 migration docs confirm Streamable HTTP support; ROADMAP.md confirms v2.0.0 stable |
| **Decision** | ADOPT — use SDK for JSON-RPC parsing, transport scaffolding, tool/resource registration, SSE streaming. Custom middleware for auth, admission, scheduling wraps SDK hooks. |
| **MRTR support** | Confirmed: v2 SDK implements InputRequiredResult per 2026-07-28 spec |
| **subscriptions/listen** | Confirmed: v2 SDK supports SSE streaming for subscriptions |
| **Request metadata headers** | Confirmed: Mcp-Method, Mcp-Name, MCP-Protocol-Version, x-mcp-header support |
| **server/discover** | Confirmed: mandatory in 2026-07-28 spec, implemented in v2 SDK |
| **Known limitation** | SDK opt-in required for 2026-07-28 wire format (does not default). Must explicitly configure. |
| **Fallback** | Hand-roll JSON-RPC + Streamable HTTP transport (significant effort) |

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
| **Package/tool** | @opentelemetry/api + @opentelemetry/sdk-node + @opentelemetry/exporter-otlp-http |
| **Exact version** | @opentelemetry/api@1.9.0, @opentelemetry/sdk-node@0.57.0 |
| **License** | Apache-2.0 |
| **Required capability** | Distributed tracing, metrics, log correlation |
| **Deno compatibility** | OTel JS SDK is Node-oriented; Deno support is experimental but functional via npm compat. Deno 2.8+ has native OTel support via `--unstable-otel`. |
| **Evidence checked** | Deno blog (v2.7+) mentions OTel integration; OpenTelemetry JS SDK npm packages available |
| **Decision** | ADOPT — use Deno's native `--unstable-otel` for traces; supplement with npm OTel API for manual spans |
| **Known limitation** | Deno's native OTel is still under `--unstable-otel` flag. May need npm SDK as fallback. |
| **Fallback** | Pure npm @opentelemetry/* packages |

---

## Validation

| Field | Value |
|---|---|
| **Package/tool** | Zod |
| **Exact version** | 3.24.4 |
| **License** | MIT |
| **Required capability** | Runtime schema validation, TypeScript type inference, strict unknown-field policy |
| **Deno compatibility** | Pure TypeScript; fully Deno-compatible |
| **Evidence checked** | Zod is the de facto validation library in the TS ecosystem; MCP SDK v2 uses Zod internally |
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
| **Package/tool** | StrykerJS |
| **Exact version** | 8.7.1 |
| **License** | Apache-2.0 |
| **Required capability** | TypeScript mutation testing, CI integration, mutation score reporting |
| **Deno compatibility** | StrykerJS is Node/npm-oriented. Deno compatibility is UNVERIFIED. Stryker uses Node test runners (Jest, Vitest, Mocha). |
| **Evidence checked** | stryker-mutator.io; GitHub issues mention TypeScript-embedding compatibility as "later qualification"; no official Deno support. |
| **Decision** | WRAP — use StrykerJS with Vitest runner adapter, running via `deno task` shelling to npx. If Deno-native execution fails, run mutation tests via Node as a separate CI step. Must prove in Task 0.4. |
| **Known limitation** | Stryker does not natively support Deno's test runner. Requires Vitest bridge or Node execution. This is the highest-risk tool decision. |
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

## Image/Container Scanning

| Field | Value |
|---|---|
| **Package/tool** | Trivy |
| **Exact version** | 0.71.0 |
| **License** | Apache-2.0 |
| **Required capability** | Container vulnerability scanning, secret scanning in images, filesystem scanning |
| **Evidence checked** | GitHub aquasecurity/trivy; tech-insider.org confirms v0.71.0 (June 2026); supports SBOM, vuln, secret, IaC scanning |
| **Decision** | ADOPT — pin in CI for container and filesystem scanning |
| **Known limitation** | Requires binary installation; not a Deno package |
| **Fallback** | Grype (Anchore) for vulnerability scanning |

---

## SBOM Generation

| Field | Value |
|---|---|
| **Package/tool** | Syft (Anchore) |
| **Exact version** | 1.42.0 |
| **License** | Apache-2.0 |
| **Required capability** | CycloneDX or SPDX SBOM generation from filesystem/container |
| **Evidence checked** | GitHub anchore/syft; appsecsanta.com confirms v1.42.0 (February 2026) |
| **Decision** | ADOPT — generate SBOM in CI alongside Trivy |
| **Known limitation** | Separate binary; not integrated with Deno toolchain |
| **Fallback** | Trivy can also generate SBOMs (trivy fs --format cyclonedx) |

---

## Summary Table

| Tool | Version | License | Decision | Deno Compat | Risk |
|---|---|---|---|---|---|
| Deno | 2.9.7 | MIT | ADOPT | N/A (is runtime) | LOW — not installed, needs install |
| MCP SDK v2 | 2.0.0 | MIT | ADOPT | npm: specifier | LOW |
| @notionhq/client | 5.27.0 | MIT | ADOPT | npm: specifier | LOW |
| postgres.js | 3.4.5 | Unlicense | ADOPT | Native Deno support | LOW |
| ioredis | 5.6.1 | MIT | ADOPT | npm: compat layer | MEDIUM — needs spike |
| @opentelemetry/* | api 1.9.0 | Apache-2.0 | ADOPT | --unstable-otel + npm | MEDIUM |
| Zod | 3.24.4 | MIT | ADOPT | Pure TS | LOW |
| fast-check | 3.23.2 | MIT | ADOPT | Pure TS | LOW — must prove in 0.4 |
| StrykerJS | 8.7.1 | Apache-2.0 | WRAP | Via Node/Vitest | HIGH — must prove in 0.4 |
| Gitleaks | 8.30.1 | MIT | ADOPT | N/A (binary) | LOW |
| Trivy | 0.71.0 | Apache-2.0 | ADOPT | N/A (binary) | LOW |
| Syft | 1.42.0 | Apache-2.0 | ADOPT | N/A (binary) | LOW |

---

## Deviations from Canonical Specification

None. All decisions align with spec §13 (Deno runtime, MCP SDK adoption, external IdP, KMS-ready encryption).

## Unresolved

1. **Deno not installed on host** — executable spike cannot run until Deno is installed.
2. **ioredis Deno compat** — Streams + Pub/Sub + Lua through Deno's Node compat layer needs spike verification.
3. **StrykerJS Deno compat** — highest-risk decision; may need Node-based fallback for mutation testing.
4. **Exact postgres.js version** — 3.4.5 is best known; spike will confirm latest available via npm.
5. **OpenTelemetry Deno stability** — `--unstable-otel` flag indicates API may change.
