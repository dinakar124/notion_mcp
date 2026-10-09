/**
 * Reward Ledger — Versioned strict event schemas (Zod 4).
 *
 * Every schema uses .strict() so unknown fields are rejected at parse time.
 */

import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'Must be 64 lowercase hex chars (SHA-256)');
const GitSha = z.string().regex(/^[0-9a-f]{40}$/, 'Must be 40 lowercase hex chars (git SHA)');

export const PrincipalRole = z.enum(['builder', 'verifier', 'moderator']);
export type PrincipalRole = z.infer<typeof PrincipalRole>;

export const EvidenceTier = z.enum([
  'SPEC_INTENT',
  'OFFICIAL_DOC',
  'REAL_API',
  'CONFORMANCE',
  'SYNTHETIC_FIXTURE',
  'UNVERIFIED',
]);
export type EvidenceTier = z.infer<typeof EvidenceTier>;

export const VerificationOutcome = z.enum(['pass', 'fail', 'inconclusive']);
export type VerificationOutcome = z.infer<typeof VerificationOutcome>;

export const VerdictDecision = z.enum(['accepted', 'rejected']);
export type VerdictDecision = z.infer<typeof VerdictDecision>;

/** Canonical checkpoint IDs in order. Unknown IDs rejected at schema level. */
export const CHECKPOINT_IDS = [
  'CP-0',
  'CP-1',
  'CP-2A',
  'CP-2C',
  'CP-2B',
  'CP-3A',
  'CP-3B',
  'CP-4',
] as const;
export const CheckpointId = z.enum(CHECKPOINT_IDS);
export type CheckpointId = z.infer<typeof CheckpointId>;

export const Principal = z.object({ principalId: z.string().min(1), role: PrincipalRole }).strict();
export type Principal = z.infer<typeof Principal>;

/** Revision subject — immutable commit or moderator-sealed snapshot. */
export const CommitRevision = z.object({
  kind: z.literal('commit'),
  commitSha: GitSha,
  treeDigest: Sha256Hex,
}).strict();
export const SnapshotRevision = z.object({
  kind: z.literal('snapshot'),
  snapshotDigest: Sha256Hex,
  sealEventHash: Sha256Hex,
}).strict();
export const Revision = z.discriminatedUnion('kind', [CommitRevision, SnapshotRevision]);
export type Revision = z.infer<typeof Revision>;

export const EvidenceRecord = z.object({
  tier: EvidenceTier,
  subject: z.string().min(1),
  source: z.string().min(1),
  revisionDigest: Sha256Hex.optional(),
  command: z.string().optional(),
  exitStatus: z.number().int().optional(),
  runnerPrincipalId: z.string().min(1),
  artifactDigest: Sha256Hex.optional(),
}).strict();
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

export const ManifestEntry = z.object({
  commandId: z.string().min(1),
  scope: z.string().min(1),
  expectedExit: z.number().int(),
  nonEmptySuite: z.boolean(),
}).strict();
export type ManifestEntry = z.infer<typeof ManifestEntry>;

export const ExecutionManifest = z.object({
  checkpointId: CheckpointId,
  required: z.array(ManifestEntry).min(1),
}).strict();
export type ExecutionManifest = z.infer<typeof ExecutionManifest>;

export const ManifestResult = z.object({
  commandId: z.string().min(1),
  exitStatus: z.number().int(),
  suiteCount: z.number().int().nonnegative(),
  logDigest: Sha256Hex,
}).strict();
export type ManifestResult = z.infer<typeof ManifestResult>;

export const BehaviorWeight = z.object({
  behaviorId: z.string().min(1),
  weight: z.number().min(0).max(1),
  binary: z.boolean(),
}).strict();
export type BehaviorWeight = z.infer<typeof BehaviorWeight>;

const EventBase = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  eventId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  actor: Principal,
  prevEventHash: z.union([z.literal(''), Sha256Hex]),
  eventHash: z.union([z.literal(''), Sha256Hex]),
});

export const EventType = z.enum([
  'activation',
  'contract',
  'cancellation',
  'reissue',
  'claim',
  'verification',
  'verdict',
  'checkpoint',
  'finalized',
  'revoked',
]);
export type EventType = z.infer<typeof EventType>;

export const ActivationEvent = EventBase.extend({
  type: z.literal('activation'),
  protocolDocHash: Sha256Hex,
}).strict();
export type ActivationEvent = z.infer<typeof ActivationEvent>;

