# Seal: Evaluator Truth Surface

Regenerated: 2026-08-09. This file separates proved, tested, reproduced,
shipped, and open facts. It is still hand-generated from the two `CLAIMS.md`
files, the fleet lock, the live verifier declarations, and the current
proof-reference inventories. No checked-in generator exists; that remains a
stop-ship.

> **Dated correction, measured 2026-08-08.** Section 2's historical
> artifact-identity rows
> describe the 2026-07-31 state and are superseded on these points: the shipped
> fleet is no longer `d7d81e27`. Measured in the morning, the fleet lock and all
> six locked wasm paths carried `0b5e7925…`; that afternoon a coordinated fleet
> repin ("repin fleet WASM to audited kernel") landed on every fleet remote, and
> the lock (`seal-host/release/fleet-lock.json`) plus all six locked wasm paths
> were independently re-hashed to
> `28bb3ae71985357163e3b651791e2a70c462ea5d1313a59b4967d4c20ea77657`. The
> `dd00cd2b` clean-rebuild candidate row remains a true record of that rebuild.
> No GitHub release has been published for any tag as of this date
> (re-checked after the repin; the release policy gate still refuses). The rest
> of this file is retained verbatim as the 2026-07-31 audit.

## 1. Source order and status words

When sources disagree, live bytes and live declarations win over prose. A
theorem states a model result. A test gives finite evidence. `REPRODUCED` means
one observed rebuild matched. It does not mean `REPRODUCIBLE` across hardware,
kernels, or repeated independent runs. `CANDIDATE` is not `SHIPPED`.

| Source | Role | Backing |
|---|---|---|
| Canonical-core claims | Public claim ceiling for the v2 canonical core | `mcp-seal-dev/CLAIMS.md:20-30` |
| Host claims | Public claim ceiling for the deployed multi-kernel host | `seal-host/CLAIMS.md:29-49` |
| Shipped fleet identity | Exact repository commits and kernel hash | `seal-host/release/fleet-lock.json:1-31` |
| Verifier contracts | Profile meanings and expected roster | `seal-assurance-kit/docs/VERIFY-PROFILES.md:88-206` |
| Live verifier declarations | Actual profile selected by each copy | Section 4 below, with each live file and line |
| Proof inventories | Curated public theorem references, counted in this rewrite | `mcp-seal-dev/docs/PROOF-REFERENCE.md:5-55`; `seal-host/docs/PROOF-REFERENCE.md:5-30` |

## 2. Historical artifact identity: 2026-07-31 candidate and shipped fleet

The rows in this section retain the measured 2026-07-31 record. They are not
current fleet status; the dated correction above and the regenerated stop-ship
table in Section 6 state what superseded them.

