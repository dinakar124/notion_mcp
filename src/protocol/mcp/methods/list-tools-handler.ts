import type { ToolRegistry } from '../../../application/tools/tool-registry.ts';
import type { JsonObject } from '../../../domain/json.ts';
import type { McpMethodHandler } from '../dispatcher.ts';

export class ListToolsHandler implements McpMethodHandler {
  readonly method = 'tools/list';

  constructor(private readonly registry: ToolRegistry) {}

  handle(): Promise<JsonObject> {
    return Promise.resolve({
      resultType: 'complete',
      tools: this.registry.definitions().map((definition) => ({
        name: definition.name,
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: { ...definition.annotations },
      })),
      ttlMs: 60_000,
      cacheScope: 'public',
    });
  }
}
