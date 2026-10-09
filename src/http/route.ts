/** One exact-path HTTP endpoint. */
export interface Route {
  readonly path: string;
  handle(request: Request): Promise<Response>;
}