| Fact | Result | Backing |
|---|---|---|
| Source measured by the clean rebuild | `seal-host` commit `54aa677f1eb5f560e978eb1ef8131cb54069c8e1` | Git object and checkout identity; `/var/tmp/seal-wasm-clean-final2.2ia1TA/REPRODUCE.md:3-20` |
| CANDIDATE wasm | SHA-256 `dd00cd2bd01531113e3c687eb0df62f23860213219a01d2cb1f3e219adfa48c3`, 5,776,864 bytes | Independently hashed `seal-host/wasm-spike/verified/seal.wasm`; clean evidence `evidence/result.sha256:1-3` and `evidence/result.sizes:1-3` |
| CANDIDATE generated JS | SHA-256 `0802ef0c4237c88dcefbaa4e2bb541e0dc6477ee1b6e3d5e5627e1d50b3bdf0a`, 62,971 bytes | Independently hashed `seal-host/wasm-spike/verified/seal.js`; clean evidence `evidence/result.sha256:2` and `evidence/result.sizes:2` |
| Clean rebuild result | REPRODUCED once: generated wasm and JS matched the checked-in candidate; all nine recorded phases exited 0; the cold Lake build reached 16,247 of 16,247 jobs | `/var/tmp/seal-wasm-clean-final2.2ia1TA/evidence/comparison.txt:1-2`; `evidence/status.txt:1-9`; `evidence/lake_build.log`; `evidence/result.sha256:1-3` |
| Toolchain recipe pins | Ubuntu `sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90`; Lean commit `7e01a1bf5c70fc6167d49c345d3bf80596e9a79b`; Lean archive SHA-256 `ceb3a3f844f7aebf63245e2b51c28d5b0ed38942c19f93cf3febd520302160bd`; Emscripten commit `d223ae73c6998296e3ab27cf81dc2c2c9fd383de`; runner image ID `sha256:770b606e55d3e89448392d432bb05000ab806114452a9fa8350621aeb1aede83` | `/var/tmp/seal-wasm-clean-final2.2ia1TA/Dockerfile:1-21`; `evidence/provision_toolchain.log`; `evidence/environment.txt`; local image `seal-wasm-clean-runner:lean4.28.0` |
| SHIPPED fleet wasm | SHA-256 `d7d81e277ba0b5e9df385129d86abf6f7469e6da2a65bb2ec35626caa44ea2be` in all six locked wasm paths | `seal-host/release/fleet-lock.json:3-30`; each blob at its locked commit was independently hashed |
| Candidate versus shipped | The clean rebuild reproduced the CANDIDATE. It did not reproduce the SHIPPED fleet artifact. The measured gap is `dd00cd2b` versus `d7d81e27` | The two independently measured rows above |
| Pinned verify-action record | Bytes at fleet-pinned commit `d97433e2e9370d660af2f5b08912941a880a75ce` hash to `d7d81e27`, but `VENDORED.md:15,70` and `lib/pin.js:22` at that commit say `a3790181`. This is stale documentation, not a wasm mismatch | Git blobs at the pinned commit; later commit `3d62f55b14a89e24fc317abf8a0549b28787a6b7` corrects both records |

The clean rebuild excluded the host checkout, host caches, sibling private
repositories, Docker socket and volumes, and `/home/monkey`. It used a complete
Git bundle, a read-only root, dropped capabilities, no new privileges, and a
byte-identical `lake-manifest.json`. Backing:
`/var/tmp/seal-wasm-clean-final2.2ia1TA/reproduce.sh:19-109` and
`REPRODUCE.md:11-58`.

The limits are part of the result:

- At the time of this rebuild, repository authorization required one transient
  host GitHub credential. It was unset before compilation and not mounted from disk.
  Backing: `REPRODUCE.md:27-46`; `reproduce.sh:11-17`.
- Cross-hardware and cross-kernel reproducibility was not checked. This is one
  x86-64 cold-container sample. Backing: `evidence/environment.txt`; no second
  environment exists in the evidence set.
- Runtime behavior in the clean container was not checked. The recipe rebuilds
  and hashes; it does not run the three-way runtime agreement suite. Backing:
  `reproduce.sh:77-109`.
- The checked-in provenance recipe is not the recipe that succeeded. It names
  `/home/monkey/bin/leanbuild` and omits the separate dependency C-object build;
  the clean recipe used pinned `lake build` and first ran
  `.lake/packages/mcp-seal/c/build.sh`. Backing:
  `seal-host/wasm-spike/verified/PROVENANCE.txt:76-91` and
  `/var/tmp/seal-wasm-clean-final2.2ia1TA/reproduce.sh:77-90`.

## 3. Proved, tested, deployed, and residual truth surface

