/**
 * Reward Ledger — Deterministic state machine / reducer.
 */

import { computeContractHash } from './crypto.ts';
import { CHECKPOINT_IDS, revisionDigest, revisionsEqual } from './schemas.ts';
import type {
  ActivationEvent,
  BehaviorWeight,
  CancellationEvent,
  CheckpointEvent,
  ClaimEvent,
  ContractEvent,
  FinalizedEvent,
  LedgerEvent,
  ManifestResult,
  ReissueEvent,
  Revision,
  RevokedEvent,
  VerdictEvent,
  VerificationEvent,
} from './schemas.ts';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface ContractState {
  itemId: string;
  title: string;
  checkpointId: string;
  acceptance: string[];
  behaviorWeights: BehaviorWeight[];
  requiredGates: string[];
  requiredEvidenceTiers: Record<string, string>;
  executionManifest: {
    checkpointId: string;
    required: Array<{
      commandId: string;
      scope: string;
      expectedExit: number;
      nonEmptySuite: boolean;
    }>;
  };
  rewardBudget: number;
  contractHash: string;
  contractEventHash: string;
  cancelled: boolean;
  predecessorEventHash?: string;
}

export interface ItemState {
  itemId: string;
  activeContract: ContractState | null;
  cancelledContracts: ContractState[];
  claimed: boolean;
  claimEvent: ClaimEvent | null;
  verified: boolean;
  verificationEvent: VerificationEvent | null;
  verdictDecision: 'accepted' | 'rejected' | null;
  verdictEvent: VerdictEvent | null;
  finalized: boolean;
  finalizedEvent: FinalizedEvent | null;
  revoked: boolean;
  revokedEvent: RevokedEvent | null;
  computedScore: number;
  builderPrincipalId: string | null;
  verifierPrincipalId: string | null;
  moderatorPrincipalId: string | null;
}

export interface CheckpointState {
  checkpointId: string;
  regressionPassed: boolean;
  checkpointEventHash: string | null;
  revision: Revision | null;
}

export interface LedgerState {
  activated: boolean;
  activationEvent: ActivationEvent | null;
  items: Map<string, ItemState>;
  checkpoints: Map<string, CheckpointState>;
  headHash: string;
  sequence: number;
  eventsByHash: Map<string, LedgerEvent>;
}

export class ReducerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ReducerError';
  }
}

export function initialState(): LedgerState {
  return {
    activated: false,
    activationEvent: null,
    items: new Map(),
    checkpoints: new Map(),
    headHash: '',
    sequence: 0,
    eventsByHash: new Map(),
  };
}

export async function reduce(state: LedgerState, event: LedgerEvent): Promise<LedgerState> {
  if (event.sequence !== state.sequence) {
    throw new ReducerError(
      'SEQUENCE_MISMATCH',
      `Expected seq ${state.sequence}, got ${event.sequence}`,
    );
  }
  if (event.prevEventHash !== state.headHash) {
    throw new ReducerError(
      'CHAIN_MISMATCH',
      `Expected prev "${state.headHash}", got "${event.prevEventHash}"`,
    );
  }
  switch (event.type) {
    case 'activation':
      return reduceActivation(state, event);
    case 'contract':
      return await reduceContract(state, event);
    case 'cancellation':
      return reduceCancellation(state, event);
    case 'reissue':
      return await reduceReissue(state, event);
    case 'claim':
      return reduceClaim(state, event);
    case 'verification':
      return reduceVerification(state, event);
    case 'verdict':
      return reduceVerdict(state, event);
    case 'checkpoint':
      return reduceCheckpoint(state, event);
    case 'finalized':
      return reduceFinalized(state, event);
    case 'revoked':
      return reduceRevoked(state, event);
  }
}

export async function replay(events: LedgerEvent[]): Promise<LedgerState> {
  let s = initialState();
  for (const e of events) s = await reduce(s, e);
  return s;
}

function advance(state: LedgerState, event: LedgerEvent): LedgerState {
  return {
    ...state,
    headHash: event.eventHash,
    sequence: state.sequence + 1,
    eventsByHash: new Map(state.eventsByHash).set(event.eventHash, event),
  };
}

function requireActivated(s: LedgerState): void {
  if (!s.activated) throw new ReducerError('NOT_ACTIVATED', 'Protocol not activated');
}

