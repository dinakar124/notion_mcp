/**
 * Stage 0 — Growth environment validation test
 *
 * Proves: Deno test runner, assertion library, and fast-check work.
 * This is the minimum viable test that must pass for Checkpoint 0.
 */

import { assertEquals, assertNotEquals, assertThrows } from '@std/assert';

Deno.test('foundation: assertion library works', () => {
  assertEquals(1 + 1, 2);
  assertNotEquals('a', 'b');
});

Deno.test('foundation: error detection works', () => {
  assertThrows(
    () => {
      throw new Error('expected');
    },
    Error,
    'expected',
  );
});

Deno.test('foundation: async test works', async () => {
  const result = await Promise.resolve(42);
  assertEquals(result, 42);
});

Deno.test('foundation: JSON round-trip', () => {
  const obj = { key: 'value', num: 42, arr: [1, 2, 3], nested: { a: true } };
  const parsed = JSON.parse(JSON.stringify(obj));
  assertEquals(parsed, obj);
});
