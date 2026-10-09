import { type Application, createApplication } from '../../src/app.ts';
import {
  FakeNotionGateway,
  type FakeNotionOptions,
} from '../../src/adapters/fake/fake-notion-gateway.ts';
import { type AppConfig, loadConfig } from '../../src/config/config.ts';
import type { NotionGateway } from '../../src/application/ports/notion-gateway.ts';
import {
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
} from '../../src/protocol/mcp/constants.ts';
import { silentLogger } from '../../src/observability/logger.ts';

export const PROTOCOL = '2026-07-28';

export interface RpcResponse {
  readonly status: number;
  // deno-lint-ignore no-explicit-any
  readonly body: any;
  readonly headers: Headers;
}

export interface CallOptions {
  readonly headers?: Record<string, string | null>;
  readonly meta?: Record<string, unknown> | null;
  readonly id?: unknown;
}

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ get: (name) => env[name] });
}

export function buildTestApp(
  gateway: NotionGateway = new FakeNotionGateway(),
  config: AppConfig = testConfig(),
): Application {
  return createApplication(config, silentLogger, gateway);
}

export function fakeGateway(options: FakeNotionOptions = {}): FakeNotionGateway {
  return new FakeNotionGateway(options);
}

export function mcpHeaders(method: string, name?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL,
    'Mcp-Method': method,
    ...(name === undefined ? {} : { 'Mcp-Name': name }),
  };
}

export function mcpBody(
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {},
) {
  const meta = options.meta === undefined
    ? { [META_PROTOCOL_VERSION]: PROTOCOL, [META_CLIENT_CAPABILITIES]: {} }
    : options.meta;
  return {
    jsonrpc: '2.0',
    id: options.id === undefined ? 1 : options.id,
    method,
    params: meta === null ? params : { _meta: meta, ...params },
  };
}

/** Sends JSON-RPC requests straight to an in-process handler (no sockets). */
export class McpTestClient {
  constructor(private readonly handle: (request: Request) => Promise<Response>) {}

  async post(path: string, body: unknown, headers: Record<string, string>): Promise<RpcResponse> {
    const response = await this.handle(
      new Request(`http://127.0.0.1${path}`, {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json(), headers: response.headers };
  }

  call(
    method: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<RpcResponse> {
    const name = method === 'tools/call' ? String(params.name) : undefined;
    const headers: Record<string, string> = { ...mcpHeaders(method, name) };
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (value === null) delete headers[key];
      else headers[key] = value;
    }
    return this.post('/mcp', mcpBody(method, params, options), headers);
  }

  callTool(name: string, args: Record<string, unknown>): Promise<RpcResponse> {
    return this.call('tools/call', { name, arguments: args });
  }
}
