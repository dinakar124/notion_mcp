# Notion Endpoint Manifest — Task 0.1

**Canonical source:** notion-mcp-product-spec-v3.md §8 (Tools, Resources, Prompts)
**Notion API Version:** 2026-03-11
**Date:** 2026-10-09
**Status:** Complete — REAL VERIFICATION PENDING (no test workspace yet)

---

## Conflict Record

**CONFLICT-001:** Product spec (§5, Flow 2) states OAuth token exchange returns `access_token + refresh_token + expires_in`. Official Notion API documentation for `POST /v1/oauth/token` (accessed 2026-10-09) does NOT include `expires_in` in the response schema. Response fields are: `access_token`, `token_type`, `refresh_token` (string|null), `bot_id`, `workspace_icon`, `workspace_name`, `workspace_id`, `owner`, `duplicated_template_id`, `request_id`. **Resolution:** Implementation must handle the absence of `expires_in`. Use refresh-on-401 strategy plus proactive refresh based on a configured TTL (e.g., 55 minutes). Mark for real-provider verification in Task 0.2.

**CONFLICT-002:** Product spec states webhook event field is `id` (UUID). Notion official docs show the field name in the page.content_updated event payload. Real-provider verification needed to confirm exact field name. Mark for verification.

---

## Showcase Tools (spec §8.1)

### notion_search

| Field | Value |
|---|---|
| **Tool name** | notion_search |
| **Notion API version** | 2026-03-11 |
| **Endpoint** | `POST /v1/search` |
| **HTTP method** | POST |
| **Key request fields** | `query` (string), `filter` (object: { value, property }), `sort` (object: { direction, timestamp }), `start_cursor`, `page_size` (max 100) |
| **Key response fields** | `results[]` (page/database objects), `has_more`, `next_cursor`, `type` |
| **Capability requirements** | Connection must have access to searched content |
| **Pagination** | Cursor-based: `start_cursor` + `has_more` + `next_cursor`; max `page_size`: 100 |
| **Rate-limit category** | Standard (3 req/s free, 10 req/s enterprise per workspace) |
| **Retry behavior** | Safe to retry (read-only, no side effects) |
| **Idempotency classification** | READ (inherently idempotent) |
| **Related webhook events** | N/A (read-only) |
| **Official doc** | https://developers.notion.com/reference/post-search |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_get_page

| Field | Value |
|---|---|
| **Tool name** | notion_get_page |
| **Notion API version** | 2026-03-11 |
| **Endpoint** | `GET /v1/pages/{page_id}` |
| **HTTP method** | GET |
| **Key request fields** | `page_id` (path param), `filter_properties` (query param, optional) |
| **Key response fields** | `object`, `id`, `created_time`, `last_edited_time`, `archived`, `in_trash`, `properties`, `parent`, `url`, `icon`, `cover` |
| **Capability requirements** | Connection must have Read content capability; page must be shared with connection |
| **Pagination** | N/A (single object) |
| **Rate-limit category** | Standard |
| **Retry behavior** | Safe to retry (read-only) |
| **Idempotency classification** | READ |
| **Related webhook events** | `page.properties_updated`, `page.content_updated` |
| **Official doc** | https://developers.notion.com/reference/retrieve-a-page |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_read_page_content

| Field | Value |
|---|---|
| **Tool name** | notion_read_page_content |
| **Notion API version** | 2026-03-11 |
| **Endpoint** | `GET /v1/blocks/{block_id}/children` |
| **HTTP method** | GET |
| **Key request fields** | `block_id` (path param = page_id), `start_cursor`, `page_size` (max 100) |
| **Key response fields** | `results[]` (block objects), `has_more`, `next_cursor`, `type`, `block` |
| **Capability requirements** | Read content |
| **Pagination** | Cursor-based: `start_cursor` + `has_more`; max 100 per page |
| **Rate-limit category** | Standard |
| **Retry behavior** | Safe to retry (read-only) |
| **Idempotency classification** | READ |
| **Related webhook events** | `page.content_updated` |
| **Official doc** | https://developers.notion.com/reference/get-block-children |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_create_page

