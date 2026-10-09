import type { NotionGateway } from '../ports/notion-gateway.ts';
import { NotionCreatePageTool } from './create-page-tool.ts';
import { NotionFetchPageTool } from './fetch-page-tool.ts';
import { NotionSearchTool } from './search-tool.ts';
import type { Tool } from './tool.ts';

/** The tool catalogue. Adding a tool means adding one line here. */
export function createDefaultTools(gateway: NotionGateway): Tool[] {
  return [
    new NotionSearchTool(gateway),
    new NotionFetchPageTool(gateway),
    new NotionCreatePageTool(gateway),
  ];
}
