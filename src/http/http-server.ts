import type { Logger } from '../observability/logger.ts';

export interface ServerAddress {
  readonly hostname: string;
  readonly port: number;
}

/** Owns the listening socket lifecycle: start once, stop gracefully. */
export class HttpServer {
  private server: Deno.HttpServer<Deno.NetAddr> | undefined;
  private readonly abort = new AbortController();

  constructor(
    private readonly handler: (request: Request) => Promise<Response>,
    private readonly host: string,
    private readonly port: number,
    private readonly logger: Logger,
  ) {}

  start(): ServerAddress {
    if (this.server) throw new Error('HttpServer already started');
    this.server = Deno.serve(
      { hostname: this.host, port: this.port, signal: this.abort.signal, onListen: () => {} },
      this.handler,
    );
    const address = { hostname: this.server.addr.hostname, port: this.server.addr.port };
    this.logger.info('server.listening', { ...address });
    return address;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.abort.abort();
    await this.server.finished;
    this.logger.info('server.stopped');
    this.server = undefined;
  }
}