| Field | Value |
|---|---|
| **Tool name** | notion_create_page |
| **Notion API version** | 2026-03-11 |
| **Endpoint** | `POST /v1/pages` |
| **HTTP method** | POST |
| **Key request fields** | `parent` ({ data_source_id } or { page_id }), `properties` (required), `children` (optional block array), `icon`, `cover` |
| **Key response fields** | `object`, `id`, `created_time`, `properties`, `parent`, `url` |
| **Capability requirements** | Insert content; parent must be shared with connection |
| **Pagination** | N/A (single create) |
| **Rate-limit category** | Standard |
| **Retry behavior** | NOT safe to blindly retry — NON-IDEMPOTENT. Duplicate creates produce duplicate pages. |
| **Idempotency classification** | NON-IDEMPOTENT → AMBIGUOUS_REQUIRES_REVIEW on failure |
| **Related webhook events** | `page.created` |
| **Official doc** | https://developers.notion.com/reference/post-page |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_archive_page

| Field | Value |
|---|---|
| **Tool name** | notion_archive_page |
| **Notion API version** | 2026-03-11 |
| **Endpoint** | `PATCH /v1/pages/{page_id}` |
| **HTTP method** | PATCH |
| **Key request fields** | `page_id` (path param), `archived: true` |
| **Key response fields** | `object`, `id`, `archived`, `in_trash` |
| **Capability requirements** | Update content; page must be shared |
| **Pagination** | N/A |
| **Rate-limit category** | Standard |
| **Retry behavior** | Safe to retry — NATURALLY IDEMPOTENT (archiving already-archived page is no-op) |
| **Idempotency classification** | NATURALLY IDEMPOTENT → reconcile by reading archived status |
| **Related webhook events** | `page.properties_updated`, `page.moved_to_trash` |
| **Official doc** | https://developers.notion.com/reference/patch-page |
| **Real verification** | REAL VERIFICATION PENDING |

---

## Additional Tools (spec §8.1, full catalog)

### notion_update_page

| Field | Value |
|---|---|
| **Tool name** | notion_update_page |
| **Endpoint** | `PATCH /v1/pages/{page_id}` |
| **Idempotency** | NATURALLY IDEMPOTENT (read + compare) |
| **Related events** | `page.properties_updated` |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_restore_page

| Field | Value |
|---|---|
| **Tool name** | notion_restore_page |
| **Endpoint** | `PATCH /v1/pages/{page_id}` with `archived: false, in_trash: false` |
| **Idempotency** | NATURALLY IDEMPOTENT |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_append_blocks

| Field | Value |
|---|---|
| **Tool name** | notion_append_blocks |
| **Endpoint** | `PATCH /v1/blocks/{block_id}/children` |
| **Idempotency** | NON-IDEMPOTENT → AMBIGUOUS_REQUIRES_REVIEW |
| **Related events** | `page.content_updated` |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_update_block

| Field | Value |
|---|---|
| **Tool name** | notion_update_block |
| **Endpoint** | `PATCH /v1/blocks/{block_id}` |
| **Idempotency** | NATURALLY IDEMPOTENT |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_delete_block

| Field | Value |
|---|---|
| **Tool name** | notion_delete_block |
| **Endpoint** | `DELETE /v1/blocks/{block_id}` |
| **Idempotency** | NATURALLY IDEMPOTENT (deleting already-deleted = no-op) |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_create_database

| Field | Value |
|---|---|
| **Tool name** | notion_create_database |
| **Endpoint** | `POST /v1/databases` |
| **Idempotency** | NON-IDEMPOTENT → AMBIGUOUS_REQUIRES_REVIEW |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_update_database

| Field | Value |
|---|---|
| **Tool name** | notion_update_database |
| **Endpoint** | `PATCH /v1/databases/{database_id}` |
| **Idempotency** | NATURALLY IDEMPOTENT |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_create_comment

