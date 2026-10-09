/**
 * Reward Ledger — Integrity validator.
 *
 * Validates hash chain, monotonic sequences, duplicate IDs, truncation,
 * hash format (64 lowercase hex), UUID format, expected length/sequence.
 */

import { LedgerEvent } from './schemas.ts';
import { computeHash } from './crypto.ts';

export interface ValidationError {
  index: number;
  eventId: string;
  code:
    | 'INVALID_SCHEMA'
    | 'HASH_MISMATCH'
    | 'CHAIN_BROKEN'
    | 'SEQUENCE_GAP'
    | 'SEQUENCE_DUPLICATE'
    | 'DUPLICATE_EVENT_ID'
    | 'TRUNCATION_DETECTED'
    | 'LENGTH_MISMATCH'
    | 'INVALID_HASH_FORMAT'
    | 'INVALID_UUID';
  message: string;
}

export interface ValidationOptions {
  expectedHeadHash?: string;
  expectedLength?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  headHash: string;
  length: number;
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validateLedger(
  events: LedgerEvent[],
  opts?: string | ValidationOptions,
): Promise<ValidationResult> {
  // Backward compat: string arg = expectedHeadHash
  const options: ValidationOptions = typeof opts === 'string'
    ? { expectedHeadHash: opts }
    : (opts ?? {});

  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();
  const seenSequences = new Set<number>();
  let prevHash = '';

  // [#10] Empty-ledger truncation: if expectedHeadHash is nonempty but ledger is empty
  if (options.expectedHeadHash && options.expectedHeadHash.length > 0 && events.length === 0) {
    errors.push({
      index: -1,
      eventId: '<empty>',
      code: 'TRUNCATION_DETECTED',
      message: `Expected head hash "${options.expectedHeadHash}" but ledger is empty`,
    });
  }

  // [#10] Expected length check
  if (options.expectedLength !== undefined && events.length !== options.expectedLength) {
    errors.push({
      index: -1,
      eventId: '<length>',
      code: 'LENGTH_MISMATCH',
      message: `Expected ${options.expectedLength} events, got ${events.length}`,
    });
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const eid = event.eventId;

    // UUID format
    if (!UUID_RE.test(eid)) {
      errors.push({
        index: i,
        eventId: eid,
        code: 'INVALID_UUID',
        message: `Invalid UUID: ${eid}`,
      });
    }

    // Hash format validation
    if (event.eventHash !== '' && !SHA256_RE.test(event.eventHash)) {
      errors.push({
        index: i,
        eventId: eid,
        code: 'INVALID_HASH_FORMAT',
        message: `Invalid eventHash format`,
      });
    }
    if (event.prevEventHash !== '' && !SHA256_RE.test(event.prevEventHash)) {
      errors.push({
        index: i,
        eventId: eid,
        code: 'INVALID_HASH_FORMAT',
        message: `Invalid prevEventHash format`,
      });
    }

    if (seenIds.has(eid)) {
      errors.push({
        index: i,
        eventId: eid,
        code: 'DUPLICATE_EVENT_ID',
        message: `Duplicate eventId: ${eid}`,
      });
    }
    seenIds.add(eid);

    if (event.sequence !== i) {
      if (seenSequences.has(event.sequence)) {
        errors.push({
          index: i,
          eventId: eid,
          code: 'SEQUENCE_DUPLICATE',
          message: `Duplicate sequence ${event.sequence} at index ${i}`,
        });
      } else {
        errors.push({
          index: i,
          eventId: eid,
          code: 'SEQUENCE_GAP',
          message: `Expected sequence ${i}, got ${event.sequence}`,
        });
      }
    }
    seenSequences.add(event.sequence);

    if (event.prevEventHash !== prevHash) {
      errors.push({
        index: i,
        eventId: eid,
        code: 'CHAIN_BROKEN',
        message: `prevEventHash mismatch at ${i}`,
      });
    }

    const computed = await computeHash(event);
    if (computed !== event.eventHash) {
      errors.push({
        index: i,
        eventId: eid,
        code: 'HASH_MISMATCH',
        message:
          `eventHash mismatch at ${i}: computed "${computed}", recorded "${event.eventHash}"`,
      });
    }

    prevHash = event.eventHash;
  }

  // Truncation detection (non-empty ledger)
  if (options.expectedHeadHash !== undefined && events.length > 0) {
    const lastHash = events[events.length - 1]!.eventHash;
    if (lastHash !== options.expectedHeadHash) {
      errors.push({
        index: events.length - 1,
        eventId: events[events.length - 1]!.eventId,
        code: 'TRUNCATION_DETECTED',
        message: `Expected head hash "${options.expectedHeadHash}", got "${lastHash}"`,
      });
    }
  }

  const headHash = events.length > 0 ? events[events.length - 1]!.eventHash : '';

  return { valid: errors.length === 0, errors, headHash, length: events.length };
}

export function parseLedger(
  jsonl: string,
): { events: LedgerEvent[]; parseErrors: ValidationError[] } {
  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);
  const events: LedgerEvent[] = [];
  const parseErrors: ValidationError[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const raw = JSON.parse(lines[i]!);
      const result = LedgerEvent.safeParse(raw);
      if (!result.success) {
        parseErrors.push({
          index: i,
          eventId: raw?.eventId ?? '<unknown>',
          code: 'INVALID_SCHEMA',
          message: `Schema validation failed at line ${i}: ${result.error.message}`,
        });
      } else {
        events.push(result.data);
      }
    } catch (e) {
      parseErrors.push({
        index: i,
        eventId: '<parse-error>',
        code: 'INVALID_SCHEMA',
        message: `JSON parse error at line ${i}: ${(e as Error).message}`,
      });
    }
  }

  return { events, parseErrors };
}
