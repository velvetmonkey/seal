> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.
> The authorization rule is PROVED. The state machine is TESTED.
> For the truth about what you installed, read [docs/RELEASE-NOTES-v0.2.0-rc.3.md](RELEASE-NOTES-v0.2.0-rc.3.md) and the [README](../README.md).

# The Authorization Mesh: verified coordination-free single-use

Seal is a machine-checked authorization gate for AI agents. This is the **mesh layer**: when you run a fleet of seal gates over shared approvals, four machine-checked theorems establish that a one-shot approval stays single-use across a network partition, and that guarantee applies to the real gate.

## The one claim

**A one-use approval handed to a fleet of agents provably cannot be double-spent across a network partition without coordination, and the impossibility applies to seal's actual gate, honestly scoped to within the approval's TTL.**

## The four bricks

| # | Brick | What it proves | Theorem |
|---|---|---|---|
| 1 | **Receipt non-interference** | The audit log is not a covert channel: it reveals nothing about internal policy or other tenants beyond the one authorized bit, single request and across a session. | `observe_noninterference`, `stateful_noninterference_trace` |
| 2 | **Authority-frontier necessity** | Over freely-replicable state, staying single-use *forces* at most one node able to consume at any consistent cut. Drop coordination and there is a witnessed double-spend. | `authority_frontier_card_le_one`, `double_consume_countermodel` |
| 3 | **Sealed-handoff sufficiency** | The handoff pattern that keeps a fleet safe (seal your own consume before enabling the next node). A third safe shape (consume-sequencing) was found and recorded. | `sealed_handoff_safe`, `wSeq_safe` |
| 4 | **Applicability bridge** | The abstract impossibility, applied to SealV2's *real* nonce model (`validateAndConsumeWithStore`, the deployed FFI store). The whiteboard theorem now speaks about a Lean model of the deployed gate's real consume seam. | `sealv2_frontier_card_le_one`, `sealv2_no_disconnected_double_availability` |

All four carry the axiom footprint `{propext, Classical.choice, Quot.sound}`, zero `sorry`, no `native_decide`, compile-time pinned.

## The honest boundaries (this is the whole point)

- **Single-use is *within the approval's TTL window*, per concurrent replica** — not "single-use for all time." SealV2 approvals expire and the store prunes; receipts count domains, not time. The transferred claim inherits this scope, stated, never rounded up.
- **Necessity is general; sufficiency is in-model.** The impossibility is proven for the abstract system; the sufficiency pattern is proven in a finite probe model, not yet lifted to the abstract system.
- **Rejoin records, it does not repair.** The consumed-nonce store merges monotonically (grow-only union), so partitions rejoin to a consistent record, but a double-spend that happened during a partition cannot be un-spent. The guarantee is conserved *during* the split (via the handoff or a gap), not recovered after it. Coordination is required at handoff time and free at rejoin time.
- **Model-level.** These are theorems about the Lean model of the gate, tied to the deployed Rust/TS bodies by byte-exact conformance testing over a corpus, not end-to-end proof.
- **No novelty beyond invariant-confluence / escrow-CRDT.** The necessity is a machine-checked, named corollary of known distributed-systems theory. Not Byzantine, not crash-recovery, not cryptographic.

## The line a competitor cannot say

*A machine-checked boundary on exactly where a distributed approval fabric must coordinate to stay single-use, transferred to the real gate, with a witnessed counterexample for what happens when it does not, and every limit stated out loud.*

## Where it lives

- Abstract theorems + product doc: [crdt-lean](https://github.com/velvetmonkey/crdt-lean) (`Crdt/AuthorityFrontier.lean`, `docs/AUTHORITY-FRONTIER.md`).
- Receipt non-interference + the applicability bridge: [seal-host](https://github.com/velvetmonkey/seal-host) (`Host/StatefulNI.lean`, `Host/AuthorityFrontierBridge.lean`).
- Theorem-to-file index: `seal-host/docs/PROOF-REFERENCE.md`. Claims index: `docs/CLAIMS-MATRIX.md`.
