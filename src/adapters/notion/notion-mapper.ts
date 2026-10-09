import { z } from 'zod';
import { ProviderError } from '../../domain/errors.ts';
import {
  type ContentBlock,
  type ContentBlockType,
  type CreatedPage,
  type CreatePageInput,
  type PageDetails,
  type PageSummary,
  tryParsePageId,
} from '../../domain/notion.ts';
import {
  blockChildrenSchema,
  blockTextSchema,
  type NotionBlock,
  type NotionPage,
  pageSchema,
  searchResponseSchema,
} from './notion-schemas.ts';

const TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set<ContentBlockType>([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'quote',
  'callout',
  'code',
]);

function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderError(
      'bad_response',
      'Notion returned a response this server could not understand.',
    );
  }
  return parsed.data;
}

function mapPageDetails(raw: NotionPage): PageDetails {
  const id = tryParsePageId(raw.id);
  if (!id) throw new ProviderError('bad_response', 'Notion returned an unexpected page id.');
  const titleProperty = Object.values(raw.properties).find((property) => property.type === 'title');
  const title = titleProperty?.title?.map((part) => part.plain_text).join('').trim() ?? '';
  return {
    id,
    title: title === '' ? 'Untitled' : title,
    url: raw.url,
    createdTime: raw.created_time,
    lastEditedTime: raw.last_edited_time,
    archived: raw.archived === true || raw.in_trash === true,
  };
}

export function mapPage(raw: unknown): PageDetails {
  return mapPageDetails(parseOrThrow(pageSchema, raw));
}

export function mapSearchResponse(raw: unknown) {
  const response = parseOrThrow(searchResponseSchema, raw);
  const pages: PageSummary[] = response.results
    .filter((result) => result.object === 'page')
    .map((result) => mapPage(result))
    .filter((page) => !page.archived)
    .map(({ id, title, url, lastEditedTime }) => ({ id, title, url, lastEditedTime }));
  return { pages, hasMore: response.has_more, nextCursor: response.next_cursor };
}

function mapBlock(raw: NotionBlock): ContentBlock {
  if (!TEXT_BLOCK_TYPES.has(raw.type)) {
    return { id: raw.id, type: 'unsupported', text: '', hasChildren: raw.has_children };
  }
  const payload = blockTextSchema.safeParse(raw[raw.type]);
  return {
    id: raw.id,
    type: raw.type as ContentBlockType,
    text: payload.success ? payload.data.rich_text.map((part) => part.plain_text).join('') : '',
    hasChildren: raw.has_children,
  };
}

export function mapBlockChildren(raw: unknown) {
  const response = parseOrThrow(blockChildrenSchema, raw);
  return { blocks: response.results.map(mapBlock), hasMore: response.has_more };
}

export function mapCreatedPage(raw: unknown): CreatedPage {
  const { id, title, url } = mapPage(raw);
  return { id, title, url };
}

/** Request body for POST /v1/pages: a titled child page with paragraph blocks. */
export function buildCreatePageBody(input: CreatePageInput) {
  return {
    parent: { page_id: input.parentPageId },
    properties: { title: { title: [{ text: { content: input.title } }] } },
    children: input.paragraphs.map((text) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
    })),
  };
}

export function buildSearchBody(query: string, limit: number, cursor: string | undefined) {
  return {
    query,
    page_size: limit,
    filter: { property: 'object', value: 'page' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    ...(cursor === undefined ? {} : { start_cursor: cursor }),
  };
}
