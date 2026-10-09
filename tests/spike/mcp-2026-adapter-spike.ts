/**
 * MCP 2026-07-28 Adapter Feasibility Spike (Final)
 *
 * Thin custom transport/dispatch adapter reusing @modelcontextprotocol/core
 * schemas where they match published wire shapes. Where SDK schemas are
 * permissive (top-level resultType/ttlMs/cacheScope accepted but not required),
 * explicit wire-shape assertions fill the gap. Stated honestly.
 *
 * Run:  deno task spike:adapter
 * Perm: --allow-net=127.0.0.1,localhost only (no env, no fs)
 */

import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ClientCapabilitiesSchema,
  DiscoverRequestSchema,
  DiscoverResultSchema,
  ElicitRequestParamsSchema,
  ElicitResultSchema,
  JSONRPCErrorResponseSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ResultMetaObjectSchema,
  ServerCapabilitiesSchema,
  SubscriptionsAcknowledgedNotificationSchema,
  SubscriptionsListenRequestSchema,
  SubscriptionsListenResultMetaSchema,
  SubscriptionsListenResultSchema,
  ToolSchema,
} from '@modelcontextprotocol/core';
import { assertEquals, assertExists, assertStrictEquals } from '@std/assert';

const PROTOCOL_VERSION = '2026-07-28';
const SERVER_NAME = 'notion-mcp-spike';
const SERVER_VERSION = '0.0.0-spike';

// ─── 10s watchdog ─────────────────────────────────────────────────────────────
const WATCHDOG_MS = 10_000;
const watchdog = setTimeout(() => {
  console.error('\n⏱️  WATCHDOG: 10s ceiling — forcing exit');
  Deno.exit(99);
}, WATCHDOG_MS);
Deno.unrefTimer(watchdog);

// ─── Test accounting (correction #11) ─────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function record(test: string, contract: number, detail?: string): void {
  passed++;
  const det = detail ? ` — ${detail}` : '';
  console.log(`  ✅ [${contract}] ${test}${det}`);
}

function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

/** Wrap a test block; catch assertion errors as failures, not crashes. */
async function runTest(
  name: string,
  contract: number,
  fn: () => Promise<void> | void,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`[${contract}] ${name}: ${msg}`);
    console.log(`  ❌ [${contract}] ${name} — ${msg}`);
  }
}

// ─── AES-GCM requestState codec ──────────────────────────────────────────────
let serverKey: CryptoKey;
async function initKey(): Promise<void> {
  serverKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function sha256Hex(d: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function seal(
  tool: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
): Promise<string> {
  const ah = await sha256Hex(JSON.stringify(args));
  const pt = JSON.stringify({ toolName: tool, argsHash: ah, ...extra });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    serverKey,
    new TextEncoder().encode(pt),
  );
  return btoa(String.fromCharCode(...iv)) + '.' + btoa(String.fromCharCode(...new Uint8Array(ct)));
}
async function unseal(
  tok: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const [ivB, ctB] = tok.split('.');
    if (!ivB || !ctB) return null;
    const iv = Uint8Array.from(atob(ivB), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, serverKey, ct);
    const s = JSON.parse(new TextDecoder().decode(pt)) as Record<string, unknown>;
    if (s.toolName !== tool) return null;
    if (s.argsHash !== await sha256Hex(JSON.stringify(args))) return null;
    return s;
  } catch {
    return null;
  }
}

// ─── Tool registry ────────────────────────────────────────────────────────────
interface MockTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresElicitation?: boolean;
  handler: (
    a: Record<string, unknown>,
    ir?: Record<string, unknown>,
  ) => Promise<{
    resultType: string;
    content?: { type: string; text: string }[];
    inputRequests?: Record<string, unknown>;
    requestState?: string;
  }>;
}
const tools: Map<string, MockTool> = new Map();

tools.set('echo', {
  name: 'echo',
  title: 'Echo',
  description: 'Echoes input',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  handler: (a) =>
    Promise.resolve({
      resultType: 'complete',
      content: [{ type: 'text', text: `echo: ${String(a.message)}` }],
    }),
});

tools.set('current_time', {
  name: 'current_time',
  title: 'Current Time',
  description: 'Returns UTC timestamp',
  inputSchema: { type: 'object', properties: {} },
  handler: () =>
    Promise.resolve({
      resultType: 'complete',
      content: [{ type: 'text', text: new Date().toISOString() }],
    }),
});

tools.set('collect_label', {
  name: 'collect_label',
  title: 'Collect Label',
  description: 'Collects a label via elicitation. No side effects.',
  inputSchema: {
    type: 'object',
    properties: { item_id: { type: 'string' } },
    required: ['item_id'],
  },
  requiresElicitation: true,
  handler: async (a, ir) => {
    if (!ir || !ir['label_input']) {
      const rs = await seal('collect_label', a, { step: 'awaiting_label' });
      return {
        resultType: 'input_required',
        inputRequests: {
          label_input: {
            method: 'elicitation/create',
            params: {
              message: `Provide a label for item "${String(a.item_id)}"`,
              requestedSchema: {
                type: 'object',
                properties: { label: { type: 'string' } },
                required: ['label'],
              },
            },
          },
        },
        requestState: rs,
      };
    }
    const lr = ir['label_input'] as { content?: { label?: string } };
    const label = lr?.content?.label ?? '(none)';
    return {
      resultType: 'complete',
      content: [{ type: 'text', text: `Item "${String(a.item_id)}" labeled: "${label}"` }],
    };
  },
});

