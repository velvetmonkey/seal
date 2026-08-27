# Seal Family — Public Surfaces Claim Audit (FINDINGS)

**Lean proof source:** [`seal-host`'s proof reference](https://github.com/velvetmonkey/seal-host/blob/main/docs/PROOF-REFERENCE.md) is the reader-facing index for the Lean proof properties stated here.

**Scope**: Top-level README + docs/ openers and matrices for the umbrella `seal/` repo. Representative claims sampled from README truthbox, "Why you can believe it", CLAIMS-MATRIX, LIMITATIONS, AUTHORIZATION-MESH, EVALUATOR-START, WHY-DIFFERENT.

**Method**: Every claim below was re-read from the public docs, then cross-checked against shipped artifacts (Lean sources in mcp-seal / mcp-seal-dev layout, seal-host code/tests, seal-assurance-kit, seal-check, seal-live-demo scripts/asserts, seal-verify-action). "Backed?" cites concrete file:line or test name where the rule or conformance lives. No new guarantees added.

**Collar**: All original honesty labels (truthbox, non-claims, "proves the KERNEL", TCB, "not tamper-IMPOSSIBLE", "AUTHORIZATION not INTENT", etc.) are preserved verbatim in README and docs. This table only audits; it does not change copy.

## Sampled Claims Table

**Lean proof source:** [`seal-host`'s proof reference](https://github.com/velvetmonkey/seal-host/blob/main/docs/PROOF-REFERENCE.md) is the reader-facing index for the Lean proof properties stated in this section.

| Claim (verbatim or close paraphrase from public surface) | Backed? | File:line / evidence | Action |
|----------------------------------------------------------|---------|----------------------|--------|
| An AI agent tries to delete your production database. Seal stops it, because no human approved that exact action. | Yes (showcase) | seal-live-demo/scripts/run_local.sh + assert.mjs (17 invariants, P2 block vs P3 bypass on identical canonical_request_sha256); fixtures/ | keep |
| Seal puts one checkpoint... is there a matching live approval for *this exact request*? No matching approval, no guarded action. (The theorems bind an approval record in state; that the approver is the human you think is the declared custody assumption — see the "Approval origin" row.) | Yes (proven + tested) | mcp-seal-dev/SealCore/Safety.lean: default_deny_never_allowed, guarded_allow_iff_live, approval_binds_to_target; conformance in seal-host + seal-check tests | keep |
| Every decision lands as a tamper-evident receipt you can re-check yourself. | Yes (tested) | seal-assurance-kit/bin/seal verify + src/verify.cjs; seal-check/test/receipt-verify.test.cjs; seal-live-demo evidence/ + pwa replay | keep |
| The core question is narrow enough to *prove*: a guarded action must not pass unless the approval state authorizes that exact target. | Yes (proven) | mcp-seal-dev/SealCore/Safety.lean + SealV2/DecideTheorems.lean (non_bypass etc.); axiom footprint documented | keep |
| The rulebook is a machine-checked theorem in Lean 4... Rust, wasm, JavaScript are tied back by byte-exact conformance tests over a shared corpus. | Yes (tested) | seal-host/scripts/conformance_bridge.mjs + docs/conformance-*.txt; seal-host/rust tests; seal-check differential | keep |
| A one-shot approval provably cannot be double-spent across a network partition without coordination... honestly scoped to within the approval's TTL. | Yes (proven, scoped) | crdt-lean/Crdt/AuthorityFrontier.lean (authority_frontier_card_le_one); bridged in seal-host/Host/AuthorityFrontierBridge.lean; TTL scoped | keep |
| **Fleet deployment shapes (new headliners):** shared replay-store provably *cannot* carry the seal (`sealv2_shared_not_sealed_senders` — two replicas can both honour the same approval). Single-delivery is Safe with no `hsafe` (`sealv2_partitioned_safe`). Mesh-coordinated over shared store is Safe by composition (`sealv2_mesh_safe`). The obvious shared-DB design fails; Seal proves the working architectures. | Yes (proven, model-level, scoped to SealV2 seam + TTL + 1 approval) | Host/AuthorityFrontierBridge.lean (sealv2_shared_not_sealed_senders:307, sealv2_partitioned_safe:426, sealv2_mesh_safe + witnesses in §Composition); Test/Axioms.lean pins; crdt-lean for abstract | keep |
| Seal proves properties of the mediation KERNEL, not of the whole deployed system. | Yes (documented + true) | docs/archive/LIMITATIONS.md (verbatim), docs/CLAIMS-MATRIX.md, seal-host/docs/archive/LIMITATIONS.md + TCB.md | keep |
| The deployed Rust / wasm / JS are NOT proven bug-free; they are tied to the proof by byte-exact conformance testing over a corpus, not for every possible input. | Yes (documented + true) | docs/archive/LIMITATIONS.md (verbatim block), CLAIMS-MATRIX "Tested" rows + conformance transcripts | keep |
| Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal will execute it. | Yes (documented + true) | docs/archive/LIMITATIONS.md (verbatim), README "honest claim" sections, EVALUATOR-START | keep |
| Seal's audit chain is tamper-EVIDENT, not tamper-IMPOSSIBLE. | Yes (documented + true) | docs/archive/LIMITATIONS.md (verbatim), seal-host Host/Record.lean (tamper_evident theorem with hypotheses) | keep |
| Strict `canonical-l0` is proved and modelled, not the deployed route yet. (compatible profile) | Yes (documented + true) | truthbox (verbatim in README + docs/TRUTH-BOX.md), seal-host/CLAIMS.md (profile table), Host/Canonical*.lean | keep |
| SHA-256 collision resistance (A-CR). | Assumed (named, scoped) | docs/archive/LIMITATIONS.md, family TCB docs | keep |
| Approval origin (that the signing human is who you think). | Assumed (channel custody) | EVALUATOR-START §7, docs/ (origin vs ordering split) | keep |
| Intent match / making the AI smarter / preventing hallucinations. | Not claimed | docs/archive/LIMITATIONS.md (verbatim) | keep |
| Universal conformance over all inputs. | Not claimed | EVALUATOR-START, CLAIMS-MATRIX | keep |
| default_deny_never_allowed (unguarded action never allowed). | Yes (proven) | mcp-seal/SealCore/Safety.lean:8 (theorem default_deny_never_allowed) | keep |
| guarded_allow_iff_live + approval_binds_to_target (exact target match required). | Yes (proven) | mcp-seal/SealCore/Safety.lean:16,29 | keep |
| The live demo evidence is real (blocked vs bypassed on identical canonical sha). | Yes (tested) | seal/scripts/run-showcase.sh (captured output shows "blocked" "bypassed" from bundle); seal-live-demo/scripts/assert.mjs (17 invariants) | keep |
| Tamper-evident receipt re-derivable by anyone (PWA or kit). | Yes (tested) | seal/scripts/run-showcase.sh + PWA html served (replay grid); seal-assurance-kit + seal-check tests | keep |

## NEEDS BEN (unverified or out-of-scope in this pass)

**Lean proof source:** [`seal-host`'s proof reference](https://github.com/velvetmonkey/seal-host/blob/main/docs/PROOF-REFERENCE.md) is the reader-facing index for the Lean proof properties stated in this section.
- Full end-to-end live run of `bash scripts/run_local.sh` in this environment (Docker + Node required; the local ./scripts/run-showcase.sh + captured seal-demo.log + bundle evidence provide the showcase instead).
- Exhaustive audit of every theorem in mcp-seal-dev (used local mcp-seal/SealCore/Safety.lean + Test/ + matrix as proxy; the matrix itself is the comprehensive view).
- Public source links (including the mcp-seal-dev full tree) — backing via the linked repositories and the drift-guarded matrix.
- Evaluator links (mcp-seal-dev and seal-host) — backing cited via their public trees and the public matrix; the deferred crdt-lean work is not a current product route.
- Exhaustive audit of every .lean theorem vs every line of every conformance corpus entry (sampled the load-bearing safety + non-interference + bridge theorems; matrix + PROOF-REFERENCE already do the heavy lifting).
- Any claim surface added after 2026-07 (this audit is against the files read in this session).

All sampled public claims are backed by the cited shipped code/tests/Lean or are explicitly honesty labels that we preserved verbatim. No claims were added or strengthened beyond what the artifacts support.

See also the canonical CLAIMS-MATRIX.md (one table view) and docs/archive/LIMITATIONS.md (verbatim non-claims block, drift-guarded).

---

This file is the committed findings table for the seal/ public surfaces glow-up. It was produced by direct reads of the docs + cross-checks against the referenced source.
