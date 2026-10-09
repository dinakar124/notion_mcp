# Agent Reward Protocol — Notion MCP Build

**Date:** 2026-10-09 (updated 2026-10-09T06:35Z)
**Status:** Draft — requires moderator ratification before activation
**Scope:** Cooperative multi-agent build of `notion-mcp` against canonical spec and implementation plan
**Aligned to:** `notion-mcp-product-spec-v3.md`, `notion-mcp-implementation-plan.md`

---

## 1. Purpose and Non-Goals

### Purpose

Incentivize agents to produce correct, integrated, evidence-backed work aligned to the canonical checkpoints — not to maximize output volume, test count, or code size. Reward genuine contribution to the product's correctness; make gaming costlier than honest work.

### Non-goals

- This is NOT a competition. It is a cooperative protocol where multiple agents contribute to a single product under a single moderator.
- This does NOT replace the canonical checkpoint gates. Every gate in the implementation plan is authoritative; this protocol rewards passage through those gates, not around them.
- This does NOT achieve absolute hack-proofing. No incentive design can. The goal is to make gaming economically irrational — the effort to fake a passing gate exceeds the effort to pass it genuinely.
- No final numerical reward is assigned yet. Current work remains provisional until an independent regression verifier validates the final integrated checkpoint evidence.

---

## 2. Roles

| Role | Identity Constraint | Description |
|---|---|---|
| **Moderator** | Human operator or human-designated oversight agent. NEVER a builder. | Owns acceptance decisions, adversarial test bank, and gate verdicts. |
| **Builder** | Agent session bound to build tasks. Cannot be the moderator. | Writes code, tests, docs. Claims work. Reports evidence. |
| **Verifier** | Agent session bound to verification tasks. Cannot be the builder whose work it verifies. Must have READ-ONLY access to the checkout. | Independently reproduces builder claims. Reports verification evidence. |

**Identity separation rule:** A builder CANNOT verify its own work. A verifier CANNOT verify work it also built. The moderator CANNOT be a builder or verifier on the same work item. Violation → disqualification of the affected work item (§9).

---

## 3. Canonical Checkpoint Alignment

Reward is structured around the implementation plan's hard gates. No score accrues until a gate passes. No gate passes until its full checklist is met.

| Checkpoint | Gate Name | Implementation Plan Reference |
|---|---|---|
| CP-0 | Foundation Approved | "CHECKPOINT 0: Foundation approved" |
| CP-1 | Cellular Correctness | "CHECKPOINT 1: Cellular correctness" |
| CP-2A | Persistence Hard Pause | "CHECKPOINT 2A: Persistence hard pause" |
| CP-2C | Protocol Foundation Conformance | "CHECKPOINT 2C: Protocol Foundation Conformance" |
| CP-2B | Coordination Hard Pause | "CHECKPOINT 2B: Coordination hard pause" |
| CP-3A | Deterministic End-to-End | "CHECKPOINT 3A: Deterministic end-to-end" |
| CP-3B | Real Notion Contract Lap | "CHECKPOINT 3B: Real Notion contract lap" |
| CP-4 | Release Gate | "CHECKPOINT 4: Release Gate" |

The ordering is canonical: CP-0 → CP-1 → CP-2A → CP-2C → CP-2B → CP-3A → CP-3B → CP-4. No checkpoint can be claimed before all prior checkpoints are accepted.

---

## 4. Binary Eligibility Gates

Before ANY score is computed for a work item, it must pass ALL of the following binary gates. A single gate failure → zero reward for that item, regardless of effort or partial quality. **Binary gates override points: a gate failure zeros the item even if the quality multiplier would be high.**

### Gate G1: Provenance
- Every factual claim carries an explicit source citation (log timestamp+pid, file:line, command output, URL+date) or is labeled INFERENCE/UNVERIFIED.
- Synthetic fixtures are labeled SYNTHETIC. They are never cited as provider evidence.
- No claim uses a third-party blog post or community forum as OFFICIAL_DOC-tier evidence.

### Gate G2: Evidence Hierarchy Compliance
The evidence precedence from the canonical build is binding:

For product intent: (1) Canonical product specification → (2) Canonical implementation plan → (3) Explicit user decision → (4) Everything else.

For external provider behavior: (1) Current real API observation (REAL_API) → (2) Current official provider documentation (OFFICIAL_DOC) → (3) Observed behavior of the exact versioned official SDK → (4) Sanitized historical fixture → (5) Synthetic fixture (SYNTHETIC_FIXTURE).

