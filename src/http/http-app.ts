import { JsonRpcCode } from '../protocol/mcp/constants.ts';
import type { Logger } from '../observability/logger.ts';
import { jsonResponse } from './responses.ts';
import type { Route } from './route.ts';

/** Exact-path router with a last-resort error boundary. Transport only: no MCP or Notion logic. */
export class HttpApp {
  private readonly routes = new Map<string, Route>();

  constructor(routes: readonly Route[], private readonly logger: Logger) {
    for (const route of routes) {
      if (this.routes.has(route.path)) throw new Error(`Duplicate route: ${route.path}`);
      this.routes.set(route.path, route);
    }
  }

  readonly handle = async (request: Request): Promise<Response> => {
    const route = this.routes.get(new URL(request.url).pathname);
    if (!route) return jsonResponse({ error: 'Not Found' }, 404);
    try {
      return await route.handle(request);
    } catch (error) {
      this.logger.error('http.unhandled_error', {
        path: route.path,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return jsonResponse(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: JsonRpcCode.InternalError, message: 'Internal error' },
        },
        500,
      );
    }
  };
}
