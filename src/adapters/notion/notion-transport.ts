/** Minimal HTTP surface the Notion gateway needs; lets tests swap the network out. */
export interface NotionRequest {
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Path and query, starting with `/v1/`. */
  readonly path: string;
  readonly body?: unknown;
  /**
   * True only when repeating the request cannot cause a second side effect.
   * Non-idempotent requests are sent at most once, and any failure that does not prove the
   * provider rejected them is reported as an uncertain outcome.
   */
  readonly idempotent: boolean;
}

export interface NotionTransport {
  /**
   * Resolves with the parsed JSON body of a 2xx response; throws ProviderError otherwise.
   * Aborting `signal` cancels the request and stops any retry.
   */
  request(request: NotionRequest, signal: AbortSignal): Promise<unknown>;
}
