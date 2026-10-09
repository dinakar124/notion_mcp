import { assertEquals, assertThrows } from '@std/assert';
import { clamp, inRange, paginate } from './range-validator.ts';

// ── inRange ──────────────────────────────────────────────────────────────────

Deno.test('inRange: value at lower boundary is in range', () => {
  assertEquals(inRange(0, 0, 10), true);
});

Deno.test('inRange: value at upper boundary is in range', () => {
  assertEquals(inRange(10, 0, 10), true);
});

Deno.test('inRange: value below lower boundary is out of range', () => {
  assertEquals(inRange(-1, 0, 10), false);
});

Deno.test('inRange: value above upper boundary is out of range', () => {
  assertEquals(inRange(11, 0, 10), false);
});

Deno.test('inRange: value in middle of range', () => {
  assertEquals(inRange(5, 0, 10), true);
});

Deno.test('inRange: single-value range (min == max), value matches', () => {
  assertEquals(inRange(7, 7, 7), true);
});

Deno.test('inRange: single-value range (min == max), value does not match', () => {
  assertEquals(inRange(6, 7, 7), false);
  assertEquals(inRange(8, 7, 7), false);
});

Deno.test('inRange: throws when min > max', () => {
  assertThrows(() => inRange(5, 10, 0), RangeError, 'min (10) must not exceed max (0)');
});

// ── clamp ────────────────────────────────────────────────────────────────────

Deno.test('clamp: value below min returns min', () => {
  assertEquals(clamp(-5, 0, 10), 0);
});

Deno.test('clamp: value above max returns max', () => {
  assertEquals(clamp(15, 0, 10), 10);
});

Deno.test('clamp: value within range returns value', () => {
  assertEquals(clamp(5, 0, 10), 5);
});

Deno.test('clamp: value at lower boundary returns value', () => {
  assertEquals(clamp(0, 0, 10), 0);
});

Deno.test('clamp: value at upper boundary returns value', () => {
  assertEquals(clamp(10, 0, 10), 10);
});

Deno.test('clamp: throws when min > max', () => {
  assertThrows(() => clamp(5, 10, 0), RangeError, 'min (10) must not exceed max (0)');
});

Deno.test('clamp: single-value range (min == max) does not throw', () => {
  assertEquals(clamp(5, 3, 3), 3);
  assertEquals(clamp(3, 3, 3), 3);
  assertEquals(clamp(1, 3, 3), 3);
});

// ── paginate ─────────────────────────────────────────────────────────────────

Deno.test('paginate: first page of multi-page set', () => {
  const result = paginate([1, 2, 3, 4, 5], 1, 2);
  assertEquals(result.data, [1, 2]);
  assertEquals(result.totalPages, 3);
  assertEquals(result.hasNext, true);
  assertEquals(result.hasPrev, false);
});

Deno.test('paginate: middle page', () => {
  const result = paginate([1, 2, 3, 4, 5], 2, 2);
  assertEquals(result.data, [3, 4]);
  assertEquals(result.totalPages, 3);
  assertEquals(result.hasNext, true);
  assertEquals(result.hasPrev, true);
});

Deno.test('paginate: last page (partial)', () => {
  const result = paginate([1, 2, 3, 4, 5], 3, 2);
  assertEquals(result.data, [5]);
  assertEquals(result.totalPages, 3);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, true);
});

Deno.test('paginate: page beyond end returns empty data', () => {
  const result = paginate([1, 2, 3], 10, 2);
  assertEquals(result.data, []);
  assertEquals(result.totalPages, 2);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, true);
});

Deno.test('paginate: empty array returns 1 totalPages', () => {
  const result = paginate([], 1, 10);
  assertEquals(result.data, []);
  assertEquals(result.totalPages, 1);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, false);
});

Deno.test('paginate: single item single page', () => {
  const result = paginate(['a'], 1, 10);
  assertEquals(result.data, ['a']);
  assertEquals(result.totalPages, 1);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, false);
});

Deno.test('paginate: exact page boundary', () => {
  const result = paginate([1, 2, 3, 4], 2, 2);
  assertEquals(result.data, [3, 4]);
  assertEquals(result.totalPages, 2);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, true);
});

Deno.test('paginate: throws when pageSize <= 0', () => {
  assertThrows(() => paginate([1], 1, 0), RangeError, 'pageSize must be positive');
  assertThrows(() => paginate([1], 1, -1), RangeError, 'pageSize must be positive');
});

Deno.test('paginate: throws when page < 1', () => {
  assertThrows(() => paginate([1], 0, 10), RangeError, 'page must be >= 1');
  assertThrows(() => paginate([1], -1, 10), RangeError, 'page must be >= 1');
});

Deno.test('paginate: page 2 of items that fill exactly 1 page', () => {
  const result = paginate([1, 2], 2, 2);
  assertEquals(result.data, []);
  assertEquals(result.totalPages, 1);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, true);
});