| Name | Current result | Backing | Limit |
|---|---|---|---|
| V2 Allow witness and default deny | PROVED for the canonical core: an `Allow` carries parsed and validated approval evidence and canonical output; output is unreachable without it | `mcp-seal-dev/CLAIMS.md:24-26`; theorems `SealV2.non_bypass` at `SealV2/DecideTheorems.lean:67`, `SealV2.default_deny` at `:77`, and `SealV2.canonical_roundtrip` at `SealV2/SerializationTheorems.lean:1257` | Core only; not a whole deployment proof |
| Approval lifecycle | PROVED in the model: issue, target bind, one-shot consume, and TTL expiry | `mcp-seal-dev/CLAIMS.md:27`; theorem `SealV2.replay_denied` at `SealV2/LifecycleTheorems.lean:84` and the lifecycle inventory at `docs/PROOF-REFERENCE.md:27` | Deployment durability and store identity are separate rows |
| Ed25519 canonical approval bytes | CODE plus trusted crypto leaf; the shim enforces RFC 8032 `S < L`; the recorded corpus was 62 of 62 invalid rejected and 88 of 88 valid accepted | `mcp-seal-dev/CLAIMS.md:28,78-97`; `c/seal_ed25519.c`; Wycheproof runner named in the claim | TweetNaCl group arithmetic remains trusted |
| Principal non-influence | PROVED as a model property for fixed judged line and approval state | `mcp-seal-dev/CLAIMS.md:29`; theorem `SealV2.Effect.principal_non_influence` at `SealV2/PrincipalNonInfluence.lean:146` | Whether a decision exists and host behavior can still depend on principal |
| Deployed host profile | IMPLEMENTED and deployed as `compatible`; `canonical-l0` is proved at the proof layer but is not the deployed path | `seal-host/CLAIMS.md:17-27`; `Host/Canonical.lean`; `Host/CanonicalL0.lean`; `Ffi.stepImpl` | Canonical AST is audit data, not the deployed mediation gate |
| Conditional single-link non-bypass | PROVED for the pure routing implication and TESTED across the Rust sink bridge | `seal-host/CLAIMS.md:37`; theorem `Host.step_forward_non_bypass` at `Host/Composition.lean:504`; `rust/src/route.rs`; the single child-write sink in `rust/src/main.rs` | Model-to-binary correspondence is tested, not proved; only lines classified as `tools/call` are covered |
| Passthrough perimeter | PROVED model result: a line is gate-decided exactly inside the classified perimeter and forwarded undecided when it escapes. Widened non-bypass fails for every escape, including a JSON-RPC batch | `seal-host/CLAIMS.md:44`; theorems `mediation_perimeter` at `Host/PassthroughPerimeter.lean:615` and `widened_non_bypass_fails` at `:661` | Child strictness is assumed; duplicate-key disagreement and the unwired strict profile remain open |
| Gated-sink adapter | PROVED at model level for P2 forward and P3 retry | `seal-host/CLAIMS.md:39-43`; `Host/GatedSinkAdapter.lean:74-90`; `Host/SealAdapter.lean:83-121` | It is not a model of the full deployed alphabet; Rust byte refinement remains TCB |
| Multi-kernel composition | PROVED at model level for registered kernels, including the seven-kernel closed algebra | `seal-host/CLAIMS.md:33-34,46`; theorem `Host.registry_closed_algebra` at `Host/Composition.lean:541` | Liveness, config correctness, crypto, and IO realization are outside the theorem |
| A6 signed-token cross-restart durability | TESTED and implemented: accepted production-channel nonces are written to SQLite before Lean, with WAL and `synchronous=FULL` | `seal-host/CLAIMS.md:56-60`; `rust/src/replay_store.rs:102-153`; restart backing in `rust/tests/host_path.rs:1148-1232` | Only the Ed25519 signed-token production channel; legacy channels remain in memory |
| A7 replay-store instance integrity | OPEN accepted limitation. The 0700 parent and 0600 file checks narrow substitution authority to host euid and root, but do not authenticate store identity | `seal-host/CLAIMS.md:61-80`; `rust/src/secure_fs.rs:14-96`; `rust/tests/replay_store_substitution.rs:121-179` | A conforming substituted store re-accepts a previously consumed nonce within TTL |
| Numeric and parser equivalence | PARTIAL. The binary64 agreement guard refuses the measured numeric disagreement class; full per-server equivalence remains open | `mcp-seal-dev/CLAIMS.md:77`; `seal-host/CLAIMS.md:53`; `seal-host/docs/V31-DOWNSTREAM-PARSER-AGREEMENT.md:110-137` | Inputs and downstream parsers outside the measured corpus were not checked |
| Response egress | NOT MEDIATED by the claim | `mcp-seal-dev/CLAIMS.md:100-103`; `seal-host/CLAIMS.md:101-104` | Never claim that Seal prevents response leaks |

## 4. Live verifier profiles

The prose roster has one confirmed stale path: it places the host declaration
in `rust/src/decision_receipt.rs`, while the live declaration is in
`rust/src/authorization_decision.rs`. The live declaration wins.

