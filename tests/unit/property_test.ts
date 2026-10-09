/**
 * Stage 0 — Property-based testing validation
 *
 * Proves fast-check runs under Deno's test runner.
 * Task 0.0 selected fast-check; Task 0.4 must prove it works.
 */

import { assertEquals } from '@std/assert';
import * as fc from 'fast-check';

Deno.test('property: JSON stringify/parse round-trips for objects', () => {
  fc.assert(
    fc.property(
      fc.record({
        key: fc.string(),
        num: fc.integer(),
        flag: fc.boolean(),
      }),
      (obj) => {
        const roundTripped = JSON.parse(JSON.stringify(obj));
        return (
          roundTripped.key === obj.key &&
          roundTripped.num === obj.num &&
          roundTripped.flag === obj.flag
        );
      },
    ),
    { numRuns: 200 },
  );
});

Deno.test('property: array sort is idempotent', () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (arr) => {
      const sorted1 = [...arr].sort((a, b) => a - b);
      const sorted2 = [...sorted1].sort((a, b) => a - b);
      return JSON.stringify(sorted1) === JSON.stringify(sorted2);
    }),
    { numRuns: 200 },
  );
});

Deno.test('property: string concatenation length', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (a, b) => {
      return (a + b).length === a.length + b.length;
    }),
    { numRuns: 200 },
  );
});

Deno.test('fast-check: arbitrary generation works', () => {
  const sample = fc.sample(fc.nat({ max: 100 }), 10);
  assertEquals(sample.length, 10);
  for (const n of sample) {
    assertEquals(n >= 0 && n <= 100, true);
  }
});
