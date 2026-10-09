import { computeContractHash, computeHash } from '../../tooling/rewards/crypto.ts';
import { sha256Hex } from '../../tooling/rewards/crypto.ts';
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
  Principal,
  ReissueEvent,
  Revision,
  RevokedEvent,
  VerdictEvent,
  VerificationEvent,
} from '../../tooling/rewards/schemas.ts';
import { SCHEMA_VERSION } from '../../tooling/rewards/schemas.ts';

let _seq = 0;
let _prevHash = '';

export function resetChain() {
  _seq = 0;
  _prevHash = '';
}

async function stamp<T extends LedgerEvent>(fields: Record<string, unknown>): Promise<T> {
  const ph = { ...fields, eventHash: '' } as unknown as LedgerEvent;
  const hash = await computeHash(ph);
  const event = { ...fields, eventHash: hash } as unknown as T;
  _prevHash = hash;
  _seq++;
  return event;
}

function baseFields(actor: Principal) {
  return {
    schemaVersion: SCHEMA_VERSION as 1,
    eventId: crypto.randomUUID(),
    sequence: _seq,
    timestamp: new Date().toISOString(),
    actor,
    prevEventHash: _prevHash,
  };
}

export const FAKE_TREE = 'b'.repeat(64);
export const FAKE_COMMIT = 'a'.repeat(40);
export const FAKE_HASH = 'a'.repeat(64);
export const DEFAULT_REVISION: Revision = {
  kind: 'commit',
  commitSha: FAKE_COMMIT,
  treeDigest: FAKE_TREE,
};

export const MOD: Principal = { principalId: 'moderator-1', role: 'moderator' as const };
export const BUILDER: Principal = { principalId: 'builder-1', role: 'builder' as const };
export const VERIFIER: Principal = { principalId: 'verifier-1', role: 'verifier' as const };

export const DEFAULT_GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
export const DEFAULT_WEIGHTS: BehaviorWeight[] = [
  { behaviorId: 'correctness', weight: 0.4, binary: false },
  { behaviorId: 'completeness', weight: 0.25, binary: false },
  { behaviorId: 'robustness', weight: 0.2, binary: false },
  { behaviorId: 'evidence', weight: 0.15, binary: false },
];
export const WEIGHTS_WITH_GATE: BehaviorWeight[] = [
  { behaviorId: 'correctness', weight: 0.4, binary: true },
  { behaviorId: 'completeness', weight: 0.25, binary: false },
  { behaviorId: 'robustness', weight: 0.2, binary: false },
  { behaviorId: 'evidence', weight: 0.15, binary: false },
];
export const DEFAULT_MANIFEST = {
  checkpointId: 'CP-0' as const,
  required: [{
    commandId: 'test:unit',
    scope: 'tests/unit/',
    expectedExit: 0,
    nonEmptySuite: true,
  }],
};
export const DEFAULT_EVIDENCE_TIERS: Record<string, string> = {};
export const DEFAULT_EXEC_RESULTS: ManifestResult[] = [
  { commandId: 'test:unit', exitStatus: 0, suiteCount: 10, logDigest: 'c'.repeat(64) },
];

export async function makeProtocolDocHash(): Promise<string> {
  return await sha256Hex('protocol-doc-content-v1');
}

export async function makeActivation(actor = MOD): Promise<ActivationEvent> {
  return await stamp<ActivationEvent>({
    ...baseFields(actor),
    type: 'activation',
    protocolDocHash: await makeProtocolDocHash(),
    eventHash: '',
  });
}

export async function makeContract(
  itemId: string,
  checkpointId = 'CP-0' as string,
  actor = MOD,
  weights = DEFAULT_WEIGHTS,
  budget = 100,
  gates = DEFAULT_GATES,
  evidenceTiers: Record<string, string> = DEFAULT_EVIDENCE_TIERS,
  manifest: {
    checkpointId: string;
    required: Array<
      { commandId: string; scope: string; expectedExit: number; nonEmptySuite: boolean }
    >;
  } = DEFAULT_MANIFEST,
  title?: string,
): Promise<ContractEvent> {
  const partial = {
    ...baseFields(actor),
    type: 'contract' as const,
    itemId,
    title: title ?? `Test item ${itemId}`,
    checkpointId,
    acceptance: ['test passes'],
    behaviorWeights: weights,
    requiredGates: gates,
    requiredEvidenceTiers: evidenceTiers,
    executionManifest: manifest,
    rewardBudget: budget,
    contractHash: FAKE_HASH,
    eventHash: '',
  };
  const contractHash = await computeContractHash(partial as unknown as ContractEvent);
  return await stamp<ContractEvent>({ ...partial, contractHash });
}

