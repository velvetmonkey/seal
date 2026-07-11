# Seal claims matrix

One table: every load-bearing claim, marked **Proven** (a machine-checked Lean 4 theorem),
**Tested** (a named, rerunnable CI gate or test), **Assumed** (trusted computing base — declared,
not proved), or **Not claimed** (things Seal deliberately does not say).

This matrix is an **index, not a new claim surface**. The canonical claim text lives in the
drift-guarded blocks ([docs/LIMITATIONS.md](LIMITATIONS.md), [docs/TRUTH-BOX.md](TRUTH-BOX.md) —
`scripts/claims-drift.mjs` enforces verbatim mirrors); theorem-to-file detail lives in
`seal-host/docs/PROOF-REFERENCE.md` and `seal-assurance-kit/CLAIMS.md`. If this table and those
ever disagree, they win.

All proven rows carry the axiom footprint `{propext, Classical.choice, Quot.sound}` — the minimal
classical fragment, no `sorry`, no `native_decide`.

| Claim | Status | Checked by | Home |
|---|---|---|---|
| An unguarded or unapproved action is never allowed (default deny). | **Proven** | `default_deny_never_allowed` (SealCore/Safety.lean) | mcp-seal-dev |
| A guarded action passes **iff** a live human approval matches that exact target. | **Proven** | `guarded_allow_iff_live`, `approval_binds_to_target` | mcp-seal-dev |
| An approval for one target never authorizes another (confused deputy blocked). | **Proven** | `confused_deputy_blocks_from_single_other_approval` | mcp-seal-dev |
| Approvals are single-use and expire. | **Proven** | `consumed_approval_not_live`, `expired_not_live` | mcp-seal-dev |
| The canonical request grammar is total to parse and roundtrip-stable, with exactly one byte representation per Unicode string. | **Proven** | `parse_total`, `canonical_roundtrip`, `escapeString_injective` | mcp-seal-dev (SealV2) |
| Kernel decisions cannot be bypassed inside the model: every Allow carries a validity witness. | **Proven** | `non_bypass`, `decide_emit_unique` | mcp-seal-dev |
| Host model properties: the gate reveals only the one authorized bit (non-interference), no double-spend of approvals, replay isolation — at the model level. | **Proven** | `seal-host` Host/ + Kernels/ theorem sets (see PROOF-REFERENCE.md) | seal-host |
| **Distributed, necessity:** no coordination-free protocol can stop two disconnected replicas both consuming the same authority without a causal handoff (the authority frontier) — over an abstract `AuthoritySystem D`. | **Proven** | `authority_frontier_card_le_one`, `no_disconnected_double_availability` (Crdt/AuthorityFrontier.lean) | crdt-lean |
| **Distributed, sufficiency:** the sealed-handoff pattern (each sender seals its own consume in its causal past before enabling the next) yields ≤ 1 consume per valid cut. Proven in a finite `CutWorld` model, **not** lifted to the abstract system; the sealed handoff is **not** claimed to be the unique safe shape (causal consume-sequencing is a checked third shape). | **Proven** (finite CutWorld model) | `sealed_handoff_safe`; third-shape witnesses `wSeq_safe`, `wSeq_not_sealed_handoff` (Crdt/AuthorityFrontier.lean) | crdt-lean |
| **Distributed → gate, bridge:** the coordination-free no-double-spend necessity transfers onto the SealV2 gate model as a **TTL-scoped applicability instance** (within TTL, per concurrent replica) — an instance mapping, not a refinement of the full validate-and-consume path. | **Proven** (instance, TTL-scoped) | `Host.AuthorityFrontierBridge.sealv2_frontier_card_le_one`, `sealv2_no_disconnected_double_availability` (PROOF-REFERENCE.md) | seal-host |
| The deployed bodies (Rust host, browser wasm, JS checker) match the proven kernel **byte-for-byte over the conformance corpus**. | **Tested** | conformance bridge (model == native == wasm), CI transcripts in seal-host/docs | seal-host |
| Decision receipts (schema v2) validate, derived hashes recompute, the verdict re-derives identically, and emitted decision bytes are byte-identical. | **Tested** | `seal verify` check list + `npm test` frozen vectors | seal-assurance-kit |
| A tampered receipt fails verification; a bypass receipt is never reported as verified. | **Tested** | seal-check tamper suite (`test/receipt-verify.test.cjs`), kit bypass expect-fail gate | seal-check / seal-assurance-kit |
| Nonce replay across host **restart** is rejected (durable replay store, production signed-token channel). | **Tested** | `sqlite_replay_survives_restart` (seal-host Rust tests) | seal-host |
| The live demo's evidence is real: the blocked destructive request and the bypass-executed one are **byte-identical** (`canonical_request_sha256` equal), and all phase receipts are v2. | **Tested** | `scripts/assert.mjs` (15 invariants, gates the docker run) | seal-live-demo |
| The approval field set carries enough information to identify the exact effect it authorizes (receipt-field **sufficiency**). The pre-v2 field set **failed** this check — a concrete collision: two different effects indistinguishable through the committed fields — and v2's `args_hash` is the field that closes it. A collision indicts the field set, not one implementation; no implementation reading insufficient fields can fix it. | **Tested** (finite refinement analysis) | `seal adequacy` (anchored on `witness_computable_iff_refines` / `witness_separation_fails`); `witness-check`, the private sufficiency analyzer | seal-assurance-kit / witness-check |
| Differences between two receipts are detected and classified against the authorization surface (integrity-checked against each receipt's own hashes before diffing; a pre-v2 → v2 pair is called out as the approval surface widening). | **Tested** | `seal receipt-diff` test suite (11 cases in the kit's npm chain) | seal-assurance-kit |
| The same `seal verify` closure runs in CI: vendored byte-identical into the GitHub Action, sha256-pinned to the kit commit, drift-guarded, exercised by a fixture selftest workflow. | **Tested** | seal-verify-action ci + selftest workflows | seal-verify-action |
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
proved-vs-deployed map). Family links are private; they resolve only for authorised evaluators.