| Copy | Live profile | Backing |
|---|---|---|
| assurance kit reference verifier | `P-REF` | `seal-assurance-kit/src/verify.cjs:26` |
| seal-check | `P-ENFORCE` | `seal-check/receipt.js:26` |
| verify-action fork | `P-ENFORCE` | `seal-verify-action/lib/pin.js:23` |
| seal-host authorization-decision verifier | `P-ENFORCE` | `seal-host/rust/src/authorization_decision.rs:29` |
| live-demo PWA | `P-ENFORCE` | `seal-live-demo/pwa/receipt.js:22` |
| seal-demo self-audit | `P-SELFAUDIT` | `seal-demo/public/audit.js:35` |

Profile meanings and outcome classes come from
`seal-assurance-kit/docs/VERIFY-PROFILES.md:88-171,208-228`. `P-REF` may verify
a configless non-principal parseable receipt. `P-ENFORCE` requires signed-config
binding and an independent signer pin for its top result. `P-SELFAUDIT` says
`SELF-CONSISTENT`, never independent `VERIFIED`.

## 5. Current theorem inventories and the module inventory gate

Counting theorem names in the current curated proof-reference tables gives:

| Inventory | Count | Method and backing |
|---|---:|---|
| `mcp-seal-dev` | 34 theorem names across 24 claim rows | Counted from `docs/PROOF-REFERENCE.md:5-55`: 6 V1, 10 V2 pipeline and lifecycle, 15 golden-path, 3 V2.3 principal rows |
| `seal-host` | 40 theorem names across 23 claim rows | Counted from `docs/PROOF-REFERENCE.md:5-30`, including every parenthesized companion theorem |

These are curated public inventories, not counts of every theorem declaration
in every Lean module. Source locations win over stale inventory anchors. For
example, the host inventory says `Host.step_forward_non_bypass` is at
`Host/Composition.lean:241`; the theorem is currently at line 504.

The module axiom gate is derived evidence: run `lake exe module_axiom_check` in
the public `mcp-seal-dev` tree. The command computes the production-module
count from the checked-out tree, reports the kernel-baseline assignment-list
size, and fails if either population drifts from the gate's enumerated scope.
GitHub Actions run `31054969690` completed successfully for public commit
`71dc8801e0242b06a5f75cd537b666cd56d89ec6`. The 2026-08-09 regeneration
checked that public commit, the gate source, the tree census, and the completed
remote run rather than carrying forward the 2026-07-31 red result. This repair
also reran the command locally. Re-run it for the counts in any later tree;
they are not copied into this document.

## 6. Five stop-ships

| Stop-ship | Current measured state | Backing and closure condition |
|---|---|---|
| Coordinated wasm/fleet promotion | **CLOSED, AS OF 2026-08-10.** At that snapshot, the lock and all six pinned wasm paths carried `28bb3ae7…` | `seal-host/release/fleet-lock.json`; every exact pinned revision fetched anonymously on 2026-08-09 and every locked wasm path hashed to `28bb3ae71985357163e3b651791e2a70c462ea5d1313a59b4967d4c20ea77657` |
| Umbrella regeneration | **STILL TRUE.** This file remains hand-maintained | No generator exists under `seal/scripts`; `scripts/linkcheck.mjs` reads this file but does not generate it. Closure still requires checked regeneration from both CLAIMS files, the lock, and live profiles |
| Passthrough perimeter choice | **STILL TRUE.** The model proves P1 escape bypass; no option is chosen | `seal-host/CLAIMS.md` K4 and `Host/PassthroughPerimeter.lean` prove `widened_non_bypass_fails`. Closure still requires either refusing every escape or a named strict-child adapter profile with executable evidence |
| Release gating at the exact tagged commit | **CLOSED.** Publication requires same-commit CI, Golden Path, and Security runs, including the CI `release-evidence` conjunction | `seal-host/scripts/tag_release_gate.py`; `release.yml` runs it without `continue-on-error`; all 12 focused gate tests pass and cover absent, pending, red, ambiguous, and missing-evidence cases |
| Public tree buildable with zero private access | **CLOSED, MEASURED 2026-08-09.** A cold build resolved every pinned dependency and completed the Lean tests, FFI export/shared library, optimized Rust binaries, and release-policy gate with no credential available | `seal-host/lake-manifest.json`, `release/fleet-lock.json`, `.github/workflows/release.yml`, `.github/workflows/acceptance.yml`; local credential-free run completed in 14m01s with all 10 Lean test binaries passing |

