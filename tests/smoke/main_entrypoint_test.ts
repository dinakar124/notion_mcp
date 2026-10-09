import { assert, assertEquals } from '@std/assert';
import { CONFIG_ENV_VARS } from '../../src/config/config.ts';

/**
 * Boots the real `src/main.ts` as a subprocess in default (fake) mode with no credentials,
 * then discovers, lists and searches over a real socket. Every wait is bounded.
 */

const MAIN = new URL('../../src/main.ts', import.meta.url).pathname;
const V = '2026-07-28';
const BOOT_TIMEOUT_MS = 20_000;
// Run with exactly the permissions the dev task grants.
const ALLOW_ENV = `--allow-env=${CONFIG_ENV_VARS.join(',')}`;

async function waitForReadyLine(stderr: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stderr.pipeThrough(new TextDecoderStream()).getReader();
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let buffer = '';
  while (Date.now() < deadline) {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), deadline - Date.now())
    );
    const chunk = await Promise.race([reader.read(), timeout]);
    if (chunk === null || chunk.done) break;
    buffer += chunk.value;
    for (const line of buffer.split('\n')) {
      if (line.includes('"server.ready"')) {
        reader.releaseLock();
        return (JSON.parse(line) as { mcpUrl: string }).mcpUrl;
      }
    }
  }
  throw new Error(`server did not become ready; stderr so far: ${buffer.slice(0, 500)}`);
}

async function rpc(url: string, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': V,
      'Mcp-Method': method,
      ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': V,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
        ...params,
      },
    }),
    signal: AbortSignal.timeout(5000),
  });
  return await response.json();
}

Deno.test('smoke: deno run src/main.ts (fake mode) serves discover, list and search', async () => {
  const child = new Deno.Command('deno', {
    args: [
      'run',
      ALLOW_ENV,
      '--allow-net=127.0.0.1',
      MAIN,
    ],
    env: { MCP_SERVER_PORT: '0', NOTION_MODE: 'fake', LOG_LEVEL: 'info' },
    clearEnv: true,
    stdin: 'null',
    stdout: 'null',
    stderr: 'piped',
  }).spawn();

  try {
    const mcpUrl = await waitForReadyLine(child.stderr);
    assert(mcpUrl.startsWith('http://127.0.0.1:'), mcpUrl);

    const discover = await rpc(mcpUrl, 'server/discover');
    assertEquals(discover.result.supportedVersions, [V]);

    const list = await rpc(mcpUrl, 'tools/list');
    assertEquals(list.result.tools.length, 3);

    const search = await rpc(mcpUrl, 'tools/call', {
      name: 'notion_search',
      arguments: { query: 'roadmap' },
    });
    assertEquals(search.result.structuredContent.results[0].title, 'Engineering roadmap');
  } finally {
    child.kill('SIGTERM');
    const exited = await Promise.race([
      child.status.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!exited) child.kill('SIGKILL');
    await child.status;
  }
});

Deno.test('smoke: invalid configuration exits 2 with a readable message and starts nothing', async () => {
  const { code, stderr } = await new Deno.Command('deno', {
    args: [
      'run',
      ALLOW_ENV,
      '--allow-net=127.0.0.1',
      MAIN,
    ],
    env: { NOTION_MODE: 'real' },
    clearEnv: true,
    stdin: 'null',
    stdout: 'null',
    stderr: 'piped',
  }).output();
  assertEquals(code, 2);
  assert(new TextDecoder().decode(stderr).includes('NOTION_TOKEN is required'));
});
