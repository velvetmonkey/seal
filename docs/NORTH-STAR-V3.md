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

Four things. Nothing else is on the roadmap.

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
This agent has N paths to cause an effect.
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
- The denominator is total agent reachability, never the brokered subset. A
  coverage figure computed over what we already watch is the project's own
  signature defect wearing a new hat.
- The report is signed and verifiable independently of the host that produced it.

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

## 4. What we are NOT building

Every item below appeared on at least one seat's kill list. Naming them here so
that adding one back is a visible decision rather than a drift.

- **Connector catalogues.** No breadth of sinks. One sink, proven.
- **A secrets store.** We are not replacing Vault. We lease from it.
- **High availability.** `BROKER-HA.md` is a design record, not a build plan. The
  broker is single-holder per shard and that ceiling is stated in the claims.
- **Dashboards, enterprise anything, privileged-session management.**
- **The MCP proxy transport as a maintained product surface.** It stays as the
  current adapter, but it is not the contribution and it does not get polished.
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