export const ContractEvent = EventBase.extend({
  type: z.literal('contract'),
  itemId: z.string().min(1),
  title: z.string().min(1),
  checkpointId: CheckpointId,
  acceptance: z.array(z.string().min(1)).min(1),
  behaviorWeights: z.array(BehaviorWeight).min(1),
  requiredGates: z.array(z.string().min(1)).min(1),
  requiredEvidenceTiers: z.record(z.string(), EvidenceTier),
  executionManifest: ExecutionManifest,
  rewardBudget: z.number().positive(),
  contractHash: Sha256Hex,
  predecessorEventHash: z.string().optional(),
}).strict();
export type ContractEvent = z.infer<typeof ContractEvent>;

export const CancellationEvent = EventBase.extend({
  type: z.literal('cancellation'),
  itemId: z.string().min(1),
  contractEventHash: Sha256Hex,
  reason: z.string().min(1),
}).strict();
export type CancellationEvent = z.infer<typeof CancellationEvent>;

export const ReissueEvent = EventBase.extend({
  type: z.literal('reissue'),
  itemId: z.string().min(1),
  title: z.string().min(1),
  checkpointId: CheckpointId,
  acceptance: z.array(z.string().min(1)).min(1),
  behaviorWeights: z.array(BehaviorWeight).min(1),
  requiredGates: z.array(z.string().min(1)).min(1),
  requiredEvidenceTiers: z.record(z.string(), EvidenceTier),
  executionManifest: ExecutionManifest,
  rewardBudget: z.number().positive(),
  contractHash: Sha256Hex,
  predecessorEventHash: Sha256Hex,
}).strict();
export type ReissueEvent = z.infer<typeof ReissueEvent>;

export const ClaimEvent = EventBase.extend({
  type: z.literal('claim'),
  itemId: z.string().min(1),
  revision: Revision,
  artifacts: z.record(z.string(), z.string()),
  evidence: z.array(EvidenceRecord).optional(),
}).strict();
export type ClaimEvent = z.infer<typeof ClaimEvent>;

export const VerificationEvent = EventBase.extend({
  type: z.literal('verification'),
  itemId: z.string().min(1),
  revision: Revision,
  outcome: VerificationOutcome,
  counterexamples: z.array(z.string()).optional(),
  evidence: z.array(EvidenceRecord).optional(),
  executionResults: z.array(ManifestResult),
}).strict();
export type VerificationEvent = z.infer<typeof VerificationEvent>;

export const VerdictEvent = EventBase.extend({
  type: z.literal('verdict'),
  itemId: z.string().min(1),
  decision: VerdictDecision,
  revision: Revision,
  binaryGates: z.record(z.string(), z.boolean()),
  behaviorResults: z.record(z.string(), z.boolean()),
  moderatorNotes: z.string().optional(),
}).strict();
export type VerdictEvent = z.infer<typeof VerdictEvent>;

export const CheckpointEvent = EventBase.extend({
  type: z.literal('checkpoint'),
  checkpointId: CheckpointId,
  revision: Revision,
  regressionPassed: z.boolean(),
}).strict();
export type CheckpointEvent = z.infer<typeof CheckpointEvent>;

export const FinalizedEvent = EventBase.extend({
  type: z.literal('finalized'),
  itemId: z.string().min(1),
  computedScore: z.number().nonnegative(),
  checkpointEventHash: Sha256Hex,
  verdictEventHash: Sha256Hex,
}).strict();
export type FinalizedEvent = z.infer<typeof FinalizedEvent>;

export const RevokedEvent = EventBase.extend({
  type: z.literal('revoked'),
  itemId: z.string().min(1),
  reason: z.string().min(1),
  counterEvidence: z.string().optional(),
  invalidatedDependents: z.array(z.string()),
}).strict();
export type RevokedEvent = z.infer<typeof RevokedEvent>;

export const LedgerEvent = z.discriminatedUnion('type', [
  ActivationEvent,
  ContractEvent,
  CancellationEvent,
  ReissueEvent,
  ClaimEvent,
  VerificationEvent,
  VerdictEvent,
  CheckpointEvent,
  FinalizedEvent,
  RevokedEvent,
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;

/** Compare two Revision objects for exact equality. */
export function revisionsEqual(a: Revision, b: Revision): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'commit' && b.kind === 'commit') {
    return a.commitSha === b.commitSha && a.treeDigest === b.treeDigest;
  }
  if (a.kind === 'snapshot' && b.kind === 'snapshot') {
    return a.snapshotDigest === b.snapshotDigest && a.sealEventHash === b.sealEventHash;
  }
  return false;
}

/** Get the primary digest of a revision for evidence matching. */
export function revisionDigest(r: Revision): string {
  return r.kind === 'commit' ? r.treeDigest : r.snapshotDigest;
}