function reduceActivation(s: LedgerState, e: ActivationEvent): LedgerState {
  if (s.activated) throw new ReducerError('ALREADY_ACTIVATED', 'Already activated');
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  return { ...advance(s, e), activated: true, activationEvent: e };
}

async function reduceContract(s: LedgerState, e: ContractEvent): Promise<LedgerState> {
  requireActivated(s);
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  validateContractFields(e);
  const computed = await computeContractHash(e);
  if (computed !== e.contractHash) throw new ReducerError('CONTRACT_HASH_INVALID', `Hash mismatch`);
  const ex = s.items.get(e.itemId);
  if (ex?.activeContract) throw new ReducerError('CONTRACT_ALREADY_ACTIVE', `Already active`);
  const c = buildContract(e, e.eventHash);
  const item = ex ?? newItem(e.itemId);
  const ns = advance(s, e);
  const items = new Map(ns.items);
  items.set(e.itemId, { ...item, activeContract: c, moderatorPrincipalId: e.actor.principalId });
  return { ...ns, items };
}

function reduceCancellation(s: LedgerState, e: CancellationEvent): LedgerState {
  requireActivated(s);
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  const item = s.items.get(e.itemId);
  if (!item?.activeContract) throw new ReducerError('NO_ACTIVE_CONTRACT', 'None');
  if (item.activeContract.contractEventHash !== e.contractEventHash) {
    throw new ReducerError('CONTRACT_HASH_MISMATCH', 'Mismatch');
  }
  const cancelled = { ...item.activeContract, cancelled: true };
  const ns = advance(s, e);
  const items = new Map(ns.items);
  items.set(e.itemId, {
    ...item,
    activeContract: null,
    cancelledContracts: [...item.cancelledContracts, cancelled],
    claimed: false,
    claimEvent: null,
    verified: false,
    verificationEvent: null,
    verdictDecision: null,
    verdictEvent: null,
    finalized: false,
    finalizedEvent: null,
    computedScore: 0,
  });
  return { ...ns, items };
}

async function reduceReissue(s: LedgerState, e: ReissueEvent): Promise<LedgerState> {
  requireActivated(s);
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  validateContractFields(e);
  const computed = await computeContractHash(e);
  if (computed !== e.contractHash) throw new ReducerError('CONTRACT_HASH_INVALID', 'Hash mismatch');
  const item = s.items.get(e.itemId);
  if (item?.activeContract) throw new ReducerError('CONTRACT_ALREADY_ACTIVE', 'Already active');
  const pred = s.eventsByHash.get(e.predecessorEventHash);
  if (!pred || (pred.type !== 'contract' && pred.type !== 'reissue')) {
    throw new ReducerError('INVALID_PREDECESSOR', 'Not a contract event');
  }
  if ((pred as ContractEvent).itemId !== e.itemId) {
    throw new ReducerError('CROSS_ITEM_PREDECESSOR', 'Wrong item');
  }
  if (!item?.cancelledContracts.some((c) => c.contractEventHash === e.predecessorEventHash)) {
    throw new ReducerError('PREDECESSOR_NOT_CANCELLED', 'Not cancelled');
  }
  const latest = item!.cancelledContracts[item!.cancelledContracts.length - 1];
  if (latest?.contractEventHash !== e.predecessorEventHash) {
    throw new ReducerError('PREDECESSOR_NOT_LATEST', 'Not latest');
  }
  const c = buildContract(e, e.eventHash);
  const ns = advance(s, e);
  const items = new Map(ns.items);
  items.set(e.itemId, { ...(item ?? newItem(e.itemId)), activeContract: c });
  return { ...ns, items };
}

function reduceClaim(s: LedgerState, e: ClaimEvent): LedgerState {
  requireActivated(s);
  if (e.actor.role !== 'builder') throw new ReducerError('ROLE_VIOLATION', 'Only builder');
  const item = s.items.get(e.itemId);
  if (!item?.activeContract) throw new ReducerError('NO_ACTIVE_CONTRACT', 'None');
  if (item.claimed) throw new ReducerError('DUPLICATE_CLAIM', 'Already claimed');
  if (item.moderatorPrincipalId === e.actor.principalId) {
    throw new ReducerError('ROLE_COLLISION', 'Builder=moderator');
  }
  const ns = advance(s, e);
  const items = new Map(ns.items);
  items.set(e.itemId, {
    ...item,
    claimed: true,
    claimEvent: e,
    builderPrincipalId: e.actor.principalId,
  });
  return { ...ns, items };
}

