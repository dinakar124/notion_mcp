import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { FakeNotionGateway } from '../../src/adapters/fake/fake-notion-gateway.ts';
import { FAKE_PARENT_PAGE_ID } from '../../src/adapters/fake/seed-pages.ts';
import type { NotionGateway } from '../../src/application/ports/notion-gateway.ts';
import type { RequestContext } from '../../src/application/request-context.ts';
import { createDefaultTools } from '../../src/application/tools/default-tools.ts';
import { NotionCreatePageTool } from '../../src/application/tools/create-page-tool.ts';
import { NotionFetchPageTool } from '../../src/application/tools/fetch-page-tool.ts';
import { NotionSearchTool } from '../../src/application/tools/search-tool.ts';
import type { Tool } from '../../src/application/tools/tool.ts';
import { DuplicateToolError, ToolRegistry } from '../../src/application/tools/tool-registry.ts';
import {
  ConfirmationRequiredError,
  InvalidArgumentsError,
  ProviderError,
  UnknownToolError,
} from '../../src/domain/errors.ts';
import type { CreatePageInput, PageId, SearchQuery } from '../../src/domain/notion.ts';

const ROADMAP_ID = '11111111-1111-4111-8111-111111111102';
const ctx: RequestContext = { signal: new AbortController().signal };

/** Gateway that records calls so tests can assert what a tool delegated. */
class RecordingGateway implements NotionGateway {
  readonly searches: SearchQuery[] = [];
  readonly creates: CreatePageInput[] = [];
  readonly fetches: PageId[] = [];
  readonly contexts: RequestContext[] = [];
  private readonly delegate = new FakeNotionGateway();

  search(query: SearchQuery, context: RequestContext) {
    this.searches.push(query);
    this.contexts.push(context);
    return this.delegate.search(query, context);
  }
  fetchPage(id: PageId, context: RequestContext) {
    this.fetches.push(id);
    this.contexts.push(context);
    return this.delegate.fetchPage(id, context);
  }
  createPage(input: CreatePageInput, context: RequestContext) {
    this.creates.push(input);
    this.contexts.push(context);
    return this.delegate.createPage(input, context);
  }
}

Deno.test('search tool: applies defaults, maps to stable output, reports eventual consistency', async () => {
  const gateway = new RecordingGateway();
  const output = await new NotionSearchTool(gateway).execute({ query: 'launch' }, ctx);

  assertEquals(gateway.searches, [{ query: 'launch', limit: 10 }]);
  assertEquals(output.data.count, 1);
  assertEquals(output.data.hasMore, false);
  assertEquals((output.data.indexing as { consistency: string }).consistency, 'eventual');
});

Deno.test('search tool: paginates with the cursor it returned', async () => {
  const tool = new NotionSearchTool(new FakeNotionGateway());
  const first = await tool.execute({ query: '', limit: 2 }, ctx);
  assertEquals(first.data.count, 2);
  assertEquals(first.data.hasMore, true);

  const second = await tool.execute({ query: '', limit: 2, cursor: first.data.nextCursor }, ctx);
  assertEquals(second.data.count, 1);
  assertEquals(second.data.hasMore, false);
  assertEquals(second.data.nextCursor, null);
});

Deno.test('search tool: rejects invalid arguments before calling the gateway', async () => {
  const gateway = new RecordingGateway();
  const tool = new NotionSearchTool(gateway);
  for (
    const args of [{}, { query: 1 }, { query: 'x', limit: 0 }, { query: 'x', limit: 26 }, null]
  ) {
    await assertRejects(() => tool.execute(args, ctx), InvalidArgumentsError);
  }
  assertEquals(gateway.searches.length, 0);
});

Deno.test('fetch tool: returns the stable page shape and normalises the id', async () => {
  const gateway = new RecordingGateway();
  const output = await new NotionFetchPageTool(gateway).execute({
    page_id: ROADMAP_ID.replaceAll('-', '').toUpperCase(),
  }, ctx);
  assertEquals(gateway.fetches, [ROADMAP_ID as PageId]);
  assertEquals(Object.keys(output.data).sort(), ['blockCount', 'blocks', 'page', 'truncated']);
  assertEquals(
    Object.keys(output.data.page as object).sort(),
    ['archived', 'createdTime', 'id', 'lastEditedTime', 'title', 'url'],
  );
});

Deno.test('fetch tool: invalid id never reaches the gateway; provider errors propagate typed', async () => {
  const gateway = new RecordingGateway();
  const tool = new NotionFetchPageTool(gateway);
  await assertRejects(() => tool.execute({ page_id: 'abc' }, ctx), InvalidArgumentsError);
  assertEquals(gateway.fetches.length, 0);

  const error = await assertRejects(
    () => tool.execute({ page_id: '99999999-9999-4999-8999-999999999999' }, ctx),
    ProviderError,
  );
  assertEquals(error.kind, 'not_found');
});

Deno.test('create tool: refuses without confirm=true and does not touch the gateway', async () => {
  const gateway = new RecordingGateway();
  const tool = new NotionCreatePageTool(gateway);
  const base = { parent_page_id: FAKE_PARENT_PAGE_ID, title: 'T' };

  for (const extra of [{}, { confirm: false }]) {
    await assertRejects(() => tool.execute({ ...base, ...extra }, ctx), ConfirmationRequiredError);
  }
  for (const confirm of ['true', 1, null, 'yes']) {
    await assertRejects(() => tool.execute({ ...base, confirm }, ctx), InvalidArgumentsError);
  }
  assertEquals(gateway.creates.length, 0);
});

