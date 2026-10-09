import { z } from 'zod';
import type { NotionGateway } from '../ports/notion-gateway.ts';
import { pageIdSchema } from './page-id-schema.ts';
import { SchemaTool, type ToolOutput } from './tool.ts';

const fetchSchema = z.object({ page_id: pageIdSchema });

export class NotionFetchPageTool extends SchemaTool<typeof fetchSchema> {
  constructor(private readonly gateway: NotionGateway) {
    super({
      name: 'notion_fetch_page',
      title: 'Fetch a Notion page',
      description:
        'Fetch a page by id: title, URL, timestamps and its top-level text blocks (up to 100).',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    }, fetchSchema);
  }

  protected async run(input: z.output<typeof fetchSchema>): Promise<ToolOutput> {
    const { page, blocks, truncated } = await this.gateway.fetchPage(input.page_id);
    return {
      summary: `Fetched "${page.title}" (${blocks.length} block(s)${
        truncated ? ', truncated' : ''
      }).`,
      data: {
        page: {
          id: page.id,
          title: page.title,
          url: page.url,
          createdTime: page.createdTime,
          lastEditedTime: page.lastEditedTime,
          archived: page.archived,
        },
        blocks: blocks.map((block) => ({
          id: block.id,
          type: block.type,
          text: block.text,
          hasChildren: block.hasChildren,
        })),
        blockCount: blocks.length,
        truncated,
      },
    };
  }
}
