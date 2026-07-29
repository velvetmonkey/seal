# Roadmap, kernel outward: north star graft

Set 2026-07-25; grafted 2026-07-27 after Ben asked for the north star and the
working roadmap to become one ordered plan.

This document is the working order. It does not replace
`NORTH-STAR-V3.md`, `NORTH-STAR-ADJUSTED.md`, the g9 specification, or the
round-10 register. Those remain the decision and reversal history. This graft
connects their WHY to executable HOW and corrects the status board without
rewriting that history.

## Authority and settled sequence

The governing sequence is:

1. establish the g9 Phase-1 floor;
2. blind-test that floor;
3. fold the surviving findings into this plan;
4. resolve the Phase-2 boundary tradeoffs, including canonical binary encoding
   versus tested conformance; and only then
5. pivot to a **compulsory verify moment**: a receiver-side inline gate that
   somebody is obliged to run before the effect proceeds.

Ben's 2026-07-24 14:17 ruling controls the order: finish-to-pure first, then
pivot. Receipt honesty was essentially done; adoption of verification, not
another honesty label, was the product bottleneck. The 2026-07-25 adjusted
north star temporarily promoted comprehension to Priority 0, and the original
version of this roadmap followed it. V3 then restored proofs-to-bytes as the
highest-value item. This graft records that reversal and puts comprehension
inside the later verify-moment pivot instead of silently leaving it first.

Three later rulings constrain every phase.

**Correction, 2026-07-28:** this paragraph previously counted two; the MCP v1
support ruling below is the third.

- 2026-07-27 01:04: the differential/conformance apparatus is half the product.
  It is seal, co-equal with the kernel and broker, not disposable scaffolding.
- 2026-07-27 15:03: preserve the checked chain; shape, naming, versioning and
  compatibility may change. Chain rigor is fixed. Its packaging is not.
- 2026-07-28: seal v1 supports MCP revision 2026-07-28. Phase M records the
  conformance work now; its letter does not insert a schedule ahead of or
  between the settled Phases 0–4.

## The WHY keys used by every roadmap item

- **FLOOR** — the g9 Phase-1 floor: Decision Bundle, CFG, verifier, checked
  correspondence, honest outcomes, crash-consistent host and cannot-lie CI.
- **V3.1** — close the gap between proofs and bytes. The conformance apparatus
  is part of the shipped artifact.
- **V3.2** — signed unbrokered-reachability reporting with UNKNOWN and an
  honest denominator.
- **V3.3** — one real Postgres sink end to end, including what the human was
  shown and a direct-connection negative control.
- **V3.4** — the paper and evidence-backed write-up.
- **BOXPOL** — the non-growing policy layer V3.3 signs against; it starts after
  V3.1 or not at all.
- **VERIFY** — the settled product pivot: compulsory receiver-side verification
  before execution, not optional post-hoc accountability.

An item marked **Serves: NONE** has no north-star justification yet. That is a
finding, not an invitation to invent one.

## Product artifact at the floor: fork for Ben

g9 §2 calls the **Decision Bundle** the product artifact:
`DecisionBundle { signed_config, A, H[], B, optional trace_witness }`, verified
against an out-of-band, project-signed, role-split `TrustContext`. g9 §3 makes
the verifier a first-class product surface with typed outcomes and an honest
split between fail-closed gates and always-on limitations. g9 §8 puts both in
the Phase-1 SHORT list. `NORTH-STAR-ADJUSTED.md` retains them as “then the
bundle, the verifier and the honest-claims work from g9.”

Nothing in the required sources explicitly supersedes that artifact. The later
documents rename receipts to authorization decisions, select a four-leg Option
D record, add ApprovalRecord v2, and omit the bundle and verifier from the
working roadmap; they do not say whether those shapes replace the bundle or
live inside it.

**Therefore this is a fork for Ben, not a decision made here:** either the g9
Decision Bundle plus verifier remain the product artifact and must be updated
to the authorization-decision/ApprovalRecord-v2 vocabulary, or a named successor
must explicitly supersede them and inherit every checked correspondence and
honest verifier outcome. Until that fork is ruled, their floor obligations
remain live and their implementation status is **UNVERIFIED**.

## Verify an UNVERIFIED marker before implementing

**MEASURED:** two consecutive Phase-2 items, 2.3 and 2.4, carried
OPEN/PARTIAL and implementation-UNVERIFIED states even though the requested
controls already existed and were correct. Both closed on evidence from the
existing implementation and tests; neither required new code. In these two
cases, the roadmap's own UNVERIFIED markers had not themselves been verified.

**INFERRED working rule:** before building anything for an item marked
UNVERIFIED, first check whether the current implementation already satisfies
it. This observation is about exactly these two items, not a claim that the
whole roadmap is stale.

## Ordered plan

### Phase 0 — establish the g9 Phase-1 floor

This is the floor against which the blind test ran. Its specification exists;
whether its named artifact was implemented or superseded is the fork above.

0.1 **Freeze the Decision Bundle and CFG obligation.** Preserve separate signed
facts for request, approval and decision; fail-safe `admission_paths`; the
kernel-bound admission key; the universal-frame input; and the signed host
record. If the four-leg authorization decision is its successor, write the
explicit correspondence rather than relying on a rename.
**Serves: FLOOR, V3.1, VERIFY. Status: OPEN; canonical artifact is a fork for
Ben; implementation UNVERIFIED.**

0.2 **Restore the verifier as a product surface.** It takes the artifact,
role-split `TrustContext` and verifier context time; re-derives the checked
chain; prints facts it cannot establish; and returns typed outcomes that cannot
be confused with authorization. A compulsory gate must consume a typed result,
never grep a line.
**Serves: FLOOR, V3.1, VERIFY. Status: OPEN; implementation UNVERIFIED.**

0.3 **Preserve the host floor.** The pre-release weld, persist-before-forward
ordering, v1-eligibility rule, honest durability class, consumed-set ordering,
release projection and idempotent recovery remain obligations unless a
successor artifact makes each one obsolete explicitly.
**Serves: FLOOR, V3.1, V3.3. Status: UNVERIFIED.**

0.4 **Preserve the stranger test.** On a clean machine, without Lean, a stranger
must verify the artifact against a separately obtained root, mutate one
payload byte, and see the affected object fail. That walkthrough must exercise
the same verifier the compulsory gate consumes.
**Serves: FLOOR, V3.4, VERIFY. Status: UNVERIFIED.**

### Phase 1 — fold the blind-test survivors; freeze ordering is a fork for Ben

**MEASURED:** the round-10 register labelled every Tier-1 row FRISKING / NOT
ACCEPTED; the current frisk state is now recorded per row. **INFERRED working
rule:** only a surviving implementation finding earns an implementation fix.

**MEASURED — sequencing evidence:** the T1.1 identifiers `admission_key` and
`kernel_tool_namespace` occur in g9 but not in current implementation source,
and the g9 verifier and its five typed outcomes are not implemented.
**INFERRED — structural consequence:** both Tier-1 items previously treated as
gating the freeze bear on spec-only machinery. They therefore cannot gate an
implementation freeze; they gate the spec. **FORK FOR BEN:** the council ranked
T1.1 first on the belief that it was a live code defect. Ben must decide whether
to re-prioritise the implementation work or retain spec closure first. No phase
is re-ordered here pending that ruling.

1.1 **T1.1 — present-but-wrong namespace lookup: FRISKED; SPEC-SIDE; OPEN,
CENTRAL DUAL-PARSE QUESTION UNVERIFIED.** **MEASURED:** `admission_key` and
`kernel_tool_namespace` occur in the g9 specification and not in current repo
implementation source. The implemented classifier is
`mcp-seal-dev/Seal/Classify.lean:110` `classifyToolCall`; it resolves to
`.benign` at line 107, `.guarded target` at line 104, or `.defaultDeny` at
lines 100 and 108. **INFERRED:** the alleged path is a finding against g9's
specified machinery, not a reproduced defect in the present implementation.
**UNVERIFIED:** whether the classifying parse and deciding parse are independent
parses of the same bytes. That central question remains open; this item is not
closed.
**Serves: FLOOR, V3.1, VERIFY.**

1.2 **T1.2 — `AUTHORIZED` claim mislabel: FRISKED; UNREACHABLE IN THE
IMPLEMENTATION; SPEC LABEL OPEN.** **MEASURED:** no g9 verifier or occurrence
of its five outcomes (`AUTHORIZED(0)`, `UNPINNED-AUDIT(10)`,
`STALE-UNKNOWN(11)`, `UNVERIFIABLE(20)`, `REFUTED(30)`) exists under
`seal-host/rust/src/`. **INFERRED:** there is therefore no executable point at
which the allegation can be reproduced or refuted against the implementation.
**MEASURED:** the unmerged `frisk/t12-authorized-label` test at
`rust/tests/topology_matrix.rs:590`, commit `b58ed1c`, exercised a real request
through `seal-host-rs` with the widest expressible allow shape and observed
exit 0, record type `seal.authorization-decision`, verdict `ALLOW`,
authorization `explicit_policy_allow`, and no g9 status emission.
**MEASURED — partial rejection:** Safety's predicate is stated at
`mcp-seal-dev/Seal/Classify.lean:27-123` and `CONFIG.md:55-100`; the narrower
surviving claim is that g9's artifact contract does not state or bind it.
**MEASURED — prior live-surface rejection:** `7c83191` already replaced the
RECORDED-adjacent live name with `record_type:
"seal.authorization-decision"`; only stale g9 text still calls B a “Decision
Receipt.” **INFERRED — candidate, not applied:** `DECISION-CONSISTENT` is a
possible green-status name, but that naming decision is Ben's.
**Serves: FLOOR, VERIFY.**

