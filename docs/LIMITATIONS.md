> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.
> The authorization rule is PROVED. The state machine is TESTED.
> For the truth about what you installed, read [docs/RELEASE-NOTES-v1.1.md](RELEASE-NOTES-v1.1.md) and the [README](../README.md).

# Limitations

This is the canonical claims block. index.html mirrors it
verbatim between the same markers; `scripts/claims-drift.mjs` enforces
equality for those two files, so edit here first, then mirror.

<!-- claims:begin -->
- Seal proves properties of the mediation KERNEL, not of the whole deployed system.
- Seal does NOT prove SHA-256 collision resistance in Lean; it is a named, scoped cryptographic assumption (A-CR).
- The deployed Rust / wasm / JS are NOT proven bug-free; they are tied to the proof by byte-exact conformance testing over a corpus, not for every possible input.
- Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal will execute it.
- Seal does NOT prevent compromise of hosts, browsers, build systems, keys, operators, or downstream tools.
- Seal's audit chain is tamper-EVIDENT, not tamper-IMPOSSIBLE.
- Seal does NOT make the AI smarter or prevent hallucinations; it stops an unapproved effect.
- Axiom footprint {propext, Classical.choice, Quot.sound} is the minimal classical fragment; no extra axioms.
- The axiom-footprint line is a per-theorem ceiling for theorems named in the family's axiom-pin gates; it is not a repository-wide census. Pin scope and named exceptions are indexed in the seal claims matrix (seal/docs/CLAIMS-MATRIX.md).
<!-- claims:end -->

## Trust boundaries

The Node product's kernel config is signed by an Ed25519 key generated inside
the same worker that supplies the config. The rejected `demo-pk` stub is not on
the decision path, but the replacement is still demo-grade self-authorization,
not an operator-pinned or externally trusted production config key.

These are the four explicit places where Seal's proofs stop. They are strengths because the boundaries are known and each has a named closure path outside the kernel — closed where stated, still open where stated.

1. Byzantine / non-participating replica — non-bypass proven for replicas that RUN the gate; a replica not running seal is outside the TCB by definition. Named closure path (not yet implemented): attestation of the sealed core.
2. Egress after allow (P6) — seal mediates the DECISION and records it, not the downstream effect. Closes via: compose with an egress proxy; decision gate by design. (Already in seal-host's RUST_BRIDGE.md.)
3. Model vs compiled binary — proofs bind the routing core the code delegates to (Ffi.stepImpl → composed kernels), not a byte-for-byte proof of the compiled wasm. Lane C runs a wasm-vs-interpreted-Lean differential in seal-host CI over a fixed corpus; it is evidence over that corpus, not a universal binary-equals-model proof.
4. Partition liveness — safety (no double-spend) holds unconditionally under partition; liveness is conditional, inherited from crdt-lean. The correct safety-over-availability tradeoff.
