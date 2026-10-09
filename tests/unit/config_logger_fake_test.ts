import { assert, assertEquals, assertThrows } from '@std/assert';
import { CONFIG_ENV_VARS, loadConfig } from '../../src/config/config.ts';
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
  assert(issuesOf({ ...real, NOTION_API_VERSION: 'latest' }).includes('NOTION_API_VERSION'));
  assert(issuesOf({ ...real, NOTION_TIMEOUT_MS: '5' }).includes('NOTION_TIMEOUT_MS'));
});

function baseUrlOf(env: Record<string, string>): string | undefined {
  const { notion } = load(env);
  return notion.mode === 'real' ? notion.baseUrl : undefined;
}

Deno.test('config: real mode talks to exactly https://api.notion.com unless a loopback test flag is set', () => {
  assertEquals(baseUrlOf(real), 'https://api.notion.com');
  assertEquals(
    baseUrlOf({ ...real, NOTION_API_BASE_URL: 'https://api.notion.com/' }),
    'https://api.notion.com',
  );

  for (
    const url of [
      'https://evil.example',
      'https://api.notion.com.evil.example',
      'https://api.notion.com:8443',
      'https://API.NOTION.COM.evil.example',
      'http://api.notion.com',
      'https://www.notion.so',
      'http://127.0.0.1:9999',
      'http://localhost:9999',
    ]
  ) {
    const message = issuesOf({ ...real, NOTION_API_BASE_URL: url });
    assert(message.includes('NOTION_API_BASE_URL must be https://api.notion.com'), url);
    assert(message.includes('NOTION_ALLOW_LOOPBACK_BASE_URL'), url);
  }
  // A flag alone changes nothing; the flag value must be exactly "true".
  assertEquals(
    issuesOf({
      ...real,
      NOTION_API_BASE_URL: 'http://127.0.0.1:9999',
      NOTION_ALLOW_LOOPBACK_BASE_URL: 'yes',
    })
      .includes('NOTION_ALLOW_LOOPBACK_BASE_URL'),
    true,
  );
});

Deno.test('config: the loopback test flag admits loopback origins only, never external ones', () => {
  const flag = { ...real, NOTION_ALLOW_LOOPBACK_BASE_URL: 'true' };
  for (
    const url of [
      'http://127.0.0.1:9999',
      'http://localhost:9999',
      'https://127.0.0.1:9999',
      'http://[::1]:9999',
    ]
  ) {
    assertEquals(baseUrlOf({ ...flag, NOTION_API_BASE_URL: url }), new URL(url).origin, url);
  }
  assertEquals(baseUrlOf(flag), 'https://api.notion.com');

  for (
    const url of [
      'https://evil.example',
      'http://evil.example',
      'http://127.0.0.1.evil.example',
      'http://localhost.evil.example',
      'http://0.0.0.0:9999',
      'ftp://127.0.0.1',
    ]
  ) {
    const message = issuesOf({ ...flag, NOTION_API_BASE_URL: url });
    assert(message.includes('must be a loopback origin'), url);
  }
});

Deno.test('config: a rejected base URL is never echoed, whatever secrets its authority carries', () => {
  const token = 'secret_abcdefgh';
  for (
    const url of [
      'https://user:hunter2@evil.example',
      'https://evil.example/?token=hunter2',
      'https://hunter2.evil.example',
    ]
  ) {
    for (
      const flag of [{}, { NOTION_ALLOW_LOOPBACK_BASE_URL: 'true' }] as Array<
        Record<string, string>
      >
    ) {
      const message = issuesOf({ ...real, ...flag, NOTION_API_BASE_URL: url });
      for (const leaked of ['hunter2', 'evil.example', token]) {
        assertEquals(message.includes(leaked), false, `${url} leaked ${leaked}`);
      }
    }
  }
});

Deno.test('config: deno.json tasks grant exactly the config variables and the Notion host', async () => {
  const { tasks } = JSON.parse(
    await Deno.readTextFile(new URL('../../deno.json', import.meta.url)),
  );
  const expected = [...CONFIG_ENV_VARS].sort().join(',');
  for (const name of ['dev', 'dev:real', 'start', 'build']) {
    const command: string = tasks[name];
    const env = /--allow-env=(\S+)/.exec(command)?.[1] ?? '';
    assertEquals(env.split(',').sort().join(','), expected, `${name}: --allow-env`);
    assertEquals(/--allow-(read|write|run|all)\b|-A\b|--allow-env\s/.test(command), false, name);
    const net = /--allow-net=(\S+)/.exec(command)?.[1];
    assert(net !== undefined, `${name} must restrict --allow-net`);
    assertEquals(
      net.split(',').includes('api.notion.com'),
      name === 'dev:real' || name === 'build',
      `${name}: --allow-net=${net}`,
    );
    assertEquals(
      net.split(',').filter((host) => !['127.0.0.1', 'localhost', 'api.notion.com'].includes(host)),
      [],
    );
  }
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
