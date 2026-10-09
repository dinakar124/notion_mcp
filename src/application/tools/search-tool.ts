import { z } from 'zod';
import type { NotionGateway } from '../ports/notion-gateway.ts';
import { SchemaTool, type ToolOutput } from './tool.ts';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const searchSchema = z.object({
  query: z.string().max(200).describe(
    'Text to match against page titles. Empty lists recent pages.',
  ),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe(
    `Maximum results (1-${MAX_LIMIT}).`,
  ),
  cursor: z.string().min(1).max(500).optional().describe('Cursor from a previous result page.'),
});

const INDEXING_NOTE =
  'Notion search is eventually consistent: pages created or renamed in the last few minutes ' +
  'may be missing. Use notion_fetch_page with a known page id for authoritative content.';

export class NotionSearchTool extends SchemaTool<typeof searchSchema> {
  constructor(private readonly gateway: NotionGateway) {
    super({
      name: 'notion_search',
      title: 'Search Notion pages',
      description:
        'Search pages the integration can access by title. Results may lag recent edits.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    }, searchSchema);
  }

  protected async run(input: z.output<typeof searchSchema>): Promise<ToolOutput> {
    const results = await this.gateway.search({
      query: input.query,
      limit: input.limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    return {
      summary: `Found ${results.pages.length} page(s) matching "${input.query}".`,
      data: {
        query: input.query,
        count: results.pages.length,
        results: results.pages.map((page) => ({
          id: page.id,
          title: page.title,
          url: page.url,
          lastEditedTime: page.lastEditedTime,
        })),
        hasMore: results.hasMore,
        nextCursor: results.nextCursor,
        indexing: { consistency: 'eventual', note: INDEXING_NOTE },
      },
    };
  }
}
