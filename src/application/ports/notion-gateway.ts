import type {
  CreatedPage,
  CreatePageInput,
  PageContent,
  PageId,
  SearchQuery,
  SearchResults,
} from '../../domain/notion.ts';
import type { RequestContext } from '../request-context.ts';

/**
 * Everything the application needs from a Notion provider.
 * Implementations throw ProviderError for provider-side failures and stop work
 * when `context.signal` aborts.
 */
export interface NotionGateway {
  search(query: SearchQuery, context: RequestContext): Promise<SearchResults>;
  fetchPage(id: PageId, context: RequestContext): Promise<PageContent>;
  /** Not idempotent: implementations must send it at most once. */
  createPage(input: CreatePageInput, context: RequestContext): Promise<CreatedPage>;
}