export async function makeCancellation(
  itemId: string,
  contractEventHash: string,
  actor = MOD,
): Promise<CancellationEvent> {
  return await stamp<CancellationEvent>({
    ...baseFields(actor),
    type: 'cancellation',
    itemId,
    contractEventHash,
    reason: 'Changed',
    eventHash: '',
  });
}

export async function makeReissue(
  itemId: string,
  predecessorEventHash: string,
  checkpointId = 'CP-0',
  actor = MOD,
  weights = DEFAULT_WEIGHTS,
): Promise<ReissueEvent> {
  const partial = {
    ...baseFields(actor),
    type: 'reissue' as const,
    itemId,
    title: `Reissued ${itemId}`,
    checkpointId,
    acceptance: ['updated'],
    behaviorWeights: weights,
    requiredGates: DEFAULT_GATES,
    requiredEvidenceTiers: DEFAULT_EVIDENCE_TIERS,
    executionManifest: DEFAULT_MANIFEST,
    rewardBudget: 100,
    contractHash: FAKE_HASH,
    predecessorEventHash,
    eventHash: '',
  };
  const contractHash = await computeContractHash(partial as unknown as ReissueEvent);
  return await stamp<ReissueEvent>({ ...partial, contractHash });
}

export async function makeClaim(
  itemId: string,
  actor = BUILDER,
  revision = DEFAULT_REVISION,
): Promise<ClaimEvent> {
  return await stamp<ClaimEvent>({
    ...baseFields(actor),
    type: 'claim',
    itemId,
    revision,
    artifacts: { pr: '42' },
    eventHash: '',
  });
}

export async function makeVerification(
  itemId: string,
  outcome: 'pass' | 'fail' | 'inconclusive' = 'pass',
  actor = VERIFIER,
  revision = DEFAULT_REVISION,
  execResults = DEFAULT_EXEC_RESULTS,
): Promise<VerificationEvent> {
  return await stamp<VerificationEvent>({
    ...baseFields(actor),
    type: 'verification',
    itemId,
    revision,
    outcome,
    executionResults: execResults,
    eventHash: '',
  });
}

export async function makeVerdict(
  itemId: string,
  decision: 'accepted' | 'rejected' = 'accepted',
  actor = MOD,
  revision = DEFAULT_REVISION,
  behaviorResults?: Record<string, boolean>,
  gates = DEFAULT_GATES,
): Promise<VerdictEvent> {
  const gr: Record<string, boolean> = {};
  for (const g of gates) gr[g] = true;
  return await stamp<VerdictEvent>({
    ...baseFields(actor),
    type: 'verdict',
    itemId,
    decision,
    revision,
    binaryGates: gr,
    behaviorResults: behaviorResults ?? {
      correctness: true,
      completeness: true,
      robustness: true,
      evidence: true,
    },
    eventHash: '',
  });
}

export async function makeCheckpoint(
  checkpointId: string,
  actor = MOD,
  revision = DEFAULT_REVISION,
): Promise<CheckpointEvent> {
  return await stamp<CheckpointEvent>({
    ...baseFields(actor),
    type: 'checkpoint',
    checkpointId,
    revision,
    regressionPassed: true,
    eventHash: '',
  });
}

export async function makeFinalized(
  itemId: string,
  computedScore: number,
  checkpointEventHash: string,
  verdictEventHash: string,
  actor = MOD,
): Promise<FinalizedEvent> {
  return await stamp<FinalizedEvent>({
    ...baseFields(actor),
    type: 'finalized',
    itemId,
    computedScore,
    checkpointEventHash,
    verdictEventHash,
    eventHash: '',
  });
}

export async function makeRevoked(
  itemId: string,
  deps: string[] = [],
  actor = MOD,
): Promise<RevokedEvent> {
  return await stamp<RevokedEvent>({
    ...baseFields(actor),
    type: 'revoked',
    itemId,
    reason: 'Counter-evidence',
    invalidatedDependents: deps,
    eventHash: '',
  });
}

export async function buildValidLifecycle(itemId = 'ITEM-1', checkpointId = 'CP-0') {
  resetChain();
  const activation = await makeActivation();
  const contract = await makeContract(itemId, checkpointId);
  const claim = await makeClaim(itemId);
  const verification = await makeVerification(itemId);
  const verdict = await makeVerdict(itemId);
  return { activation, contract, claim, verification, verdict };
}
