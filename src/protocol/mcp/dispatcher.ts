import type { JsonObject } from '../../domain/json.ts';
import { META_SERVER_INFO, SERVER_NAME, SERVER_VERSION } from './constants.ts';
import { McpProtocolError } from './protocol-error.ts';
import type { McpRequest } from './request.ts';

/** Handles exactly one MCP method. Adding a method means adding a handler. */
export interface McpMethodHandler {
  readonly method: string;
  handle(request: McpRequest): Promise<JsonObject>;
}

/** Routes a validated request to its handler and stamps the server info on the result. */
export class McpDispatcher {
  private readonly handlers = new Map<string, McpMethodHandler>();

  constructor(handlers: readonly McpMethodHandler[]) {
    for (const handler of handlers) {
      if (this.handlers.has(handler.method)) {
        throw new Error(`Duplicate MCP method handler: ${handler.method}`);
      }
      this.handlers.set(handler.method, handler);
    }
  }

  async dispatch(request: McpRequest): Promise<JsonObject> {
    const handler = this.handlers.get(request.method);
    if (!handler) throw McpProtocolError.methodNotFound(request.method);
    const result = await handler.handle(request);
    return {
      ...result,
      _meta: { [META_SERVER_INFO]: { name: SERVER_NAME, version: SERVER_VERSION } },
    };
  }
}
