import { z } from 'zod';
import { ConfirmationRequiredError, InvalidArgumentsError } from '../../domain/errors.ts';
import { MAX_CREATE_BLOCKS, splitParagraphs } from '../../domain/notion.ts';
import type { NotionGateway } from '../ports/notion-gateway.ts';
import { pageIdSchema } from './page-id-schema.ts';
import { SchemaTool, type ToolOutput } from './tool.ts';

const createSchema = z.object({
  parent_page_id: pageIdSchema.describe('Page under which the new page is created.'),
  title: z.string().trim().min(1).max(200).describe('Title of the new page.'),
  content: z.string().max(20_000).optional().describe(
    'Optional body text. Blank lines separate paragraphs.',
  ),
  confirm: z.boolean().default(false).describe(
    'Must be true to write. Set only after the user has approved this exact action.',
  ),
});

export class NotionCreatePageTool extends SchemaTool<typeof createSchema> {
  constructor(private readonly gateway: NotionGateway) {
    super({
      name: 'notion_create_page',
      title: 'Create a Notion page',
      description: 'Create a child page under an existing page. Writes only when confirm=true; ' +
        'not idempotent, so repeating a call creates another page.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    }, createSchema);
  }

  protected async run(input: z.output<typeof createSchema>): Promise<ToolOutput> {
    if (input.confirm !== true) throw new ConfirmationRequiredError(this.definition.name);

    const paragraphs = splitParagraphs(input.content ?? '');
    if (paragraphs.length > MAX_CREATE_BLOCKS) {
      throw new InvalidArgumentsError('Content is too long.', [
        `content: at most ${MAX_CREATE_BLOCKS} paragraphs are supported`,
      ]);
    }

    const page = await this.gateway.createPage({
      parentPageId: input.parent_page_id,
      title: input.title,
      paragraphs,
    });
    return {
      summary: `Created page "${page.title}".`,
      data: { created: true, page: { id: page.id, title: page.title, url: page.url } },
    };
  }
}