A claim backed only by tier-5 evidence that contradicts tier-1 or tier-2 evidence is rejected. Distinguish OFFICIAL_DOC (published reference docs with URL+date) from REAL_API (observed API response from a live call).

### Gate G3: No Test Weakening
- No test assertion has been lowered, broadened, or made conditional to accommodate an implementation weakness.
- No test threshold has been relaxed from the canonical spec's requirements.
- No "known limitation" has been documented to excuse a failing test.
- If a test reveals a fundamental limitation of the approach, the approach must change — not the test.

### Gate G4: No Mock-as-Real Credit
- A test passing against a mock, fake, or synthetic fixture is credited as SYNTHETIC_FIXTURE evidence, never as REAL_API or OFFICIAL_DOC evidence.
- A Compose service health check is credited as INFRASTRUCTURE-PASS, not as FUNCTIONAL-PASS.
- No builder may claim a checkpoint sub-gate as met based solely on authored-but-unexecuted artifacts.

### Gate G5: Execution Proof
- Every claimed behavior must have a reproducible execution trace: command + output + exit code, or test name + pass/fail result.
- Authored-but-unexecuted code is not evidence of behavior. It is evidence of authorship only.
- "Spike code written" ≠ "spike proves runtime works."

### Gate G6: No Speculative Evidence
- No decision is recorded as resolved based on inferred, interpolated, or hypothesized provider behavior.
- If official documentation is silent on a field (e.g., `expires_in`), the decision remains UNRESOLVED until REAL_API or OFFICIAL_DOC evidence resolves it.
- Invented values (e.g., "55-minute TTL") are rejected regardless of their plausibility.

### Gate G7: Integration Proof
- Code that compiles in isolation but has never been integrated (imported, called, tested in combination with its dependencies) is not credited as integrated.
- Checkpoint gates require end-to-end behavior proof, not unit-in-isolation proof.

---

## 5. Reward Formula

### 5.1 Per-Item Base Score

Each work item (a task or sub-task from the implementation plan) has a base score computed as:

```
base_score = task_weight × quality_multiplier
```

Where:
- `task_weight` is assigned by the moderator at item creation, proportional to the task's complexity and integration surface (see §6 Task-Size Normalization).
- `quality_multiplier` is in [0.0, 1.0], determined by the moderator after verifier report.

### 5.2 Quality Multiplier Components

| Component | Weight | Criterion |
|---|---|---|
| Correctness | 0.40 | Does the work produce the specified behavior? Verified by independent reproduction. |
| Completeness | 0.25 | Are all sub-behaviors from the implementation plan checklist covered? No gaps left for the next agent to discover. |
| Robustness | 0.20 | Are failure paths, edge cases, and illegal transitions tested — not just happy paths? |
| Evidence quality | 0.15 | Are claims cited, traces attached, and synthetic vs. real clearly labeled? |

```
quality_multiplier = (0.40 × correctness) + (0.25 × completeness) + (0.20 × robustness) + (0.15 × evidence_quality)
```

Each component is scored by the moderator on [0.0, 1.0].

### 5.3 Checkpoint Completion Bonus

When a full checkpoint gate passes (ALL sub-gates green, ALL prerequisite checkpoints already accepted):

```
checkpoint_bonus = Σ(item_base_scores in checkpoint) × 0.20
```

The bonus is distributed proportionally to the base_score of each contributing item. This rewards integrated work over isolated fragments.

### 5.4 Verification Reward

Verifiers earn a separate score:

```
verifier_score = verification_weight × verification_quality
```

Where:
- `verification_weight` is proportional to the item being verified (typically 0.15 × task_weight).
- `verification_quality` is in [0.0, 1.0], scored by the moderator on: independence of reproduction, quality of counterexamples found, correctness of the verification verdict.

### 5.5 What Does NOT Earn Score

| Non-rewarded activity | Reason |
|---|---|
| Lines of code written | Volume ≠ value |
| Number of tests written | Count ≠ coverage of specified behaviors |
| Number of files created | Scaffolding ≠ working software |
| Authored-but-unexecuted artifacts | Authorship ≠ proof of behavior (Gate G5) |
| Self-reported completion status | Claims are verified, not trusted |
| Passing tests against mocks only (when real-infra tests are required) | Gate G4 |

---

## 6. Task-Size Normalization

To prevent incentive distortion from task granularity (many small tasks vs. few large ones), the moderator assigns task_weight using a complexity rubric:

| Factor | Low (1) | Medium (2) | High (3) |
|---|---|---|---|
| Integration surface | Pure function, no deps | 1-2 infrastructure deps | 3+ deps, cross-cutting |
| State complexity | Stateless or single state | 2-3 states | State machine with 5+ transitions |
| Concurrency | Sequential | Single contention point | Multi-actor, distributed coordination |
| Failure modes | Input validation only | 2-3 failure branches | Ambiguous states, crash recovery |

```
task_weight = Σ(factor scores) / 12   # normalized to [0.33, 1.0]
```

The moderator may override with justification.

---

## 7. Acceptance Contract and Immutability

### 7.1 Acceptance Contract

Each work item's acceptance condition is defined BEFORE work begins, by the moderator, as a structured contract:

```json
{
  "item_id": "CP1-T1.3",
  "title": "Canonicalization",
  "acceptance": [
    "deno task test -- tests/unit/canonical_test.ts passes",
    "Property: hash(canonical(x)) == hash(canonical(parse(serialize(x)))) for 10000 random inputs",
    "Two semantically equal objects → same hash (5 test vectors)",
    "Different objects → different hash (5 test vectors)",
    "URI normalization is stable (idempotent, tested with property)"
  ],
  "checkpoint": "CP-1",
  "task_weight": 0.58,
  "contract_hash": "<SHA-256 of the above fields, computed by moderator>"
}
```

### 7.2 Immutability

- Once a contract is issued, its `contract_hash` is recorded in the reward audit ledger (NOT in evidence-index.md — see §11).
- Any modification to the acceptance conditions requires a new contract with a new hash and an explicit moderator justification entry.
- A builder cannot modify, weaken, or reinterpret acceptance conditions.
- The moderator's `contract_hash` is the canonical reference. If the builder's claimed acceptance does not match the hash, the claim is rejected.

---

## 8. Adversarial and Mutation Testing

### 8.1 Moderator-Owned Adversarial Tests

Where practical, the moderator maintains a HIDDEN test bank:
- Tests that exercise the same behaviors as the acceptance contract but with different inputs, edge cases, or orderings.
- The builder never sees these tests before submission.
- At acceptance evaluation, the moderator runs the hidden tests. If they fail while the builder's tests pass, it is evidence of test overfitting.

**Practical constraint:** Hidden test banks are feasible for pure cells (Layer 1) and deterministic tissues. They are less practical for integration tests requiring specific infrastructure state. The moderator documents which items have hidden coverage and which do not.

### 8.2 Mutation Testing Requirements

For pure cells (Layer 1), mutation testing is required by canonical Checkpoint 1:
- The mutation tool (StrykerJS or equivalent) must be executed, not just configured.
- A mutation score below the canonical threshold, or an unavailable/unexecuted required mutation result, is a **binary gate failure**: the checkpoint remains NO-GO. This cannot be converted into a quality_multiplier reduction or deferred to moderator discretion — the canonical implementation plan requires "Mutation testing on cells: foundational assertions detect behavioral changes" as a hard gate.
- If the canonical checkpoint requirement is explicitly changed by the user (the spec owner), the gate changes accordingly. The moderator cannot unilaterally waive it.
- If mutation tooling cannot run due to a tooling blocker (e.g., StrykerJS Deno incompatibility), the checkpoint remains NO-GO until either (a) the tooling blocker is resolved, or (b) the user explicitly changes the canonical requirement.

### 8.3 Negative and Boundary Tests

Every state machine must have:
- Every LEGAL transition tested
- Every ILLEGAL transition tested (must throw)
- Precondition failures (wrong owner, wrong version) tested

Every input-validated function must have:
- Valid input → correct output
- Missing required field → specific error
- Unknown field → stripped or rejected (per policy)
- Oversized input → rejected
- Malformed input → specific error, not a crash

---

## 9. Disqualification Conditions

A work item is disqualified — zero reward — if any of the following are detected. No subjective credibility multiplier is applied; instead, invalid evidence gets zero for the affected item and triggers enhanced verification on subsequent items from the same agent.

| Condition | Scope | Consequence |
|---|---|---|
| Builder verified its own work (identity overlap) | Item | Zero reward; item must be re-verified by a different verifier |
| Test assertions were weakened to pass | Item + all items in same checkpoint | Zero reward for all affected items; checkpoint re-evaluation required |
| Synthetic fixture cited as REAL_API or OFFICIAL_DOC evidence | Item | Zero reward; evidence record corrected |
| `contract_hash` tampered or acceptance condition reinterpreted | Item | Zero reward; moderator re-issues contract |
| Invented evidence (e.g., fabricated TTL values, imagined API fields) | Item | Zero reward; enhanced verification on agent's next 3 items |
| Execution trace fabricated (claiming a command ran when it did not) | Agent | Agent disqualified from build; all prior items from that agent re-verified |
| Checkpoint claimed before prior checkpoint accepted | Claim | Claim rejected, no penalty if honest mistake |
| Code committed before required validation sequence | Commit | Commit does not count as checkpoint evidence |

