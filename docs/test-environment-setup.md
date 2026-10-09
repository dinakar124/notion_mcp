# Test Environment Setup — Task 0.2

**Status:** BLOCKED — requires human action

---

## What is Needed

A dedicated Notion test workspace and a public OAuth integration are required for:
1. Real-provider contract tests (scheduled CI)
2. OAuth flow verification
3. Webhook signature verification
4. Endpoint manifest REAL_API evidence

---

## Human Actions Required

### 1. Create a Dedicated Notion Test Workspace

**Why:** Contract tests create and modify pages/databases. A dedicated workspace isolates test data from production.

**Steps:**
1. Go to https://www.notion.so
2. Create a new workspace named "MCP Server Test" (or similar)
3. Note the workspace ID from Settings → Workspace ID

**Completion evidence:** Workspace ID available

### 2. Create a Public OAuth Integration

**Why:** The MCP server is a separate Notion OAuth client (INV-9). Public integration enables OAuth flow testing.

**Steps:**
1. Go to https://www.notion.so/my-integrations
2. Click "+ New integration"
3. Name: "notion-mcp-test"
4. Type: Public
5. Redirect URI: `http://localhost:3000/oauth/callback`
6. Capabilities: Read content, Update content, Insert content, Read user info (all needed for showcase tools)
7. Save the integration
8. Note: OAuth client ID and OAuth client secret

**Completion evidence:** Client ID and secret available

### 3. Create an Internal Integration (for contract tests)

**Why:** Simpler token for automated tests that don't need OAuth flow.

**Steps:**
1. In the same integrations page, create a new Internal integration
2. Name: "notion-mcp-contract-tests"
3. Associated workspace: your test workspace
4. Capabilities: same as above
5. Copy the Internal Integration Secret

**Completion evidence:** Internal token available

### 4. Share a Test Page with the Integration

**Why:** Internal integrations cannot create workspace-level pages (REAL_API verified — E-026). The integration needs at least one page shared with it to serve as a parent for contract test pages.

**Steps:**
1. Create a page in the test workspace named "MCP Contract Tests Root"
2. Click the ··· menu on the page → Connections → Add connections
3. Select "notion-mcp-contract-tests" integration
4. Note the page ID from the URL (the UUID after the page name)
5. Add `NOTION_TEST_PARENT_PAGE_ID=<page-id>` to `.env`

**Completion evidence:** Integration can access the shared page via `GET /v1/pages/{id}`

### 5. Store Credentials

**Local (.env):**
```bash
cp .env.example .env
# Fill in values from steps above
```

**CI (GitHub Actions secrets):**
- `NOTION_TEST_WORKSPACE_TOKEN` — internal integration secret
- `NOTION_TEST_WORKSPACE_ID` — workspace ID
- `NOTION_CLIENT_ID` — OAuth client ID
- `NOTION_CLIENT_SECRET` — OAuth client secret

**Where:** GitHub repo → Settings → Environments → Create "notion-contract" → Add secrets

### 5. Create Test Fixtures in Workspace

After setup, create:
- 2 databases (one for queries, one for schema tests)
- 5 pages with nested blocks (paragraph, heading, list, code, divider)
- Comments on at least 2 pages

### 6. Share Content with Integration

**Steps:**
1. Open each test database/page
2. Click Share → Invite → Select your integration
3. Verify the integration can access the content

---

## Cleanup Procedure

Contract tests should clean up after themselves. Pattern:

```
1. Before test: record all created page/database IDs
2. After test: archive all created objects
3. Periodic: manual cleanup of any leaked test data
```

A cleanup script will be added when the contract test framework is built (Layer 2+).

---

## Environment Configurations

| Environment | Notion | Postgres | Redis | Credentials |
|---|---|---|---|---|
| **Local dev** | Notion Fake (compose) | Local (compose) | Local (compose) | None required |
| **PR CI** | Notion Fake (service) | Service container | Service container | None required |
| **Contract CI** | Real Notion | Service container | Service container | GitHub Secrets |
| **Release smoke** | Real Notion | Real or local | Real or local | Manual |

---

## Work That Continues Without This

All deterministic development and testing can proceed without real Notion credentials:
- All unit tests (fake/mock Notion)
- Integration tests with Notion Fake
- MCP protocol conformance tests
- Security scanning
- SBOM generation

Only contract tests and REAL_API evidence collection are blocked.
