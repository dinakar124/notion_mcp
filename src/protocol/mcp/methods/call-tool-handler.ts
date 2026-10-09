import type { ToolRegistry } from '../../../application/tools/tool-registry.ts';
import { AppError, InvalidArgumentsError, UnknownToolError } from '../../../domain/errors.ts';
import { isJsonObject, type JsonObject } from '../../../domain/json.ts';
import type { Logger } from '../../../observability/logger.ts';
import type { McpMethodHandler } from '../dispatcher.ts';
import { McpProtocolError } from '../protocol-error.ts';
import type { McpRequest } from '../request.ts';
import { toolFailureResult, toolSuccessResult } from '../tool-result.ts';

/**
 * Executes a tool. Unknown tools and malformed arguments are protocol errors;
 * failures inside a tool are returned as `isError` results the model can act on.
 */
export class CallToolHandler implements McpMethodHandler {
  readonly method = 'tools/call';

  constructor(private readonly registry: ToolRegistry, private readonly logger: Logger) {}

  async handle(request: McpRequest): Promise<JsonObject> {
    const name = request.params.name as string;
    if ('inputResponses' in request.params || 'requestState' in request.params) {
      throw McpProtocolError.invalidParams('Multi-round-trip requests are not supported');
    }
    const args = request.params.arguments ?? {};
    if (!isJsonObject(args)) throw McpProtocolError.invalidParams('arguments must be an object');

    const startedAt = performance.now();
    try {
      const output = await this.registry.get(name).execute(args);
      this.logger.info('tool.completed', { tool: name, durationMs: elapsed(startedAt) });
      return toolSuccessResult(output);
    } catch (error) {
      if (error instanceof UnknownToolError || error instanceof InvalidArgumentsError) {
        throw McpProtocolError.invalidParams(error.message, error.details);
      }
      if (error instanceof AppError) {
        this.logger.warn('tool.failed', {
          tool: name,
          code: error.code,
          durationMs: elapsed(startedAt),
        });
        return toolFailureResult(error);
      }
      throw error;
    }
  }
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
