import type { JsonObject } from '../../../domain/json.ts';
import { PROTOCOL_VERSION } from '../constants.ts';
import type { McpMethodHandler } from '../dispatcher.ts';

export class DiscoverHandler implements McpMethodHandler {
  readonly method = 'server/discover';

  handle(): Promise<JsonObject> {
    return Promise.resolve({
      resultType: 'complete',
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: { tools: {} },
      instructions:
        'Notion tools: notion_search (title search, eventually consistent), notion_fetch_page, ' +
        'and notion_create_page (writes only with confirm=true).',
      ttlMs: 3_600_000,
      cacheScope: 'public',
    });
  }
}
