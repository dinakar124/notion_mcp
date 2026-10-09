export interface RetryPolicyOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Returns a value in [0, 1); injectable for deterministic tests. */
  readonly random?: () => number;
}

export interface RetryContext {
  /** 1-based number of the attempt that just failed. */
  readonly attempt: number;
  /** Undefined for network-level failures. */
  readonly status?: number;
  readonly retryAfterHeader?: string | null;
  readonly idempotent: boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryPolicyOptions = {
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 5_000,
};

/**
 * Decides whether and when to retry. 429 is always safe (the request was not processed);
 * 503/529 and network failures are retried only for idempotent requests because the
 * provider may already have applied a write.
 */
export class RetryPolicy {
  private readonly random: () => number;

  constructor(private readonly options: RetryPolicyOptions = DEFAULT_RETRY_OPTIONS) {
    this.random = options.random ?? Math.random;
  }

  /** Milliseconds to wait before the next attempt, or null to stop retrying. */
  delayBeforeRetry(context: RetryContext): number | null {
    if (context.attempt >= this.options.maxAttempts) return null;
    if (!this.isRetryable(context)) return null;

    const requested = parseRetryAfterMs(context.retryAfterHeader);
    if (requested !== null) {
      return requested <= this.options.maxDelayMs ? requested : null;
    }
    const exponential = this.options.baseDelayMs * 2 ** (context.attempt - 1);
    const capped = Math.min(exponential, this.options.maxDelayMs);
    return Math.round(capped * (0.5 + this.random() / 2));
  }

  private isRetryable({ status, idempotent }: RetryContext): boolean {
    if (status === 429) return true;
    if (status === undefined || status === 503 || status === 529) return idempotent;
    return false;
  }
}

/** Parses a Retry-After header expressed in seconds. HTTP-date values are ignored. */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (header === null || header === undefined || !/^\d+(\.\d+)?$/.test(header.trim())) return null;
  return Math.round(Number(header) * 1000);
}
