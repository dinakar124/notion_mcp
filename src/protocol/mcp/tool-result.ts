import type { ToolOutput } from '../../application/tools/tool.ts';
import { AppError, ProviderError } from '../../domain/errors.ts';
import type { JsonObject } from '../../domain/json.ts';

const NOT_CACHEABLE = { ttlMs: 0, cacheScope: 'private' } as const;

export function toolSuccessResult(output: ToolOutput): JsonObject {
  return {
    resultType: 'complete',
    content: [
      { type: 'text', text: output.summary },
      { type: 'text', text: JSON.stringify(output.data) },
    ],
    structuredContent: output.data,
    isError: false,
    ...NOT_CACHEABLE,
  };
}

/** Shapes a typed failure into a client-visible tool error; never includes causes or stacks. */
export function toolFailureResult(error: AppError): JsonObject {
  const body: JsonObject = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
  if (error instanceof ProviderError) {
    body.outcomeUncertain = error.outcomeUncertain;
    if (error.requestId !== undefined) body.providerRequestId = error.requestId;
    if (error.retryAfterMs !== undefined) body.retryAfterMs = error.retryAfterMs;
  }
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
    structuredContent: { error: body },
    isError: true,
    ...NOT_CACHEABLE,
  };
}
