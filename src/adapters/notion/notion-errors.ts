import { ProviderError, type ProviderErrorKind, requestCancelled } from '../../domain/errors.ts';
import { parseRetryAfterMs } from './retry-policy.ts';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;

/** Returns the upstream request id only if it is a harmless token; otherwise undefined. */
export function sanitizeRequestId(raw: string | null): string | undefined {
  return raw !== null && REQUEST_ID_PATTERN.test(raw) ? raw : undefined;
}

function kindForStatus(status: number): ProviderErrorKind {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'unavailable' : 'invalid_request';
  }
}

const MESSAGES: Record<ProviderErrorKind, string> = {
  unauthorized: 'Notion rejected the credentials.',
  forbidden: 'The integration is not allowed to access this resource.',
  not_found: 'Page not found, or it has not been shared with the integration.',
  conflict: 'Notion reported a conflicting update; retry later.',
  invalid_request: 'Notion rejected the request as invalid.',
  rate_limited: 'Notion rate limit reached.',
  unavailable: 'Notion is temporarily unavailable.',
  timeout: 'Notion did not respond in time.',
  cancelled: 'The request was cancelled.',
  bad_response: 'Notion returned a response this server could not understand.',
};

/**
 * Statuses that prove Notion rejected the request without applying it. Everything else on a
 * write (429, 409, 5xx, ...) leaves open that the change was made.
 */
const DEFINITE_REJECTIONS: ReadonlySet<number> = new Set([400, 401, 403, 404]);

/** Builds a typed error from an upstream HTTP failure without copying the upstream message. */
export function errorFromResponse(
  response: Response,
  bodyText: string,
  idempotent: boolean,
): ProviderError {
  const kind = kindForStatus(response.status);
  const providerCode = extractProviderCode(bodyText);
  const message = providerCode ? `${MESSAGES[kind]} (${providerCode})` : MESSAGES[kind];
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  return new ProviderError(kind, message, {
    requestId: sanitizeRequestId(response.headers.get('x-notion-request-id')),
    ...(retryAfterMs === null ? {} : { retryAfterMs }),
    outcomeUncertain: !idempotent && !DEFINITE_REJECTIONS.has(response.status),
  });
}

function extractProviderCode(bodyText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === 'object' && parsed !== null && 'code' in parsed) {
      const { code } = parsed as { code: unknown };
      if (typeof code === 'string' && ERROR_CODE_PATTERN.test(code)) return code;
    }
  } catch { /* non-JSON error body */ }
  return undefined;
}

/**
 * A failure while the request was (or may have been) on the wire. Cancellation by the caller
 * is told apart from the client's own timeout by the caller's signal, not by the error shape.
 */
export function networkError(
  cause: unknown,
  idempotent: boolean,
  cancelledByCaller: boolean,
): ProviderError {
  if (cancelledByCaller) return requestCancelled(!idempotent);
  const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
  return new ProviderError(
    timedOut ? 'timeout' : 'unavailable',
    timedOut ? MESSAGES.timeout : 'Could not reach Notion.',
    { outcomeUncertain: !idempotent, cause },
  );
}

/** `outcomeUncertain` is true for a 2xx whose body is unusable: the write was most likely applied. */
export function badResponse(
  requestId?: string,
  cause?: unknown,
  outcomeUncertain = false,
): ProviderError {
  return new ProviderError('bad_response', MESSAGES.bad_response, {
    ...(requestId === undefined ? {} : { requestId }),
    outcomeUncertain,
    cause,
  });
}