| Field | Value |
|---|---|
| **Tool name** | notion_create_comment |
| **Endpoint** | `POST /v1/comments` |
| **Idempotency** | NON-IDEMPOTENT → AMBIGUOUS_REQUIRES_REVIEW |
| **Related events** | `comment.created` |
| **Real verification** | REAL VERIFICATION PENDING |

### notion_query_data_source

| Field | Value |
|---|---|
| **Tool name** | notion_query_data_source |
| **Notion API version** | 2026-03-11 |
| **Endpoint** | `POST /v1/data_sources/{data_source_id}/query` |
| **HTTP method** | POST |
| **Key request fields** | `data_source_id` (path), `filter`, `sorts`, `start_cursor`, `page_size` (max 100) |
| **Key response fields** | `results[]`, `has_more`, `next_cursor`, `type: "page_or_data_source"` |
| **Capability requirements** | Read content; data source must be shared |
| **Pagination** | Cursor-based |
| **Rate-limit category** | Standard |
| **Retry behavior** | Safe to retry (read-only) |
| **Idempotency** | READ |
| **Related events** | N/A (read) |
| **Official doc** | https://developers.notion.com/reference/query-a-data-source |
| **Real verification** | REAL VERIFICATION PENDING |
| **VERIFIED (OFFICIAL_DOC)** | Endpoint path `POST /v1/data_sources/{data_source_id}/query` confirmed 2026-10-09. Response includes status codes: 200, 400, 401, 403, 404, 406, 409, 429, 500, 503, 504, 529. |

---

## OAuth Endpoints

### Token Exchange

| Field | Value |
|---|---|
| **Endpoint** | `POST /v1/oauth/token` |
| **Auth** | Basic (base64 of client_id:client_secret) |
| **Request fields** | `grant_type: "authorization_code"`, `code`, `redirect_uri` |
| **Response fields** | `access_token`, `token_type: "bearer"`, `refresh_token` (string\|null), `bot_id`, `workspace_icon`, `workspace_name`, `workspace_id`, `owner`, `request_id` |
| **VERIFIED (OFFICIAL_DOC)** | Response schema confirmed 2026-10-09. NO `expires_in` field in documented response. See CONFLICT-001. |
| **IMPORTANT** | Notion rotates refresh tokens: each refresh returns a NEW refresh_token, invalidating the previous one. Source: nango.dev + moveworks.com docs. |

### Token Refresh

| Field | Value |
|---|---|
| **Endpoint** | `POST /v1/oauth/token` (same endpoint, different grant_type) |
| **Request fields** | `grant_type: "refresh_token"`, `refresh_token` |
| **Response fields** | Same as token exchange (new access_token + new refresh_token) |
| **VERIFIED (OFFICIAL_DOC)** | Page at developers.notion.com/reference/refresh-a-token confirmed 2026-10-09 |

### Token Revocation

| Field | Value |
|---|---|
| **Endpoint** | `POST /v1/oauth/revoke` |
| **Official doc** | https://developers.notion.com/reference/revoke-token |
| **Real verification** | REAL VERIFICATION PENDING |

### Token Introspection

| Field | Value |
|---|---|
| **Endpoint** | `POST /v1/oauth/introspect` |
| **Official doc** | https://developers.notion.com/reference/introspect-token |
| **Real verification** | REAL VERIFICATION PENDING |

---

## Webhook Events

### Signature Verification

| Field | Value |
|---|---|
| **Header** | `X-Notion-Signature` |
| **Format** | `sha256=<hex_digest>` |
| **Algorithm** | HMAC-SHA256 |
| **Signing key** | `verification_token` (sent during subscription setup) |
| **Input** | Raw request body (NOT re-serialized JSON) |
| **Comparison** | Constant-time (timing-safe) |
| **SDK helper** | `verifyWebhookSignature()` in @notionhq/client v5.23.0+ |
| **VERIFIED (OFFICIAL_DOC)** | Confirmed from developers.notion.com/reference/webhooks, accessed 2026-10-09 |

