import { assertEquals, assertRejects } from '@std/assert';
import { HttpServer } from '../../src/http/http-server.ts';
import { silentLogger } from '../../src/observability/logger.ts';
import { buildTestApp, mcpBody, mcpHeaders } from '../support/mcp-test-client.ts';

Deno.test('HttpServer serves real sockets on an ephemeral loopback port and stops cleanly', async () => {
  const app = buildTestApp();
  const server = new HttpServer(app.httpApp.handle, '127.0.0.1', 0, silentLogger);
  const { hostname, port } = server.start();
  assertEquals(hostname, '127.0.0.1');

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assertEquals(health.status, 200);
    await health.body?.cancel();

    const discover = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: mcpHeaders('server/discover'),
      body: JSON.stringify(mcpBody('server/discover')),
    });
    assertEquals(discover.status, 200);
    assertEquals((await discover.json()).result.resultType, 'complete');

    const get = await fetch(`http://127.0.0.1:${port}/mcp`);
    assertEquals(get.status, 405);
    await get.body?.cancel();
  } finally {
    await server.stop();
  }

  await assertRejects(() => fetch(`http://127.0.0.1:${port}/health`));
});

Deno.test('HttpServer refuses a second start', async () => {
  const server = new HttpServer(buildTestApp().httpApp.handle, '127.0.0.1', 0, silentLogger);
  server.start();
  try {
    let message = '';
    try {
      server.start();
    } catch (error) {
      message = (error as Error).message;
    }
    assertEquals(message, 'HttpServer already started');
  } finally {
    await server.stop();
  }
});