function reduceVerification(s: LedgerState, e: VerificationEvent): LedgerState {
  requireActivated(s);
  if (e.actor.role !== 'verifier') throw new ReducerError('ROLE_VIOLATION', 'Only verifier');
  const item = s.items.get(e.itemId);
  if (!item?.activeContract) throw new ReducerError('NO_ACTIVE_CONTRACT', 'None');
  if (!item.claimed) throw new ReducerError('NOT_CLAIMED', 'Not claimed');
  if (item.verified) throw new ReducerError('DUPLICATE_VERIFICATION', 'Already verified');
  if (item.builderPrincipalId === e.actor.principalId) {
    throw new ReducerError('ROLE_COLLISION', 'Verifier=builder');
  }
  if (item.moderatorPrincipalId === e.actor.principalId) {
    throw new ReducerError('ROLE_COLLISION', 'Verifier=moderator');
  }

  if (e.outcome === 'pass') {
    if (!revisionsEqual(e.revision, item.claimEvent!.revision)) {
      throw new ReducerError('VERIFICATION_REVISION_MISMATCH', 'Revision does not match claim');
    }
    validateExecutionResults(item.activeContract, e.executionResults);
    validateVerificationEvidence(item.activeContract, e, item.claimEvent!.revision);
  }

  const ns = advance(s, e);
  const items = new Map(ns.items);
  items.set(e.itemId, {
    ...item,
    verified: true,
    verificationEvent: e,
    verifierPrincipalId: e.actor.principalId,
  });
  return { ...ns, items };
}

function reduceVerdict(s: LedgerState, e: VerdictEvent): LedgerState {
  requireActivated(s);
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  const item = s.items.get(e.itemId);
  if (!item?.activeContract) throw new ReducerError('NO_ACTIVE_CONTRACT', 'None');
  if (!item.claimed) throw new ReducerError('NOT_CLAIMED', 'Not claimed');
  if (item.verdictDecision !== null) throw new ReducerError('DUPLICATE_VERDICT', 'Already verdict');
  if (!item.verified || item.verificationEvent?.outcome !== 'pass') {
    throw new ReducerError('VERIFICATION_REQUIRED', 'Need passing verification');
  }
  if (!revisionsEqual(e.revision, item.claimEvent!.revision)) {
    throw new ReducerError('VERDICT_REVISION_MISMATCH', 'Revision mismatch');
  }

  if (e.decision === 'accepted') {
    const c = item.activeContract;
    const vKeys = Object.keys(e.binaryGates).sort();
    const rKeys = [...c.requiredGates].sort();
    if (JSON.stringify(vKeys) !== JSON.stringify(rKeys)) {
      throw new ReducerError('GATES_MISMATCH', 'Verdict gates != required gates');
    }
    for (const [g, p] of Object.entries(e.binaryGates)) {
      if (!p) throw new ReducerError('GATE_FAILURE', `Gate "${g}" false`);
    }
    for (const bw of c.behaviorWeights) {
      if (!(bw.behaviorId in e.behaviorResults)) {
        throw new ReducerError('MISSING_BEHAVIOR_RESULT', `Missing "${bw.behaviorId}"`);
      }
      if (bw.binary && !e.behaviorResults[bw.behaviorId]) {
        throw new ReducerError('GATE_FAILURE', `Behavior "${bw.behaviorId}" false`);
      }
    }
    for (const p of getPrerequisiteCheckpoints(c.checkpointId)) {
      if (!s.checkpoints.get(p)?.regressionPassed) {
        throw new ReducerError('PREREQUISITE_CHECKPOINT_MISSING', `${p} not passed`);
      }
    }
  }

  const score = e.decision === 'accepted'
    ? computeScore(
      item.activeContract.behaviorWeights,
      e.behaviorResults,
      item.activeContract.rewardBudget,
    )
    : 0;
  const ns = advance(s, e);
  const items = new Map(ns.items);
  items.set(e.itemId, {
    ...item,
    verdictDecision: e.decision,
    verdictEvent: e,
    computedScore: score,
  });
  return { ...ns, items };
}

