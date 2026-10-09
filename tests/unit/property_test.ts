import { assert, assertEquals } from '@std/assert';
import * as fc from 'fast-check';
import { contentMediaType } from '../../src/http/media-type.ts';
import { ProviderError } from '../../src/domain/errors.ts';
import { tryParsePageId } from '../../src/domain/notion.ts';
import {
  buildClient,
  liveSignal,
  ScriptedFetch,
  type ScriptedReply,
  writeRequest,
} from '../support/notion-client-harness.ts';
import { buildTestApp, mcpHeaders, McpTestClient, PROTOCOL } from '../support/mcp-test-client.ts';

const HEX = [...'0123456789abcdefABCDEF'];
const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const hexOf = (length: number) =>
  fc.array(fc.constantFrom(...HEX), { minLength: length, maxLength: length }).map((c) =>
    c.join('')
  );

const dash = (hex: string) =>
  [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join(
    '-',
  );

Deno.test('property: any spelling of a page UUID canonicalises to one lowercase dashed id', () => {
  fc.assert(
    fc.property(hexOf(32), fc.constantFrom('', ' ', '\n\t '), (hex, padding) => {
      const undashed = tryParsePageId(`${padding}${hex}${padding}`);
      const dashed = tryParsePageId(`${padding}${dash(hex)}${padding}`);
      assert(undashed !== null && CANONICAL.test(undashed));
      assertEquals(undashed, dashed);
      assertEquals(undashed.replaceAll('-', ''), hex.toLowerCase());
      assertEquals(tryParsePageId(undashed), undashed);
    }),
    { numRuns: 200 },
  );
});

Deno.test('property: strings that are not exactly 32 hex digits are never accepted as page ids', () => {
  const wrongLength = fc.integer({ min: 0, max: 64 }).filter((n) => n !== 32).chain(hexOf);
  const nonHexChar = fc.tuple(
    hexOf(32),
    fc.integer({ min: 0, max: 31 }),
    fc.constantFrom(
      ...'ghzGZ_ /.%x',
    ),
  ).map(([hex, at, bad]) => `${hex.slice(0, at)}${bad}${hex.slice(at + 1)}`);

  fc.assert(
    fc.property(fc.oneof(wrongLength, nonHexChar), (candidate) => {
      assertEquals(tryParsePageId(candidate), null);
    }),
    { numRuns: 200 },
  );
});

Deno.test('property: a non-idempotent write is sent exactly once, whatever the failure', async () => {
  const definitelyRejected = [400, 401, 403, 404];
  const failure = fc.oneof(
    fc.constantFrom(400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504, 529).map((status) =>
      ({ status }) as ScriptedReply
    ),
    fc.constantFrom(
      new TypeError('connection reset'),
      new DOMException('timed out', 'TimeoutError'),
    ),
  );
  const retryAfter = fc.constantFrom(undefined, '0', '1', '120');

  await fc.assert(
    fc.asyncProperty(failure, retryAfter, async (first, retryAfterSeconds) => {
      const headers: Record<string, string> = retryAfterSeconds === undefined
        ? {}
        : { 'retry-after': retryAfterSeconds };
      const reply: ScriptedReply | Error = first instanceof Error ? first : { ...first, headers };
      const script = new ScriptedFetch([reply, { status: 200, body: { id: 'duplicate' } }]);
      const { client, sleeps } = buildClient(script.fetch);

      let error: unknown;
      try {
        await client.request(writeRequest, liveSignal());
      } catch (caught) {
        error = caught;
      }
      assert(error instanceof ProviderError);
      assertEquals(script.calls.length, 1);
      assertEquals(sleeps.length, 0);
      const proven = !(first instanceof Error) && definitelyRejected.includes(first.status);
      assertEquals(error.outcomeUncertain, !proven);
      assert(!(error.retryable && error.outcomeUncertain));
    }),
    { numRuns: 150 },
  );
});

function newClient() {
  return new McpTestClient(buildTestApp().httpApp.handle);
}

Deno.test('property: any JSON body gets a well-formed JSON-RPC envelope and never a 5xx', async () => {
  const client = newClient();
  const envelopeLike = fc.record({
    jsonrpc: fc.constantFrom('2.0', '1.0', 2),
    id: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
    method: fc.oneof(fc.constantFrom('tools/list', 'tools/call', 'server/discover'), fc.string()),
    params: fc.jsonValue(),
  }, { requiredKeys: ['jsonrpc'] });

  await fc.assert(
    fc.asyncProperty(fc.oneof(fc.jsonValue(), envelopeLike), async (payload) => {
      const sent = JSON.parse(JSON.stringify(payload));
      const { status, body } = await client.post(
        '/mcp',
        JSON.stringify(payload),
        mcpHeaders('tools/list'),
      );
      assert(status < 500, `status ${status}`);
      assertEquals(body.jsonrpc, '2.0');
      assertEquals('result' in body !== 'error' in body, true);
      if (typeof sent?.id === 'string' || typeof sent?.id === 'number') {
        assertEquals(body.id, sent.id);
      }
    }),
    { numRuns: 150 },
  );
});

Deno.test('property: an Mcp-Method header that differs from the body method is always rejected', async () => {
  const client = newClient();
  const printable = fc.array(fc.constantFrom(...[...'abcXYZ019/_-.= ']), { maxLength: 16 })
    .map((chars) => chars.join('').trim());

  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom('tools/list', 'server/discover'),
      printable,
      async (method, header) => {
        fc.pre(header !== method);
        const { status, body } = await client.post(
          '/mcp',
          {
            jsonrpc: '2.0',
            id: 1,
            method,
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': PROTOCOL,
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          },
          { ...mcpHeaders(method), 'Mcp-Method': header },
        );
        assertEquals(status, 400);
        assert(body.error !== undefined && body.result === undefined);
      },
    ),
    { numRuns: 100 },
  );
});

Deno.test('property: a Content-Type is JSON only when its media type token is exactly application/json', () => {
  const tokenSuffix = fc.array(fc.constantFrom(...[...'abcxyz019+.-']), {
    minLength: 1,
    maxLength: 8,
  }).map((chars) => chars.join(''));
  const parameter = fc.constantFrom('', '; charset=utf-8', ';charset=UTF-8', ' ; q=1');
  const casing = fc.constantFrom('application/json', 'APPLICATION/JSON', ' Application/Json ');

  fc.assert(
    fc.property(tokenSuffix, parameter, casing, (suffix, param, spelling) => {
      assertEquals(
        contentMediaType(`${spelling.trimEnd()}${suffix}${param}`) === 'application/json',
        false,
      );
      assertEquals(contentMediaType(`${spelling}${param}`), 'application/json');
    }),
    { numRuns: 200 },
  );
});