**Enhanced verification** means the moderator requires verifier reproduction PLUS hidden adversarial tests PLUS moderator spot-check before provisional acceptance. It is not a subjective score penalty — it is a process escalation.

---

## 10. Finalization

No reward is finalized at claim time. Finalization is event-based, not time-boxed.

### 10.1 Finalization Sequence

1. **Builder claims `done`** with artifacts and evidence pointers.
2. **Verifier independently reproduces** the claimed behaviors (fresh clone, documented commands, READ-ONLY access — see §14).
3. **Moderator evaluates** acceptance contract, verifier report, hidden adversarial tests (if available), and gate compliance.
4. **Provisional acceptance** if all gates pass and verifier confirms.
5. **Finalization** occurs when: (a) independent clean-room verification is complete, AND (b) the checkpoint integration/regression pass succeeds for the checkpoint containing the item.
6. **Revocation:** Later counter-evidence (from any agent, human, or automated regression) can revoke a finalized item. The moderator re-evaluates, and if the counter-evidence stands, the item is disqualified retroactively.

### 10.2 Checkpoint Finalization

Individual items may be provisionally accepted, but `checkpoint_bonus` is not finalized until ALL items in the checkpoint pass AND the checkpoint itself passes as a whole (integrated regression).

---

## 11. Audit Records

**Reward audit records are kept SEPARATE from provider evidence records.** Provider/technical evidence belongs in `docs/evidence-index.md`. Reward scoring events belong in `docs/agent-reward-ledger.jsonl` (append-only, one JSON object per line).

### Reward Ledger Schema (`docs/agent-reward-ledger.jsonl`)

Each line is a JSON object with one of these `type` values:

```jsonc
// Contract issued
{"type":"contract","item_id":"CP0-T0.0","title":"SDK and Runtime Compatibility Spike","checkpoint":"CP-0","acceptance":["..."],"task_weight":0.67,"contract_hash":"<SHA-256>","issued_by":"<moderator session>","timestamp":"2026-10-09T06:00:00Z"}

// Builder claim
{"type":"claim","item_id":"CP0-T0.0","claimed_by":"<builder session>","status":"done","artifacts":{"spike_result":"<independently verified result>"},"timestamp":"2026-10-09T06:00:00Z"}

// Verifier report
{"type":"verification","item_id":"CP0-T0.0","verified_by":"<verifier session>","reproduction_result":"pass","counterexamples":[],"timestamp":"2026-10-09T06:00:00Z"}

// Moderator verdict
{"type":"verdict","item_id":"CP0-T0.0","verdict":"provisionally_accepted","quality_multiplier":0.85,"gate_compliance":{"G1":true,"G2":true,"G3":true,"G4":true,"G5":true,"G6":true,"G7":true},"moderator_notes":"","timestamp":"2026-10-09T06:00:00Z"}

// Finalization
{"type":"finalized","item_id":"CP0-T0.0","base_score":0.5695,"timestamp":"2026-10-09T06:00:00Z"}

// Revocation (if counter-evidence)
{"type":"revoked","item_id":"CP0-T0.0","reason":"...","counter_evidence":"...","timestamp":"2026-10-09T06:00:00Z"}

// Checkpoint gate
{"type":"checkpoint","checkpoint_id":"CP-0","verdict":"NO-GO","open_gates":["real_api_verification","docker_compose","gitleaks"],"timestamp":"2026-10-09T06:00:00Z"}
```

---

## 12. Reproducibility Requirements

### 12.1 Builder Reproducibility

Every claimed behavior must be reproducible by:
1. Access to the repository at the claimed state (commit, or uncommitted snapshot for pre-commit Stage 0 work)
2. Documented setup commands (from README or PROGRESS.md)
3. Documented test commands
4. Deterministic outcome (same pass/fail, same output shape)

If the behavior depends on non-deterministic factors (timing, network), the builder must document the flakiness window and provide a deterministic alternative (mock, injectable clock).

**Pre-commit work (Stage 0):** Before a validated commit exists, verification uses the working-tree state. The verifier may use a read-only worktree copy or an uncommitted snapshot provided by the moderator. Fresh-clone verification applies only after a validated commit exists.

### 12.2 Verifier Reproducibility