Deno.test('create tool: confirmed call splits content into paragraphs and returns id and URL', async () => {
  const gateway = new RecordingGateway();
  const output = await new NotionCreatePageTool(gateway).execute({
    parent_page_id: FAKE_PARENT_PAGE_ID,
    title: '  Plan  ',
    content: 'one\n\n\ntwo\n\n  three  ',
    confirm: true,
  }, ctx);
  assertEquals(gateway.creates[0]?.title, 'Plan');
  assertEquals(gateway.creates[0]?.paragraphs, ['one', 'two', 'three']);
  assertEquals(output.data.created, true);
  const page = output.data.page as { id: string; url: string };
  assert(page.id.length === 36);
  assert(page.url.startsWith('https://'));
});

Deno.test('create tool: validates title, parent and content size', async () => {
  const gateway = new RecordingGateway();
  const tool = new NotionCreatePageTool(gateway);
  const ok = { parent_page_id: FAKE_PARENT_PAGE_ID, title: 'T', confirm: true };
  await assertRejects(() => tool.execute({ ...ok, title: '   ' }, ctx), InvalidArgumentsError);
  await assertRejects(
    () => tool.execute({ ...ok, parent_page_id: 'x' }, ctx),
    InvalidArgumentsError,
  );
  await assertRejects(
    () => tool.execute({ ...ok, content: Array(101).fill('p').join('\n\n') }, ctx),
    InvalidArgumentsError,
  );
  assertEquals(gateway.creates.length, 0);
});

Deno.test('tools hand the caller context to the gateway unchanged', async () => {
  const gateway = new RecordingGateway();
  const own: RequestContext = { signal: new AbortController().signal };
  await new NotionSearchTool(gateway).execute({ query: 'launch' }, own);
  await new NotionFetchPageTool(gateway).execute({ page_id: ROADMAP_ID }, own);
  await new NotionCreatePageTool(gateway).execute({
    parent_page_id: FAKE_PARENT_PAGE_ID,
    title: 'T',
    confirm: true,
  }, own);
  assertEquals(gateway.contexts.length, 3);
  assert(gateway.contexts.every((received) => received === own));
});

Deno.test('create tool: a pre-aborted confirmed call never reaches the gateway', async () => {
  const gateway = new RecordingGateway();
  const error = await assertRejects(
    () =>
      new NotionCreatePageTool(gateway).execute({
        parent_page_id: FAKE_PARENT_PAGE_ID,
        title: 'T',
        confirm: true,
      }, { signal: AbortSignal.abort() }),
    ProviderError,
  );
  assertEquals([error.kind, error.code, error.outcomeUncertain], [
    'cancelled',
    'PROVIDER_CANCELLED',
    false,
  ]);
  assertEquals(gateway.creates.length, 0);
});

Deno.test('create tool: unknown parent surfaces a typed provider error', async () => {
  const error = await assertRejects(
    () =>
      new NotionCreatePageTool(new FakeNotionGateway()).execute({
        parent_page_id: '99999999-9999-4999-8999-999999999999',
        title: 'T',
        confirm: true,
      }, ctx),
    ProviderError,
  );
  assertEquals(error.code, 'PROVIDER_NOT_FOUND');
});

Deno.test('tool definitions advertise JSON Schema without $schema and describe every property', () => {
  for (const tool of createDefaultTools(new FakeNotionGateway())) {
    const { inputSchema } = tool.definition;
    assertEquals(inputSchema.type, 'object');
    assert(!('$schema' in inputSchema));
    const properties = inputSchema.properties as Record<string, { description?: string }>;
    for (const [name, schema] of Object.entries(properties)) {
      assert(schema.description, `${tool.definition.name}.${name} needs a description`);
    }
  }
});

Deno.test('registry: preserves order, resolves by name, rejects duplicates and bad names', () => {
  const gateway = new FakeNotionGateway();
  const tools = createDefaultTools(gateway);
  const registry = new ToolRegistry(tools);
  assertEquals(registry.definitions().map((d) => d.name), [
    'notion_search',
    'notion_fetch_page',
    'notion_create_page',
  ]);
  assertEquals(registry.get('notion_search'), tools[0]);

  assertThrows(() => registry.get('missing'), UnknownToolError);
  assertThrows(() => new ToolRegistry([tools[0]!, tools[0]!]), DuplicateToolError);

  const badName: Tool = {
    definition: { ...tools[0]!.definition, name: 'Bad Name' },
    execute: tools[0]!.execute.bind(tools[0]),
  };
  assertThrows(() => new ToolRegistry([badName]), Error, 'Invalid tool name');
});

Deno.test('registry: a new tool needs no change to existing tools or protocol code', async () => {
  const echo: Tool = {
    definition: {
      name: 'echo',
      title: 'Echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    execute: (args) => Promise.resolve({ summary: 'echo', data: { args: args as never } }),
  };
  const registry = new ToolRegistry([...createDefaultTools(new FakeNotionGateway()), echo]);
  assertEquals((await registry.get('echo').execute({ a: 1 }, ctx)).data, { args: { a: 1 } });
});
