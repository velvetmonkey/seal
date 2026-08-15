> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.
> The authorization rule is PROVED. The state machine is TESTED.
> For the truth about what you installed, read [docs/RELEASE-NOTES-v0.1.1.md](RELEASE-NOTES-v0.1.1.md) and the [README](../README.md).

# Seal claims matrix

One table: every load-bearing claim, marked **Proven** (a machine-checked Lean 4 theorem),
**Tested** (a named, rerunnable CI gate or test), **Assumed** (trusted computing base — declared,
not proved), or **Not claimed** (things Seal deliberately does not say).

This matrix is an **index, not a new claim surface**. The canonical claim text lives in the
drift-guarded blocks ([docs/LIMITATIONS.md](LIMITATIONS.md), [docs/TRUTH-BOX.md](TRUTH-BOX.md) —
`scripts/claims-drift.mjs` enforces verbatim mirrors); theorem-to-file detail lives in
`seal-host/docs/PROOF-REFERENCE.md` and `seal-assurance-kit/CLAIMS.md`. If this table and those
ever disagree, they win.

Proven rows are axiom-gated in their home repo **where the cited theorem is named in that
repo's pin sources** (seal-host: `lake exe axiom_check` over the `Test/Axioms.lean`
import-and-pin closure; mcp-seal-dev: `Test/Axioms.lean` + `Test/AxiomAllowlist.lean` +
the `Test/ModuleAxiomScan.lean` gate, which scans exactly the modules assigned in its
`kernelBaselineModuleNames` list — an explicit list, not the whole build, so check the list at
the rev you are auditing rather than trusting any frozen count; crdt-lean: `Test/Axioms.lean` `#guard_msgs`
pins, a default target). That coverage is not total. Named exceptions, checked against the
pin sources on 2026-08-06: `guarded_allow_iff_live` and `approval_not_transferable_across_targets`
(both `SealCore/Safety.lean`) appear in no mcp-seal-dev pin, and `SealCore.Safety` is not one
of the module gate's assigned modules (`SealCore.Safety` does not appear in
`kernelBaselineModuleNames`) — those two theorems compile in the build but their
axiom footprints are not CI-pinned. Adding them to the pins is a gate change reserved for the
maintainer.
Each pinned theorem uses **at most** the minimal classical fragment
`{propext, Classical.choice, Quot.sound}` — no `sorry`, no `native_decide` — and some use less
(seal-host's record-chain theorems are axiom-free; several crdt-lean merge lemmas use `propext`
only). The footprints are not one uniform set, and the gate is not repository-wide: seal-host
measures 51 of 53 theorem-bearing modules inside its closure; the two outside it are named in
seal-host/CLAIMS.md ("Proof build-wire scope").

