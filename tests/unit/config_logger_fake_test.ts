import { assert, assertEquals, assertThrows } from '@std/assert';
import { loadConfig } from '../../src/config/config.ts';
import { ConfigError } from '../../src/domain/errors.ts';
import { JsonLogger } from '../../src/observability/logger.ts';
import { FakeNotionGateway } from '../../src/adapters/fake/fake-notion-gateway.ts';
import { SEED_PAGES } from '../../src/adapters/fake/seed-pages.ts';

const load = (env: Record<string, string>) => loadConfig({ get: (name) => env[name] });
const real = { NOTION_MODE: 'real', NOTION_TOKEN: 'secret_abcdefgh' };

function issuesOf(env: Record<string, string>): string {
  const error = assertThrows(() => load(env), ConfigError);
  return error.message;
}

Deno.test('config: defaults are fake mode on loopback with no credentials', () => {
  const config = load({});
  assertEquals([config.host, config.port, config.notion.mode, config.logLevel], [
    '127.0.0.1',
    3000,
    'fake',
    'info',
  ]);
  assertEquals(config.allowedOrigins.size, 0);
});

Deno.test('config: host, port, origins and log level are configurable', () => {
  const config = load({
    MCP_SERVER_HOST: 'localhost',
    MCP_SERVER_PORT: '0',
    MCP_ALLOWED_ORIGINS: 'http://localhost:6274, https://app.example.com/',
    LOG_LEVEL: 'debug',
  });
  assertEquals([config.host, config.port, config.logLevel], ['localhost', 0, 'debug']);
  assertEquals([...config.allowedOrigins], ['http://localhost:6274', 'https://app.example.com']);
});

Deno.test('config: non-loopback bind requires explicit opt-in', () => {
  assert(issuesOf({ MCP_SERVER_HOST: '0.0.0.0' }).includes('MCP_ALLOW_NON_LOOPBACK'));
  assertEquals(
    load({ MCP_SERVER_HOST: '0.0.0.0', MCP_ALLOW_NON_LOOPBACK: 'true' }).host,
    '0.0.0.0',
  );
});

Deno.test('config: invalid port, log level, mode and origins are all reported together', () => {
  const message = issuesOf({
    MCP_SERVER_PORT: '70000',
    LOG_LEVEL: 'loud',
    NOTION_MODE: 'maybe',
    MCP_ALLOWED_ORIGINS: 'not-an-origin,http://ok.example/path',
  });
  for (const fragment of ['MCP_SERVER_PORT', 'LOG_LEVEL', 'NOTION_MODE', 'MCP_ALLOWED_ORIGINS']) {
    assert(message.includes(fragment), fragment);
  }
  assertEquals(issuesOf({ MCP_SERVER_PORT: '12ab' }).includes('MCP_SERVER_PORT'), true);
});

Deno.test('config: real mode validates token, base URL, version and timeout', () => {
  const config = load({ ...real, NOTION_API_BASE_URL: 'https://api.notion.com/' });
  assertEquals(config.notion.mode === 'real' && config.notion.baseUrl, 'https://api.notion.com');
  assertEquals(config.notion.mode === 'real' && config.notion.apiVersion, '2022-06-28');

  assert(issuesOf({ NOTION_MODE: 'real' }).includes('NOTION_TOKEN is required'));
  assert(issuesOf({ NOTION_MODE: 'real', NOTION_TOKEN: 'short' }).includes('NOTION_TOKEN must be'));
  assert(
    issuesOf({ NOTION_MODE: 'real', NOTION_TOKEN: 'has space in it' }).includes(
      'NOTION_TOKEN must be',
    ),
  );
  for (
    const url of [
      'not a url',
      'http://api.notion.com',
      'https://api.notion.com/v1',
      'https://u:p@api.notion.com',
      'ftp://x',
    ]
  ) {
    assert(issuesOf({ ...real, NOTION_API_BASE_URL: url }).includes('NOTION_API_BASE_URL'), url);
  }
  assertEquals(load({ ...real, NOTION_API_BASE_URL: 'http://127.0.0.1:9999' }).notion.mode, 'real');
  assert(issuesOf({ ...real, NOTION_API_VERSION: 'latest' }).includes('NOTION_API_VERSION'));
  assert(issuesOf({ ...real, NOTION_TIMEOUT_MS: '5' }).includes('NOTION_TIMEOUT_MS'));
});

Deno.test('config: a rejected token is never echoed in the error message', () => {
  const secret = 'bad token with spaces';
  assertEquals(issuesOf({ NOTION_MODE: 'real', NOTION_TOKEN: secret }).includes(secret), false);
});

Deno.test('config: fake mode ignores real-mode variables', () => {
  assertEquals(load({ NOTION_TOKEN: 'x', NOTION_API_BASE_URL: 'garbage' }).notion.mode, 'fake');
});

Deno.test('logger: filters by level, writes JSON lines and redacts sensitive keys', () => {
  const lines: string[] = [];
  const logger = new JsonLogger(
    'warn',
    (line) => lines.push(line),
    () => new Date('2026-01-01T00:00:00Z'),
  );
  logger.info('hidden');
  logger.warn('shown', { authorization: 'Bearer abc', apiKey: 'k', NOTION_TOKEN: 't', tool: 'x' });
  logger.error('boom');
  assertEquals(lines.length, 2);
  assertEquals(JSON.parse(lines[0]!), {
    time: '2026-01-01T00:00:00.000Z',
    level: 'warn',
    message: 'shown',
    authorization: '[REDACTED]',
    apiKey: '[REDACTED]',
    NOTION_TOKEN: '[REDACTED]',
    tool: 'x',
  });
});

Deno.test('fake gateway: search ordering, filtering and pagination are deterministic', async () => {
  const gateway = new FakeNotionGateway();
  const all = await gateway.search({ query: '', limit: 10 });
  assertEquals(all.pages.map((p) => p.title), [
    'Meeting notes: launch review',
    'Engineering roadmap',
    'Welcome to the demo workspace',
  ]);
  assertEquals((await gateway.search({ query: 'LAUNCH', limit: 10 })).pages.length, 1);
  assertEquals((await gateway.search({ query: 'zzz', limit: 10 })).pages, []);
  assertEquals(SEED_PAGES.length, 3);
});

Deno.test('fake gateway: invalid cursor is a typed invalid_request', async () => {
  let thrown: unknown;
  try {
    await new FakeNotionGateway().search({ query: '', limit: 1, cursor: 'garbage' });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && thrown.name === 'ProviderError');
});
