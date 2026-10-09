/** Product-owned Notion domain values. Nothing here mirrors a provider payload. */

declare const pageIdBrand: unique symbol;
/** Canonical lowercase dashed UUID. */
export type PageId = string & { readonly [pageIdBrand]: true };

const PAGE_ID_PATTERN =
  /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/;

export function tryParsePageId(raw: string): PageId | null {
  const match = PAGE_ID_PATTERN.exec(raw.trim().toLowerCase());
  return match ? (match.slice(1).join('-') as PageId) : null;
}

export interface PageSummary {
  readonly id: PageId;
  readonly title: string;
  readonly url: string;
  readonly lastEditedTime: string;
}

export interface PageDetails extends PageSummary {
  readonly createdTime: string;
  readonly archived: boolean;
}

export type ContentBlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'to_do'
  | 'quote'
  | 'callout'
  | 'code'
  | 'unsupported';

export interface ContentBlock {
  readonly id: string;
  readonly type: ContentBlockType;
  readonly text: string;
  readonly hasChildren: boolean;
}

export interface SearchQuery {
  readonly query: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface SearchResults {
  readonly pages: readonly PageSummary[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface PageContent {
  readonly page: PageDetails;
  readonly blocks: readonly ContentBlock[];
  /** True when the page has more blocks than were returned. */
  readonly truncated: boolean;
}

export interface CreatePageInput {
  readonly parentPageId: PageId;
  readonly title: string;
  /** Plain-text paragraphs, each within the provider's per-block limit. */
  readonly paragraphs: readonly string[];
}

export interface CreatedPage {
  readonly id: PageId;
  readonly title: string;
  readonly url: string;
}

export const MAX_PARAGRAPH_CHARS = 2000;
export const MAX_CREATE_BLOCKS = 100;

/** Splits text on blank lines and wraps paragraphs longer than the block limit. */
export function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const trimmed = chunk.trim();
    for (let start = 0; start < trimmed.length; start += MAX_PARAGRAPH_CHARS) {
      paragraphs.push(trimmed.slice(start, start + MAX_PARAGRAPH_CHARS));
    }
  }
  return paragraphs;
}
