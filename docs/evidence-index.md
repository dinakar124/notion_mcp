# Evidence Index — Notion MCP Server

**Date:** 2026-10-09
**Status:** Active — updated as evidence is gathered

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
| **Claim** | `POST /v1/oauth/token` returns: access_token, token_type, refresh_token (string\|null), bot_id, workspace_icon, workspace_name, workspace_id, owner, duplicated_template_id, request_id. NO `expires_in` field. |
| **Source type** | Official documentation |
| **Source** | https://developers.notion.com/reference/refresh-a-token |
| **Doc/API version** | 2026-03-11 |
| **Date accessed** | 2026-10-09 |
| **Section** | Authentication > Refresh a token |
| **Verification level** | OFFICIAL_DOC |
| **Fixture path** | N/A |
| **Depends on** | OAuth flow, token refresh, credential storage |
| **Uncertainty** | **CONFLICT with spec §5:** spec states `expires_in` is returned; official docs do not show it. Real-provider verification needed. |
| **Decision** | Implement refresh-on-401 + proactive refresh on configurable TTL. Do NOT rely on `expires_in` until REAL_API verified. |

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

### E-006: MCP SDK v2 Supports 2026-07-28 Spec

| Field | Value |
|---|---|
| **Claim** | @modelcontextprotocol/sdk v2 (2.0.0) implements the 2026-07-28 MCP specification including Streamable HTTP, MRTR, subscriptions/listen |
| **Source type** | Official SDK documentation |
| **Source** | https://ts.sdk.modelcontextprotocol.io/v2/ |
| **Date accessed** | 2026-10-09 |
| **Verification level** | OFFICIAL_DOC |
| **Depends on** | All MCP protocol handling |
| **Uncertainty** | 2026-07-28 wire format requires explicit opt-in per migration docs |
| **Decision** | ADOPT with explicit 2026-07-28 configuration |

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
| **Claim** | Deno 2.9.7 is latest stable release with 75%+ Node test suite pass rate and npm compat |
| **Source type** | Official release |
| **Source** | https://github.com/denoland/deno/releases/tag/v2.9.7 |
| **Date accessed** | 2026-10-09 |
| **Verification level** | OFFICIAL_DOC |
| **Depends on** | Runtime selection |
| **Uncertainty** | Not installed on current host |

---

## Evidence Precedence (from prompt)

**For product intent:**
1. Canonical product specification
2. Canonical implementation plan
3. Explicit user decision
4. Everything else

**For external provider behavior:**
1. Current real API observation (REAL_API)
2. Current official provider documentation (OFFICIAL_DOC)
3. Versioned official SDK behavior
4. Sanitized historical fixture
5. Synthetic fixture