The verifier reproduces from scratch:
1. Clone the repo at the builder's claimed commit (or use a read-only worktree/snapshot for pre-commit work)
2. Follow ONLY the documented setup steps
3. Run ONLY the documented test commands
4. Report: which commands succeeded, which failed, which produced different output

The verifier does NOT read the builder's transcript. The verifier reproduces from artifacts only.

---

## 13. Residual Risks

This protocol reduces but cannot eliminate gaming. Known residual risks:

| Risk | Mitigation | Residual |
|---|---|---|
| Builder and verifier collude | Identity separation enforced by moderator; hidden adversarial tests | Collusion between separate agent sessions is possible if both are controlled by the same operator |
| Moderator error (accepts weak work) | Event-based finalization + revocation | Moderator is human and can make mistakes |
| Hidden test bank is insufficient | Moderator expands bank over time; mutation testing supplements | No hidden bank covers all behaviors |
| Agent overfits to visible acceptance criteria | Hidden tests + property-based testing + mutation testing | Some overfitting is always possible |
| Execution traces can be fabricated | Verifier independent reproduction; moderator spot-checks | A determined attacker can fabricate both |
| Task_weight assignments are subjective | Rubric in §6; moderator justifies overrides | Subjectivity remains |
| Late/stale writes conflict | Concurrency controls in §14 | Single-writer enforcement depends on moderator discipline |

**Honest assessment:** Absolute hack-proofing is impossible. This protocol makes gaming costlier than genuine work by requiring independent reproduction, hidden adversarial tests, event-based finalization with revocation, and disqualification with enhanced verification. A sufficiently motivated attacker with control of all agent sessions could still game it — but would expend more effort than doing the real work.

---

## 14. Concurrency and Write Safety

### 14.1 Single-Writer Rule

Only one agent session writes to the repository checkout at a time. Concurrent builder writes to the same checkout produce undefined merge results and invalidate evidence integrity.

**Enforcement options (moderator chooses one):**
- **Serialized dispatch:** Moderator dispatches one builder at a time per checkout. Next builder starts only after previous builder's claim is recorded.
- **Isolated worktrees:** Each builder gets its own `git worktree`. Integration happens via merge at checkpoint time.

### 14.2 Verifier Read-Only Access

Verifiers MUST have read-only access to the checkout. A verifier that modifies files, runs `git checkout`, or writes to the working tree invalidates its own verification. Verifier reproduction uses a fresh clone or a separate read-only worktree.

### 14.3 Stale Agent Writes

If an agent writes to a file that has been modified by another agent since the first agent's last read:
- The later write is the one on disk (last-writer-wins at the filesystem level).
- The moderator detects the conflict by comparing file modification timestamps against the dispatch log.
- The overwritten agent's work must be re-verified against the current file state.

### 14.4 Evidence Files

This protocol's evidence and progress files (`PROGRESS.md`, `DECISIONS.md`, `docs/evidence-index.md`, `docs/notion-endpoints.md`, `docs/agent-reward-protocol.md`, `docs/agent-reward-ledger.jsonl`) have a designated sole writer per reconciliation pass. The moderator assigns the writer explicitly. Concurrent writes to these files are a protocol violation.

---

## 15. Protocol Activation

This protocol is INACTIVE until:
1. The moderator ratifies it (signs the document hash).
2. The moderator issues the first acceptance contracts for CP-0 items.
3. All agents acknowledge the protocol (recorded in reward ledger).

No score, reward, or penalty applies retroactively to work done before activation.

---

## Appendix A: Evidence Consulted for This Document

| Document | Path / URL | Purpose |
|---|---|---|
| Product specification | `/Users/dinakarmeruga/.kiro/crew/workspace/notion-mcp-product-spec-v3.md` | Canonical spec — invariants, SLOs, architecture |
| Implementation plan | `/Users/dinakarmeruga/.kiro/crew/workspace/notion-mcp-implementation-plan.md` | Canonical checkpoint structure, task definitions, gate checklists |
| Oversight record | `/Users/dinakarmeruga/.kiro/crew/workspace/notion-mcp-oversight.md` | Current NO-GO verdict, open findings |
| MCP 2026-07-28 spec | [modelcontextprotocol.io/specification/2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) | Published protocol specification |
| Notion API reference | [developers.notion.com/reference](https://developers.notion.com/reference) | OAuth, webhooks, data sources |
| Deno runtime | `deno 2.9.7` at `/Users/dinakarmeruga/.deno/bin/deno` | Confirmed installed |
| MCP TypeScript SDK | [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | SDK version and capability inspection |
| Repository state | Commit `646e1c3` + working-tree modifications | Git log, status |
