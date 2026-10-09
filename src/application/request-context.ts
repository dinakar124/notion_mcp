/** Per-request values passed down explicitly from the transport; there is no ambient state. */
export interface RequestContext {
  /** Aborts when the caller disconnects or cancels. Work must stop and must never be retried. */
  readonly signal: AbortSignal;
}
