/** Minimal HTTP surface the Notion gateway needs; lets tests swap the network out. */
export interface NotionRequest {
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Path and query, starting with `/v1/`. */
  readonly path: string;
  readonly body?: unknown;
  /** True when repeating the request cannot cause a second side effect. */
  readonly idempotent: boolean;
}

export interface NotionTransport {
  /** Resolves with the parsed JSON body of a 2xx response; throws ProviderError otherwise. */
  request(request: NotionRequest): Promise<unknown>;
}
