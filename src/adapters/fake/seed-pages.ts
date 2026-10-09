import { type ContentBlock, type PageDetails, tryParsePageId } from '../../domain/notion.ts';

export interface SeedPage {
  readonly details: PageDetails;
  readonly blocks: readonly ContentBlock[];
}

function seed(
  id: string,
  title: string,
  lastEdited: string,
  paragraphs: readonly string[],
): SeedPage {
  const pageId = tryParsePageId(id);
  if (!pageId) throw new Error(`Invalid seed page id: ${id}`);
  return {
    details: {
      id: pageId,
      title,
      url: `https://www.notion.so/fake-${pageId.replaceAll('-', '')}`,
      createdTime: '2026-01-05T09:00:00.000Z',
      lastEditedTime: lastEdited,
      archived: false,
    },
    blocks: paragraphs.map((text, index) => ({
      id: `${id.slice(0, -2)}${String(index).padStart(2, '0')}`,
      type: index === 0 ? 'heading_1' : 'paragraph',
      text,
      hasChildren: false,
    })),
  };
}

/** Deterministic demo workspace served by FakeNotionGateway. Entirely synthetic. */
export const SEED_PAGES: readonly SeedPage[] = [
  seed(
    '11111111-1111-4111-8111-111111111101',
    'Welcome to the demo workspace',
    '2026-09-01T10:00:00.000Z',
    [
      'Welcome',
      'This is a synthetic page served by the in-memory fake. No network or credentials involved.',
    ],
  ),
  seed('11111111-1111-4111-8111-111111111102', 'Engineering roadmap', '2026-09-20T15:30:00.000Z', [
    'Engineering roadmap',
    'Q4 focus: reliability of the MCP server, tool catalogue growth, and contract tests.',
    'Search indexing in Notion is eventually consistent, so new pages may take a moment to appear.',
  ]),
  seed(
    '11111111-1111-4111-8111-111111111103',
    'Meeting notes: launch review',
    '2026-10-02T08:15:00.000Z',
    [
      'Launch review',
      'Decisions: ship the read tools first; writes require explicit confirmation.',
    ],
  ),
];

export const FAKE_PARENT_PAGE_ID = SEED_PAGES[0]!.details.id;
