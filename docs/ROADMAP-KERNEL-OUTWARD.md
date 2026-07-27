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

Two later rulings constrain every phase:

- 2026-07-27 01:04: the differential/conformance apparatus is half the product.
  It is seal, co-equal with the kernel and broker, not disposable scaffolding.
- 2026-07-27 15:03: preserve the checked chain; shape, naming, versioning and
  compatibility may change. Chain rigor is fixed. Its packaging is not.

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

2.2 **`release-evidence` CI gate** *(former roadmap item 1)*. Missing private
evidence must make the release verdict red, and every required Lean, Rust,
conformance, security and golden-path result must be observed.
**Serves: FLOOR, V3.1. Status: LANDED.** Established by
`f198642` being an ancestor of `seal-host` main and by the gate script and
workflow wiring present there.

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

2.5 **Make `RepinStep2Guards` a real lakefile target** *(former item 4)*, then
ablate the NFD comparison and record the red result.
**Serves: FLOOR, V3.1. Status: OPEN; implementation UNVERIFIED.**

2.6 **Emscripten toolchain availability** *(former item 5)*. This is a
prerequisite for rebuilding and testing the browser artifact, not an end in
itself.
**Serves: V3.1. Status: UNVERIFIED.**

2.7 **Keep the completed numeric work complete, without calling V3.1 done.**
The semantic response to the parser finding moved from Option B to C at 08:01
and then to Option D at 08:34: record four separate facts, leave executor
acknowledgment UNKNOWN without cooperation, and never fuse authorization with
execution. The numeric agreement implementation itself is done and pushed.
**Serves: V3.1. Status: DONE AND PUSHED for the numeric subwork.** Established
by `mcp-seal-dev` `main` and `origin/main` both at `6c23b5c`, whose history
contains the agreement guard and the later coefficient-conjunct demotion.

2.8 **Keep the complete parser-divergence characterization in required
evidence.** All 18 configured divergence vectors and all five observers have
definite outcomes; this closes the stale “13 untested” statement, not the
underlying correspondence gap. Nine forwarded surrogate vectors disagreed.
**Serves: V3.1. Status: CHARACTERISED, GAP OPEN.** Established by
`ba4e21d` being an ancestor of `seal-host` main and
`docs/V31-DOWNSTREAM-PARSER-AGREEMENT.md` recording 18/18, 5/5 and 90/90.

2.9 **External oracles in required CI** *(former item 15)*. Keep JSONTestSuite
and Wycheproof, add any boundary corpus selected by the Phase-2 fork, and prove
each control can fail.
**Serves: FLOOR, V3.1. Status: PARTIAL/UNVERIFIED as a complete required-CI
set.** Individual artifacts exist; the complete current required-CI claim was
not established in this graft.

2.10 **Implement or explicitly supersede the Decision Bundle and CFG.** This is
the implementation consequence of Phase 0.1 and the artifact fork. No successor
may lose request/approval/decision separation, out-of-band trust, byte
re-derivation or the honest event ceiling.
**Serves: FLOOR, V3.1, VERIFY. Status: OPEN after Ben's fork.**

2.11 **Implement the verifier consumed by the future inline gate.** Carry
fail-closed typed outcomes, trust-context binding, exact-byte references,
context and identity pinning, kernel pinning, limitations and negative controls.
**Serves: FLOOR, V3.1, VERIFY. Status: OPEN after Ben's fork.**

2.12 **Harvest `feat/field-warrant`** *(former item 14)* for expiry,
issued-at freshness, policy-version and delegation gates, but only after
checking those gates against the artifact selected above.
**Serves: FLOOR, V3.1, V3.3. Status: OPEN; branch and current applicability
UNVERIFIED.**

2.13 **Accept the reachability v0 baseline without laundering its denominator.**
The signed report exists and is merged. It says
`denominator.sound = false`, emits no coverage percentage, and carries UNKNOWN
sentinels because declared inventory is not total reachability. The next V3.2
work is to decide what evidence can soundly improve that denominator without
rounding UNKNOWN to covered.
**Serves: V3.2. Status: V0 MERGED; V3.2 NOT COMPLETE.** Established by
`b800096` being an ancestor of `seal-host` main and the signed payload on disk.

Phase 2 is complete only when the Tier-1 items Ben keeps on the implementation
path are dispositioned, the binary/conformance fork is ruled, the selected
floor has executable negative controls, and the evidence gate measures that
selected floor.

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

3.12 **Make the demos a real roadmap surface.** There are 21 Python scripts
under `seal-host/demo/`. Inventory each against a north-star claim, define its
prerequisites and oracle, run it on a clean path, and retain at least one
failure observation for every demo promoted as evidence. Scripts that are
examples rather than controls must say so.
**Serves: V3.3, V3.4, VERIFY. Status: 21 PRESENT; RUN STATE UNKNOWN.**
Presence was established by enumerating `seal-host/demo/*.py`; no claim is made
that any particular script runs today.

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
| V3.3 one sink end to end | **UNVERIFIED AS A WHOLE** | no run satisfying all four V3.3 success criteria was checked in this graft |
| ApprovalRecord v2 sub-artifact | **LANDED** | `e8f3a3a` and demo follow-up `444af1e` are ancestors of `seal-host` main |
| four-leg Option D authorization decision | **PARTIAL / COMPLETE IMPLEMENTATION UNVERIFIED** | rename and ApprovalRecord v2 commits landed; no complete four-leg evidence RUN was established here |
| V3.4 write-up | **UNVERIFIED** | no completion evidence checked |
| boxpol | **SPECIFICATION PRESENT; BUILD UNVERIFIED** | V3 points to `POLICY-LANGUAGE.md`; build state was not established |
| demos | **21 PYTHON SCRIPTS PRESENT; RUN STATE UNKNOWN** | enumerated `seal-host/demo/*.py`; none was assumed runnable from presence |
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
