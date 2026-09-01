> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.
> The state machine is TESTED.
> For the truth about what you installed, read [docs/assurance/RELEASE-NOTES-v0.2.1.md](../assurance/RELEASE-NOTES-v0.2.1.md) and the [README](../../README.md).

# Why a proof, not a prompt: Seal vs heuristic guards

**Lean proof source:** [`seal-host`'s proof reference](https://github.com/velvetmonkey/seal-host/blob/main/docs/PROOF-REFERENCE.md) is the reader-facing index for the Lean proof properties stated here.

LLM judges and prompt filters for agent tools work by judgment: a model or prompt-level
heuristic classifies the request. Judgment is probabilistic — on the novel attack it has
never seen, it guesses. And when one of these heuristic guards guesses wrong it can fail
**open**: the action goes through, and usually nothing is left behind to show that a
guess was even made.

Seal's kernel does not judge. It asks one checkable question — *does a live approval
record match this exact target?* — and the rule that an unapproved action is never
allowed is a machine-checked Lean 4 theorem (`default_deny_never_allowed`). Novelty
does not move it: an attack the kernel has never seen has no matching approval, so it
fails **closed**. Every decision, allow or block, leaves a tamper-evident receipt that
anyone can re-derive.

| | LLM judge or prompt filter | Seal |
|---|---|---|
| **Decision basis** | Model judgment / patterns | Machine-checked exact-target approval match |
| **Failure direction** | Can fail open on a novel attack | Default-deny: fails closed (`default_deny_never_allowed`) |
| **Evidence left behind** | Logs, if any | Tamper-evident receipt, re-derivable by anyone |

**The fleet-scale headliner (new since last pass, axiom-pinned):** the obvious developer design — "put approvals in a shared DB and dedupe on replay" — is *provably unable* to stop cross-replica double-spend of a one-shot approval. Seal proves the lower bound (`sealv2_shared_not_sealed_senders` in Host/AuthorityFrontierBridge.lean): over a shared replay-store, two replicas can both honour the same approval. It also proves the shapes that *do* work:

- Single-delivery: deliver each approval to exactly one replica (`sealv2_partitioned_safe`).
- Mesh-coordinated over shared store: sealv2_mesh_safe (Safe by composition given the mesh's SealedSenders); concrete outright-Safe witness sealv2_token_mesh_safe, holder-live via mesh_holder_live_at_init.

**Honest boundary for these results:** these are proofs about a model tightly bound to the real SealV2 consume seam (`validateAndConsumeWithStore`), within the approval's TTL, for one approval per instance, hypothesis-form validation. Not a line-by-line proof of the whole deployed Rust/wasm/JS binary or end-to-end system. The shipped bodies are tied by conformance testing over a corpus.

See the four explicit Trust boundaries (Byzantine / non-participating replica, Egress after allow (P6), Model vs compiled binary, Partition liveness) with their "Closes via" mechanisms in [docs/archive/LIMITATIONS.md#trust-boundaries](../archive/LIMITATIONS.md).

What this does **not** mean — the boundary, stated up front: the theorems cover the
mediation kernel, not the whole deployed system. The shipped Rust/wasm/JS bodies are
tied to the proof by byte-exact conformance testing over a corpus, not proven bug-free,
and the runtime profile is `compatible` (strict `canonical-l0` is proved, not yet the
deployed route). Seal guarantees **authorization** match, not **intent** match: approve a
malicious-but-valid request and Seal executes it.

- The full honesty boundary: [What Seal is NOT](https://github.com/velvetmonkey/seal-assurance-kit/blob/main/docs/WHAT-SEAL-IS-NOT.md)
- Every load-bearing claim, statused: [CLAIMS-MATRIX.md](../archive/CLAIMS-MATRIX.md)
- See the difference run: [seal-live-demo](https://github.com/velvetmonkey/seal-live-demo) — the same destructive call, blocked with Seal on, executed with Seal bypassed
