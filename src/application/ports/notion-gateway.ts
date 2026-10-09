import type {
  CreatedPage,
  CreatePageInput,
  PageContent,
  PageId,
  SearchQuery,
  SearchResults,
} from '../../domain/notion.ts';

/**
 * Everything the application needs from a Notion provider.
 * Implementations throw ProviderError for provider-side failures.
 */
export interface NotionGateway {
  search(query: SearchQuery): Promise<SearchResults>;
  fetchPage(id: PageId): Promise<PageContent>;
  createPage(input: CreatePageInput): Promise<CreatedPage>;
}
