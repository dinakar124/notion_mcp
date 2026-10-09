/**
 * Reward Ledger — Canonical serialization, SHA-256 hash chain, contract hash.
 *
 * CONTRACT HASH CANONICAL VERSION: 1
 * Includes: schemaVersion, title, itemId, checkpointId, acceptance, behaviorWeights,
 * requiredGates, requiredEvidenceTiers, executionManifest, rewardBudget,
 * predecessorEventHash (reissue only). Excludes event headers.
 */

import { SCHEMA_VERSION } from './schemas.ts';
import type { ContractEvent, LedgerEvent, ReissueEvent } from './schemas.ts';

export function canonicalize(event: LedgerEvent): string {
  const clone = { ...event } as Record<string, unknown>;
  delete clone['eventHash'];
  return JSON.stringify(clone, sortedReplacer);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

export async function computeHash(event: LedgerEvent): Promise<string> {
  return await sha256Hex(canonicalize(event));
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyEventHash(event: LedgerEvent): Promise<boolean> {
  return (await computeHash(event)) === event.eventHash;
}

export async function stampEvent<T extends LedgerEvent>(event: T): Promise<T> {
  const ph = { ...event, eventHash: '' } as unknown as LedgerEvent;
  const hash = await computeHash(ph);
  return { ...event, eventHash: hash } as T;
}

/** Compute contractHash from semantic contract fields. Canonical version 1. */
export async function computeContractHash(event: ContractEvent | ReissueEvent): Promise<string> {
  const fields: Record<string, unknown> = {
    canonicalVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    title: event.title,
    itemId: event.itemId,
    checkpointId: event.checkpointId,
    acceptance: event.acceptance,
    behaviorWeights: event.behaviorWeights,
    requiredGates: event.requiredGates,
    requiredEvidenceTiers: event.requiredEvidenceTiers,
    executionManifest: event.executionManifest,
    rewardBudget: event.rewardBudget,
  };
  if (event.type === 'reissue') fields['predecessorEventHash'] = event.predecessorEventHash;
  return await sha256Hex(JSON.stringify(fields, sortedReplacer));
}
