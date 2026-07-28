# North Star V3

Written 2026-07-25 after the topology-C ruling, the adversarial council `12c998e1`
and a five-seat neutral product assessment. Supersedes `NORTH-STAR-ADJUSTED.md`
for PRIORITY and SCOPE. That document's diagnosis still stands and is not
restated here.

This document exists because the roadmap changed shape twice in one day and the
reasons were spread across chat, councils and three other files. One place, one
order, one set of things we are explicitly not doing.

---

## 1. What seal is, in one sentence

> Every agent security tool shows you a green dashboard for the paths it watches.
> Seal machine-checks the path it covers, and signs a map of the ones it does not.

Two claims, both meant literally:

- **For the effects it brokers**: this happened because a specific human approved
  these specific bytes, and the decision function that concluded so is
  machine-checked.
- **For everything else**: here is the list of authority paths this system does
  NOT cover, signed, printing UNKNOWN where coverage cannot be determined.

The second claim is the invention. The first is table stakes that we happen to do
more rigorously than the field.

## 2. What this project is FOR. Settled, not to be reopened

**Ruled by Ben 2026-07-25: seal is an open-source engineering artifact and career
centrepiece. It is not a startup.**

Five independent models on a neutral brief, told explicitly they could answer "do
not build this", returned: **no standalone business, yes credible artifact**,
unanimously. That divergence is the answer rather than a problem, because the
artifact was always the goal.

Consequences that bind the rest of this document:

- Market size is not an input to any decision here.
- "Nobody will pay for it" is not an objection. OpenSSH, curl and sqlite are the
  reference class.
- **ARIA is compatible with this.** Their deployment paths are "spinout,
  partnership, **or upstreaming**", and upstreaming is open source. Their own
  template states that the commercialisation hypothesis is not a selection
  criterion, and their IP terms require specs and proof artefacts to be published
  openly. A funded open-source outcome is a first-class ARIA outcome.
- Effort is judged by: does this make the artifact more correct, more credible, or
  more legible to a serious reviewer.

## 3. The build, in order

Four things, plus two admitted by ruling. Nothing else is on the roadmap.

**Correction, 2026-07-28.** The previous sentence said “plus one.” Ben has now
ruled MCP revision 2026-07-28 support into seal v1. That admits a required
compatibility workstream; it does not silently assign Phase M a schedule
position among the settled four.

### Status at a glance

Added 2026-07-26. Before this, answering "how far along are we" meant reading the
whole file and then digging on disk. **Keep this current or delete it**, because a
status board that lags is the same defect as a stale `PINS.md` row.

Last refreshed 2026-07-28.

| item | status | the honest one-liner |
|---|---|---|
| V3.1 proofs-to-bytes | **PARTIAL** | numeric agreement and the 18-vector/five-observer characterization are complete; parser correspondence is not (`ROADMAP-KERNEL-OUTWARD.md` 2.7-2.8; `mcp-seal-dev` `6c23b5c`; `seal-host` `ba4e21d`) |
| V3.2 unbrokered reachability | **PARTIAL — V0 ONLY** | v0 declares its scope and limitations in the signed document, prints total reachability as UNKNOWN and no percentage, and rejects a payload that claims a sound denominator; V3.2 has not moved past v0 (`ROADMAP-KERNEL-OUTWARD.md` 2.13; `seal-host` `b800096`, `rust/src/reachability.rs:321-399,432-470,506-509,624-661`) |
| V3.3 one sink end to end | **PARTIAL — FRAMED SUBJECT IN PROGRESS** | position: target discovery is fixed only on unmerged `888187e`; the five approval demos still sign refused v1 records, and a separate approver cannot mint v2 from the current refusal. Queue: finish the ruled framed-subject emission, integrate target discovery, migrate the demos to v2, then rerun the watched mutations and classified demo surface (`ROADMAP-KERNEL-OUTWARD.md` D.2,D.8-D.11) |
| V3.4 the write-up | **NOT STARTED** | |
| boxpol | **SPECIFIED, NOT BUILT** | correctly gated: starts after V3.1 or not at all |
| V3.5 MCP 2026-07-28 conformance | **RULED, NOT STARTED** | Option A commits complete `_meta`; supported revisions are a signed set; V2 targets/envelopes are inside v1; demos are dual-era; and Phase M gives all eight items disk-verifiable closure conditions (`ROADMAP-KERNEL-OUTWARD.md` Phase M) |
| factory prediction confirmation | **RULED, NOT STARTED** | the needs-you inbox is the selected answer to the prediction-confirmation bottleneck; neither retirement of the unresolvable class nor waiting for 31 July remains the plan |

**What V3.1 PARTIAL means**, because a colour is not evidence:

