/**
 * Deterministic Notion API Fake
 *
 * Returns canned responses for each endpoint. Supports configurable error injection.
 * Provenance: SYNTHETIC_FIXTURE for all responses.
 *
 * Usage: deno run --allow-net=0.0.0.0 test-support/notion-fake/server.ts
 */

const PORT = parseInt(Deno.env.get('PORT') ?? '8080');
const HOST = Deno.env.get('HOST') ?? '127.0.0.1';

// Error injection state (configurable via POST /admin/inject-error)
let injectedError: { status: number; code: string; count: number } | null = null;

function checkInjectedError(): Response | null {
  if (injectedError && injectedError.count > 0) {
    injectedError.count--;
    const { status, code } = injectedError;
    if (injectedError.count === 0) injectedError = null;
    return new Response(
      JSON.stringify({
        object: 'error',
        message: `Injected ${code} error`,
        code,
        status,
        additional_data: {},
      }),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Notion-Fake': 'true',
      'X-Fixture-Provenance': 'SYNTHETIC_FIXTURE',
    },
  });
}

// Canned page object
const CANNED_PAGE = {
  object: 'page',
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  created_time: '2026-01-01T00:00:00.000Z',
  last_edited_time: '2026-10-01T00:00:00.000Z',
  archived: false,
  in_trash: false,
  url: 'https://www.notion.so/Test-Page-aaaaaaaa',
  properties: {
    Name: { id: 'title', type: 'title', title: [{ type: 'text', text: { content: 'Test Page' } }] },
  },
  parent: { type: 'workspace', workspace: true },
  icon: null,
  cover: null,
};

// Canned block objects
const CANNED_BLOCKS = [
  {
    object: 'block',
    id: '11111111-1111-1111-1111-111111111111',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: 'This is a test paragraph.' } }],
    },
  },
  {
    object: 'block',
    id: '22222222-2222-2222-2222-222222222222',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Test Heading' } }],
    },
  },
];

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Health check
  if (path === '/health') {
    return jsonResponse({ status: 'ok', service: 'notion-fake' });
  }

  // Admin: inject error
  if (path === '/admin/inject-error' && method === 'POST') {
    const body = await req.json();
    injectedError = { status: body.status, code: body.code, count: body.count ?? 1 };
    return jsonResponse({ injected: true, ...injectedError });
  }

  // Admin: clear errors
  if (path === '/admin/clear-errors' && method === 'POST') {
    injectedError = null;
    return jsonResponse({ cleared: true });
  }

  // Check for injected errors on API paths
  if (path.startsWith('/v1/')) {
    const err = checkInjectedError();
    if (err) return err;
  }

  // Validate Notion-Version header on API paths
  if (path.startsWith('/v1/')) {
    const version = req.headers.get('Notion-Version');
    if (!version) {
      return jsonResponse(
        { object: 'error', message: 'Missing Notion-Version header', code: 'missing_version', status: 400 },
        400,
      );
    }
  }

  // POST /v1/search
  if (path === '/v1/search' && method === 'POST') {
    return jsonResponse({
      object: 'list',
      results: [CANNED_PAGE],
      has_more: false,
      next_cursor: null,
      type: 'page_or_database',
    });
  }

  // GET /v1/pages/:id
  if (path.match(/^\/v1\/pages\/[a-f0-9-]+$/) && method === 'GET') {
    return jsonResponse(CANNED_PAGE);
  }

  // PATCH /v1/pages/:id
  if (path.match(/^\/v1\/pages\/[a-f0-9-]+$/) && method === 'PATCH') {
    const body = await req.json();
    return jsonResponse({ ...CANNED_PAGE, ...body });
  }

  // POST /v1/pages
  if (path === '/v1/pages' && method === 'POST') {
    return jsonResponse(
      { ...CANNED_PAGE, id: 'new-page-' + crypto.randomUUID().slice(0, 8) },
      200,
    );
  }

  // GET /v1/blocks/:id/children
  if (path.match(/^\/v1\/blocks\/[a-f0-9-]+\/children$/) && method === 'GET') {
    return jsonResponse({
      object: 'list',
      results: CANNED_BLOCKS,
      has_more: false,
      next_cursor: null,
      type: 'block',
    });
  }

  // POST /v1/data_sources/:id/query
  if (path.match(/^\/v1\/data_sources\/[a-f0-9-]+\/query$/) && method === 'POST') {
    return jsonResponse({
      object: 'list',
      results: [CANNED_PAGE],
      has_more: false,
      next_cursor: null,
      type: 'page_or_data_source',
    });
  }

  // GET /v1/users
  if (path === '/v1/users' && method === 'GET') {
    return jsonResponse({
      object: 'list',
      results: [
        {
          object: 'user',
          id: 'user-1111',
          type: 'person',
          name: 'Test User',
          person: { email: 'test@example.com' },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
  }

  // POST /v1/oauth/token
  if (path === '/v1/oauth/token' && method === 'POST') {
    return jsonResponse({
      access_token: 'ntn_fake_access_token_for_testing_only',
      token_type: 'bearer',
      refresh_token: 'ntn_fake_refresh_token_for_testing_only',
      bot_id: 'bot-fake-1111',
      workspace_icon: null,
      workspace_name: 'Test Workspace',
      workspace_id: 'ws-fake-1111',
      owner: { type: 'user', user: { id: 'user-1111', object: 'user' } },
      duplicated_template_id: null,
      request_id: 'req-fake-' + crypto.randomUUID().slice(0, 8),
    });
  }

  // Fallback: 404
  return jsonResponse(
    { object: 'error', message: `Not found: ${method} ${path}`, code: 'object_not_found', status: 404 },
    404,
  );
}

Deno.serve({ port: PORT, hostname: HOST }, handleRequest);
console.log(`Notion Fake running on http://${HOST}:${PORT}`);
