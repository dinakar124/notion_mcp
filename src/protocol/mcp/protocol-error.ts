import type { JsonValue } from '../../domain/json.ts';
import { JsonRpcCode } from './constants.ts';

/** A failure that is reported as a JSON-RPC error with a matching HTTP status. */
export class McpProtocolError extends Error {
  constructor(
    readonly rpcCode: number,
    readonly httpStatus: number,
    message: string,
    readonly data?: JsonValue,
  ) {
    super(message);
    this.name = 'McpProtocolError';
  }

  static invalidRequest(message: string, httpStatus = 400): McpProtocolError {
    return new McpProtocolError(JsonRpcCode.InvalidRequest, httpStatus, message);
  }
  static invalidParams(message: string, data?: JsonValue): McpProtocolError {
    return new McpProtocolError(JsonRpcCode.InvalidParams, 400, message, data);
  }
  static headerMismatch(message: string): McpProtocolError {
    return new McpProtocolError(JsonRpcCode.HeaderMismatch, 400, message);
  }
  static methodNotFound(method: string): McpProtocolError {
    return new McpProtocolError(JsonRpcCode.MethodNotFound, 404, `Method not found: ${method}`);
  }
}