- **Done.** The live Lean/Rust encoder differential is un-ignored and passing
  13/13 over the shared corpus, with a byte-level ablation proving it can fail.
- **Done, and it is the substantive result.** `v31run` measured a real
  cross-parser disagreement: the kernel signed
  `external.json_corpus([-10^9999])` while a real downstream MCP server extracted
  `external.json_corpus([-Infinity])` from the same approved bytes. So approval
  under the kernel's `CanonicalAction` does NOT by itself establish downstream
  agreement about the forwarded effect. NOT a demonstrated unsafe act: the
  application rejected those arguments afterwards for unrelated reasons.
- **Done for the numeric subwork; not V3.1 done.** `NUMERIC-AGREEMENT.md` Option
  B was accepted 2026-07-26, and is no longer in flight. Its first implemented
  rule's coefficient conjunct was superseded by Ben's 2026-07-27 11:05 ruling:
  exact binary64 agreement now decides accepted integers, with coefficient length
  retained only as a pre-conversion resource bound (`mcp-seal-dev` `b467c7d`,
  merged as `6c23b5c`; `Seal/JsonUtil.lean:336-367,381-418`). The numeric spec's
  Option C, downstream attestation, was present and rejected on 2026-07-26; no
  numeric Option D exists on disk.
- **NOT done, and this is the stated V3.1 scope.** A verified JSON parser in Lean,
  or proven serialization invariants with executable checks that the host upholds
  them. Neither exists.
- **Done for characterization; not parser correspondence.** The recursive harness
  names and ran all 18 divergence vectors, one negative control and five concrete
  observers: 18/18 vectors, 5/5 observers and 90/90 matrix cells have definite
  outcomes (`seal-host` `ba4e21d`;
  `scripts/downstream_parser_agreement.py:3-18,40-74,99-130,448-536`;
  `docs/V31-DOWNSTREAM-PARSER-AGREEMENT.md:13-22,72-108,131-168`).
- **Done, with two baselines rather than a flattering uniform one.** The
  module-aware gate at `mcp-seal-dev` `d4c13be` checks 1,286 declarations:
  24 regular kernel modules retain `[propext, Classical.choice, Quot.sound]`;
  `Ffi` alone adds `lcProof`. There is no uniform three-name module baseline
  (`Test/ModuleAxiomScan.lean:13-29,52-85,214-252`).
- **Wired, not yet reached in CI.** `seal-host` `49a2a12` moves the acceptance
  guards to Stage A full-arguments targets and invokes both Python host integration
  entrypoints from CI; direct runs remain red on stale pre-minted approval targets,
  and every Actions attempt since the wiring has skipped that step. `091d68f`
  repairs the witness so a dead child reports its exit code and stderr rather than
  a downstream `BrokenPipeError` or `JSONDecodeError`
  (`ROADMAP-KERNEL-OUTWARD.md` D.4-D.6).

Claims discipline has a coverage gap of its own: the Python host suites existed
before they were wired, and `test/test_rebased_pin_baseline.py` still has no
workflow caller. The fresh-receipt filesystem leg is not a third never-run
example—it passed in Golden Path run `30213014766` on 2026-07-26—although the
latest run `30352188374` stopped at the token gate before reaching it.

**The trap:** the encoder twin passing is about WRITING agreement. The measured
defect is about READING agreement. Conflating the two is how this gap stayed open,
and a green twin must never be cited as progress on the parser question.

**Ruled in by Ben 2026-07-26 01:32: boxpol enters the roadmap.** `POLICY-LANGUAGE.md`
specifies it and deliberately refused to add itself, on the grounds that admitting a
fifth item must be a visible decision rather than a drift. This is that decision,
recorded here so it is visible. Two constraints travel with the admission and are
part of the ruling, not commentary:

- **It is not a fifth item in the ORDER.** It is the policy layer that V3.3 signs
  against. The analyzer build starts **after V3.1 or not at all**; V3.1 remains the
  single highest-value item and boxpol does not displace it.
- **Non-growth is constitutional.** Analyzer-undecidable constructs are parse errors,
  permanently. The named failure mode is expressiveness creep reintroducing
  rubber-stamping in formal clothes, and `POLICY-LANGUAGE.md` §8 instruments it: the
  first UNKNOWN whose cause is a policy CONSTRUCT rather than a lens or world gap is
  to be treated as an incident, not a line item.

**Factory-work ruling, 2026-07-28 21:47.** The **needs-you inbox** is the answer to
the prediction-confirmation bottleneck, selected over retiring the unresolvable
class or waiting for 31 July. This does not add another seal build item to the
ordered four; it fixes how the surrounding work factory obtains human
confirmation. **Status: RULED, NOT STARTED.**

### V3.1 Close the gap between the proofs and the bytes