function reduceCheckpoint(s: LedgerState, e: CheckpointEvent): LedgerState {
  requireActivated(s);
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  const ex = s.checkpoints.get(e.checkpointId);
  if (ex?.regressionPassed && e.regressionPassed) {
    throw new ReducerError('DUPLICATE_CHECKPOINT', 'Already passed');
  }
  for (const p of getPrerequisiteCheckpoints(e.checkpointId)) {
    if (!s.checkpoints.get(p)?.regressionPassed) {
      throw new ReducerError('PREREQUISITE_CHECKPOINT_MISSING', `${p} not passed`);
    }
  }

  if (e.regressionPassed) {
    let cpItemCount = 0;
    for (const [_id, item] of s.items) {
      if (item.activeContract?.checkpointId === e.checkpointId) {
        cpItemCount++;
        if (item.verdictDecision !== 'accepted') {
          throw new ReducerError('CHECKPOINT_ITEMS_NOT_ACCEPTED', `${item.itemId} not accepted`);
        }
        if (!revisionsEqual(item.claimEvent!.revision, e.revision)) {
          throw new ReducerError(
            'CHECKPOINT_REVISION_MISMATCH',
            `${item.itemId} revision mismatch`,
          );
        }
        // #10: require that item's verification had passing manifest
        if (!item.verificationEvent || item.verificationEvent.outcome !== 'pass') {
          throw new ReducerError(
            'CHECKPOINT_VERIFICATION_MISSING',
            `${item.itemId} has no passing verification`,
          );
        }
      }
    }
    if (cpItemCount === 0) {
      throw new ReducerError('CHECKPOINT_ZERO_ITEMS', `No items for checkpoint ${e.checkpointId}`);
    }
  }

  const ns = advance(s, e);
  const cps = new Map(ns.checkpoints);
  cps.set(e.checkpointId, {
    checkpointId: e.checkpointId,
    regressionPassed: e.regressionPassed,
    checkpointEventHash: e.eventHash,
    revision: e.revision,
  });
  return { ...ns, checkpoints: cps };
}

function reduceFinalized(s: LedgerState, e: FinalizedEvent): LedgerState {
  requireActivated(s);
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  const item = s.items.get(e.itemId);
  if (!item?.activeContract) throw new ReducerError('NO_ACTIVE_CONTRACT', 'None');
  if (item.verdictDecision !== 'accepted') {
    throw new ReducerError('VERDICT_NOT_ACCEPTED', 'Not accepted');
  }
  if (item.revoked) throw new ReducerError('ITEM_REVOKED', 'Revoked');
  if (item.finalized) throw new ReducerError('DUPLICATE_FINALIZATION', 'Already finalized');
  if (e.verdictEventHash !== item.verdictEvent!.eventHash) {
    throw new ReducerError('VERDICT_HASH_MISMATCH', 'Hash mismatch');
  }
  const cp = s.checkpoints.get(item.activeContract.checkpointId);
  if (!cp?.regressionPassed) throw new ReducerError('CHECKPOINT_REGRESSION_REQUIRED', 'Not passed');
  if (cp.checkpointEventHash !== e.checkpointEventHash) {
    throw new ReducerError('CHECKPOINT_HASH_MISMATCH', 'Hash mismatch');
  }
  if (!cp.revision || !revisionsEqual(cp.revision, item.claimEvent!.revision)) {
    throw new ReducerError('FINALIZATION_REVISION_MISMATCH', 'Checkpoint revision != claim');
  }
  if (Math.abs(e.computedScore - item.computedScore) > 1e-10) {
    throw new ReducerError('SCORE_MISMATCH', 'Score mismatch');
  }
  const ns = advance(s, e);
  const items = new Map(ns.items);
  items.set(e.itemId, { ...item, finalized: true, finalizedEvent: e });
  return { ...ns, items };
}

