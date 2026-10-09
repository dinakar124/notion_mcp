export const PROTOCOL_VERSION = '2026-07-28';
export const SERVER_NAME = 'notion-mcp';
export const SERVER_VERSION = '0.1.0';

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const JsonRpcCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  Forbidden: -32000,
  HeaderMismatch: -32020,
  MissingCapability: -32021,
  UnsupportedVersion: -32022,
} as const;