**All five product seats independently named this as the thing a serious reviewer
attacks within five minutes.** Qwen put it most sharply: "How do you know the JSON
parsed by the unverified Rust host matches the digest verified by the Lean kernel?
If the Rust host can be tricked into parsing a JSON payload differently than the
Lean kernel's digest function expects, the proofs are void."

Today the proofs cover the decision function and the bytes arrive through
unverified Rust. That is the difference between "good academic exercise" and
"serious engineering artifact", in their words and now in ours.

Scope, deliberately bounded. This is NOT verifying the host:

- a verified JSON parser, or a verified subset sufficient for the wire shapes we
  admit, in Lean; or
- proven serialization invariants the host must uphold, with executable checks
  that the host actually upholds them.

Already-open work that belongs to this and nothing else: the interior-NUL seam
test, the parser-differential corpus, the external oracles (Wycheproof,
JSONTestSuite), and `wireNumbersSafe` measuring the wrong thing.

**This is the single highest-value item in the project.** It comes first.

### V3.2 The unbrokered reachability report

The novel contribution. Five seats confirmed nobody ships this for agent tooling;
nearest analogues named were AWS IAM Access Analyzer, GCP Policy Intelligence and
CSPM unmanaged-asset views, none of which operate on agent tool calls and none of
which emit a signed coverage artifact.

The deliverable is a signed document of the shape:

```
This agent has N enumerated path records.
  BROKERED (3):    postgres.query, fs.write, deploy.hook
  UNBROKERED (5):  outbound HTTP, shell, scheduler, 2 in-process tool handles
  UNKNOWN (1):     <cannot classify, and says so>

Postgres brokered CONDITIONAL ON credential removal,
which this system cannot verify.
```

That last line is the point of the whole document. It is the least sellable
sentence in security software, which is precisely why it is ours. It comes
directly from Kimi's criticism: the guarantee rests on a deployment precondition
the artifact cannot enforce, so the artifact must SAY SO rather than let a green
dashboard imply otherwise.

Design constraints:
- UNKNOWN is a first-class value, never rounded to covered or to safe.
- A denominator may be printed only when the scope over which it is computed is
  declared in the same signed document, and no percentage may be printed over a
  scope the artifact cannot bound. A coverage figure computed over what we
  already watch without that bound is the project's own signature defect wearing
  a new hat.
- The report is signed and verifiable independently of the host that produced it.

**Signpost 2026-08-11:** if V3.2 has not moved past V0, that is a finding about
where effort is going, not a status update. V3.2 is the named invention and the
least advanced item while V3.1 and V3.3 absorb nearly all effort; §1 itself calls
claim one "table stakes".

### V3.3 One sink, end to end

Postgres. Real database, real agent, real approval, real receipt.

Success criteria, all four, and the fourth is the one that matters:

1. The agent holds no DSN and no password. Verified by inspecting its environment.
2. The effect fires only on a capability bound to the approved request digest.
3. The receipt records what the human was SHOWN, not merely that a click happened.
   See `COMPREHENSION-CHECK.md`.

   **Correction, 2026-07-25 20:45.** An earlier revision of this file stated that
   the approval prompt shows a 16-hex-char TRUNCATED digest. **That is false and
   was never checked.** It came from a council seat, was accepted without a frisk,
   and propagated into this document and into an external review brief.

   What is actually on disk: the interactive prompt at `rust/src/providers.rs:540`
   prints `{target}` in full, and a target is constrained to a lowercase 64-hex
   SHA-256 by `is_target_hex` (`providers.rs:16-18`, `s.len() == 64`). The 16-char
   truncation at `providers.rs:105` is `redacted_record_id`, whose only caller is
   `ApprovalDropWarning` (`providers.rs:72`), a diagnostic warning record. It never
   touches the human approval path.

   So the digest shown to the human is NOT truncated, and "fix the truncated
   digest" is not a real task. The comprehension problem stands unchanged and is
   the harder one: 64 hex characters convey no more meaning to a human than 16.
4. **Negative control**: an agent with full shell inside that container attempts a
   direct connection and cannot make one, because there is no credential to make
   it with. Observed failing, recorded verbatim.

Without (4) this is an architecture diagram.

### V3.4 The write-up

- A paper: unbrokered reachability as a property, how to compute it for a given
  policy, and what a signed coverage artifact buys an operator. DeepSeek called
  formalising this "a genuine contribution".
- A repo where every claim has an executable check and **every check has been
  observed failing**.
- **Watched-mutation census.** Carry D.10's declared-denominator baseline into
  the write-up: kernel guard rules 35/47 WATCHED, ApprovalRecord v2 signed leaves
  1/21, and authorization-decision committed leaves 1/55. "35 of 47 rules have
  been watched to fail, and here are the 12 that have not" is the most credible
  paragraph we could put in front of a serious reviewer.

