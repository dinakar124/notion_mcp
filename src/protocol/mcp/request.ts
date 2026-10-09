import { isJsonObject, type JsonObject } from '../../domain/json.ts';
import {
  JsonRpcCode,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from './constants.ts';
import { McpProtocolError } from './protocol-error.ts';

export type JsonRpcId = string | number;

/** A validated, stateless MCP request. */
export interface McpRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: JsonObject;
  readonly clientCapabilities: JsonObject;
}

const METHODS_REQUIRING_NAME = new Set(['tools/call']);

/** Decodes the `=?base64?...?=` header value encoding. */
function decodeHeaderValue(value: string): string {
  if (!(value.startsWith('=?base64?') && value.endsWith('?='))) return value;
  try {
    const bytes = Uint8Array.from(atob(value.slice(9, -2)), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw McpProtocolError.headerMismatch('Mcp-Name is not valid base64-encoded UTF-8');
  }
}

/**
 * Validates the JSON-RPC envelope, the required `_meta` and the Mcp-* headers
 * against the body. Throws McpProtocolError with the id when it is already known.
 */
export class McpRequestParser {
  parse(headers: Headers, body: unknown): McpRequest {
    if (Array.isArray(body)) {
      throw McpProtocolError.invalidRequest('Batch arrays are not supported');
    }
    if (!isJsonObject(body)) {
      throw McpProtocolError.invalidRequest('Body must be a JSON-RPC object');
    }
    if ('result' in body || ('error' in body && !('method' in body))) {
      throw McpProtocolError.invalidRequest('Clients must not send JSON-RPC responses');
    }
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      throw McpProtocolError.invalidRequest('Expected jsonrpc "2.0" and a string method');
    }
    const id = this.readId(body);
    const method = body.method;
    const params = body.params === undefined ? {} : body.params;
    if (!isJsonObject(params)) {
      throw McpProtocolError.invalidParams('params must be an object');
    }

    const meta = isJsonObject(params._meta) ? params._meta : {};
    const headerVersion = headers.get('MCP-Protocol-Version');
    if (!headerVersion) {
      throw McpProtocolError.headerMismatch('Missing MCP-Protocol-Version header');
    }
    const bodyVersion = meta[META_PROTOCOL_VERSION];
    if (typeof bodyVersion !== 'string') {
      throw McpProtocolError.headerMismatch(`Missing _meta["${META_PROTOCOL_VERSION}"]`);
    }
    if (headerVersion !== bodyVersion) {
      throw McpProtocolError.headerMismatch(
        'MCP-Protocol-Version header does not match _meta protocol version',
      );
    }
    if (headerVersion !== PROTOCOL_VERSION) {
      throw new McpProtocolError(
        JsonRpcCode.UnsupportedVersion,
        400,
        'Unsupported protocol version',
        { supported: [PROTOCOL_VERSION] },
      );
    }
    const capabilities = meta[META_CLIENT_CAPABILITIES];
    if (!isJsonObject(capabilities)) {
      throw new McpProtocolError(
        JsonRpcCode.MissingCapability,
        400,
        `Missing _meta["${META_CLIENT_CAPABILITIES}"]`,
      );
    }

    this.checkMcpHeaders(headers, method, params);
    return { id, method, params, clientCapabilities: capabilities };
  }

  private readId(body: JsonObject): JsonRpcId {
    const id = body.id;
    if (typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) return id;
    if (id === undefined) {
      throw new McpProtocolError(
        JsonRpcCode.MethodNotFound,
        400,
        'Client notifications are not accepted over 2026-07-28 Streamable HTTP',
      );
    }
    throw McpProtocolError.invalidRequest('id must be a string or number');
  }

  private checkMcpHeaders(headers: Headers, method: string, params: JsonObject): void {
    const methodHeader = headers.get('Mcp-Method');
    if (!methodHeader) throw McpProtocolError.headerMismatch('Missing Mcp-Method header');
    if (methodHeader !== method) {
      throw McpProtocolError.headerMismatch('Mcp-Method header does not match body method');
    }
    if (!METHODS_REQUIRING_NAME.has(method)) return;

    const nameHeader = headers.get('Mcp-Name');
    if (!nameHeader) throw McpProtocolError.headerMismatch(`Missing Mcp-Name header for ${method}`);
    if (typeof params.name !== 'string' || params.name === '') {
      throw McpProtocolError.invalidParams('params.name must be a non-empty string');
    }
    if (decodeHeaderValue(nameHeader) !== params.name) {
      throw McpProtocolError.headerMismatch('Mcp-Name header does not match params.name');
    }
  }
}
