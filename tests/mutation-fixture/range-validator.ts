/**
 * Stage 0 mutation-testing tooling fixture.
 *
 * Pure behavior with boundary conditions, error branches, and arithmetic
 * that Stryker can meaningfully mutate. This file is the ONLY mutation target
 * for Stage 0; it proves Stryker + Deno command-runner viability.
 */

/** Inclusive-range membership check. */
export function inRange(value: number, min: number, max: number): boolean {
  if (min > max) {
    throw new RangeError(`min (${min}) must not exceed max (${max})`);
  }
  return value >= min && value <= max;
}

/** Clamp a value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`min (${min}) must not exceed max (${max})`);
  }
  return Math.min(Math.max(value, min), max);
}

/** Paginate an array with 1-based page numbers. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { data: T[]; totalPages: number; hasNext: boolean; hasPrev: boolean } {
  if (pageSize <= 0) {
    throw new RangeError(`pageSize must be positive, got ${pageSize}`);
  }
  if (page < 1) {
    throw new RangeError(`page must be >= 1, got ${page}`);
  }
  const totalPages = items.length === 0 ? 1 : Math.ceil(items.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return {
    data: items.slice(start, end),
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