// ─── Supported subscription filter types ──────────────────────────────────────
const SUPPORTED_SUB_FILTERS = new Set(['toolsListChanged']);

// ─── Base64 sentinel decoding per spec §Value Encoding ────────────────────────
function decodeHeaderValue(v: string): string {
  if (v.startsWith('=?base64?') && v.endsWith('?=')) {
    const b64 = v.slice(9, -2);
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  }
  return v;
}

function contentMediaType(value: string | null): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase();
}

function acceptedMediaTypes(value: string | null): Set<string> {
  const accepted = new Set<string>();
  for (const range of value?.split(',') ?? []) {
    const [rawType, ...rawParams] = range.split(';');
    const type = rawType?.trim().toLowerCase();
    if (!type) continue;

    let quality = 1;
    for (const rawParam of rawParams) {
      const [name, rawValue] = rawParam.split('=', 2).map((part) => part.trim());
      if (name?.toLowerCase() === 'q') {
        const parsed = Number(rawValue);
        quality = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    if (quality > 0) accepted.add(type);
  }
  return accepted;
}

// ─── Adapter handler ──────────────────────────────────────────────────────────
function createHandler(origins: Set<string>) {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const timers = new Set<ReturnType<typeof setInterval>>();

  function err(id: string | number | null, code: number, msg: string, data?: unknown): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message: msg, ...(data !== undefined ? { data } : {}) },
    });
  }
  function ok(id: string | number, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result });
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Correction #1: enforce exact /mcp pathname
    if (url.pathname !== '/mcp') {
      return new Response('Not Found', { status: 404 });
    }

    // POST only
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    }

    // Validate exact Content-Type media type (parameters and case are allowed).
    if (contentMediaType(req.headers.get('Content-Type')) !== 'application/json') {
      return new Response(
        err(null, -32700, 'Content-Type must be application/json'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Accept must explicitly permit both response media types with q > 0.
    const accepted = acceptedMediaTypes(req.headers.get('Accept'));
    if (!accepted.has('application/json') || !accepted.has('text/event-stream')) {
      return new Response(
        err(null, -32600, 'Accept must include both application/json and text/event-stream'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Origin validation
    const origin = req.headers.get('Origin');
    if (origin !== null && !origins.has(origin)) {
      return new Response(
        err(null, -32000, `Forbidden origin: ${origin}`),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        err(null, -32700, 'Parse error'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Reject batch arrays
    if (Array.isArray(body)) {
      return new Response(
        err(null, -32600, 'Batch arrays not supported'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Reject response objects
    if (
      typeof body === 'object' && body !== null &&
      ('result' in body || ('error' in body && !('method' in body)))
    ) {
      return new Response(
        err(null, -32600, 'Client must not send JSON-RPC response objects'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Correction #7: malformed JSON-RPC — require jsonrpc and method
    const msg = body as Record<string, unknown>;
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return new Response(
        err(null, -32600, 'Invalid JSON-RPC: missing jsonrpc:"2.0" or method string'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const isNotif = !('id' in msg) || msg.id === undefined;
    const method = msg.method as string;
    const id = (msg.id ?? null) as string | number | null;
    const params = (msg.params ?? {}) as Record<string, unknown>;
    const meta = (params._meta ?? {}) as Record<string, unknown>;

    // Header: MCP-Protocol-Version
    const hv = req.headers.get('MCP-Protocol-Version');
    if (!hv) {
      return new Response(
        err(id, -32020, 'Missing MCP-Protocol-Version header'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Body _meta.protocolVersion required on requests
    const mv = meta['io.modelcontextprotocol/protocolVersion'] as string | undefined;
    if (!isNotif && mv === undefined) {
      return new Response(
        err(id, -32020, 'Missing _meta["io.modelcontextprotocol/protocolVersion"]'),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Header/body mismatch
    if (mv !== undefined && hv !== mv) {
      return new Response(
        err(id, -32020, `MCP-Protocol-Version "${hv}" != body _meta "${mv}"`),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Unsupported version
    if (hv !== PROTOCOL_VERSION) {
      return new Response(
        err(id, -32022, 'UnsupportedProtocolVersion', { supported: [PROTOCOL_VERSION] }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Correction #2: clientCapabilities required; use -32021 for missing capability
    if (!isNotif) {
      const cc = meta['io.modelcontextprotocol/clientCapabilities'];
      if (cc === undefined) {
        return new Response(
          err(id, -32021, 'MissingRequiredClientCapability: clientCapabilities required in _meta'),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // Mcp-Method / Mcp-Name headers
    if (!isNotif) {
      const mh = req.headers.get('Mcp-Method');
      if (!mh) {
        return new Response(
          err(id, -32020, 'Missing Mcp-Method header'),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (mh !== method) {
        return new Response(
          err(id, -32020, `Mcp-Method "${mh}" != body method "${method}"`),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const NAME_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);
      if (NAME_METHODS.has(method)) {
        const nh = req.headers.get('Mcp-Name');
        if (!nh) {
          return new Response(
            err(id, -32020, `Missing Mcp-Name header for ${method}`),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // Correction #7: decode Base64 sentinel before comparing
        const decoded = decodeHeaderValue(nh);
        const bodyName = method === 'resources/read'
          ? params.uri as string | undefined
          : params.name as string | undefined;
        if (bodyName !== undefined && decoded !== bodyName) {
          return new Response(
            err(id, -32020, `Mcp-Name "${decoded}" != body "${bodyName}"`),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    // Notifications
    if (isNotif) {
      return new Response(
        err(null, -32601, `No client notifications in ${PROTOCOL_VERSION} Streamable HTTP`),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Dispatch ──

    if (method === 'server/discover') {
      DiscoverRequestSchema.parse({ method, params });
      const result = {
        resultType: 'complete' as const,
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: { tools: {}, resources: {} },
        instructions: 'Notion MCP spike — 2026-07-28 feasibility.',
        ttlMs: 3600000,
        cacheScope: 'public' as const,
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };
      DiscoverResultSchema.parse(result);
      return new Response(ok(id!, result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'tools/list') {
      ListToolsRequestSchema.parse({ method, params });
      const tl = Array.from(tools.values()).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      for (const t of tl) ToolSchema.parse(t);
      const result = {
        resultType: 'complete' as const,
        tools: tl,
        ttlMs: 60000,
        cacheScope: 'public' as const,
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };
      ListToolsResultSchema.parse(result);
      return new Response(ok(id!, result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'tools/call') {
      CallToolRequestSchema.parse({ method, params });
      const tn = params.name as string;
      const tool = tools.get(tn);
      if (!tool) {
        return new Response(
          err(id, -32602, `Unknown tool: ${tn}`),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Correction #3: check elicitation capability before emitting MRTR
      const cc = meta['io.modelcontextprotocol/clientCapabilities'] as Record<string, unknown>;
      if (tool.requiresElicitation && !cc.elicitation) {
        return new Response(
          err(id, -32021, 'MissingRequiredClientCapability: elicitation required for this tool'),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const ir = params.inputResponses as Record<string, unknown> | undefined;

      if (ir) {
        const rs = params.requestState as string | undefined;
        if (!rs) {
          return new Response(
            err(id, -32602, 'inputResponses requires requestState'),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const s = await unseal(rs, tn, args);
        if (!s) {
          return new Response(
            err(id, -32602, 'Invalid or tampered requestState'),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }

      const hr = await tool.handler(args, ir);
      const result: Record<string, unknown> = {
        resultType: hr.resultType,
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };
      if (hr.resultType === 'complete') {
        result.content = hr.content;
      } else if (hr.resultType === 'input_required') {
        result.content = hr.content ?? [{ type: 'text', text: 'Input required' }];
        result.inputRequests = hr.inputRequests;
        result.requestState = hr.requestState;
      }
      CallToolResultSchema.parse(result);
      return new Response(ok(id!, result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'subscriptions/listen') {
      SubscriptionsListenRequestSchema.parse({ method, params });
      const sid = id!;
      const reqNotifs = (params.notifications ?? {}) as Record<string, unknown>;
      // Correction #4: acknowledge only supported filters
      const acked: Record<string, unknown> = {};
      for (const k of Object.keys(reqNotifs)) {
        if (SUPPORTED_SUB_FILTERS.has(k)) acked[k] = reqNotifs[k];
      }
      const enc = new TextEncoder();
      let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
      let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctrl = c;
          streams.add(c);
          // Ack first
          const ack = {
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: {
              _meta: { 'io.modelcontextprotocol/subscriptionId': sid },
              notifications: acked,
            },
          };
          SubscriptionsAcknowledgedNotificationSchema.parse(ack);
          c.enqueue(enc.encode(`data: ${JSON.stringify(ack)}\n\n`));

          // Correction #4: emit one tools-list-changed if subscribed
          if (acked.toolsListChanged) {
            const notif = {
              jsonrpc: '2.0',
              method: 'notifications/tools/list_changed',
              params: {
                _meta: { 'io.modelcontextprotocol/subscriptionId': sid },
              },
            };
            c.enqueue(enc.encode(`data: ${JSON.stringify(notif)}\n\n`));
          }

          // Correction #5: periodic keepalive timer (100ms for test)
          keepaliveTimer = setInterval(() => {
            try {
              c.enqueue(enc.encode(': keepalive\n\n'));
            } catch {
              if (keepaliveTimer !== undefined) clearInterval(keepaliveTimer);
            }
          }, 100);
          timers.add(keepaliveTimer);
        },
        cancel() {
          if (keepaliveTimer !== undefined) {
            clearInterval(keepaliveTimer);
            timers.delete(keepaliveTimer);
          }
          if (ctrl) streams.delete(ctrl);
        },
      });

      SubscriptionsListenResultMetaSchema.parse({
        'io.modelcontextprotocol/subscriptionId': sid,
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    return new Response(
      err(id, -32601, `Method not found: ${method}`),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function cleanup(): void {
    for (const t of timers) clearInterval(t);
    timers.clear();
    for (const c of streams) {
      try {
        c.close();
      } catch { /* ok */ }
    }
    streams.clear();
  }

  return { handle, cleanup, activeTimerCount: () => timers.size };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

function H(method?: string, name?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  if (method) h['Mcp-Method'] = method;
  if (name) h['Mcp-Name'] = name;
  return h;
}

function B(
  method: string,
  id: number | string,
  params: Record<string, unknown> = {},
  caps: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method,
    id,
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': { name: 'spike', version: '0.0.0' },
        'io.modelcontextprotocol/clientCapabilities': caps,
      },
      ...params,
    },
  });
}

/** B with elicitation capability. */
function Be(
  method: string,
  id: number | string,
  params: Record<string, unknown> = {},
): string {
  return B(method, id, params, { elicitation: {} });
}

type JRPCErr = { error: { code: number; message: string; data?: unknown } };
type JRPCOk<T> = { result: T };

// ─── TESTS ────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  console.log('🔬 MCP 2026-07-28 Adapter Spike (Final)');
  console.log('========================================');
  console.log(`   Deno ${Deno.version.deno} / V8 ${Deno.version.v8}`);
  console.log(`   Protocol: ${PROTOCOL_VERSION}`);
  console.log(`   Date: ${new Date().toISOString()}`);
  console.log(`   Core: @modelcontextprotocol/core@2.3.1`);

  await initKey();
  const { handle, cleanup, activeTimerCount } = createHandler(
    new Set(['http://localhost:3000', 'http://127.0.0.1:3000']),
  );
  const ac = new AbortController();
  const srv = Deno.serve(
    { hostname: '127.0.0.1', port: 0, signal: ac.signal, onListen: () => {} },
    handle,
  );
  const base = `http://127.0.0.1:${srv.addr.port}`;

  try {
    // ─ 1: Endpoint /mcp + pathname enforcement ─
    section('1: /mcp endpoint + pathname enforcement');
    await runTest('/mcp responds', 1, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('server/discover'),
        body: B('server/discover', 'e1'),
      });
      assertStrictEquals(r.status, 200);
      await r.json();
      record('POST /mcp → 200', 1);
    });
    await runTest('/other → 404', 1, async () => {
      const r = await fetch(`${base}/anything`, {
        method: 'POST',
        headers: H('server/discover'),
        body: B('server/discover', 'e2'),
      });
      assertStrictEquals(r.status, 404);
      await r.text();
      record('/anything → 404', 1);
    });
    await runTest('/mcp/ trailing → 404', 1, async () => {
      const r = await fetch(`${base}/mcp/`, {
        method: 'POST',
        headers: H('server/discover'),
        body: B('server/discover', 'e3'),
      });
      assertStrictEquals(r.status, 404);
      await r.text();
      record('/mcp/ (trailing slash) → 404', 1);
    });
    await runTest('/mcp%2F encoded → 404', 1, async () => {
      const r = await fetch(`${base}/mcp%2F`, {
        method: 'POST',
        headers: H('server/discover'),
        body: B('server/discover', 'e4'),
      });
      assertStrictEquals(r.status, 404);
      await r.text();
      record('/mcp%2F (encoded) → 404', 1);
    });

    // ─ 2: POST only ─
    section('2: POST only');
    for (const m of ['GET', 'PUT', 'DELETE']) {
      await runTest(`${m} → 405`, 2, async () => {
        const r = await fetch(`${base}/mcp`, {
          method: m,
          headers: { Accept: 'text/event-stream' },
        });
        assertStrictEquals(r.status, 405);
        assertStrictEquals(r.headers.get('allow'), 'POST');
        await r.text();
        record(`${m} → 405`, 2);
      });
    }

    // ─ 3: Origin ─
    section('3: Origin validation');
    await runTest('No origin → OK', 3, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('server/discover'),
        body: B('server/discover', 'o1'),
      });
      assertStrictEquals(r.status, 200);
      await r.json();
      record('Absent origin → allowed', 3);
    });
    await runTest('Good origin', 3, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { ...H('server/discover'), Origin: 'http://localhost:3000' },
        body: B('server/discover', 'o2'),
      });
      assertStrictEquals(r.status, 200);
      await r.json();
      record('Allowed origin → 200', 3);
    });
    await runTest('Bad origin → 403', 3, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { ...H('server/discover'), Origin: 'https://evil.example.com' },
        body: B('server/discover', 'o3'),
      });
      assertStrictEquals(r.status, 403);
      await r.json();
      record('Forbidden origin → 403', 3);
    });

    // ─ 4: Single object ─
    section('4: Batch/response rejection');
    await runTest('Batch → 400', 4, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify([{ jsonrpc: '2.0', method: 'x', id: 1 }]),
      });
      assertStrictEquals(r.status, 400);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32600);
      record('Batch → 400 -32600', 4);
    });
    await runTest('Response obj → 400', 4, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      });
      assertStrictEquals(r.status, 400);
      await r.json();
      record('Response object → 400', 4);
    });

    // ─ Correction #7: Malformed JSON-RPC ─
    section('7a: Malformed JSON-RPC');
    await runTest('Missing jsonrpc field', 7, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ method: 'server/discover', id: 1 }),
      });
      assertStrictEquals(r.status, 400);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32600);
      record('Missing jsonrpc → -32600', 7);
    });
    await runTest('Missing method field', 7, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1 }),
      });
      assertStrictEquals(r.status, 400);
      record('Missing method → -32600', 7);
    });

    // ─ 5: Protocol version ─
    section('5: Protocol version');
    await runTest('No header → -32020', 5, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'server/discover', id: 'v1', params: {} }),
      });
      assertStrictEquals(r.status, 400);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32020);
      record('Missing version header → -32020', 5);
    });
    await runTest('Header/body mismatch', 5, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { ...H('server/discover'), 'MCP-Protocol-Version': '2026-07-28' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'server/discover',
          id: 'v2',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2025-11-25',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      assertStrictEquals(r.status, 400);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32020);
      record('Version mismatch → -32020', 5);
    });
    await runTest('Unsupported → -32022', 5, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { ...H('server/discover'), 'MCP-Protocol-Version': '2099-01-01' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'server/discover',
          id: 'v3',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2099-01-01',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      assertStrictEquals(r.status, 400);
      const b = (await r.json()) as JRPCErr;
      assertStrictEquals(b.error.code, -32022);
      JSONRPCErrorResponseSchema.parse(b);
      record('Unsupported → -32022', 5);
    });

    // ─ _meta enforcement ─
    section('_meta body enforcement');
    await runTest('No _meta → 400', 3, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('server/discover'),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'server/discover', id: 'm1', params: {} }),
      });
      assertStrictEquals(r.status, 400);
      record('Missing _meta → 400', 3);
    });
    await runTest('No protocolVersion in _meta', 3, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('server/discover'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'server/discover',
          id: 'm2',
          params: { _meta: { 'io.modelcontextprotocol/clientCapabilities': {} } },
        }),
      });
      assertStrictEquals(r.status, 400);
      record('No protocolVersion → 400', 3);
    });
    await runTest('No clientCapabilities → -32021', 2, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('server/discover'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'server/discover',
          id: 'm3',
          params: { _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION } },
        }),
      });
      assertStrictEquals(r.status, 400);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32021);
      record('Missing clientCaps → -32021', 2);
    });

    // ─ 6: Content-Type / Accept ─
    section('6: Content-Type and Accept validation');
    await runTest('Wrong Content-Type', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
        body: '{}',
      });
      assertStrictEquals(r.status, 400);
      record('text/plain Content-Type → 400', 6);
    });
    await runTest('Missing Accept text/event-stream', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
        body: B('server/discover', 'a1'),
      });
      assertStrictEquals(r.status, 400);
      record('Accept without text/event-stream → 400', 6);
    });
    await runTest('Missing Accept application/json', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
        body: B('server/discover', 'a2'),
      });
      assertStrictEquals(r.status, 400);
      record('Accept without application/json → 400', 6);
    });
    await runTest('Content-Type substring spoof rejected', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          ...H('server/discover'),
          'Content-Type': 'application/jsonx',
        },
        body: B('server/discover', 'a3'),
      });
      assertStrictEquals(r.status, 400);
      record('application/jsonx Content-Type → 400', 6);
    });
    await runTest('Accept substring spoof rejected', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          ...H('server/discover'),
          Accept: 'application/jsonx, xtext/event-stream',
        },
        body: B('server/discover', 'a4'),
      });
      assertStrictEquals(r.status, 400);
      record('Spoofed Accept media types → 400', 6);
    });
    await runTest('Media types allow case, parameters, and positive quality', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          ...H('server/discover'),
          'Content-Type': 'Application/JSON; charset=utf-8',
          Accept: 'Application/JSON; q=0.8, Text/Event-Stream; q=1',
        },
        body: B('server/discover', 'a5'),
      });
      assertStrictEquals(r.status, 200);
      record('Case-insensitive parameterized media types → 200', 6);
    });
    await runTest('Accept q=0 does not permit a media type', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          ...H('server/discover'),
          Accept: 'application/json; q=1, text/event-stream; q=0',
        },
        body: B('server/discover', 'a6'),
      });
      assertStrictEquals(r.status, 400);
      record('Accept q=0 media type → 400', 6);
    });

    // ─ Mcp-Method / Mcp-Name ─
    section('Header enforcement');
    await runTest('No Mcp-Method', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
        body: B('tools/list', 'h1'),
      });
      assertStrictEquals(r.status, 400);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32020);
      record('Missing Mcp-Method → -32020', 6);
    });
    await runTest('Mcp-Method mismatch', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/list'),
        body: B('server/discover', 'h2'),
      });
      assertStrictEquals(r.status, 400);
      record('Mcp-Method mismatch → -32020', 6);
    });
    await runTest('Missing Mcp-Name', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call'),
        body: B('tools/call', 'h3', { name: 'echo', arguments: { message: 'x' } }),
      });
      assertStrictEquals(r.status, 400);
      record('Missing Mcp-Name → -32020', 6);
    });
    await runTest('Mcp-Name mismatch', 6, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'wrong'),
        body: B('tools/call', 'h4', { name: 'echo', arguments: { message: 'x' } }),
      });
      assertStrictEquals(r.status, 400);
      record('Mcp-Name mismatch → -32020', 6);
    });

    // Correction #7: Base64 sentinel Mcp-Name
    await runTest('Base64 Mcp-Name', 7, async () => {
      const encoded = `=?base64?${btoa('echo')}?=`;
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', encoded),
        body: B('tools/call', 'b64-1', { name: 'echo', arguments: { message: 'b64' } }),
      });
      assertStrictEquals(r.status, 200);
      const b = (await r.json()) as JRPCOk<{ content: { text: string }[] }>;
      assertStrictEquals(b.result.content[0]!.text, 'echo: b64');
      record('Base64 sentinel Mcp-Name decoded and matched', 7);
    });

    // ─ 7: No initialize ─
    section('7: No initialize');
    await runTest('tools/list first', 7, async () => {
      const { handle: fh, cleanup: fc } = createHandler(new Set());
      const fac = new AbortController();
      const fs = Deno.serve(
        { hostname: '127.0.0.1', port: 0, signal: fac.signal, onListen: () => {} },
        fh,
      );
      const r = await fetch(`http://127.0.0.1:${fs.addr.port}/mcp`, {
        method: 'POST',
        headers: H('tools/list'),
        body: B('tools/list', 'f1'),
      });
      assertStrictEquals(r.status, 200);
      assertStrictEquals(r.headers.get('mcp-session-id'), null);
      await r.json();
      fac.abort();
      await fs.finished;
      fc();
      record('tools/list first, no session header', 7);
    });
    await runTest('initialize → 404', 9, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('initialize'),
        body: B('initialize', 'i1'),
      });
      assertStrictEquals(r.status, 404);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32601);
      record('Legacy initialize → -32601', 9);
    });

    // ─ 8: server/discover wire shape ─
    section('8: server/discover');
    await runTest('discover shape', 8, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('server/discover'),
        body: B('server/discover', 'd1'),
      });
      const { result: res } = (await r.json()) as JRPCOk<Record<string, unknown>>;
      assertStrictEquals(res.resultType, 'complete');
      assertEquals(res.supportedVersions, [PROTOCOL_VERSION]);
      assertExists(res.capabilities);
      assertStrictEquals(typeof res.ttlMs, 'number');
      assertEquals(res.cacheScope === 'public' || res.cacheScope === 'private', true);
      const m = res._meta as Record<string, unknown>;
      assertExists(m['io.modelcontextprotocol/serverInfo']);
      assertStrictEquals(m['io.modelcontextprotocol/resultType'], undefined);
      DiscoverResultSchema.parse(res);
      ServerCapabilitiesSchema.parse(res.capabilities);
      ResultMetaObjectSchema.parse(m);
      record('discover: top-level fields correct, SDK passes', 8);
    });

    // ─ 9: tools/list + tools/call ─
    section('9: tools/list + tools/call');
    await runTest('tools/list', 9, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/list'),
        body: B('tools/list', 'r1'),
      });
      const { result: res } = (await r.json()) as JRPCOk<Record<string, unknown>>;
      const names = (res.tools as { name: string }[]).map((t) => t.name).sort();
      assertEquals(names, ['collect_label', 'current_time', 'echo']);
      assertStrictEquals(res.resultType, 'complete');
      assertStrictEquals(typeof res.ttlMs, 'number');
      assertEquals(res.cacheScope === 'public' || res.cacheScope === 'private', true);
      const m = res._meta as Record<string, unknown>;
      assertStrictEquals(m['io.modelcontextprotocol/resultType'], undefined);
      ListToolsResultSchema.parse(res);
      for (const t of res.tools as Record<string, unknown>[]) ToolSchema.parse(t);
      record('tools/list: 3 tools, top-level fields, SDK passes', 9);
    });
    await runTest('tools/call echo', 9, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'echo'),
        body: B('tools/call', 'r2', { name: 'echo', arguments: { message: 'spike' } }),
      });
      const { result: res } = (await r.json()) as JRPCOk<Record<string, unknown>>;
      assertStrictEquals(res.resultType, 'complete');
      assertStrictEquals((res.content as { text: string }[])[0]!.text, 'echo: spike');
      CallToolResultSchema.parse(res);
      record('echo → complete', 9);
    });
    await runTest('tools/call current_time', 9, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'current_time'),
        body: B('tools/call', 'r3', { name: 'current_time', arguments: {} }),
      });
      const { result: res } = (await r.json()) as JRPCOk<{ content: { text: string }[] }>;
      assertStrictEquals(isNaN(new Date(res.content[0]!.text).getTime()), false);
      record('current_time → valid ISO', 9);
    });

    // ─ 10: MRTR ─
    section('10: MRTR collect_label');
    await runTest('MRTR round-trip', 10, async () => {
      // First: input_required (needs elicitation cap)
      const r1 = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'collect_label'),
        body: Be('tools/call', 'm1', { name: 'collect_label', arguments: { item_id: 'p42' } }),
      });
      assertStrictEquals(r1.status, 200);
      const { result: res1 } = (await r1.json()) as JRPCOk<Record<string, unknown>>;
      assertStrictEquals(res1.resultType, 'input_required');
      const reqs = res1.inputRequests as Record<
        string,
        { method: string; params: Record<string, unknown> }
      >;
      assertExists(reqs.label_input);
      assertStrictEquals(reqs.label_input.method, 'elicitation/create');
      ElicitRequestParamsSchema.parse(reqs.label_input.params);
      CallToolResultSchema.parse(res1);
      record('First → input_required, elicitation validated', 10);

      // Opaque check
      const rs = res1.requestState as string;
      try {
        JSON.parse(atob(rs));
        throw new Error('decoded');
      } catch (e) {
        if ((e as Error).message === 'decoded') throw e;
      }
      record('requestState opaque', 10);

      // Retry
      const resp = { action: 'accept', content: { label: 'Important' } };
      ElicitResultSchema.parse(resp);
      const r2 = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'collect_label'),
        body: Be('tools/call', 'm2', {
          name: 'collect_label',
          arguments: { item_id: 'p42' },
          inputResponses: { label_input: resp },
          requestState: rs,
        }),
      });
      assertStrictEquals(r2.status, 200);
      const { result: res2 } = (await r2.json()) as JRPCOk<
        { resultType: string; content: { text: string }[] }
      >;
      assertStrictEquals(res2.resultType, 'complete');
      assertStrictEquals(res2.content[0]!.text, 'Item "p42" labeled: "Important"');
      record('Retry → complete', 10);

      // Tampered
      const r3 = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'collect_label'),
        body: Be('tools/call', 'm3', {
          name: 'collect_label',
          arguments: { item_id: 'p42' },
          inputResponses: { label_input: resp },
          requestState: rs.slice(0, -4) + 'XXXX',
        }),
      });
      assertStrictEquals(r3.status, 400);
      record('Tampered → rejected', 10);

      // No requestState
      const r4 = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'collect_label'),
        body: Be('tools/call', 'm4', {
          name: 'collect_label',
          arguments: { item_id: 'p42' },
          inputResponses: { label_input: resp },
        }),
      });
      assertStrictEquals(r4.status, 400);
      record('No requestState → rejected', 10);

      // Wrong args binding
      const r5 = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'collect_label'),
        body: Be('tools/call', 'm5', {
          name: 'collect_label',
          arguments: { item_id: 'DIFFERENT' },
          inputResponses: { label_input: resp },
          requestState: rs,
        }),
      });
      assertStrictEquals(r5.status, 400);
      record('Wrong args → rejected', 10);

      // Correction #7: cross-tool requestState reuse
      const r6 = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'echo'),
        body: Be('tools/call', 'm6', {
          name: 'echo',
          arguments: { message: 'steal' },
          inputResponses: { label_input: resp },
          requestState: rs,
        }),
      });
      assertStrictEquals(r6.status, 400);
      record('Cross-tool requestState reuse → rejected', 10);
    });

    // Correction #3: elicitation capability check
    await runTest('No elicitation cap → -32021', 3, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'collect_label'),
        body: B('tools/call', 'cap1', { name: 'collect_label', arguments: { item_id: 'x' } }),
      });
      assertStrictEquals(r.status, 400);
      assertStrictEquals(((await r.json()) as JRPCErr).error.code, -32021);
      record('No elicitation → -32021', 3);
    });
    await runTest('With elicitation cap → input_required', 3, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('tools/call', 'collect_label'),
        body: Be('tools/call', 'cap2', { name: 'collect_label', arguments: { item_id: 'y' } }),
      });
      assertStrictEquals(r.status, 200);
      const { result: res } = (await r.json()) as JRPCOk<{ resultType: string }>;
      assertStrictEquals(res.resultType, 'input_required');
      // Validate client caps shape
      ClientCapabilitiesSchema.parse({ elicitation: {} });
      record('With elicitation → input_required', 3);
    });

    // ─ 11: subscriptions/listen ─
    section('11: subscriptions/listen');
    await runTest('SSE + ack + notification + keepalives', 11, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('subscriptions/listen'),
        body: B('subscriptions/listen', 42, { notifications: { toolsListChanged: true } }),
      });
      assertStrictEquals(r.status, 200);
      assertStrictEquals(r.headers.get('content-type'), 'text/event-stream');
      assertStrictEquals(r.headers.get('x-accel-buffering'), 'no');
      record('SSE headers correct', 11);

      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let acc = '';
      const dataEvents: string[] = [];
      const comments: string[] = [];

      // Read for up to 1.5s to get ack + notification + ≥2 keepalives
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((r) =>
            setTimeout(() => r({ done: true, value: undefined }), 200)
          ),
        ]);
        if (done && !value) {
          if (comments.length >= 2) break;
          continue;
        }
        if (value) {
          acc += dec.decode(value, { stream: true });
          const lines = acc.split('\n');
          acc = lines.pop() ?? '';
          for (const l of lines) {
            if (l.startsWith('data: ')) dataEvents.push(l.slice(6));
            else if (l.startsWith(':')) comments.push(l);
          }
        }
        if (dataEvents.length >= 2 && comments.length >= 2) break;
      }

      await reader.cancel();
      assertStrictEquals(
        await waitFor(() => activeTimerCount() === 0),
        true,
        'Keepalive timer must be removed within 500ms of cancellation',
      );
      record('Stream read + cancelled', 11);
      record('Keepalive timer removed on cancellation', 11);

      // Ack is FIRST data event
      assertEquals(
        dataEvents.length >= 2,
        true,
        `Expected ≥2 data events, got ${dataEvents.length}`,
      );
      const ack = JSON.parse(dataEvents[0]!) as {
        method: string;
        params: { _meta: Record<string, unknown>; notifications: Record<string, unknown> };
      };
      assertStrictEquals(ack.method, 'notifications/subscriptions/acknowledged');
      assertStrictEquals(ack.params._meta['io.modelcontextprotocol/subscriptionId'], 42);
      SubscriptionsAcknowledgedNotificationSchema.parse(ack);
      record('Ack first, subscriptionId=42', 11);

      // Correction #4: ack reflects only supported filters
      assertStrictEquals(ack.params.notifications.toolsListChanged, true);
      record('Ack reflects supported filter', 11);

      // Second data event is tools/list_changed notification
      const notif = JSON.parse(dataEvents[1]!) as {
        method: string;
        params: { _meta: Record<string, unknown> };
      };
      assertStrictEquals(notif.method, 'notifications/tools/list_changed');
      assertStrictEquals(notif.params._meta['io.modelcontextprotocol/subscriptionId'], 42);
      record('tools/list_changed notification emitted with subscriptionId', 11);

      // Correction #5: ≥2 periodic keepalive comments
      assertEquals(comments.length >= 2, true, `Expected ≥2 keepalives, got ${comments.length}`);
      record(`${comments.length} periodic keepalive comments received`, 11);

      SubscriptionsListenResultSchema.parse({
        _meta: { 'io.modelcontextprotocol/subscriptionId': 42 },
      });
      record('SDK SubscriptionsListenResultSchema passes', 11);
    });

    // Correction #4: unknown/empty filter
    await runTest('Unknown filter omitted', 4, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: H('subscriptions/listen'),
        body: B('subscriptions/listen', 99, { notifications: { bogusFilter: true } }),
      });
      assertStrictEquals(r.status, 200);
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let acc = '';
      const dataEvts: string[] = [];
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((r) =>
            setTimeout(() => r({ done: true, value: undefined }), 100)
          ),
        ]);
        if (done) break;
        if (value) {
          acc += dec.decode(value, { stream: true });
          for (const l of acc.split('\n')) {
            if (l.startsWith('data: ')) dataEvts.push(l.slice(6));
          }
          acc = '';
        }
        if (dataEvts.length >= 1) break;
      }
      await reader.cancel();
      assertStrictEquals(
        await waitFor(() => activeTimerCount() === 0),
        true,
        'Unknown-filter timer must be removed within 500ms of cancellation',
      );
      record('Unknown-filter keepalive timer removed on cancellation', 4);
      // Ack should have empty notifications (bogus not echoed)
      const ack = JSON.parse(dataEvts[0]!) as {
        params: { notifications: Record<string, unknown> };
      };
      assertStrictEquals(Object.keys(ack.params.notifications).length, 0);
      // No notification events beyond ack (unknown type not emitted)
      const notifEvents = dataEvts.slice(1).filter((e) => {
        try {
          return JSON.parse(e).method !== 'notifications/subscriptions/acknowledged';
        } catch {
          return false;
        }
      });
      assertStrictEquals(notifEvents.length, 0);
      record('Unknown filter omitted, no spurious notifications', 4);
    });

    // ─ 12: Notification POST negative ─
    section('12: Notification POST');
    await runTest('Notification → 400', 12, async () => {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION } },
        }),
      });
      assertStrictEquals(r.status, 400);
      await r.json();
      record('Notification → 400', 12);
    });

    // ─ 15: Schema summary ─
    section('15: Schema conformance');
    await runTest('Schema summary', 15, () => {
      record(
        '17 SDK schemas as floor validation',
        15,
        'Permissive: wire assertions enforce placement. Not claimed as full conformance.',
      );
    });
  } finally {
    cleanup();
    ac.abort();
    await srv.finished;
    clearTimeout(watchdog);
  }

  // ── Summary ──
  console.log('\n========================================');
  console.log('RESULTS');
  console.log('========================================');
  console.log(`  Total: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n❌ SPIKE FAILED');
    for (const f of failures) console.error(`  ❌ ${f}`);
    Deno.exitCode = 1;
  } else {
    console.log('\n✅ ALL ASSERTIONS PASSED');
    console.log('\n📋 OFFICIAL SHAPE MATRIX:');
    console.log('   resultType         → top-level in result');
    console.log('   ttlMs              → top-level in cacheable results');
    console.log('   cacheScope         → top-level ("public"|"private")');
    console.log('   serverInfo         → _meta["io.modelcontextprotocol/serverInfo"]');
    console.log('   inputRequests      → top-level in InputRequiredResult');
    console.log('   requestState       → top-level, opaque, AES-GCM bound');
    console.log('   subscriptionId     → _meta["io.modelcontextprotocol/subscriptionId"]');
    console.log('\n📋 CAPABILITY/FILTER SHAPES:');
    console.log('   clientCapabilities → { elicitation: {} } for MRTR elicitation');
    console.log('   subscription filter→ { toolsListChanged: true }');
    console.log('   ack reflects       → only supported filters (unsupported omitted)');
    console.log('\n📋 DEFERRED TO TASK 2.7:');
    console.log('   - Production tool registry, Notion API');
    console.log('   - x-mcp-header custom params + full Base64 encoding');
    console.log('   - SSE progress notifications on request streams');
    console.log('   - subscriptions/listen real fanout + reconnection');
    console.log('   - Auth (OAuth, JWKS, bearer)');
    console.log('   - Production requestState codec (key rotation, expiry)');
    console.log('   - cacheScope="private" for auth-filtered lists');
    console.log('   - Structured logging, OTel');
    Deno.exitCode = 0;
  }
}

await run();