function reduceRevoked(s: LedgerState, e: RevokedEvent): LedgerState {
  requireActivated(s);
  if (e.actor.role !== 'moderator') throw new ReducerError('ROLE_VIOLATION', 'Only moderator');
  const item = s.items.get(e.itemId);
  if (!item) throw new ReducerError('UNKNOWN_ITEM', 'Unknown');
  if (item.revoked) throw new ReducerError('DUPLICATE_REVOCATION', 'Already revoked');
  // #11: compute ALL later dependents — accepted, finalized, or in-flight (claimed/verified)
  const deps = computeRevocationDependents(s, e.itemId);
  const supplied = [...e.invalidatedDependents].sort();
  const computed = [...deps].sort();
  if (JSON.stringify(supplied) !== JSON.stringify(computed)) {
    throw new ReducerError('DEPENDENTS_MISMATCH', 'Supplied != computed dependents');
  }
  const ns = advance(s, e);
  const items = new Map(ns.items);
  // Reset source item
  items.set(e.itemId, {
    ...item,
    revoked: true,
    revokedEvent: e,
    computedScore: 0,
    finalized: false,
  });
  // #11: Reset ALL dependent items fully
  for (const depId of deps) {
    const dep = items.get(depId);
    if (dep) {
      items.set(depId, {
        ...dep,
        revoked: true,
        revokedEvent: e,
        computedScore: 0,
        finalized: false,
        verdictDecision: null,
        verdictEvent: null,
        verified: false,
        verificationEvent: null,
        claimed: false,
        claimEvent: null,
      });
    }
  }
  // Reopen source + all later checkpoints
  const cps = new Map(ns.checkpoints);
  const affected = new Set<string>();
  if (item.activeContract) affected.add(item.activeContract.checkpointId);
  for (const d of deps) {
    const di = items.get(d);
    if (di?.activeContract) affected.add(di.activeContract.checkpointId);
  }
  for (const cpId of affected) for (const l of getLaterCheckpoints(cpId)) affected.add(l);
  for (const cpId of affected) {
    const cp = cps.get(cpId);
    if (cp) cps.set(cpId, { ...cp, regressionPassed: false });
  }
  return { ...ns, items, checkpoints: cps };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newItem(itemId: string): ItemState {
  return {
    itemId,
    activeContract: null,
    cancelledContracts: [],
    claimed: false,
    claimEvent: null,
    verified: false,
    verificationEvent: null,
    verdictDecision: null,
    verdictEvent: null,
    finalized: false,
    finalizedEvent: null,
    revoked: false,
    revokedEvent: null,
    computedScore: 0,
    builderPrincipalId: null,
    verifierPrincipalId: null,
    moderatorPrincipalId: null,
  };
}

function buildContract(e: ContractEvent | ReissueEvent, eventHash: string): ContractState {
  return {
    itemId: e.itemId,
    title: e.title,
    checkpointId: e.checkpointId,
    acceptance: [...e.acceptance],
    behaviorWeights: [...e.behaviorWeights],
    requiredGates: [...e.requiredGates],
    requiredEvidenceTiers: { ...e.requiredEvidenceTiers },
    executionManifest: {
      checkpointId: e.executionManifest.checkpointId,
      required: [...e.executionManifest.required],
    },
    rewardBudget: e.rewardBudget,
    contractHash: e.contractHash,
    contractEventHash: eventHash,
    cancelled: false,
    predecessorEventHash: e.type === 'reissue' ? e.predecessorEventHash : undefined,
  };
}

/** #8: Validate contract internal consistency. */
function validateContractFields(e: ContractEvent | ReissueEvent): void {
  const bw = e.behaviorWeights;
  const sum = bw.reduce((s, w) => s + w.weight, 0);
  if (Math.abs(sum - 1.0) > 1e-9) throw new ReducerError('WEIGHTS_NOT_SUM_ONE', `Sum ${sum} != 1`);
  // Unique behaviorIds
  const bids = new Set(bw.map((w) => w.behaviorId));
  if (bids.size !== bw.length) {
    throw new ReducerError('DUPLICATE_BEHAVIOR_ID', 'Duplicate behaviorId');
  }
  // Unique requiredGates
  const gs = new Set(e.requiredGates);
  if (gs.size !== e.requiredGates.length) {
    throw new ReducerError('DUPLICATE_GATE', 'Duplicate gate');
  }
  // Unique manifest commandIds
  const cids = new Set(e.executionManifest.required.map((r) => r.commandId));
  if (cids.size !== e.executionManifest.required.length) {
    throw new ReducerError('DUPLICATE_COMMAND_ID', 'Duplicate commandId');
  }
  // executionManifest.checkpointId must match contract checkpointId
  if (e.executionManifest.checkpointId !== e.checkpointId) {
    throw new ReducerError(
      'MANIFEST_CHECKPOINT_MISMATCH',
      'Manifest checkpointId != contract checkpointId',
    );
  }
  // requiredEvidenceTiers keys must be subset of requiredGates
  for (const k of Object.keys(e.requiredEvidenceTiers)) {
    if (!gs.has(k)) {
      throw new ReducerError(
        'EVIDENCE_TIER_KEY_NOT_IN_GATES',
        `Evidence tier key "${k}" not in requiredGates`,
      );
    }
  }
}

function validateExecutionResults(contract: ContractState, results: ManifestResult[]): void {
  const manifest = contract.executionManifest;
  const rMap = new Map(results.map((r) => [r.commandId, r]));
  // Exact set match
  const reqIds = new Set(manifest.required.map((r) => r.commandId));
  const resIds = new Set(results.map((r) => r.commandId));
  if (reqIds.size !== resIds.size || [...reqIds].some((id) => !resIds.has(id))) {
    throw new ReducerError(
      'MANIFEST_COMMAND_MISMATCH',
      'Execution result commands do not match manifest',
    );
  }
  for (const req of manifest.required) {
    const r = rMap.get(req.commandId)!;
    if (r.exitStatus !== req.expectedExit) {
      throw new ReducerError(
        'MANIFEST_EXIT_MISMATCH',
        `${req.commandId} exit ${r.exitStatus} != ${req.expectedExit}`,
      );
    }
    if (req.nonEmptySuite && r.suiteCount === 0) {
      throw new ReducerError('MANIFEST_EMPTY_SUITE', `${req.commandId} empty suite`);
    }
  }
}

/** #9: Validate verification evidence strictly on pass. */
function validateVerificationEvidence(
  contract: ContractState,
  e: VerificationEvent,
  claimRevision: Revision,
): void {
  const reqTiers = contract.requiredEvidenceTiers;
  for (const [gateId, tier] of Object.entries(reqTiers)) {
    const matching = e.evidence?.find((ev) => ev.subject === gateId && ev.tier === tier);
    if (!matching) {
      throw new ReducerError(
        'EVIDENCE_TIER_MISSING',
        `Required ${tier} evidence for "${gateId}" not found`,
      );
    }
    // Runner must match verifier actor
    if (matching.runnerPrincipalId !== e.actor.principalId) {
      throw new ReducerError(
        'EVIDENCE_RUNNER_MISMATCH',
        `Evidence runner "${matching.runnerPrincipalId}" != verifier "${e.actor.principalId}"`,
      );
    }
    // revisionDigest must match claim's primary digest
    if (
      matching.revisionDigest !== undefined &&
      matching.revisionDigest !== revisionDigest(claimRevision)
    ) {
      throw new ReducerError(
        'EVIDENCE_REVISION_MISMATCH',
        `Evidence revisionDigest does not match claim`,
      );
    }
  }
}

export function computeScore(
  weights: BehaviorWeight[],
  results: Record<string, boolean>,
  budget: number,
): number {
  let s = 0;
  for (const w of weights) s += w.weight * ((results[w.behaviorId] ?? false) ? 1 : 0);
  return budget * s;
}

export function getPrerequisiteCheckpoints(cpId: string): string[] {
  const idx = CHECKPOINT_IDS.indexOf(cpId as typeof CHECKPOINT_IDS[number]);
  if (idx <= 0) return [];
  return [...CHECKPOINT_IDS.slice(0, idx)];
}

function getLaterCheckpoints(cpId: string): string[] {
  const idx = CHECKPOINT_IDS.indexOf(cpId as typeof CHECKPOINT_IDS[number]);
  if (idx < 0 || idx >= CHECKPOINT_IDS.length - 1) return [];
  return [...CHECKPOINT_IDS.slice(idx + 1)];
}

/** #11: Compute ALL later dependent items (accepted, finalized, OR in-flight). */
function computeRevocationDependents(s: LedgerState, revokedId: string): string[] {
  const ri = s.items.get(revokedId);
  if (!ri?.activeContract) return [];
  const laterCps = new Set(getLaterCheckpoints(ri.activeContract.checkpointId));
  const deps: string[] = [];
  for (const [id, item] of s.items) {
    if (id === revokedId) continue;
    if (item.activeContract && laterCps.has(item.activeContract.checkpointId)) {
      deps.push(id);
    }
  }
  return deps.sort();
}