1.3 **T1.3 — decision is not execution: OPEN; implementation UNFRISKED.** Four
blind-test seats converged that the artifact attests DECIDED plus intent to
record, not EXECUTED, and has no compulsory inline verify moment. Ben settled
the direction: build the compulsory receiver-side gate; do not downgrade the
project to optional post-hoc accountability. The diagnosis still needs a
current on-disk frisk before any particular code change is accepted.
**Serves: VERIFY, V3.3.**

No Phase-2 freeze may describe these rows as closed merely because they now
appear here.

### Phase 2 — finish-to-pure and settle the boundary

**MEASURED:** the Phase-2 audit found six already-complete rows (2.2, 2.5,
2.6, 2.7, 2.8 and 2.13), four partly complete rows (2.9–2.12), and no
whole item with no implementation at all. It also found that 2.10 and 2.11
lack their named machinery, 2.9's remaining corpus choice waits on 2.1, and
2.12's delegation-membership leg was deliberately stripped. **INFERRED —
honest shape:** Phase 2 is not a queue of work. It is **one machinery gap
(2.10 plus 2.11), one fork waiting on Ben (2.1, which also unblocks 2.9), and
one deliberate omission (2.12's delegation leg).**

2.1 **Choose the byte-boundary strategy: FORK FOR BEN.** g9's Phase-1 floor
selects tested conformance: pinned formulae, adversarial divergence vectors and
an independent second implementation, with nonconformance failing closed.
V3.1 permits either a verified parser/subset or proven serialization invariants
with executable host checks. The settled sequence also requires an explicit
canonical-binary-encoding versus tested-conformance tradeoff.

If “canonical binary encoding” means rewriting mediated request bytes, the
Option-A history rejects that move because it changes the authorized bytes and
creates a new semantics-preservation obligation. If it means only the bundle or
authorization-decision encoding, the sources do not resolve it. Ben must choose
the scope and branch:

- canonical binary product encoding with a checked mapping to executed bytes;
  or
- exact current bytes plus tested conformance, with CAVEAT-CONF-1 and the
  differential apparatus retained as product.

Do not combine the names and pretend the tradeoff disappeared.
**Serves: FLOOR, V3.1. Status: OPEN; fork for Ben.**

2.2 **`release-evidence` CI gate: CLOSED; ALREADY-DONE** *(former roadmap item
1)*. Missing private evidence must make the release verdict red, and every
required Lean, Rust, conformance, security and golden-path result must be
observed. **MEASURED:** the gate rejects malformed input, every non-`success`
result, and tokenless apparent success for the private Lean/Rust jobs
(`seal-host/scripts/release_evidence_gate.py:15-65`). The workflow runs it
under `always()` after five named prerequisite jobs
(`seal-host/.github/workflows/ci.yml:225-242`), and negative and green pins
exercise it (`seal-host/test/test_release_evidence_gate.py:37-95`). Commit
`f198642` is an ancestor of `seal-host` main. **INFERRED:** this satisfies the
numbered item; it is not merely a roadmap assertion.
**Serves: FLOOR, V3.1. Status: CLOSED; ALREADY-DONE.**

2.3 **Repair `differential.rs` and `parser_boundary.rs` outcome contracts:
CLOSED; ALREADY-TIGHT** *(former item 2)*. Keep enumerated fail-closed outcomes
and negative controls; do not relax to “anything nonzero.”
**Serves: V3.1. Status: CLOSED; ALREADY-TIGHT.** **MEASURED:** the previously
verified differential and host-path side was already closed.
`parser_boundary_map` compares every observed named class for exact equality
with its per-case expectation; `props::no_bypass_no_new_divergence` runs 4,000
generated cases and admits exactly `agree-routed`, `agree-unrouted`,
`reduced-scope-unparseable`, `reduced-scope-structural`, and `wire-refused`.
The file contains no process-status, nonzero-exit, ignored-test, or subprocess
assertion that could turn a crash, missing dependency, observation error, or
different named boundary outcome green. RUN
`parserbound-contract-verification-2026-07-27` measured the freeze gate at exit
0, both parser-boundary tests passing, and the full-suite failure set unchanged
at the three known environmental failures. No code was written because the
contract already met the item.

2.4 **Literal interior-NUL boundary test: CLOSED; ALREADY-COVERED** *(former
item 3)*. Exercise an actual `0x00` byte, not only a JSON escape, and retain the
observed failing control.
**Serves: V3.1. Status: CLOSED; ALREADY-COVERED.** **MEASURED:**
`rust/tests/common/mod.rs:131` uses Rust source escape `\u{0}` in
`str-raw-nul`, producing a literal byte `0x00`, and pins the named
`agree-unrouted` outcome. `rust/tests/nul_seam.rs:12-15` places literal `\0`
inside `"arg\0uments"` and asserts `line.as_bytes()[48] == 0`; the test then
pins exact classifier outcomes `0` for the 48-byte prefix and `2` for the full
sequence. RUN
`nulbyte2-20260727-already-covered` measured the freeze gate at exit 0 and
the focused tests passing, with the full-suite failure set unchanged at the
three known environmental failures; it also retained the historical failing
ablation. No code was written because the requested boundary coverage already
existed.

2.5 **Make `RepinStep2Guards` a real lakefile target: CLOSED; ALREADY-DONE**
*(former item 4)*, then ablate the NFD comparison and record the red result.
**MEASURED:** `repin_step2_guards` is a named `lean_exe`
(`seal-host/lakefile.toml:106-111`) and is listed in `defaultTargets`
(`seal-host/lakefile.toml:9`). Its canonical-equivalent-key assertion is live
(`seal-host/Test/RepinStep2Guards.lean:18-33`). Commit
`38a2ff1a83304bb8ede9ec92aa96cacd6e98b763`, “wire the raw-wire guard matrix
into the build, and ablate it”, records the NFD ablation red. The lakefile's own
comment records why it had been inert: Lake knew the module existed, but it was
never a default target and therefore had never been built
(`seal-host/lakefile.toml:3-8`). **Written, correct, and inert.**
**INFERRED:** both requested halves are complete.
**Serves: FLOOR, V3.1. Status: CLOSED; ALREADY-DONE.**

2.6 **Emscripten toolchain availability: CLOSED; ALREADY-DONE** *(former item
5)*. This is a prerequisite for rebuilding and testing the browser artifact,
not an end in itself. **MEASURED:** the emsdk is on disk at
`seal-host/wasm-spike/emsdk/upstream/emscripten`. After its environment is
sourced, `emcc` resolves there and reports Emscripten 6.0.0. The intended
hookup is recorded at `seal-host/wasm-spike/env.sh:1-3` and
`seal-host/wasm-spike/build_wasm.sh:10-29`; version/provenance is pinned at
`seal-host/wasm-spike/verified/PROVENANCE.txt:17-23`, with the prior
availability record at `seal-host/TEST-BASELINE.md:28-32`. **INFERRED:** the
availability prerequisite is satisfied on this machine.
**Serves: V3.1. Status: CLOSED; ALREADY-DONE.**

2.7 **Keep the completed numeric work complete: CLOSED; ALREADY-DONE, without
calling V3.1 done.** **MEASURED:** exact binary64 agreement decides accepted
integers; the coefficient-length check is only a pre-conversion resource bound
(`mcp-seal-dev/Seal/JsonUtil.lean:336-367,381-418`). The raw-wire classifier
refuses agreement-unsafe numbers
(`mcp-seal-dev/SealV2/ClassifyTransport.lean:161-176`). Fixed safe/unsafe
boundary cases and a named Lake executable exist
(`mcp-seal-dev/Test/NumericAgreementShow.lean:21-58`;
`mcp-seal-dev/lakefile.toml:166-168`). `mcp-seal-dev` `main` and `origin/main`
both resolve to `6c23b5cc5c32f16d8593edc4bdfbb904c40dda17`, with `b467c7d` as
an ancestor. **INFERRED:** the numeric subwork, exactly as scoped here, is
complete; this does not close V3.1 or claim the final kernel head is repinned.
**Serves: V3.1. Status: CLOSED; ALREADY-DONE FOR THE NUMERIC SUBWORK.**

2.8 **Keep the complete parser-divergence characterization in required
evidence: CLOSED; ALREADY-DONE.** **MEASURED:** the recursive harness names all
18 vectors, one negative control and five concrete observers, and records a
definite per-cell outcome
(`seal-host/scripts/downstream_parser_agreement.py:3-18,40-74,99-130,448-536`).
The production oracle is named at
`seal-host/Test/DownstreamParserOracle.lean:7-27` and
`seal-host/lakefile.toml:113-117`. The tracked report preserves every vector,
observer and the 90-cell summary
(`seal-host/docs/V31-DOWNSTREAM-PARSER-AGREEMENT.md:13-22,24-45,72-108,131-168`).
Commit `ba4e21d` is an ancestor of `seal-host` main. **INFERRED:** the
characterization itself is complete. The separate parser-correspondence gap
remains open, but is not missing characterization work.
**Serves: V3.1. Status: CLOSED; ALREADY-DONE FOR CHARACTERIZATION.**

2.9 **External oracles in required CI: OPEN; PARTLY; BLOCKED ON 2.1** *(former
item 15)*. **MEASURED:** JSONTestSuite and Wycheproof are vendored, hash-pinned,
and exercised by Rust integration tests that assert corpus floors/digests and
semantic outcomes
(`seal-host/rust/tests/external_json_corpus.rs:19-22,211-319`;
`seal-host/rust/tests/corpora/JSONTestSuite/PROVENANCE.md:3-17`;
`seal-host/rust/tests/wycheproof_ed25519.rs:15-19,97-188`;
`seal-host/rust/tests/corpora/Wycheproof/PROVENANCE.md:3-15`). The generic
required Cargo job reaches them, and `release-evidence` requires that job
(`seal-host/.github/workflows/ci.yml:63,111-119,225-242`). Commits `47b7e9d`
and `7a0235f` record the JSONTestSuite and Wycheproof red controls.
**MEASURED:** no boundary corpus has been selected by 2.1. **INFERRED:** the
only incomplete leg is the boundary corpus that cannot be selected until Ben
rules 2.1; this row is blocked on that fork, not on effort.
**Serves: FLOOR, V3.1. Status: OPEN; PARTLY; BLOCKED ON 2.1.**

2.10 **Implement the named successor to the Decision Bundle and CFG: OPEN;
PARTLY.** **MEASURED:** authorization-decision v2 already persists substantial
successor material: the exact request hash, signed config, approvals, verdict
and certificates, emitted bytes, and pinned kernel identity before ALLOW is
forwarded
(`seal-host/rust/src/authorization_decision.rs:2-7,45-57,291-335,368-418`).
There is no tracked `DecisionBundle` or role-split `TrustContext`
implementation, nor `admission_paths` or `admission_key` implementation
(`seal-host/PINS.md:52-59`). Authorization-decision v2 is not documented as the
successor that maps every obligation. `docs/ARTIFACT-INHERITANCE.md:49-82`
instead names ADEP-v1 for exactly that purpose, declares it not built, and
`docs/ARTIFACT-INHERITANCE.md:104-141` maps the obligations as UNVERIFIED.
**INFERRED:** authorization-decision v2 is substantial successor material, not
the Decision Bundle/CFG machinery or its implemented successor. No successor
may lose request/approval/decision separation, out-of-band trust, byte
re-derivation or the honest event ceiling.
**Serves: FLOOR, V3.1, VERIFY. Status: OPEN; PARTLY.**

2.11 **Implement the verifier consumed by the future inline gate: OPEN;
PARTLY.** **MEASURED:** a pinned post-hoc authorization-decision verifier body
and existing verifier surfaces are real
(`seal-host/receipt-verifier/README.md:1-13`;
`seal-host/rust/src/authorization_decision.rs:16-29,331-335,398-418`). The
in-repo surface has none of g9's five typed outcomes and no role-split
`TrustContext`; it is not a receiver-side inline gate. The current layer is
explicitly post-hoc with **no veto over the kernel**
(`seal-host/rust/src/authorization_decision.rs:269-272`). **INFERRED:** the
real pieces do not implement the requested typed, fail-closed verifier/gate
contract. Together, 2.10 and 2.11 are the one genuine machinery gap left in
Phase 2.
**Serves: FLOOR, V3.1, VERIFY. Status: OPEN; PARTLY.**

2.12 **Field warrant: OPEN; PARTLY; DELEGATION LEG DELIBERATELY STRIPPED**
*(former item 14)*. **MEASURED:** expiry, issued-at freshness and policy-version
gates are landed as conjuncts of `effectStep`, with fail-closed theorems
(`mcp-seal-dev/SealV2/EffectEnvelope.lean:728-817,981-1102`). Envelope
completeness pins nine gated fields and one explicit exemption
(`mcp-seal-dev/SealV2/EnvelopeCompleteness.lean:9-45,93-100`), and the
field-warrant and mutation controls are present
(`mcp-seal-dev/Test/FieldWarrant.lean:205-227,269-320`;
`mcp-seal-dev/Test/FieldWarrantMutation.lean:8-35,131-235`). **MEASURED:** the
delegation-membership leg was **deliberately stripped**, not forgotten:
`parent_capability_ref` and `audience` were killed as uninterpreted seats
(`mcp-seal-dev/SealV2/EffectEnvelope.lean:18-26`). The source records the
reasoning: mandatory per-verifier session binding mitigates audience
redirection only under a named deployment invariant, while the clean future
shape is host `selfId` plus `audienceGate`
(`mcp-seal-dev/SealV2/EffectEnvelope.lean:36-53`). **INFERRED:** the three gate
families are complete; delegation membership remains a deliberate omission,
not forgotten debt or a softened todo.
**Serves: FLOOR, V3.1, V3.3. Status: OPEN; PARTLY; DELIBERATE OMISSION.**

2.13 **Accept the reachability v0 baseline without laundering its denominator:
CLOSED; ALREADY-DONE.** **MEASURED:** the builder always emits `sound: false`
and no coverage percentage; incomplete categories become named UNKNOWN
records, and verification rejects a v0 payload claiming a sound denominator or
percentage (`seal-host/rust/src/reachability.rs:321-399,432-470,506-509`).
Tests pin UNKNOWN behavior, the direct-handle negative control and payload
tamper rejection (`seal-host/rust/src/reachability.rs:624-661`). Signed captured
evidence and the human contract are present
(`seal-host/evidence/reachability-v0/RUN.md:45-85`;
`seal-host/docs/REACHABILITY-REPORT-V0.md:5-13,65-75`). Commit `b800096` is an
ancestor of `seal-host` main. **INFERRED:** the honest v0 baseline satisfies
this item; improving the denominator is later V3.2 work, not a v0 defect.
**Serves: V3.2. Status: CLOSED; ALREADY-DONE FOR V0; V3.2 NOT COMPLETE.**

**INFERRED:** Phase 2 closes when Ben rules the 2.1 fork (thereby selecting or
disposing 2.9's remaining corpus leg) and the single 2.10/2.11 machinery gap is
closed. The 2.12 delegation leg remains recorded as a deliberate omission
unless a later ruling changes that disposition.

### Phase 3 — pivot to the compulsory verify moment

3.1 **Specify the compulsory-verify contract first.** Name the receiver, the
artifact it receives, the trust input it must obtain independently, the typed
success value it must consume, and the exact point before effect at which
failure blocks. “A verifier exists” and “a verifier is available in CI” do not
satisfy this item.
**Serves: VERIFY, V3.3. Status: OPEN.**

3.2 **Design rendering function `R`** *(former item 6)* from the same canonical
parse the digest covers. State totality and the agreement property: two requests
that render identically must not denote different authorized effects.
**Serves: V3.1, V3.3, VERIFY. Status: SPECIFIED; implementation and proof
UNVERIFIED.** `166ec93` establishes the specification is on this repository's
main.

3.3 **Escaping and truncation discipline** *(former item 7)*. Retain a negative
control for ANSI escapes, newline, carriage return, bidi override, homoglyph
and length. Treat truncation as a security parameter.
**Serves: V3.3, VERIFY. Status: OPEN; implementation UNVERIFIED.**

3.4 **Bind what was shown into the signed approval** *(former item 8)*. The
kernel half extends the signed message; the record half retains the exact
displayed bytes, renderer identity, request subject and original signed token.
These remain one signed-shape design even if they land in separate artifacts.
**Serves: V3.3, VERIFY. Status: PARTIAL.** ApprovalRecord v2 and its demo are
ancestors of `seal-host` main (`e8f3a3a`, `444af1e`); the kernel signed-message
half is UNVERIFIED.

3.5 **Prove rendering agreement** *(former item 9)*. This is a theorem or an
explicitly bounded equivalence, not a green example suite.
**Serves: V3.1, V3.3, VERIFY. Status: OPEN; proof UNVERIFIED.**

3.6 **Check parse-to-render type coercion** *(former item 10)*. The human must
not see source spelling while the kernel executes a coerced value without that
difference being explicit.
**Serves: V3.1, V3.3, VERIFY. Status: OPEN; implementation UNVERIFIED.**

3.7 **Put the printer in the TCB** *(former item 11)*. A correct kernel
rendering does not protect an unverified process that prints different bytes.
Test the actual display path and state its trust.
**Serves: V3.3, VERIFY. Status: OPEN; implementation UNVERIFIED.**

3.8 **Emit the four separate authorization facts** *(former item 12)*. Preserve
Option D: JUDGED, AUTHORIZED, DISPATCH ATTEMPTED and ACKNOWLEDGED are separate.
ACKNOWLEDGED is UNKNOWN without executor cooperation; DISPATCH ATTEMPTED does
not become DISPATCHED merely because the record precedes `write_child`.
The word “receipt” remains retired for this object.
**Serves: V3.3, VERIFY. Status: PARTIAL/UNVERIFIED as a complete four-leg
record.** The rename and ApprovalRecord v2 landed; a complete conforming
four-leg implementation was not established here.

3.9 **Wire the receiver-side inline gate.** The obligated receiver must invoke
the Phase-2 verifier and refuse the effect on every result except the selected,
typed success result. Retain a negative control in which removing or bypassing
the call makes required evidence red.
**Serves: VERIFY, V3.3. Status: OPEN.**

3.10 **Rebuild `seal.wasm` once against the settled signed shape** *(former
item 13)* and update the artifact, `PINNED_WASM_SHA256` and `PROVENANCE.txt`
together. Do not treat an earlier repin as proof that the post-pivot shape was
rebuilt.
**Serves: V3.1, V3.3. Status: OPEN for the settled shape; current
three-way status UNVERIFIED.**

3.11 **Build one Postgres sink end to end.** Verify that the agent has no DSN or
password, bind the effect to the approved request, retain exactly what the
human was shown, and run the negative control in which a shell-bearing agent
attempts a direct connection and fails for lack of credentials.
**Serves: V3.3, VERIFY. Status: UNVERIFIED.**

3.13 **Start boxpol only after V3.1 is closed.** Keep analyzer-undecidable
constructs as permanent parse errors and treat the first UNKNOWN caused by a
policy construct, rather than a lens or world gap, as an incident.
**Serves: BOXPOL, V3.3. Status: SPECIFICATION PRESENT; build status
UNVERIFIED.**

### Phase 4 — evidence, consolidation and write-up

4.1 **Write the contribution from the evidence, not ahead of it.** Define
unbrokered reachability, the limits of a signed coverage artifact, the
compulsory verify moment, and the co-equal kernel/conformance/broker structure.
Every public claim names a runnable check and every claimed control has been
observed failing.
**Serves: V3.4, V3.2, VERIFY. Status: UNVERIFIED.**

4.2 **Merge remaining branches and abandon `feat/v2.1-principal`** *(former
item 16)* only through item-by-item harvest decisions.
**Serves: NONE until each branch is mapped to a north-star item. Status:
UNVERIFIED.** “Merge remaining branches” is maintenance, not a product reason.

4.3 **Move to the monorepo topology from a green base** *(former item 17)* so
the correspondence checks, pins and release gate version together.
**Serves: FLOOR, V3.1. Status: OPEN; migration status UNVERIFIED.**

### Phase D — own the demo surface; ordered placement is a fork for Ben

This phase owns the measured demo surface without placing it relative to Phases
2–4. Ben must choose that placement; these rows do not choose what to build
first. North-star authority remains
[NORTH-STAR-V3](NORTH-STAR-V3.md).

D.1 **Keep the recursive demo inventory as the measured baseline** *(former
item 3.12)*.
**MEASURED:** `find seal-host/demo -type f -name '*.py'` returns 22 files. The
per-file classification and invocation table is
`/home/monkey/.mega-monkey/demo-inventory-2026-07-28.md`: 6 `RUNS-GREEN`, 3
`RUNS-RED`, 2 `BLOCKED-DEP`, 2 `NOT-AN-ENTRYPOINT`, and 9 `UNASSESSABLE`.
D.3's build-enabled follow-up has now reclassified those nine fenced outcomes
as 1 `RUNS-GREEN` and 8 `RUNS-RED`. **INFERRED:** this supersedes the former
presence-only count of 21 and preserves the inventory as the classified
baseline; `UNASSESSABLE` records the earlier lane fence, not the nine files'
current measured state.
**Serves: V3.3, V3.4, VERIFY. Status: MEASURED BASELINE; 22/22 CLASSIFIED;
NINE RECLASSIFIED IN D.3.**

D.2 **Preserve the four measured symptom classes, but do not mistake them for
four current root causes: SUPERSEDED.**
**MEASURED:** the build-enabled table at
`/home/monkey/.mega-monkey/golden-state-2026-07-28.md` records: (1)
`demo/golden_path.py`, `demo/golden_path_postgres.py`, and
`demo/golden_path_filesystem.py` reached `seal verify`, which rejected the
host-produced authorization decision with `no recognized version
discriminator`; (2) `demo/golden_path_composition.py` Safety-BLOCKED its
headline call where the demo requires ALLOW; (3) `demo/golden_path_temporal.py`
and `demo/golden_path_convergence.py` refused exact pre-minted approvals and
returned `approval required`; and (4) `demo/golden_path_token.py` and
`demo/golden_path_deploy.py` asked for Safety approval before the expected
Budget and Consensus denials. None of the eight outputs contained the exact
known-stale-guard-config failure. **CORRECTED BY LATER MEASUREMENT:** the
earlier inference that these were four distinct cause classes is no longer
current. `/home/monkey/.mega-monkey/demoapproval-2026-07-28.md` establishes
that the five approval-carrying demos share the legacy v1 signer and that the
host structurally refuses that record; its one authoritative after-run reached
the host-minted target and stopped on that refusal. **INFERRED:** the old table
still records four useful symptom/assertion-site classes, but three of those
classes are now partly explained by the shared v1 approval root. The remaining
four after-runs were fenced and must not be called reproduced at that deeper
reason.
**Serves: V3.3, V3.4, VERIFY. Status: SUPERSEDED AS A ROOT-CAUSE
CLASSIFICATION; HISTORICAL 8-RUN SYMPTOM TABLE RETAINED.**

D.3 **Resolve the nine build-fenced unknowns with a build-enabled pass:
RESOLVED.** **MEASURED:** a serial build-enabled pass at `seal-host`
`091d68f` ran all nine functional paths without a timeout or kill.
`demo/proof_manifest.py` exited 0 and produced a manifest with
`axiom_gate: PASS`; the other eight exited 1. Their four measured symptom
classes—called cause classes in that lane report, with the root-cause reading
now superseded by D.2—are:
three authorization decisions rejected for `no recognized version
discriminator`; one composition headline call Safety-BLOCKED instead of
ALLOW; two exact pre-minted approvals refused with `approval required`; and
two precedence failures where Safety requested approval before the expected
Budget or Consensus denial. **INFERRED:** the earlier “state is unknown” claim
is closed by functional evidence; the later fleet parser repair in D.7 does
not retroactively turn the three measured red runs green without a rerun.
**Serves: V3.3, V3.4, VERIFY. Status: RESOLVED; 1 RUNS-GREEN, 8 RUNS-RED.**

D.4 **Run both positive Python host integration entrypoints in CI: CLOSED.**
**MEASURED:** merged `seal-host` commit `49a2a12` changes all eight
acceptance-intended guard rules to `[{"full_arguments": true}]` and adds a
debug Rust-host build plus direct invocations of
`test/integration/test_host.py` and `test/integration/test_host_rs.py` at
`.github/workflows/ci.yml:125-134`. History checks in the guard-fix evidence
found neither entrypoint in prior workflow commits. Both entrypoints now pass
trusted-config startup but remain red: `test_host.py` fails at line 212 and
`test_host_rs.py` at line 117 because their pre-minted approval targets still
use the old commitment recipe. **INFERRED:** the positive-path CI coverage gap
is closed; the approval-fixture defect is the separate open D.6 item.
**Serves: FLOOR, V3.1, V3.3, VERIFY. Status: CLOSED; CI WIRING MERGED AT
`49a2a12`; BOTH SUITES RED.**

D.5 **Witness child startup failures at their real cause: CLOSED.**
**MEASURED:** merged `seal-host` commit `091d68f` replaces the terminal
`BrokenPipeError` and `JSONDecodeError` witnesses at the affected demo and
Python integration exchanges with the dead child's exit code and verbatim
stderr. Before that repair, the child had already died and the real startup
reason remained in an unread stderr pipe. Focused tests pin the dead-child
diagnostic and the non-blocking live-child path. The affected entrypoints
deliberately remain exit 1 and now report startup exit 3 plus the full-argument
guard rejection. **INFERRED:** this closes the witness defect only; it neither
repairs the stale config nor turns a red demo green.
**Serves: V3.3, V3.4, VERIFY. Status: CLOSED; MERGED AT `091d68f`; REDS
REMAIN RED BY DESIGN.**

D.6 **Regenerate approval fixtures for the full-arguments commitment recipe.**
**MEASURED:** after `seal-host` `49a2a12` moved the eight acceptance rules to
full-arguments targets, `test/integration/test_host.py:204,241` and
`test/integration/test_host_rs.py:89` still pre-mint `db.execute` targets with
the old `"db"`, `database`, `"write"`, `sql` recipe. The measured direct
entrypoint runs exit 1 at `test_host.py:212` and `test_host_rs.py:117`, after
trusted-config startup. **INFERRED:** the old hashes are not equivalent to the
new whole-arguments commitment, so stale approval fixtures block both Python
integration suites.
**Serves: FLOOR, V3.1, V3.3, VERIFY. Status: OPEN; APPROVAL-FIXTURE
REGENERATION BLOCKS BOTH PYTHON SUITES.**

D.7 **Accept the authorization-decision discriminator across the verifier
fleet: CLOSED.** **MEASURED:** `seal-host` `7c83191` emits
`{"record_type": "seal.authorization-decision", "record_version": 2}`. The
seven live/shipping on-disk `receipt-format.js` copies accept that exact pair
on the current-v2 path; the test-only frozen
`seal-verify-action/test/reference-kit-0aeb35a/receipt-format.js` deliberately
retains its historical behavior. The five pushed fleet fixes are
`seal-assurance-kit` `bd1cf89`, `seal-check` `fcda028`, `seal-live-demo`
`ec03f2d`, `seal-verify-action` `7ea3cdb`, and `seal-demo` `a998b5b`.
`seal-host` `f820f0f` repins golden-path CI to `bd1cf89`. **INFERRED:** this
closes the discriminator split that caused three D.3 reds; their post-fix demo
outcomes remain unmeasured until a new run records them.
**Serves: V3.3, V3.4, VERIFY. Status: CLOSED; FIVE FLEET FIXES PUSHED AND CI
REPINNED AT `f820f0f`.**

D.8 **Obtain demo approval targets from the host, not private commitment
recipes.** **MEASURED:** `/home/monkey/.mega-monkey/demoapproval-2026-07-28.md`
finds private approval-target recipes in five demos and records their
replacement with targets discovered by blocked calls to the real host on
`fix/demo-approval-target-from-host`, commit
`888187ec8f99e0d72fc9983f709f23268ebafc87`. The token after-run used the same
host-minted target in the signed token and subsequent refusal, so target
discovery reached its intended boundary. The report explicitly leaves four
after-runs and the watched argument mutation unverified. **INFERRED:** this
removes one false oracle from the demo harnesses, but cannot make the demos
green while they still sign a record version the host refuses.
**Serves: V3.1, V3.3, VERIFY. Status: PARTIAL; TARGET DISCOVERY FIXED ON AN
UNMERGED BRANCH; DEMOS STILL RED.**

D.9 **Make ApprovalRecord v2 mintable from the product refusal.**
**MEASURED:** `/home/monkey/.mega-monkey/demoapproval-2026-07-28.md` records
that all five affected demos use the shared legacy v1 signer and that
`rust/src/providers.rs:21` names the structural refusal
`approval_record_v1_not_supported`; the path check recorded in
`/home/monkey/.mega-monkey/docsync-2026-07-28.md` resolves its two admission
calls at `rust/src/providers.rs:654` and `:1060`.
`/home/monkey/.mega-monkey/approvalv2-2026-07-28.md` records that v2 admission
requires the exact delimiter-bearing framed subject, while the refusal exposes
only the target and the retained BLOCK record contains a canonical body and
body hash rather than that framed preimage.
**INFERRED:** a separate approver receiving only the refusal cannot mint a
host-admissible v2 record; signing client-retained bytes would demonstrate
privileged harness knowledge, not a usable approval channel. **RULED:** the
refusal will emit the framed subject as base64 with explicit length; lane
`framedsubject` is implementing that decision.
**Serves: V3.3, VERIFY. Status: RULED AND IN PROGRESS; NOT DONE.**

D.10 **Track watched-mutation coverage against declared denominators.**
**MEASURED:** `/home/monkey/.mega-monkey/oraclecensus-2026-07-28.md` establishes
the first watched-mutation denominator:

| population | WATCHED | total |
|---|---:|---:|
| kernel guard rules | 35 | 47 |
| ApprovalRecord v2 signed leaves | 1 | 21 |
| authorization-decision committed leaves | 1 | 55 |

Population A is not declared in one place; the report reconstructs it across
several public judgment functions, ingest paths, and both legacy and v2
stacks. Its sole `UNTOUCHED` kernel rule is the legacy control-file symlink
refusal at `Seal/Channel.lean:50-69`, with no test reference found.
**INFERRED:** the denominator is a tracked baseline, not a completeness proof;
new public decision paths can move it until the population is centrally
declared. The next controls should be exact item mutations, beginning with the
authority-bearing gaps named by the census, rather than generic whole-record
reds.
**Serves: FLOOR, V3.1, V3.3, VERIFY. Status: MEASURED BASELINE; CONTROL
EXPANSION OPEN.**

D.11 **State the shipped ApprovalRecord v2 display limit without turning an
unimplemented profile into a defect.** **INFERRED FROM SOURCE:** the complete
leaf warrant in
`/home/monkey/.mega-monkey/v2leafwarrant-2026-07-28.md` classifies all 21
signed leaves as 7 `ENFORCED`, 14 `WELL-FORMEDNESS-ONLY`, and 0 `CARRIED`.
The weakness is concentrated in the display half: `shown_*`, `renderer.*`,
`approver`, and `session` meet no displayed bytes, renderer registry, or
authenticated approver comparand in the host. **MEASURED:** the three
independent searches recorded in
`/home/monkey/.mega-monkey/docsync-2026-07-28.md` find none of
`EVIDENCE_UNAVAILABLE`, `AUTHORIZED`, `NOT_REQUIRED`, or `NOT_REACHED` under
`seal-host/rust/src`, and find neither `shown` nor `presentation` in
`rust/src/authorization_decision.rs`. **INFERRED:** the shipped v2 record
carries display attestations that no component verifies, so claiming it proves
what a human saw would overstate the implementation today. This is not a
violation of `docs/AUTHORIZATION-RECORD.md:3,230-315`, whose
exact-presentation promise belongs to a profile explicitly marked `SPECIFIED,
NOT IMPLEMENTED`.
**Serves: V3.3, V3.4, VERIFY. Status: LIMIT MEASURED; SPEC LEFT ALONE;
DISPLAY VERIFICATION OPEN.**

### Phase M — MCP revision 2026-07-28 conformance

Ben ruled this into seal v1 on 2026-07-28. This is a lettered, cross-cutting
phase, recorded after the existing lettered Phase D; that placement adds no
schedule to the settled Phase 0–4 sequence. The evidence baseline is
`/home/monkey/.mega-monkey/mcpspec-report.md`; the costs and repin judgments
are `/home/monkey/.mega-monkey/v1mcp2026-2026-07-28.md`. The stateless core is
not work for the current stdio host. The live drift order is `_meta`, top-level
batch arrays, then MRTR; MRTR fails closed today.

**Ruling, 2026-07-28 21:47 — V2 release boundary.** V2 typed targets and effect
envelopes are inside the seal v1 release boundary. **Status: RULED; SOURCE
IMPLEMENTATION IN PROGRESS; NOT REPINNED.** This ruling roughly doubles the
affected Phase M estimates; every estimate and closure condition below
therefore includes the V2 surface where the costing lane supplied one.

M.1 **Commit the complete validated `_meta` object: OPTION A.** **Ruling,
2026-07-28 21:47:** the complete validated object, including every unknown key
and a distinct absent/present state, enters the effect commitment and the
guard/typed target. Today `_meta` is covered by the raw-line receipt digest and
exact full-frame approval subject but not those semantic identities or the
Rust canonical-request projection. Because V2 is now inside v1, the cost is
**up to 900 changed LOC across up to 22 files**, the sum of the costing lane's
two with-V2 upper bounds; this is roughly double the old v1-only estimate as a
direct consequence of the release-boundary ruling. Repin: **definite**.

The guard target becomes an **invocation identity rather than a stable name for
an action**. That cost is accepted, not overlooked and not a risk reserved for
later avoidance: approvals, capabilities and replay namespaces are intentionally
invocation-specific under this v1 contract.

**Correction, 2026-07-28:** the earlier claim that every
`traceparent` carries a fresh span ID on every request was too strong. The
trace keys are optional and MCP does not mandate a new span for every request.
One permitted changing value is nevertheless enough to produce the now-accepted
invocation identity. The C-refuse-unknown versus C-commit-unknown sub-question
is **CLOSED AS MOOT** because Option A commits unknown keys by construction;
`META-PARTITION-SPEC.md` retains the three-option decision history.

**CLOSED only when** the complete validated `_meta` value is present in the
effect commitment, guard target and V2 typed target/envelope; absent, null,
duplicate and unknown-key behavior is pinned by fixtures; mutations of any
accepted key change invocation identity; the exact-frame subject regression
remains green; and every required vector, artifact and pin is regenerated.
**Serves: FLOOR, V3.1, VERIFY. Status: STAGES 1–3 MERGED; COORDINATED REPIN
AND ROADMAP CLOSURE OPEN.** Evidence: `mcp-seal-dev` commits
`bcf8817d70f479ce69edf31f0d8c5c192e3669ec` and
`4131b85996c7c3e859dc4810243a3ffb594adf9e`, plus `seal-host` commit
`f49d1981582b90c0623200c351bc064460ab6932`, are ancestors of their current
`main` branches.

M.2 **Represent supported adapter revisions as a set.** **Ruling, 2026-07-28
21:47:** `MCP_ADAPTER_VERSION` becomes a supported-set representation, not a
scalar bump. The deployed constant is
`MCP_ADAPTER_VERSION = "2025-06-18"` at
`seal-host/rust/src/envelope_v23.rs:34`, two revisions behind the ruled
revision and already inside signed effect bytes. Because the ruled set is a
signed-shape change, the cost is **up to 450 changed LOC across up to 12 files**,
replacing the old 10–25 LOC scalar estimate for that reason, and it requires a
definite repin. A capability set does not erase the per-call fact: supported
revisions belong in `server/discover`, while each signed effect must still
identify the actual semantics used for that call.

M.2a **Settle the mixed-version policy forced by the supported set.** The named
choice is transparent dual-era mediation versus an explicitly terminating
translation gateway. Translation must identify at least the actual
client-facing revision, actual child-facing revision and translation-profile
identifier; transparency must make no translation claim. The obligation to
settle and encode this policy is **RULED AND ENCODED IN MERGED SOURCE**; no
hidden default is permitted.

**CLOSED only when** every signed effect identifies the actual enforced
revision semantics, Rust and Lean verification agree on that representation,
the M.2a transparent-or-translation policy is explicit and tested, all affected
signatures/goldens are regenerated, and the set claim is reflected in
`lake-manifest.json`, `PINS.md` and native/wasm provenance.
**Serves: FLOOR, V3.1, VERIFY. Status: SOURCE IMPLEMENTATION MERGED;
COORDINATED REPIN AND END-TO-END CLOSURE OPEN.** Evidence:
`mcp-seal-dev` commit `811adf9bd3da6a3774737f49b8658d61c0239dc9`
and `seal-host` commit `8dd43b5e8fe8dd536df2b620ed9804f3aa184e76`
are ancestors of their current `main` branches; the host remains pinned to
`bd03bf7b5ef1d7d29792d08b14f90d0654954207` at
`seal-host/lake-manifest.json:14-23`.

M.3 **Refuse top-level batch arrays. REQUIRED-FOR-V1.** A top-level JSON-RPC
array currently leaves the verified classifier as passthrough `0`; 2026 stdio
admits one message per line, so the required result is refuse `2`. The proof
obligations are the refused/escape classes and `classifyWire` consequences;
the lenient-call/undecided characterization; classification iff and partition
theorems; array structural lemmas and the batch witness/guards; escape
transport results; escape-event and purge consequences; enumerator
expectations and escape traces; executable host refusal; classifier encoding;
the Rust must-refuse corpus; and classifier mapping pins. Cost: **120–220
changed LOC across about 8 files**, of which the classifier branch is only
**10–20 LOC**. Repin: **definite**.

**CLOSED only when** top-level array witnesses classify as refuse in Lean and
the executable host, the old batch escape witness and traces are repaired or
removed, the Rust differential must-refuse corpus contains the case, all named
partition/escape proofs pass, and the classifier plus native/wasm pins are
refreshed on disk.
**Serves: FLOOR, V3.1, VERIFY. Status: SOURCE CHANGE MERGED; ROADMAP CLOSURE
AND REPIN OPEN; REQUIRED-FOR-V1.** Evidence: `mcp-seal-dev` commit
`5bf8e5577c0fdba9ddfadf324b10488f61075b3e` is an ancestor of current `main`
and explicitly defers the `seal-host` repin.

M.4 **Accommodate MRTR without weakening frame binding. REQUIRED-FOR-V1.**
The fixed rule is to represent absence distinctly, commit opaque
`requestState` exactly as a value, commit the complete canonical
`inputResponses` JSON value, and **never** relax the full-frame digest/length
admission check. Today an MRTR resubmission re-enters mediation and needs fresh
approval, so the live behavior is fail-closed; the latent defect is that the
kernel target cannot distinguish changed state or responses.

Because the ruled v1 boundary includes both surfaces, the cost is **up to 1,000
changed LOC across up to 24 files**, the upper end of the costing lane's
combined v1 guard/host plus V2 typed/signed estimate; the increase from the old
v1-only upper bound of 350 LOC is a consequence of that ruling. Repin:
**definite**. This accommodation fixes target collision; it does not introduce
approval reuse.

**CLOSED only when** equal arguments with different `requestState` or
`inputResponses` produce different proved target keys, absence is distinct
from every present value, Rust and Lean signed shapes agree, the existing exact
frame digest/length check remains in force with a regression test, and all
affected classifier, signed-shape, vector and artifact pins are regenerated.
**Serves: FLOOR, V3.1, VERIFY. Status: STAGES 1–3 MERGED; COORDINATED REPIN
AND ROADMAP CLOSURE OPEN; REQUIRED-FOR-V1.** Evidence: `mcp-seal-dev` commits
`cd9ebba449bd2c0bd87a39eecdf1a58ee92a9ed7` and
`81b2114a40e7904fd68cee3698416c05817688b7`, plus `seal-host` commit
`6700282635e2aec38d622314718bb12c38377590`, are ancestors of their current
`main` branches.

M.4a **Ship the replay-store guard release before the repin.** **RULED,
Ben 2026-07-29 11:57: option C, refuse startup on a stale or
format-mismatched replay store.** This is a ruling on design, not implementation
evidence and not an executable procedure. The guard release is a **RULED
PREREQUISITE** on the Phase M critical path: it ships before the repin, retains
the old codec, and creates and checks `schema_version`,
`namespace_encoding_version`, and `ledger_generation` against authority-signed
configuration. A store-minted generation is not a trust anchor.

Rotation (Option A) is not the default cutover. It remains available only as an
explicit operator act after the refusal gate and never as automatic boot-time
acceptance of a foreign encoding. Migration (Option B) is **REJECTED AS NOT
WELL-DEFINED** as a verified fact, not a preference: the shipped store retains
no target preimage to re-key from. The evidence is
`seal-host/rust/src/replay_store.rs:72-76` and `:103-115`. After activation,
rollback to any unguarded binary is forbidden; only roll-forward is safe.

No rotation, migration, drain, mixed-version deployment, or rollback command is
designed here. The Phase M critical path remains blocked on the implementation
evidence and the four unchanged transition confirmations in
`docs/REPIN-RUNBOOK.md` step 13.
**Serves: FLOOR, V3.1, VERIFY. Status: RULED PREREQUISITE; NOT IMPLEMENTED
ON `seal-host` `main`; PROCEDURE UNDESIGNED.** Evidence: ruling commit
`83f278d150c7cc53c142cd9bf8cf819fc31f8b55`; the current store schema still
contains only `nonce`, `issued_at` and `expiry_at` at
`seal-host/rust/src/replay_store.rs:64-80`, while the four unchanged
confirmation requirements remain at `docs/REPIN-RUNBOOK.md:963-985`.

M.5 **Preserve `server/discover`.** Implementing the endpoint in seal is
**NOT-APPLICABLE** while seal is a transparent interposer: the child server,
not seal, owns its versions, capabilities and `serverInfo`. Preservation is
**REQUIRED-FOR-V1**. The current non-`tools/call` passthrough is the intended
class. A request/response byte-preservation and no-fabrication fixture is now
merged at `seal-host/test/integration/test_discover_preservation.py`; this
audit established its presence on `main` but did not re-run it. Terminating
discovery would be a different gateway design and costs **150–300 LOC across
4–7 files** before translation logic.

**CLOSED only when** a checked host/differential fixture proves a
`server/discover` request and its child response survive byte-for-byte, and no
seal path fabricates child versions, capabilities or `serverInfo`.
**Serves: V3.1, VERIFY. Status: BYTE-PRESERVATION FIXTURE MERGED; EXECUTION
EVIDENCE UNVERIFIED IN THIS AUDIT; REQUIRED-FOR-V1 AS A PRESERVED METHOD.**
Evidence:
`seal-host` commit `129fe83288cdeaca6fc408ce26b4920f7801dcfc` is an ancestor of
current `main`; its live request/response byte comparisons and production
no-fabrication check remain at
`seal-host/test/integration/test_discover_preservation.py:157-214`.

M.6 **Keep explicit 2025 and 2026 demo eras. REQUIRED-FOR-V1.** **Ruling,
2026-07-28 21:47:** demos are dual-era, not silently mixed. **Status: RULED,
PARTIAL — FILESYSTEM DUAL-ERA; SEVEN DEMOS LEGACY-ONLY.** All eight checked-in
`demo/golden_path*.py` programs retain the legacy `initialize` /
`"2025-06-18"` path; only the filesystem program also carries the modern
path. A modern path uses `server/discover`, carries required modern `_meta`,
and emits the modern success shape including `resultType` where applicable. A
shared dual-era child plus client-mode parameter costs **up to 400 changed LOC
across the eight scripts and `demo/doctrine.py`**, replacing the old 120–240
LOC modernization-only estimate because the ruling retains both eras and
requires their distinction to be taught explicitly.

**CLOSED only when** at least one checked-in golden path exercises
`server/discover`, required modern request metadata and `resultType`, its
assertions pass under the ruled adapter semantics, both the 2025 and 2026 paths
are explicit on disk with no cross-era mislabeling, and a reader can tell which
era each demo speaks and why both eras exist.
**Serves: V3.3, V3.4, VERIFY. Status: RULED, PARTIAL — FILESYSTEM DUAL-ERA;
SEVEN DEMOS LEGACY-ONLY; REQUIRED-FOR-V1.** Evidence: `seal-host` commit
`25ab0f262ff281d572d78ad50c895d889d393653` is an ancestor of current `main`;
`seal-host/demo/golden_path_filesystem.py:65-72` names both eras and the modern
`resultType`, while each of the other seven `demo/golden_path*.py` files still
contains `initialize` with `2025-06-18` and no `server/discover`.

M.7 **Close the other transparent-interposer obligations.** For mediated
`tools/call`, validate per-request modern `protocolVersion` and
`clientCapabilities` before seal blocks, approves or receipts it; malformed
required metadata maps to `-32602`, and an unsupported revision maps to
`-32022` with supported versions. Cost: **150–300 changed LOC across 5–8
files**. A Lean-owned gate forces a classifier repin; a Rust-only pregate
avoids that source repin but creates a separate trusted divergence requiring
pinned cross-language fixtures.

`resultType` does not require transparent response rewriting: omission means
`complete`, child success responses are relayed verbatim, and seal's local
policy responses are errors. Demo children carry the update under M.6; an
explicit relay fixture is optional at **10–20 LOC**.

Mixed-version transparency means preserving both modern `server/discover` and
legacy `initialize`, mediating the received call shape, making no false claim
that a legacy child is modern, and signing the actual semantics used. It does
not make a modern-only client and legacy-only child interoperate. Claiming
translation changes the product boundary: terminating both sides, truthful
intersection advertising, validation, error/result/MRTR translation and the
signed ingress/egress/profile claim cost **800–1,500 changed LOC across 12–20
files** before adversarial interoperability fixtures, with a definite repin.

**Correction, 2026-07-28:** V2 typed targets and envelopes are inside v1, so
the earlier conditional boundary language is false. The V2.3 unsolicited startup
`notifications/seal/session` is also non-conforming modern stdio output.
Moving issuance behind a defined extension or subscription costs **100–250
changed LOC across 4–7 files** without a signed-shape repin if the session
claim stays intact; changing that signed session shape costs **250–500 LOC**
and requires a definite repin. This is a required v1 closure surface.

**CLOSED only when** modern `tools/call` metadata errors are pinned in
cross-language differential fixtures before any authority decision; success
responses preserve child `resultType` bytes; both discovery and legacy
initialization relay truthfully; the signed adapter fact matches the semantics
used; no translation is claimed without complete gateway fixtures; and the
V2.3 notification is emitted only by a conforming mechanism.
**Serves: FLOOR, V3.1, V3.3, VERIFY. Status: RULED, PARTIAL; KERNEL
PER-REQUEST VALIDATION/ERROR MAPPINGS MERGED; HOST INTEGRATION PARKED PENDING
THE SINGLE REPIN; CONFORMING V2.3 FORWARDING NOT IMPLEMENTED.** Evidence:
`mcp-seal-dev` merge `6aa2ddc5d75960e8ef3c1fd5490a9cbe52284faa`
adds the gate and exact `-32602` / `-32022` mappings at
`SealV2/McpVersionGate.lean:21-109`, 13 watched cases at
`Test/M7VersionGate.lean:38-143`, and
`scripts/run_m7_version_gate.sh`. The unmerged `seal-host` branch
`feat/m7-version-gate` ends at `f712774ed63d390b2fa144515d3c0883133736f4`;
its `Ffi.lean:11-13` imports `SealV2.McpVersionGate`, which the current
`bd03bf7b5ef1d7d29792d08b14f90d0654954207` manifest pin does not contain.
Current `seal-host` `main` still emits the unsolicited startup notification at
`rust/src/main.rs:1200-1210`.

M.8 **Write the one-repin execution runbook.** **Ruling, 2026-07-28 21:47:** the
single Phase M repin must be fully written down so the process is repeatable.
This item records the deliverable; it does not contain or claim the runbook.

**CLOSED only when** a stranger can execute the checked-in runbook without
tribal knowledge and it names, at minimum: the ordered steps; every artifact
that must move together; the verification after each step; and the named
failure modes from past repins.
**Serves: FLOOR, V3.1, VERIFY. Status: RUNBOOK PRESENT; EXECUTABLE CLOSURE
NOT ESTABLISHED.** Evidence: `docs/REPIN-RUNBOOK.md:1-20` defines the checked-in
one-repin runbook and its evidentiary vocabulary; its merge-ledger requirement
remains **PROPOSED** at `:175-203`, and step 13's transition procedure remains
**UNDESIGNED** at `:900-985`.

#### Phase M repin summary

**Standing rule, ruled 2026-07-28 21:47: ALWAYS ONE REPIN.** Never piecemeal.
Every Phase M item that forces a repin waits, and all such changes, artifacts,
pins and provenance land in one verified repin act. M.8 makes that act
repeatable; neither the rule nor the runbook obligation is implementation
evidence.

**Ruled prerequisite, Ben 2026-07-29 11:57:** M.4a's old-codec guard
release ships before that one repin. The repin cannot be the first binary that
interprets replay-store format markers. This ordering is ruled design, not
evidence that the guard or transition procedure exists.

**Confirming ruling, 2026-07-29 11:56 — ONE.** Asked against the live
temptation to repin what had landed and return for the rest, Ben answered
**"one"**. This confirms the standing rule against that concrete split; it
does not replace or re-date the 2026-07-28 rule.

Five change classes in the costing can force the verified kernel/artifact
repin: the selected A `_meta` target/effect shape; batch
classification from passthrough to refuse; MRTR fields in the guard/typed
target; the ruled signed adapter set or a later
ingress/egress translation shape; and a changed V2 signed session shape.
**Disk-verified status, 2026-07-29:** the commit-level implementation status
below supersedes the dated pre-implementation descriptions above for these
five classes only; the item-level status lines use current vocabulary. It is
not evidence that an entire M item is closed, and none of it is a repin. The
audit baseline, fetched immediately before this documentation change, was
`seal` `83f278d150c7cc53c142cd9bf8cf819fc31f8b55`, `seal-host`
`84e8abbf90585d30de18a7222f5949cea9c1a012`, and `mcp-seal-dev`
`6aa2ddc5d75960e8ef3c1fd5490a9cbe52284faa`; each clean working copy was
zero commits ahead of and behind `origin/main`:

- **Option A `_meta` target/effect shape (M.1): STAGES 1–3 MERGED; COORDINATED
  REPIN OPEN.** Kernel stage 1 merged at
  `bcf8817d70f479ce69edf31f0d8c5c192e3669ec`, V2 stage 2 at
  `4131b85996c7c3e859dc4810243a3ffb594adf9e`, and the host projection stage 3
  at `f49d1981582b90c0623200c351bc064460ab6932`. All three are ancestors of
  their repository `main`; the first two merge records explicitly defer the
  host repin.
- **Batch passthrough-to-refuse classification (M.3): SOURCE CHANGE MERGED;
  ROADMAP CLOSURE AND REPIN OPEN.** The source merge is
  `5bf8e5577c0fdba9ddfadf324b10488f61075b3e`; its commit record explicitly
  says it does not repin `seal-host`, so M.3 is not yet **CLOSED** under the
  closure condition above that requires refreshed classifier and native/wasm
  pins.
- **MRTR guard/typed-target fields (M.4): STAGES 1–3 MERGED; COORDINATED REPIN
  OPEN.** Kernel stage 1 merged at
  `cd9ebba449bd2c0bd87a39eecdf1a58ee92a9ed7`, V2 stage 2 at
  `81b2114a40e7904fd68cee3698416c05817688b7`, and host stage 3 at
  `6700282635e2aec38d622314718bb12c38377590`; all are ancestors of their
  repository `main`.
- **Ruled signed adapter set (M.2/M.2a): SOURCE IMPLEMENTATION MERGED;
  COORDINATED REPIN AND END-TO-END CLOSURE OPEN.** Kernel merge
  `811adf9bd3da6a3774737f49b8658d61c0239dc9` and host merge
  `8dd43b5e8fe8dd536df2b620ed9804f3aa184e76` are each both `main` and
  `origin/main`. The kernel tree contains the adapter revision set and scalar
  entry-era mapping in `SealV2/EffectEnvelope.lean`; the host tree contains
  `rust/src/adapter_revision.rs` and the transparent dual-era policy. These
  source merges do not repin any kernel or derived artifact. M.7's kernel-side
  per-request `protocolVersion` / `clientCapabilities` validation and exact
  `-32602` / `-32022` mappings have since merged at
  `6aa2ddc5d75960e8ef3c1fd5490a9cbe52284faa`, but their host integration is
  parked off `main` pending the single repin; only the filesystem child
  advertises the dual set, and no modern V2.3 signed effect has been forwarded
  end to end.
- **Per-request version gate (M.7): KERNEL SOURCE MERGED; HOST INTEGRATION
  PARKED; V2.3 FORWARDING OPEN.** Kernel merge
  `6aa2ddc5d75960e8ef3c1fd5490a9cbe52284faa` is current
  `mcp-seal-dev` `main`. `SealV2/McpVersionGate.lean:21-109` owns the exact
  error rendering and validation; `Test/M7VersionGate.lean:38-143` contains 13
  watched cases; `scripts/run_m7_version_gate.sh` rebuilds before executing
  them. The host bridge is not on `seal-host` `main`: branch
  `feat/m7-version-gate` ends at
  `f712774ed63d390b2fa144515d3c0883133736f4`, whose `Ffi.lean:11-13` records
  and imports the new dependency. The current manifest still pins
  `bd03bf7b5ef1d7d29792d08b14f90d0654954207` at
  `seal-host/lake-manifest.json:14-23`, and that tree has no
  `SealV2/McpVersionGate.lean`; the branch is intentionally parked red until
  the one repin rather than being treated as merged or done.
- **Changed V2 signed session shape (M.7 tail): UNVERIFIED as a repository-wide
  “not started” claim.** No changed shape was established. The current checked
  host still emits `notifications/seal/session` with `schema:
  "seal.session/v1"` and `envelope: "seal.effect/v2"` at
  `seal-host/rust/src/main.rs:1200-1210`, also documented at
  `seal-host/docs/EFFECT-ENVELOPE-V23.md:15-29`; absence of a located change is
  not proof that no branch or uncommitted lane exists.

**Checked merge outside Phase M:** `seal-host` merge
`84e8abbf90585d30de18a7222f5949cea9c1a012` adds verification of the shipped
trusted policy example's Ed25519 signature against
`config/trusted.example.pub`; the executable step is
`seal-host/scripts/policy_schema_gate.sh:44-69`. Its diff is confined to the
trusted example, its public key, deployment documentation and the policy schema
gate. It does not establish any MCP revision-conformance closure condition and
therefore belongs to no Phase M item.

The concrete pin surfaces are
`seal-host/lake-manifest.json:14-23`, `seal-host/PINS.md:42-46`, the native FFI
artifact and `seal-host/wasm-spike/verified/PROVENANCE.txt:12` onward.

## WHY-to-HOW map for the original 17-item roadmap

| former item | now | north-star WHY |
|---|---|---|
| 1 release-evidence | 2.2 | FLOOR, V3.1 |
| 2 differential/parser contracts | 2.3 | V3.1 |
| 3 literal interior NUL | 2.4 | V3.1 |
| 4 `RepinStep2Guards` target | 2.5 | FLOOR, V3.1 |
| 5 Emscripten | 2.6 | V3.1 |
| 6 rendering `R` | 3.2 | V3.1, V3.3, VERIFY |
| 7 escaping/truncation | 3.3 | V3.3, VERIFY |
| 8 signed comprehension + record | 3.4 | V3.3, VERIFY |
| 9 agreement proof | 3.5 | V3.1, V3.3, VERIFY |
| 10 coercion check | 3.6 | V3.1, V3.3, VERIFY |
| 11 printer TCB | 3.7 | V3.3, VERIFY |
| 12 state what was shown | 3.8 | V3.3, VERIFY |
| 13 one settled wasm rebuild | 3.10 | V3.1, V3.3 |
| 14 field-warrant harvest | 2.12 | FLOOR, V3.1, V3.3 |
| 15 external oracles | 2.9 | FLOOR, V3.1 |
| 16 merge remaining branches | 4.2 | NONE until individually mapped |
| 17 monorepo | 4.3 | FLOOR, V3.1 |

## Evidence-backed status board

This board records how each status was established. An entry without current
evidence is UNVERIFIED rather than confidently coloured.

| item | status | how established |
|---|---|---|
| g9 Decision Bundle + verifier | **SPECIFIED; CANONICAL STATUS FORKED; IMPLEMENTATION UNVERIFIED** | g9 §§2, 3 and 8 name them; adjusted SHORT retains them; later required sources omit but never explicitly supersede them |
| release-evidence CI | **LANDED** | `f198642` is an ancestor of `seal-host` main; gate script and workflow wiring are present |
| V3.1 numeric subwork | **DONE AND PUSHED** | `mcp-seal-dev` local `main` and `origin/main` both resolve to `6c23b5c`, after the agreement guard and coefficient-conjunct demotion |
| V3.1 configured divergence set | **18/18 VECTORS, 5/5 OBSERVERS CHARACTERISED** | `ba4e21d` is an ancestor of `seal-host` main; the merged report records 90/90 definite cells |
| V3.1 as a whole | **PARTIAL / OPEN** | the same merged report records nine forwarded surrogate disagreements; neither required source nor this check establishes a verified parser or complete proven host invariant |
| blind T1.1 | **FRISKED; SPEC-SIDE; OPEN / DUAL-PARSE UNVERIFIED** | **MEASURED:** the two alleged identifiers occur in g9, not current implementation source; the live classifier is `classifyToolCall`. **UNVERIFIED:** whether classification and decision independently parse the same bytes |
| blind T1.2 | **FRISKED; UNREACHABLE IN IMPLEMENTATION; SPEC LABEL OPEN** | **MEASURED:** the g9 verifier/outcome ABI is absent; RUN `t12-always-allow` reached the live child with an `ALLOW` authorization decision and emitted no g9 status; the over-broad predicate and live B-naming claims are partly rejected |
| blind T1.3 / compulsory verify moment | **DIRECTION SETTLED; IMPLEMENTATION UNFRISKED/OPEN** | Ben's 2026-07-24 ruling selects the mandatory inline gate; the blind lead's current code diagnosis was not independently established here |
| V3.2 reachability | **V0 EXISTS AND IS MERGED; NOT COMPLETE** | `b800096` is an ancestor of `seal-host` main; signed payload on disk contains `denominator.sound = false` and `coverage_percent = null` |
| V3.3 one sink end to end | **PARTIAL; END TO END UNVERIFIED** | D.1-D.11 establish a classified baseline, several landed repairs, and the current approval queue; no run yet satisfies all four V3.3 success criteria |
| ApprovalRecord v2 sub-artifact | **LANDED; PRODUCT MINTING PATH OPEN; DISPLAY CLAIM LIMITED** | the artifact commits are merged, but D.9 measures that a separate approver cannot mint v2 from the current refusal and records the framed-subject repair as in progress; D.11 records that the shipped display tuple has no external comparand |
| four-leg Option D authorization decision | **PARTIAL / COMPLETE IMPLEMENTATION UNVERIFIED** | rename and ApprovalRecord v2 commits landed; D.11's independent searches find none of the four authorization-leg outcome names and no shown/presentation field in the shipped authorization-decision builder |
| V3.4 write-up | **UNVERIFIED** | no completion evidence checked |
| boxpol | **SPECIFICATION PRESENT; BUILD UNVERIFIED** | V3 points to `POLICY-LANGUAGE.md`; build state was not established |
| MCP 2026-07-28 conformance | **RULED, IN PROGRESS; NOT REPINNED** | Phase M records its disk-verifiable closure conditions and M.4a's ruled guard-release prerequisite; the dated repin summary records merged M.1/M.3/M.4 and M.2/M.2a source work, plus M.7's kernel-side version gate at `6aa2ddc5d75960e8ef3c1fd5490a9cbe52284faa`, while the M.7 host bridge remains parked pending the single repin and conforming V2.3 forwarding remains open, without claiming a completed item, implemented guard, transition procedure, release, or repin |
| demos | **22/22 CLASSIFIED BASELINE; TARGET FIX UNMERGED; FRAMED-SUBJECT REPAIR IN PROGRESS** | D.2 preserves the measured 1-green/8-red symptom table but supersedes its four-root inference; D.8-D.9 record the shared v1 refusal, unmerged target discovery, and ruled v2 product repair |
| watched-mutation coverage | **BASELINE MEASURED; EXPANSION OPEN** | D.10 tracks kernel guards at 35/47 WATCHED, ApprovalRecord v2 signed leaves at 1/21, and authorization-decision committed leaves at 1/55; Population A is reconstructed rather than centrally declared |
| post-shape `three_way_agreement` | **UNVERIFIED** | the prior roadmap's dated red is preserved below as history; this graft did not run the current suite |

## Rejected alternatives and reversals that remain load-bearing

- The g8 “bug-pure by construction” claim was reversed by g9. Hashed-reference
  determinism is tested conformance, not hand-proved exhaustiveness.
- More specification grind was demoted. A documented control that cannot fail
  in execution is decoration.
- Option A, canonical re-encoding of the mediated request, was rejected because
  it does not make out-of-range numbers representable and inserts an unproved
  semantics-preservation transform between approval and dispatch.
- The parser-disagreement response moved from B's fail-closed restriction to C's
  executor attestation, then to D's four separate facts with ACKNOWLEDGED
  remaining UNKNOWN absent cooperation. Preserve the reversal; do not describe
  D as proof of execution.
- The object is an authorization decision, not an effect receipt. JUDGED,
  AUTHORIZED, DISPATCH ATTEMPTED and ACKNOWLEDGED must not collapse into one
  green fact.
- **MEASURED:** T1.1 and T1.2 entered this roadmap as unfrisked
  implementation-freeze gates. Their completed frisks instead located T1.1's
  named machinery only in g9 and found T1.2's g9 verifier absent, while the
  deployed path used a distinct authorization-decision surface. **INFERRED:**
  that reverses the factual basis for the council's ordering, but does not
  itself reverse the order; the sequencing fork remains Ben's.
- The digest shown to the human is the full 64-hex target, not a 16-character
  truncation. The comprehension defect is that a digest is not meaningful, not
  that this path truncates it.
- The transport is an adapter, not the thesis. MCP may remain the current
  surface without becoming a maintained connector catalogue.
- No connector catalogue, secrets store, HA product, dashboard, enterprise
  surface or threshold sharing for a password enters this plan without a new
  explicit ruling.
- **MEASURED — 2.3 status correction, not new work:** the
  `parser_boundary.rs` outcome contracts were already tight; RUN
  `parserbound-contract-verification-2026-07-27` closed the stale
  PARTIAL/UNVERIFIED marker without a code change.
- **MEASURED — 2.4 status correction, not new work:** literal interior-NUL
  coverage already existed in `str-raw-nul` and `nul_seam.rs`; RUN
  `nulbyte2-20260727-already-covered` closed the stale OPEN/UNVERIFIED marker
  without a code change.

## Historical red, not promoted to current status

The prior roadmap deliberately carried `three_way_agreement` red because its
pinned wasm predated raw-wire guards and scheduled closure at the one settled
rebuild. That is useful reversal history and remains recorded here.

It is **not** asserted as today's status. This graft did not run the current
suite, and the repository history contains later wasm repin work. Phase 3.10
therefore requires a fresh post-shape rebuild and observation rather than
copying either the old red or a newer commit message into a green claim.