The table is the 2026-08-09 current disposition: three prior stop-ships are
closed and two remain loud. The public-build row is backed by a completed cold
build, not merely a code path or anonymous fetch.

## 7. Four secondary roadmap items

| Secondary | Current state | Backing and required result |
|---|---|---|
| Adapter numeric profile | OPEN. A global binary64 agreement guard exists, but no live per-adapter numeric profile is declared | `seal-host/rust/src/lean.rs:230-264`; `rust/src/main.rs:1456-1487`; measured limits in `docs/V31-DOWNSTREAM-PARSER-AGREEMENT.md:110-137`. Declare the accepted numeric domain and teeth per adapter |
| `read_or_empty` silent evidence | OPEN. Votes and forecasts map missing, oversized, unreadable, or non-UTF-8 evidence to the same empty string | `seal-host/rust/src/main.rs:300-308,1665-1672,1864-1869`. Make evidence absence and evidence-read failure distinct and fail or report explicitly |
| Declared Reachability Manifest v0 naming | OPEN naming correction. The implementation is declaration-based and explicitly cannot establish total reachability | `seal-host/docs/REACHABILITY-REPORT-V0.md:3-13,65-75`; wire names at `rust/src/reachability.rs:16-17`. Use the honest user-facing name while retaining the v0 limits |
| V2.3 envelope status freeze | STAGED and frozen, not an authorization path. The host flag exists, but the shipped kernel does not return the required principal and the cross-check refuses | `seal-host/docs/EFFECT-ENVELOPE-V23.md:1-13`; freeze manifest `docs/effect-envelope-v23.freeze.json:1-12`; freeze gate `scripts/contract_freeze_gate.py`. Keep this status until coordinated kernel, wasm, vector, and Rust promotion |

## 8. Prior surface disposition

The prior document had no formal table rows. Three named assertions were
deleted during regeneration:

| Deleted assertion | Reason |
|---|---|
| "Current receipt schema is v2" with normative path `seal-host/docs/DECISION-RECEIPT-SCHEMA.md` | The cited path does not exist. The current tree has `docs/AUTHORIZATION-DECISION-SCHEMA.md`, whose v2 section is marked draft, and a separate staged V2.3 effect envelope. The prior assertion was not retained |
| "The conformance corpus is a small labelled set" | The statement predates the current claims and expanded parser, host, and verifier evidence. A new universal coverage count was not derived from the mandated sources, so the stale count was removed rather than guessed |
| "The acceptance ladder is v2-current / v1-legacy / v0-live-grandfathered" | No backing for this umbrella ladder exists in the mandated source set. It was removed rather than carried forward |
| "Receipts / CLI evidence" exact command | Its claimed test composition and untouched-tree result were not checked from the mandated sources in this pass |
| "Receipt drift" exact command | Its action-CI equivalence claim was not checked from the mandated sources in this pass |
| "Host conformance bridge" exact command | The script exists, but its result was not run or asserted in this semantic-freeze pass |
| "Kernel + axioms" exact command set | The old list omitted the currently red module-inventory gate and could imply a green whole-inventory result |

One prior command row is retained as an explicit gap:

| Name | Status | Backing |
|---|---|---|
| Browser replay exact command | NO BACKING | The prior text said to open a receipt in seal-check and check emitted bytes, but named no fixture, test, theorem, or exact expected output. Do not treat it as an acceptance result |

## 9. Unverified

- Cross-hardware and cross-kernel reproducibility: not checked.
- A second independent cold reproduction: not checked.
- Runtime three-way agreement inside the clean container: not checked.
- Universal parser or conformance coverage beyond the named corpora: not
  checked.
- A second credential-free build on another host or architecture: not checked.
- Browser replay exact command: NO BACKING.
- The removed quickstart commands and their claimed results: not checked.
