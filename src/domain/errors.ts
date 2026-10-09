import type { JsonValue } from './json.ts';

export type ProviderErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_request'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'bad_response';

export type ErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'CONFIRMATION_REQUIRED'
  | 'UNKNOWN_TOOL'
  | 'CONFIG_INVALID'
  | `PROVIDER_${Uppercase<ProviderErrorKind>}`;

interface AppErrorOptions {
  retryable?: boolean;
  details?: JsonValue;
  cause?: unknown;
}

/** Base class for every error whose code and message are safe to show to a client. */
export class AppError extends Error {
  readonly retryable: boolean;
  readonly details: JsonValue | undefined;

  constructor(readonly code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class InvalidArgumentsError extends AppError {
  constructor(message: string, issues: readonly string[] = []) {
    super('INVALID_ARGUMENTS', message, { details: { issues: [...issues] } });
  }
}

export class ConfirmationRequiredError extends AppError {
  constructor(toolName: string) {
    super(
      'CONFIRMATION_REQUIRED',
      `${toolName} changes the workspace. Nothing was written. ` +
        'Ask the user to approve the action, then call again with confirm=true.',
    );
  }
}

export class UnknownToolError extends AppError {
  constructor(toolName: string) {
    super('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
  }
}

export class ConfigError extends AppError {
  constructor(issues: readonly string[]) {
    super('CONFIG_INVALID', `Invalid configuration: ${issues.join('; ')}`, {
      details: { issues: [...issues] },
    });
  }
}

const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  'rate_limited',
  'unavailable',
  'timeout',
]);

export interface ProviderErrorOptions {
  /** Sanitised upstream request id, safe to surface for support. */
  requestId?: string;
  retryAfterMs?: number;
  /** True when the provider may have applied the operation despite the failure. */
  outcomeUncertain?: boolean;
  cause?: unknown;
}

/** A failure reported by (or while talking to) the Notion provider. */
export class ProviderError extends AppError {
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly outcomeUncertain: boolean;

  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    const outcomeUncertain = options.outcomeUncertain ?? false;
    super(`PROVIDER_${kind.toUpperCase()}` as ErrorCode, message, {
      retryable: RETRYABLE_KINDS.has(kind) && !outcomeUncertain,
      cause: options.cause,
    });
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs;
    this.outcomeUncertain = outcomeUncertain;
  }
}
