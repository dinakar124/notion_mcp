import { assertEquals, assertThrows } from '@std/assert';
import {
  buildCreatePageBody,
  buildSearchBody,
  mapBlockChildren,
  mapCreatedPage,
  mapPage,
  mapSearchResponse,
} from '../../src/adapters/notion/notion-mapper.ts';
import { ProviderError } from '../../src/domain/errors.ts';
import { type PageId, splitParagraphs, tryParsePageId } from '../../src/domain/notion.ts';

const FIXTURES = new URL('../../test-support/fixtures/real-notion/', import.meta.url);

const PAGE_UUID = '66666666-6666-4666-8666-666666666666';

/** Loads a real-API fixture; ids are redacted in the files, so a valid UUID is substituted. */
async function fixture(name: string): Promise<Record<string, unknown>> {
  const raw = JSON.parse(await Deno.readTextFile(new URL(name, FIXTURES)));
  return raw.object === 'page' ? { ...raw, id: PAGE_UUID } : raw;
}

Deno.test('mapPage: maps a real page fixture to product fields only', async () => {
  const page = mapPage(await fixture('page-read.json'));
  assertEquals(Object.keys(page).sort(), [
    'archived',
    'createdTime',
    'id',
    'lastEditedTime',
    'title',
    'url',
  ]);
  assertEquals(page.archived, false);
  assertEquals(page.id, PAGE_UUID);
});

Deno.test('mapCreatedPage: maps the real create fixture to id, title and URL', async () => {
  const raw = await fixture('page-create.json');
  const created = mapCreatedPage(raw);
  assertEquals(Object.keys(created).sort(), ['id', 'title', 'url']);
  assertEquals(created.url, raw.url);
});

Deno.test('mapSearchResponse: real empty-search fixture maps to an empty page list', async () => {
  const result = mapSearchResponse(await fixture('search-empty.json'));
  assertEquals(result, { pages: [], hasMore: false, nextCursor: null });
});

Deno.test('mapSearchResponse: keeps pages, drops databases and archived pages', async () => {
  const page = await fixture('page-read.json');
  const trashed = { ...page, id: '33333333-3333-4333-8333-333333333333', in_trash: true };
  const result = mapSearchResponse({
    results: [page, { object: 'database', id: 'x' }, trashed],
    has_more: true,
    next_cursor: 'abc',
  });
  assertEquals(result.pages.length, 1);
  assertEquals(result.hasMore, true);
  assertEquals(result.nextCursor, 'abc');
});

Deno.test('mapPage: untitled pages get a stable placeholder; properties never leak', () => {
  const page = mapPage({
    object: 'page',
    id: '44444444444444444444444444444444',
    created_time: 'a',
    last_edited_time: 'b',
    url: 'https://www.notion.so/x',
    properties: { Status: { type: 'select' }, Secret: { type: 'rich_text' } },
    created_by: { id: 'user-secret' },
  });
  assertEquals(page.title, 'Untitled');
  assertEquals(page.id, '44444444-4444-4444-4444-444444444444' as PageId);
  assertEquals(JSON.stringify(page).includes('user-secret'), false);
});

Deno.test('mapBlockChildren: maps text blocks, flags unsupported ones, reports truncation', async () => {
  const fixtureBlocks = await fixture('blocks-append.json');
  const mapped = mapBlockChildren({ ...fixtureBlocks, has_more: true, next_cursor: 'c' });
  assertEquals(mapped.hasMore, true);
  assertEquals(mapped.blocks.length, 2);
  assertEquals(mapped.blocks[0]?.type, 'paragraph');
  assertEquals((mapped.blocks[0]?.text.length ?? 0) > 0, true);

  const mixed = mapBlockChildren({
    results: [
      {
        id: 'a',
        type: 'heading_2',
        has_children: false,
        heading_2: { rich_text: [{ plain_text: 'H' }] },
      },
      {
        id: 'b',
        type: 'image',
        has_children: false,
        image: { external: { url: 'https://secret' } },
      },
      { id: 'c', type: 'paragraph', has_children: true, paragraph: { rich_text: [] } },
    ],
    has_more: false,
    next_cursor: null,
  });
  assertEquals(mixed.blocks, [
    { id: 'a', type: 'heading_2', text: 'H', hasChildren: false },
    { id: 'b', type: 'unsupported', text: '', hasChildren: false },
    { id: 'c', type: 'paragraph', text: '', hasChildren: true },
  ]);
});

Deno.test('mappers: malformed provider payloads become bad_response errors', () => {
  for (
    const call of [
      () => mapPage({}),
      () => mapSearchResponse({ results: 'x' }),
      () => mapBlockChildren(null),
    ]
  ) {
    const error = assertThrows(call, ProviderError);
    assertEquals(error.kind, 'bad_response');
  }
});

Deno.test('request builders: create page body and search body shapes', () => {
  const parent = '55555555-5555-4555-8555-555555555555' as PageId;
  assertEquals(buildCreatePageBody({ parentPageId: parent, title: 'T', paragraphs: ['p'] }), {
    parent: { page_id: parent },
    properties: { title: { title: [{ text: { content: 'T' } }] } },
    children: [{
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'p' } }] },
    }],
  });
  assertEquals(buildSearchBody('q', 5, undefined).page_size, 5);
  assertEquals('start_cursor' in buildSearchBody('q', 5, undefined), false);
  assertEquals(buildSearchBody('q', 5, 'cur').start_cursor, 'cur');
});

Deno.test('domain: page id parsing and paragraph splitting', () => {
  assertEquals(
    tryParsePageId(' AAAAAAAABBBB4CCC8DDDEEEEEEEEEEEE '),
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  );
  assertEquals(tryParsePageId('not-an-id'), null);
  assertEquals(tryParsePageId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeeX'), null);

  assertEquals(splitParagraphs(''), []);
  assertEquals(splitParagraphs('a\n\nb'), ['a', 'b']);
  assertEquals(splitParagraphs('x'.repeat(4500)).map((p) => p.length), [2000, 2000, 500]);
});