| Claim | Status | Checked by | Home |
|---|---|---|---|
| An unguarded or unapproved action is never allowed (default deny). | **Proven** | `default_deny_never_allowed` (SealCore/Safety.lean) | mcp-seal-dev |
| The safety kernel allows a guarded target **iff** its state contains a matching live approval record for that exact target. | **Proven** | `guarded_allow_iff_live`, `approval_binds_to_target` | mcp-seal-dev |
| An approval for one target never authorizes another (confused deputy blocked). | **Proven** | `approval_binds_to_target`, `approval_not_transferable_across_targets` (SealCore/Safety.lean) | mcp-seal-dev |
| Approvals are single-use and expire. | **Proven** | `consumed_approval_not_live`, `expired_not_live` | mcp-seal-dev |
| The canonical request grammar is total to parse and roundtrip-stable, with exactly one byte representation per Unicode string. | **Proven** | `parse_total`, `canonical_roundtrip`, `escapeString_injective` | mcp-seal-dev (SealV2) |
| Kernel decisions cannot be bypassed inside the model: every Allow carries a validity witness. | **Proven** | `non_bypass`, `decide_emit_unique` | mcp-seal-dev |
| Host model properties: the gate reveals only the one authorized bit (non-interference), no double-spend of approvals, replay isolation — at the model level. | **Proven** | `seal-host` Host/ + Kernels/ theorem sets (see PROOF-REFERENCE.md) | seal-host |
| **Distributed, necessity:** no coordination-free protocol can stop two disconnected replicas both consuming the same authority without a causal handoff (the authority frontier) — over an abstract `AuthoritySystem D`. | **Proven** | `authority_frontier_card_le_one`, `no_disconnected_double_availability` (Crdt/AuthorityFrontier.lean) | crdt-lean |
| **Distributed, sufficiency:** the sealed-handoff pattern (each sender seals its own consume in its causal past before enabling the next) yields ≤ 1 consume per valid cut. Proven in a finite `CutWorld` model, **not** lifted to the abstract system; the sealed handoff is **not** claimed to be the unique safe shape (causal consume-sequencing is a checked third shape). | **Proven** (finite CutWorld model) | `sealed_handoff_safe`; third-shape witnesses `wSeq_safe`, `wSeq_not_sealed_handoff` (Crdt/AuthorityFrontier.lean) | crdt-lean |
| **Distributed → gate, bridge:** the coordination-free no-double-spend necessity transfers onto the SealV2 gate model as a **TTL-scoped applicability instance** (within TTL, per concurrent replica) — an instance mapping, not a refinement of the full validate-and-consume path. | **Proven** (instance, TTL-scoped) | `Host.AuthorityFrontierBridge.sealv2_frontier_card_le_one`, `sealv2_no_disconnected_double_availability` (PROOF-REFERENCE.md) | seal-host |
| **Deployment-shape safety — shared replay-store:** common `ApprovalState` ("shared DB") across replicas provably *cannot* carry the seal (`sealv2_shared_not_sealed_senders`): at empty init every replica is live; the store's only blocker is a receipt hit. Validation (not store) is the deployed "sealed" carrier. | **Proven** | `sealv2_shared_not_sealed_senders` (Host/AuthorityFrontierBridge.lean, PROOF-REFERENCE.md) | seal-host |
| **Deployment-shape safety — single-delivery (partitioned):** per-replica `ApprovalState` + delivery to exactly one validating replica (`d₀` validates, others sealed by `validate = none`) yields `Safe` with no `hsafe` operational assumption (`sealv2_partitioned_safe` via crdt-lean). | **Proven** | `sealv2_partitioned_safe` (Host/AuthorityFrontierBridge.lean, PROOF-REFERENCE.md) | seal-host |
| **Deployment-shape safety — mesh-coordinated (over shared store):** shared replay-store + a coordination layer (token/lease/sealed-handoff CRDT from crdt-lean) that designates the single consumer is Safe by composition (`sealv2_mesh_safe`, with concrete `TokenMesh` witness `mesh_holder_live_at_init`). The store contributes the real consume seam; the mesh contributes the seal. | **Proven** (by composition, model-level) | `sealv2_mesh_safe` + witnesses (Host/AuthorityFrontierBridge.lean §Composition, PROOF-REFERENCE.md) | seal-host |
| **Minimal receipt/replay interface:** `replayView` (publicKey, session, policyVersion, now) + per-request `consumeView` is the *exact-minimal* declassification for stateful non-interference over the durable replay seam (sufficient for capstone `stateful_noninterference_trace`; every field per-field necessary by counterexamples). | **Proven** | `replayView` + `stateful_noninterference_trace` + necessity (Host/StatefulNI.lean, PROOF-REFERENCE.md) | seal-host |
| The deployed bodies (Rust host, browser wasm, JS checker) match the proven kernel **byte-for-byte over the conformance corpus**. | **Tested** | conformance bridge (model == native == wasm), CI transcripts in seal-host/docs | seal-host |
| Decision receipts (schema v2) validate, derived hashes recompute, the verdict re-derives identically, and emitted decision bytes are byte-identical. | **Tested** | `seal verify` check list + `npm test` frozen vectors | seal-assurance-kit |
| A tampered receipt fails verification; a bypass receipt is never reported as verified. | **Tested** | seal-check tamper suite (`test/receipt-verify.test.cjs`), kit bypass expect-fail gate | seal-check / seal-assurance-kit |
| Nonce replay across host **restart** is rejected (durable replay store, production signed-token channel). | **Tested** | `sqlite_replay_survives_restart` (seal-host Rust tests) | seal-host |
| The live demo's evidence is real: the blocked destructive request and the bypass-executed one are **byte-identical** (`canonical_request_sha256` equal), and all phase receipts are v2. | **Tested** | `scripts/assert.mjs` (17 invariants, +1 when the optional obfuscation gauntlet ran; gates the docker run) | seal-live-demo |
| The approval field set carries enough information to identify the exact effect it authorizes (receipt-field **sufficiency**). The pre-v2 field set **failed** this check — a concrete collision: two different effects indistinguishable through the committed fields — and v2's `args_hash` is the field that closes it. A collision indicts the field set, not one implementation; no implementation reading insufficient fields can fix it. | **Tested** (finite refinement analysis) | `seal adequacy` (anchored on `witness_computable_iff_refines` / `witness_separation_fails`); `witness-check`, the private sufficiency analyzer | seal-assurance-kit / witness-check |
| Differences between two receipts are detected and classified against the authorization surface (integrity-checked against each receipt's own hashes before diffing; a pre-v2 → v2 pair is called out as the approval surface widening). | **Tested** | `seal receipt-diff` test suite (11 cases in the kit's npm chain) | seal-assurance-kit |
| The `seal verify` closure runs in CI, vendored into the GitHub Action as a maintained **downstream-stricter fork** of the kit verifier: pinned to a base kit revision with five named fork-delta files (the action requires a valid `signed_config` for an authorised outcome; kit HEAD's verifier is trust-rootless), kernel wasm byte-identical to the kit's, every vendored file sha256-checked in CI against `VENDORED.md`, exercised by a fixture selftest workflow. | **Tested** | seal-verify-action ci + selftest workflows | seal-verify-action |
| SHA-256 collision resistance. | **Assumed** (named, scoped: A-CR) | docs/LIMITATIONS.md, TCB docs | family-wide |
| Rust glue, wasm/JS mirror bodies, Lean toolchain, OS, Ed25519 provider, human operators. | **Assumed** (TCB) | seal-host/docs/TCB.md, SEAL-SYSTEM-TCB.md | seal-host |
| MCP is the sole effect channel; an unconfined shell bypasses the gate by design scope. | **Assumed** | EVALUATOR-START.md §7 | umbrella |
| Approval origin (that the signing human is who you think): the proof guarantees ordering; the out-of-band channel guarantees origin. | **Assumed** | EVALUATOR-START.md §7 | umbrella |
| Intent match. Seal proves **authorization** match: if a human approves a malicious-but-valid request, Seal executes it. | **Not claimed** | docs/LIMITATIONS.md | — |
| Whole-system correctness. The theorems are kernel claims, connected to deployments by finite conformance evidence, not end-to-end proof. | **Not claimed** | docs/LIMITATIONS.md, TRUTH-BOX | — |
| Tamper-**impossibility**. The audit chain is tamper-evident only. | **Not claimed** | docs/LIMITATIONS.md | — |
| Universal conformance. The corpus is finite evidence, not a theorem over all inputs. | **Not claimed** | EVALUATOR-START.md §6 | — |
| Making the AI smarter, preventing hallucinations, or surviving compromised hosts/keys/operators. | **Not claimed** | docs/LIMITATIONS.md | — |

Read next: [What Seal is NOT](https://github.com/velvetmonkey/seal-assurance-kit/blob/main/docs/WHAT-SEAL-IS-NOT.md)
(the buyer-legible honesty boundary) and [EVALUATOR-START.md](../EVALUATOR-START.md) (the
proved-vs-deployed map). The Seal fleet links are public and resolve for everyone; `witness-check` remains proprietary.
