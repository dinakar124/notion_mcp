import type { AppConfig } from './config/config.ts';
import { FakeNotionGateway } from './adapters/fake/fake-notion-gateway.ts';
import { createRealNotionGateway } from './adapters/notion/create-real-gateway.ts';
import type { NotionGateway } from './application/ports/notion-gateway.ts';
import { createDefaultTools } from './application/tools/default-tools.ts';
import { ToolRegistry } from './application/tools/tool-registry.ts';
import { HealthRoute } from './http/health-route.ts';
import { HttpApp } from './http/http-app.ts';
import { McpRoute } from './http/mcp-route.ts';
import type { Logger } from './observability/logger.ts';
import { McpDispatcher } from './protocol/mcp/dispatcher.ts';
import { CallToolHandler } from './protocol/mcp/methods/call-tool-handler.ts';
import { DiscoverHandler } from './protocol/mcp/methods/discover-handler.ts';
import { ListToolsHandler } from './protocol/mcp/methods/list-tools-handler.ts';
import { McpRequestParser } from './protocol/mcp/request.ts';

export interface Application {
  readonly httpApp: HttpApp;
  readonly registry: ToolRegistry;
}

function createGateway(config: AppConfig, logger: Logger): NotionGateway {
  return config.notion.mode === 'real'
    ? createRealNotionGateway(config.notion, logger)
    : new FakeNotionGateway();
}

/**
 * Production wiring. Tests pass their own gateway to exercise the same components
 * without touching the network.
 */
export function createApplication(
  config: AppConfig,
  logger: Logger,
  gateway: NotionGateway = createGateway(config, logger),
): Application {
  const registry = new ToolRegistry(createDefaultTools(gateway));
  const dispatcher = new McpDispatcher([
    new DiscoverHandler(),
    new ListToolsHandler(registry),
    new CallToolHandler(registry, logger),
  ]);
  const httpApp = new HttpApp([
    new HealthRoute(config.notion.mode),
    new McpRoute(new McpRequestParser(), dispatcher, {
      allowedOrigins: config.allowedOrigins,
      maxBodyBytes: config.maxBodyBytes,
    }, logger),
  ], logger);
  return { httpApp, registry };
}
