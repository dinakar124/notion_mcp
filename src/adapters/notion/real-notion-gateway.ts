import type { NotionGateway } from '../../application/ports/notion-gateway.ts';
import type { RequestContext } from '../../application/request-context.ts';
import { ProviderError } from '../../domain/errors.ts';
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

  async search(query: SearchQuery, { signal }: RequestContext): Promise<SearchResults> {
    const raw = await this.transport.request({
      method: 'POST',
      path: '/v1/search',
      body: buildSearchBody(query.query, query.limit, query.cursor),
      idempotent: true,
    }, signal);
    return mapSearchResponse(raw);
  }

  async fetchPage(id: PageId, { signal }: RequestContext): Promise<PageContent> {
    const [rawPage, rawBlocks] = await Promise.all([
      this.transport.request({ method: 'GET', path: `/v1/pages/${id}`, idempotent: true }, signal),
      this.transport.request({
        method: 'GET',
        path: `/v1/blocks/${id}/children?page_size=${BLOCK_PAGE_SIZE}`,
        idempotent: true,
      }, signal),
    ]);
    const { blocks, hasMore } = mapBlockChildren(rawBlocks);
    return { page: mapPage(rawPage), blocks, truncated: hasMore };
  }

  async createPage(input: CreatePageInput, { signal }: RequestContext): Promise<CreatedPage> {
    const raw = await this.transport.request({
      method: 'POST',
      path: '/v1/pages',
      body: buildCreatePageBody(input),
      idempotent: false,
    }, signal);
    try {
      return mapCreatedPage(raw);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // Notion accepted the write, so a response we cannot read must not look like a clean failure.
      throw new ProviderError(error.kind, error.message, {
        ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
        outcomeUncertain: true,
        cause: error,
      });
    }
  }
}
