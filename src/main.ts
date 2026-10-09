/** Entry point: load config, wire the application, run until signalled. */
import { createApplication } from './app.ts';
import { loadConfig } from './config/config.ts';
import { ConfigError } from './domain/errors.ts';
import { HttpServer } from './http/http-server.ts';
import { JsonLogger } from './observability/logger.ts';

function main(): void {
  const stderr = new TextEncoder();
  let config;
  try {
    config = loadConfig(Deno.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    Deno.stderr.writeSync(stderr.encode(`${error.message}\n`));
    Deno.exit(2);
  }

  const logger = new JsonLogger(
    config.logLevel,
    (line) => Deno.stderr.writeSync(stderr.encode(`${line}\n`)),
  );
  const { httpApp } = createApplication(config, logger);
  const server = new HttpServer(httpApp.handle, config.host, config.port, logger);
  const { hostname, port } = server.start();
  logger.info('server.ready', {
    mcpUrl: `http://${hostname}:${port}/mcp`,
    notionMode: config.notion.mode,
  });

  const shutdown = async () => {
    await server.stop();
    Deno.exit(0);
  };
  Deno.addSignalListener('SIGINT', shutdown);
  Deno.addSignalListener('SIGTERM', shutdown);
}

if (import.meta.main) main();
