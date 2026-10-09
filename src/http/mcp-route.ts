import { isJsonObject } from '../domain/json.ts';
import { JsonRpcCode } from '../protocol/mcp/constants.ts';
import type { McpDispatcher } from '../protocol/mcp/dispatcher.ts';
import { McpProtocolError } from '../protocol/mcp/protocol-error.ts';
import type { McpRequestParser } from '../protocol/mcp/request.ts';
import type { Logger } from '../observability/logger.ts';
import { readBoundedText } from './bounded-body.ts';
import { acceptedMediaTypes, contentMediaType } from './media-type.ts';
import { jsonResponse, methodNotAllowed } from './responses.ts';
import type { Route } from './route.ts';

export interface McpRouteOptions {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxBodyBytes: number;
}

/** POST /mcp: HTTP-level checks, then hands the parsed body to the protocol layer. */
export class McpRoute implements Route {
  readonly path = '/mcp';

  constructor(
    private readonly parser: McpRequestParser,
    private readonly dispatcher: McpDispatcher,
    private readonly options: McpRouteOptions,
    private readonly logger: Logger,
  ) {}

  async handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return methodNotAllowed('POST');

    let requestId: string | number | null = null;
    const startedAt = performance.now();
    let method = 'unknown';
    try {
      this.checkOrigin(request);
      this.checkMediaTypes(request);
      const body = this.parseJson(await readBoundedText(request, this.options.maxBodyBytes));
      requestId = extractId(body);
      const mcpRequest = this.parser.parse(request.headers, body);
      method = mcpRequest.method;
      const result = await this.dispatcher.dispatch(mcpRequest);
      this.logger.info('mcp.request', {
        method,
        outcome: 'ok',
        durationMs: Math.round(performance.now() - startedAt),
      });
      return jsonResponse({ jsonrpc: '2.0', id: mcpRequest.id, result });
    } catch (error) {
      if (!(error instanceof McpProtocolError)) throw error;
      this.logger.warn('mcp.request', {
        method,
        outcome: 'rejected',
        rpcCode: error.rpcCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return jsonResponse(
        {
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: error.rpcCode,
            message: error.message,
            ...(error.data === undefined ? {} : { data: error.data }),
          },
        },
        error.httpStatus,
      );
    }
  }

  private checkOrigin(request: Request): void {
    const origin = request.headers.get('Origin');
    if (origin !== null && !this.options.allowedOrigins.has(origin)) {
      throw new McpProtocolError(JsonRpcCode.Forbidden, 403, 'Origin not allowed');
    }
  }

  private checkMediaTypes(request: Request): void {
    if (contentMediaType(request.headers.get('Content-Type')) !== 'application/json') {
      throw new McpProtocolError(
        JsonRpcCode.ParseError,
        400,
        'Content-Type must be application/json',
      );
    }
    const accepted = acceptedMediaTypes(request.headers.get('Accept'));
    if (!accepted.has('application/json') || !accepted.has('text/event-stream')) {
      throw McpProtocolError.invalidRequest(
        'Accept must include both application/json and text/event-stream',
      );
    }
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new McpProtocolError(JsonRpcCode.ParseError, 400, 'Parse error');
    }
  }
}

function extractId(body: unknown): string | number | null {
  if (!isJsonObject(body)) return null;
  const { id } = body;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}