### V3.5 MCP revision 2026-07-28 conformance

**Ruled by Ben 2026-07-28: seal v1 supports MCP revision 2026-07-28.** Support
means that the stdio interposer refuses top-level batches, preserves
`server/discover`, validates modern per-request metadata before making an
authority decision, signs the revision semantics it actually enforced, commits
MRTR `requestState` and `inputResponses` without weakening exact frame binding,
relays modern results truthfully, and keeps explicit 2025 and 2026 demo paths
whose eras and reasons for coexisting are legible to a reader.

**Correction, 2026-07-28 21:47.** The prior paragraph costed a scalar adapter bump,
left `_meta` open and treated the V2 boundary and dual-era demos as optional.
Ben ruled supported **sets**, `_meta` Option A, V2 typed targets and envelopes
inside v1, and dual-era demos. The corresponding upper-end estimates are now
**450 changed LOC across 12 files** for the signed adapter set, **900 changed
LOC across 22 files** for complete `_meta` commitment through V2, **1,000
changed LOC across 24 files** for coherent MRTR through V2, and **400 changed
LOC across the eight demo scripts plus `demo/doctrine.py`** for the explicit
dual-era demo surface. The roughly doubled `_meta` and MRTR budgets are a
consequence of including V2 in the v1 release boundary. Batch refusal remains
**120–220 LOC across about 8 files** and per-request validation remains
**150–300 LOC across 5–8 files** because that ruling did not change their
costed surfaces. These are source-surface estimates, not measured diffs, and
they are not a schedule.

Option A commits the complete validated `_meta` object, including unknown keys,
to the effect commitment and guard/typed target. The guard target therefore
becomes an **invocation identity rather than a stable name for an action**.
That is an accepted v1 cost, not an overlooked risk. The
C-refuse-unknown/C-commit-unknown question is closed as moot.

The adapter set forces an explicit mixed-version policy: transparent dual-era
mediation or a terminating translation gateway with signed client-facing
revision, child-facing revision and translation profile. Phase M also rules
**ALWAYS ONE REPIN**, never piecemeal, and requires a repeatable runbook before
that single act.

Conformance does **not** mean adding Streamable HTTP, consuming child tool
schemas, fabricating child capabilities, guaranteeing that a child server
conforms, or claiming modern/legacy translation that does not exist. The
stateless core removes no dependency from the current stdio host. MRTR is
fail-closed today, not safely accommodated. `_meta` is covered by the raw frame
evidence but omitted from the semantic target today. UNKNOWN stays UNKNOWN:
until every Phase M closure condition is evidenced on disk, the implementation
status is **RULED, NOT STARTED**.

## 4. What we are NOT building

Every item below appeared on at least one seat's kill list. Naming them here so
that adding one back is a visible decision rather than a drift.

- **Connector catalogues.** No breadth of sinks. One sink, proven.
- **A secrets store.** We are not replacing Vault. We lease from it.
- **High availability.** `BROKER-HA.md` is a design record, not a build plan. The
  broker is single-holder per shard and that ceiling is stated in the claims.
- **Dashboards, enterprise anything, privileged-session management.**
- **The MCP proxy transport as a maintained product surface.** It stays as the
  current adapter and is not the contribution or a maintained connector
  catalogue.

  **Correction, 2026-07-28.** The earlier wording said the adapter “does not get
  polished.” Ben's MCP ruling makes that too broad: v1 must conform to revision
  2026-07-28. That obligation does not add Streamable HTTP, a translation
  gateway or connector breadth.
- **m-of-n threshold secret sharing for sink credentials.** Refuted 2026-07-25:
  you cannot threshold-present a password. See `BROKER-HA.md`.

**The credential broker is a reference implementation that proves the idea, not a
product we maintain.**

## 5. The claims discipline, which is the actual differentiator

This survived every review today and is the thing that makes the rest credible.

- A control never observed failing is not a control. Ablate it and record the
  failure verbatim, or do not claim it.
- A documented limitation is not a managed one (`METHOD.md` §12).
- Print UNKNOWN rather than a green tick.
- Every external claim carries its scope line. The proofs cover the decision
  function; digest computation, the capability table, TLS and the protocol parser
  are unverified Rust.

Kimi's warning, recorded here so it cannot be quietly ignored: **"This ruling."**
If the scoreboard records the blindness criticism as *answered*, that green is
measuring the pivot rather than the system.

## 6. Honest ceiling

Twelve months, everything going well: a repo people star and a few genuinely read,
a plausible front page, a paper with a real idea in it, ARIA funded or not and the
project surviving either way, and a handful of conversations with people who
matter in agent security who came because of the work.

Not a company. That was never the target.
