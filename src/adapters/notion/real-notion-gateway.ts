import type { NotionGateway } from '../../application/ports/notion-gateway.ts';
import type {
  CreatedPage,
  CreatePageInput,
  PageContent,
  PageId,
  SearchQuery,
  SearchResults,
} from '../../domain/notion.ts';
import {
  buildCreatePageBody,
  buildSearchBody,
  mapBlockChildren,
  mapCreatedPage,
  mapPage,
  mapSearchResponse,
} from './notion-mapper.ts';
import type { NotionTransport } from './notion-transport.ts';

const BLOCK_PAGE_SIZE = 100;

/** NotionGateway backed by the Notion REST API: builds requests, delegates to the transport, maps results. */
export class RealNotionGateway implements NotionGateway {
  constructor(private readonly transport: NotionTransport) {}

  async search(query: SearchQuery): Promise<SearchResults> {
    const raw = await this.transport.request({
      method: 'POST',
      path: '/v1/search',
      body: buildSearchBody(query.query, query.limit, query.cursor),
      idempotent: true,
    });
    return mapSearchResponse(raw);
  }

  async fetchPage(id: PageId): Promise<PageContent> {
    const [rawPage, rawBlocks] = await Promise.all([
      this.transport.request({ method: 'GET', path: `/v1/pages/${id}`, idempotent: true }),
      this.transport.request({
        method: 'GET',
        path: `/v1/blocks/${id}/children?page_size=${BLOCK_PAGE_SIZE}`,
        idempotent: true,
      }),
    ]);
    const { blocks, hasMore } = mapBlockChildren(rawBlocks);
    return { page: mapPage(rawPage), blocks, truncated: hasMore };
  }

  async createPage(input: CreatePageInput): Promise<CreatedPage> {
    const raw = await this.transport.request({
      method: 'POST',
      path: '/v1/pages',
      body: buildCreatePageBody(input),
      idempotent: false,
    });
    return mapCreatedPage(raw);
  }
}
