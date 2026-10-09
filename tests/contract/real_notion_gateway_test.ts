import { assert, assertEquals } from '@std/assert';
import { createRealNotionGateway } from '../../src/adapters/notion/create-real-gateway.ts';
import { loadConfig } from '../../src/config/config.ts';
import { tryParsePageId } from '../../src/domain/notion.ts';
import { silentLogger } from '../../src/observability/logger.ts';

/**
 * Opt-in contract tests against a real Notion workspace.
 *
 *   NOTION_CONTRACT=1 NOTION_MODE=real NOTION_TOKEN=... NOTION_TEST_PARENT_PAGE_ID=... deno task test:contract
 *
 * The write test additionally needs NOTION_CONTRACT_ALLOW_WRITE=1 and creates one page.
 * Without these variables every test is skipped. Nothing is printed from provider data.
 */

const env = (name: string) => Deno.env.get(name);
const enabled = env('NOTION_CONTRACT') === '1' && env('NOTION_MODE') === 'real';

function gateway() {
  const config = loadConfig({ get: env });
  if (config.notion.mode !== 'real') throw new Error('NOTION_MODE=real required');
  return createRealNotionGateway(config.notion, silentLogger);
}

function parentPageId() {
  const id = tryParsePageId(env('NOTION_TEST_PARENT_PAGE_ID') ?? '');
  assert(id, 'NOTION_TEST_PARENT_PAGE_ID must be a page UUID');
  return id;
}

Deno.test({
  name: 'contract: search returns mapped pages',
  ignore: !enabled,
  fn: async () => {
    const result = await gateway().search({ query: '', limit: 5 });
    for (const page of result.pages) {
      assert(tryParsePageId(page.id) !== null);
      assert(page.url.startsWith('https://'));
    }
  },
});

Deno.test({
  name: 'contract: fetch returns the shared parent page with blocks',
  ignore: !enabled,
  fn: async () => {
    const content = await gateway().fetchPage(parentPageId());
    assertEquals(content.page.id, parentPageId());
    assert(content.page.title.length > 0);
  },
});

Deno.test({
  name: 'contract: confirmed create writes a page that can be fetched',
  ignore: !enabled || env('NOTION_CONTRACT_ALLOW_WRITE') !== '1',
  fn: async () => {
    const gw = gateway();
    const created = await gw.createPage({
      parentPageId: parentPageId(),
      title: `notion-mcp contract ${new Date().toISOString()}`,
      paragraphs: ['Created by the notion-mcp contract test.'],
    });
    const fetched = await gw.fetchPage(created.id);
    assertEquals(fetched.page.id, created.id);
    assertEquals(fetched.blocks[0]?.text, 'Created by the notion-mcp contract test.');
  },
});