### Event Types (from Notion docs sidebar)

| Category | Event Types |
|---|---|
| **Pages** | `page.created`, `page.properties_updated`, `page.content_updated`, `page.moved_to_trash`, `page.restored_from_trash`, `page.deleted`, `page.undeleted` |
| **Databases** | Database schema events |
| **Data sources** | Data source events |
| **Comments** | `comment.created`, comment events |
| **File uploads** | File upload events |
| **Views** | View events |

**Note:** Exact event type strings need REAL_API verification. The above are derived from the sidebar navigation at developers.notion.com.

### Event Payload Structure (page.content_updated)

```json
{
  "id": "uuid",
  "type": "page.content_updated",
  "timestamp": "ISO 8601",
  "workspace_id": "uuid",
  "data": {
    "parent": { "id": "uuid", "data_source_id": "uuid" },
    "updated_blocks": [{ "id": "uuid" }]
  },
  "accessible_by": [{ "id": "uuid", "type": "string" }]
}
```

**VERIFIED (OFFICIAL_DOC):** Event structure from developers.notion.com/reference/webhooks/page-content-updated, accessed 2026-10-09.

---

## Error Response Shapes (for fixture generation)

### Standard Error

```json
{
  "object": "error",
  "message": "<string>",
  "code": "<error_code>",
  "status": <http_status>,
  "additional_data": {}
}
```

### Error Codes by Status

| Status | Code | Retry? |
|---|---|---|
| 400 | `invalid_json`, `invalid_request`, `validation_error` | No |
| 401 | `unauthorized`, `invalid_client` | No (trigger token refresh on 401) |
| 403 | `restricted_resource`, `test_env_error` | No |
| 404 | `object_not_found` | No |
| 406 | `row_limit_exceeded` | No |
| 409 | `conflict_error` | Context-dependent |
| 429 | `rate_limited` | Yes — respect Retry-After; adjust rate budget |
| 500 | `internal_server_error` | Yes — with backoff |
| 503 | `service_unavailable` | Yes — check retry_guidance |
| 504 | `gateway_timeout` | Yes — with backoff |
| 529 | `service_overload` | Circuit breaker OPEN |

**VERIFIED (OFFICIAL_DOC):** Status codes from data source query endpoint documentation, accessed 2026-10-09.

---

## Pagination and Payload Limits

| Dimension | Limit | Source |
|---|---|---|
| `page_size` max | 100 | OFFICIAL_DOC |
| Block children max per append | 100 | OFFICIAL_DOC (to verify) |
| Search results max per page | 100 | OFFICIAL_DOC |
| Nested block depth | To verify | REAL VERIFICATION PENDING |
| Request body max size | To verify | REAL VERIFICATION PENDING |

---

## File Upload Flow

| Step | Endpoint | Method |
|---|---|---|
| Reserve upload | `POST /v1/file_uploads` | POST |
| Upload content | `POST /v1/file_uploads/{upload_id}/send` | POST (multipart) |
| Complete | `POST /v1/file_uploads/{upload_id}/complete` | POST |

**Real verification:** REAL VERIFICATION PENDING — file upload endpoints documented in API sidebar.

---

## Real-Provider Verification Summary

| Endpoint | Verified Level | Date |
|---|---|---|
| `POST /v1/data_sources/{id}/query` | OFFICIAL_DOC | 2026-10-09 |
| `POST /v1/oauth/token` (exchange) | OFFICIAL_DOC | 2026-10-09 |
| `POST /v1/oauth/token` (refresh) | OFFICIAL_DOC | 2026-10-09 |
| Webhook signature (X-Notion-Signature) | OFFICIAL_DOC | 2026-10-09 |
| Webhook event (page.content_updated) | OFFICIAL_DOC | 2026-10-09 |
| All other endpoints | UNVERIFIED | — |

**Blocker:** Real-provider (REAL_API) verification requires a dedicated Notion test workspace with a public OAuth integration. This is a human action (Task 0.2).
