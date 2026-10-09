import type { NotionGateway } from '../../application/ports/notion-gateway.ts';
import type { RequestContext } from '../../application/request-context.ts';
import { ProviderError, requestCancelled } from '../../domain/errors.ts';
import {
  type ContentBlock,
  type CreatedPage,
  type CreatePageInput,
  type PageContent,
  type PageDetails,
  type PageId,
  type SearchQuery,
  type SearchResults,
  tryParsePageId,
} from '../../domain/notion.ts';
import { SEED_PAGES, type SeedPage } from './seed-pages.ts';

export interface FakeNotionOptions {
  readonly pages?: readonly SeedPage[];
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Pages created through the fake become searchable only after this delay. */
  readonly searchIndexLagMs?: number;
}

interface StoredPage extends SeedPage {
  readonly searchableAt: number;
}

/**
 * In-memory NotionGateway for demos and tests. Needs no network or credentials.
 * Mirrors the provider's eventual-consistency search: fetch sees a new page at once,
 * search sees it only after `searchIndexLagMs`.
 */
export class FakeNotionGateway implements NotionGateway {
  private readonly pages = new Map<PageId, StoredPage>();
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly searchIndexLagMs: number;

  constructor(options: FakeNotionOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.searchIndexLagMs = options.searchIndexLagMs ?? 0;
    for (const page of options.pages ?? SEED_PAGES) {
      this.pages.set(page.details.id, { ...page, searchableAt: 0 });
    }
  }

  search(query: SearchQuery, { signal }: RequestContext): Promise<SearchResults> {
    if (signal.aborted) return Promise.reject(requestCancelled(false));
    const needle = query.query.trim().toLowerCase();
    const nowMs = this.now().getTime();
    const matches = [...this.pages.values()]
      .filter((page) => page.searchableAt <= nowMs && !page.details.archived)
      .filter((page) => needle === '' || this.matches(page, needle))
      .sort((a, b) => b.details.lastEditedTime.localeCompare(a.details.lastEditedTime));

    const offset = query.cursor === undefined ? 0 : this.parseCursor(query.cursor);
    const slice = matches.slice(offset, offset + query.limit);
    const next = offset + slice.length;
    return Promise.resolve({
      pages: slice.map(({ details }) => ({
        id: details.id,
        title: details.title,
        url: details.url,
        lastEditedTime: details.lastEditedTime,
      })),
      hasMore: next < matches.length,
      nextCursor: next < matches.length ? `fake-offset:${next}` : null,
    });
  }

  fetchPage(id: PageId, { signal }: RequestContext): Promise<PageContent> {
    if (signal.aborted) return Promise.reject(requestCancelled(false));
    const page = this.pages.get(id);
    if (!page) {
      return Promise.reject(new ProviderError('not_found', 'Page not found or not shared.'));
    }
    return Promise.resolve({ page: page.details, blocks: page.blocks, truncated: false });
  }

  createPage(input: CreatePageInput, { signal }: RequestContext): Promise<CreatedPage> {
    if (signal.aborted) return Promise.reject(requestCancelled(false));
    if (!this.pages.has(input.parentPageId)) {
      return Promise.reject(
        new ProviderError('not_found', 'Parent page not found or not shared.'),
      );
    }
    const id = tryParsePageId(this.newId());
    if (!id) throw new Error('FakeNotionGateway: newId() must return a UUID');

    const timestamp = this.now();
    const details: PageDetails = {
      id,
      title: input.title,
      url: `https://www.notion.so/fake-${id.replaceAll('-', '')}`,
      createdTime: timestamp.toISOString(),
      lastEditedTime: timestamp.toISOString(),
      archived: false,
    };
    const blocks: ContentBlock[] = input.paragraphs.map((text, index) => ({
      id: `${id.slice(0, -4)}${String(index).padStart(4, '0')}`,
      type: 'paragraph',
      text,
      hasChildren: false,
    }));
    this.pages.set(id, {
      details,
      blocks,
      searchableAt: timestamp.getTime() + this.searchIndexLagMs,
    });
    return Promise.resolve({ id, title: details.title, url: details.url });
  }

  /** Notion's search endpoint matches page titles, so the fake does too. */
  private matches(page: StoredPage, needle: string): boolean {
    return page.details.title.toLowerCase().includes(needle);
  }

  private parseCursor(cursor: string): number {
    const match = /^fake-offset:(\d+)$/.exec(cursor);
    if (!match) throw new ProviderError('invalid_request', 'Invalid search cursor.');
    return Number(match[1]);
  }
}
