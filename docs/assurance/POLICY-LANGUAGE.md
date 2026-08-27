# POLICY-LANGUAGE.md — boxpol: the seal policy language and its analyzer

Status: draft specification v1, 2026-07-26. Written for Ben's evaluation and for a
competent stranger to implement from. Supersedes nothing; it specifies the design
answered on 2026-07-26 in response to the "tiny DSL vs Cedar" question, revised
where reading the repositories contradicted it (revisions are listed in §10, not
silently applied).

Placement against `docs/archive/NORTH-STAR-V3.md`: the roadmap is four items and this is not a
fifth. This language is the policy layer that **V3.3 (one sink, end to end)**
signs against, and the bundle in §5 is the claims discipline of North Star §5
made mechanical. The analyzer build (§9) starts **after V3.1** or not at all;
adding it to the roadmap is a visible decision for Ben, which is what this
document exists to make decidable. Repository placement follows the topology-C
ruling (`docs/archive/REPO-TOPOLOGY.md`): one merged repository, so file paths below are given
against today's `seal-host` / `mcp-seal-dev` layout and survive the merge
unchanged as subtrees.

Lean-source provenance: every Lean proof property asserted in this draft refers
to source held in `seal-host`, not to source shipped by this Node CLI. The
`mcp-seal-dev` paths below are historical topology references, not a claim that
this repository contains Lean source.

---

## 1. The design bet

**Bet.** A policy language whose denotation is a finite union of boxes over a
typed, finite attribute space, so that every analysis the sign-off ceremony
needs — permissiveness comparison, claim entailment, witness generation,
boundary sampling — reduces to a walk over a finite grid that a few hundred
lines of Lean can be proved to construct correctly. The analyzer then sits
*inside* the same proof boundary as the decision kernel, sharing its types.

A "box" is a product of per-attribute constraints, where every attribute domain
is one of exactly three shapes:

- a finite enum (statement kind, weekday),
- an integer interval with declared bounds (hour 0..23, port),
- a subset of a finite, schema-pinned universe (tables touched, scopes).

**Why this exists rather than adopting Cedar.** Cedar is the credible
alternative and the argument against it is narrow, so state it narrowly:

The primitive the human sign-off ceremony consumes is *permissiveness
comparison* — "is the request-set admitted by policy A contained in that of
policy B", and its corollaries "does this claim hold of this policy" and "what
exactly did this edit change". In Cedar, that primitive is answered by symbolic
compilation of policies into SMT formulas and a call to an SMT solver (cvc5).
Cedar's formalization work (cedar-spec, in Lean) verifies the *evaluator*, and
there is published work on verifying the *symbolic compiler* — that the
translation to SMT preserves Cedar's semantics. What is structural, and not
fixable by more of that work, is where the chain ends: the answer the signer
consumes is the solver's word, and the solver is a large unverified C++
artifact. Two escape routes exist and both fail the sizing test:

1. **Trust the solver.** Reasonable for AWS. Incoherent here: this project's
   entire identity (`docs/archive/NORTH-STAR-V3.md` §1, §5) is that the decision function is
   machine-checked and every claim carries its scope line. "The policy the
   human signed was compared against its predecessor by machinery outside the
   proof boundary" is exactly the asterisk the project exists to not have —
   attached to the one artifact whose meaning the human is attesting.
2. **Check solver certificates.** Proof-producing SMT plus a verified
   certificate checker in Lean is a real research direction, and it is larger
   than the entire analyzer proposed here — a verified checker for the theory
   fragment Cedar's compilation emits is more Lean than §9's whole table.

The counterarguments, stated at full strength because this section must survive
someone hostile to the bet:

- *"cvc5 is battle-tested; solver bugs in decidable fragments are rare."*
  Granted, and irrelevant to the argument, which is about trust-base
  **coherence**, not bug probability. The project's claims discipline requires
  every claim to name what checked it. "Checked by a 500k-line artifact we
  cannot inspect the reasoning of" is a legal scope line, but it is the scope
  line of every other security product, and the project's one differentiator
  is not writing it.
- *"You will reimplement Cedar badly over five years."* Only if the language
  grows. §7 makes non-growth constitutional: analyzer-undecidable constructs
  are parse errors, forever, with a stated pressure valve. The failure mode is
  real and §8 instruments it rather than denying it.
- *"The grid blows up combinatorially."* It can, and the analyzer's answer is
  to compute the cell count *before* walking, print the per-attribute factors,
  and refuse above a hard bound (§4.4) — never to sample silently. A policy
  too complex to analyze is rejected at authoring time, which is the correct
  outcome for a policy a human is about to sign.
- *"Cedar buys you an ecosystem."* It also sells you the parts of its surface
  this system must not have — string operations (`like`), entity hierarchies,
  a permit/forbid override algebra — as permanently attackable, misreadable
  area. And Cedar's analyzer is structurally blind to the two constructs this
  system's ceremony centrally needs to reason about: the **approve** verdict
  (Cedar has only permit/forbid; approval becomes out-of-band convention) and
  **budgets** (no such concept; a separate unsigned system). An analyzer that
  cannot see approval and rate limits cannot forecast approval load or prove
  claim C6 of §5. This point is taken from the Kimi reading and it is the
  strongest single sentence in the Cedar comparison: *on the features this
  system actually needs, the SMT-backed analyzer is not behind — it is absent.*

**What the bet honestly relocates rather than eliminates.** Policies evaluate
over an attribute record produced by a *lens* (SQL classifier, clock). The lens
is unverified and is the new JSON: `rust/tests/external_json_corpus.rs` on
`seal-host` runs the vendored JSONTestSuite corpus (pinned at commit
`1ef36fa0…`, ≥300 vectors asserted, 318 on main) and reports, for the
implementation-defined `i_*` class, the divergences between the Rust host's
view and the Lean kernel's view of identical bytes — 18 on main. That class of
two-readers divergence recurs at the lens, guaranteed, and §2.3 and the UNKNOWN
discipline of §5 are the containment. The bet's claim is not "no unverified
parsing"; it is "unverified parsing happens in one labeled place, outside the
signed logic, and the bundle confesses it."

---

## 2. The language

Two artifacts: a **schema** (where the world meets the model; names its lenses)
and a **policy** (boxes over the schema's attributes). Both have a pretty
syntax for humans and a canonical byte form that signatures bind. Only the
canonical form has semantics; the pretty syntax is an untrusted projection.

### 2.1 Schema language

```text
schema postgres.query v7 {
  universe table-universe { orders, customers, refunds, users, ... }   # full enumeration, closed

  attr db     : enum { prod, staging }
  attr kind   : enum { select, insert, update, delete, ddl, other }
  attr tables : subset of table-universe
  attr dow    : enum { mon, tue, wed, thu, fri, sat, sun }
  attr hour   : int 0..23                    # tz America/Chicago, via clock-lens

  lens sql-lens v3 digest 4be19a…            # provides kind, tables — UNVERIFIED
  lens clock-lens v1 digest c210bd…          # provides dow, hour — UNVERIFIED
}
```

Grammar (EBNF; `ident` is `[a-z][a-z0-9-]*`, `qname` is dotted idents,
`hex64` is 64 lowercase hex chars):

```ebnf
schema      = "schema" qname "v" nat "{" universe* attr+ lens* "}" ;
universe    = "universe" ident "{" ident ("," ident)* "}" ;
attr        = "attr" ident ":" attrtype ;
attrtype    = "enum" "{" ident ("," ident)* "}"
            | "int" nat ".." nat
            | "subset" "of" ident ;                  (* names a universe *)
lens        = "lens" ident "v" nat "digest" hex64
              "provides" ident ("," ident)* ;
```

Rules:

- Universes are **closed and fully enumerated**. There is no open universe. A
  new table is a schema version bump, which forces every dependent policy to be
  re-signed. That is a feature: the world changed, the attestation must too.
- Every attribute is `provides`-covered by exactly one lens, or by the
  descriptor directly (§2.3). Uncovered attributes are a schema error.
- `int` bounds are declared; there are no unbounded integers.
- Lens digests pin the exact lens build. They appear in every bundle (§5) and
  are labeled UNVERIFIED there.

### 2.2 Policy language

```text
policy analyst-readonly v1  for schema postgres.query v7

# Semantics (fixed by the language, not configurable):
#   verdict lattice: deny < approve < allow
#   result = meet of verdicts of ALL matching rules; no match = deny
#   int ranges inclusive both ends: hour in 9..17 means 09:00 through 17:59

rule read-three-tables {
  where  db = prod
         kind = select
         tables within { orders, customers, refunds }
         dow within { mon, tue, wed, thu, fri }
         hour in 9..17
  verdict approve
  budget  30 per session
}

rule never-write {
  where  kind within { insert, update, delete, ddl, other }
  verdict deny
}
```

Grammar:

```ebnf
policy      = "policy" ident "v" nat "for" "schema" qname "v" nat rule+ ;
rule        = "rule" ident "{" "where" atom* "verdict" verdict budget? "}" ;
atom        = ident "=" ident                        (* enum equality *)
            | ident "within" "{" ident ("," ident)* "}"
                                                     (* enum: membership; subset attr: ⊆ *)
            | ident "in" nat ".." nat ;              (* int range, inclusive *)
verdict     = "allow" | "approve" | "deny" ;
budget      = "budget" nat "per" ("session" | "hour") ;
```

Constraints enforced by the parser (violations are hard errors, not warnings):

- At most **one atom per attribute per rule**. Conjunction is implicit across
  atoms; there is no `or`, no `not`, no nesting. Disjunction is spelled as
  multiple rules; negation is spelled as the complementary constant sets,
  which the closed domains make finite and explicit.
- An empty `where` is legal and matches every request of the schema. This is
  how shield rules like `never-write` over-approximate on purpose.
- `budget` is legal only on `approve`/`allow` rules.
- Atoms must reference attributes of the pinned schema, constants must belong
  to the declared domains, and range endpoints must lie within declared bounds.

That is the entire language. **Every construct is listed above.** In
particular, and deliberately, the language has *none* of the following, some of
which the frozen V1 language (`seal-host/Seal/Policy.lean`, `MatchSpec`)
does have — boxpol is not a superset of V1 and must not be described as one:

- no `starts_with` (V1 has it) — string prefix breaks complement-with-finite-
  pieces and drags the analyzer toward automata containment;
- no `contains_any_ci` (V1 has it) — case-insensitive substring is string
  computation; where such classification is genuinely needed it moves into a
  lens that outputs an enum (§7);
- no regex, no glob, no arithmetic, no cross-attribute predicates
  (`field1 = field2`), no external calls, no defaults, no rule ordering, no
  inheritance, no priorities.

### 2.3 The request: descriptor first, lens second

A request reaches the evaluator as an **attribute record**: one value per
schema attribute. Two ways it can be produced, and the schema declares which:

1. **Constructor mode** (preferred; taken from the Kimi reading). The tool's
   interface accepts a *structured descriptor* — `{kind, tables, …}` — and the
   adapter **constructs** the SQL from it. The descriptor's fields *are* the
   attribute values; there is no parsing step and the two-readers divergence
   class is dead by construction for those attributes.
2. **Lens mode** (fallback, for tools whose callers genuinely submit raw
   text). An unverified lens (for Postgres: a `libpg_query` wrapper, so the
   lens is the target system's own parser as a library) computes attribute
   values from the raw bytes. Every lens is named, versioned, digest-pinned in
   the schema, labeled UNVERIFIED in every bundle, and differential-tested
   with its own corpus (§9, "SQLTestSuite").

UNKNOWN (settles by inspection of `seal-host` tool plumbing during V3.3):
whether the V3.3 Postgres sink can be constructor-mode. Today the mediated
surface passes raw tool arguments through MCP `tools/call`; an agent that
authors SQL needs lens mode. The bundle's UNKNOWN section must name which mode
is deployed, because the meaning of every claim depends on it.

### 2.4 Canonical form

**Revision after reading the repository** (was: bespoke s-expressions). The
signed artifact is a **SealV2 canonical JSON document**
(`seal-host/SealV2/Parser.lean` `IsCanonical`, serializer in
`SealV2/Serialization.lean` with injectivity theorems in
`SealV2/SerializationTheorems.lean` — `escapeString_injective`,
`serializeString_injective`, …). The repository already owns a verified
canonical encoding with exactly one byte form per AST; inventing a second
canonical encoding would recreate the two-readers problem *inside the proof
boundary*, which would be the project's signature defect wearing formal dress.

SealV2 canonicality guarantees canonical numbers, canonical escapes, and no
duplicate object keys; it does **not** impose key order. The boxpol layer
therefore adds a validator that fixes:

- object key order: exactly the spec order given below, no extra keys
  (idiom: the strict-key `WireCodec` machinery of `Seal/PolicyWire.lean`,
  already used by `Seal/PolicyBundle.lean`, where the field list drives the
  parse, the unknown-key rejection, and the JSON schema from one spec);
- `rules` sorted by rule name; atoms sorted by attribute name; set elements
  sorted lexicographically; all sorts byte-wise on UTF-8.

Canonical policy shape (schema shape analogous):

```json
{"boxpol":1,
 "policy":"analyst-readonly",
 "version":1,
 "schema":{"name":"postgres.query","version":7,"digest":"<hex64>"},
 "rules":[
   {"name":"never-write",
    "where":[["member","kind",["ddl","delete","insert","other","update"]]],
    "verdict":"deny"},
   {"name":"read-three-tables",
    "where":[["eq","db","prod"],
             ["member","dow",["fri","mon","thu","tue","wed"]],
             ["range","hour",9,17],
             ["eq","kind","select"],
             ["subset","tables",["customers","orders","refunds"]]],
    "verdict":"approve",
    "budget":["session",30]}]}
```

The policy digest is SHA-256 (`SealCore/Sha256.lean`, the kernel's pure Lean
implementation, `Digest256`) over the canonical bytes. The Lean side parses the
canonical bytes itself via the SealV2 parser plus the boxpol validator; the
pretty-syntax parser (Rust) is authoring-tool-only and untrusted, because the
signature binds the canonical digest and the signer reads the kernel's
re-emission, never the drafter's bytes ("one reader" — Kimi's framing, adopted).
Policy loading follows the existing signed-policy gate verbatim
(`Seal/SignedPolicy.lean`): **verify the Ed25519 signature over the exact bytes
first, parse second**; a policy that does not verify never parses and yields
default-deny.

---

## 3. Semantics

### 3.1 The verdict lattice

```text
        allow          (execute without a human in the loop)
          |
        approve        (execute only after human approval of this request's digest)
          |
        deny           (never execute)
```

A total order, `deny < approve < allow`. `meet` is minimum:

| meet    | deny | approve | allow   |
|---------|------|---------|---------|
| deny    | deny | deny    | deny    |
| approve | deny | approve | approve |
| allow   | deny | approve | allow   |

### 3.2 Evaluation

For request record `r` and policy `P`:

```text
verdict(P, r) = meet { rule.verdict | rule ∈ P.rules, matches(rule, r) }
              = deny                 if no rule matches   (closed world)
```

`matches(rule, r)` = every atom of the rule holds of `r` (empty conjunction
holds). Meet over a multiset is well-defined because meet on a total order is
commutative, associative, idempotent: **rule order cannot matter, by algebra
rather than by discipline.**

An `approve` verdict binds the human's approval to the SHA-256 digest of the
**canonical request record bytes** — uniform, not rule-supplied. This is a
deliberate simplification relative to the frozen V1 semantics, where guard
targets are rule-supplied templates and two matching guards can disagree, which
is why V1 needed (and has, proven) the ambiguity-fail-closed theorem
`Host.PolicyOverlap.conflicting_guards_ambiguous`. In boxpol two approving
rules always bind the same digest, so the ambiguous case is unrepresentable
rather than handled.

Budgets: each budgeted rule owns a named counter (name = rule name). When the
combined verdict is `approve` or `allow` **and the call executes**, every
matching budgeted rule's counter is charged 1; if any matching budgeted
counter is exhausted, the verdict degrades to `deny` (reason: budget). This is
the veto shape the existing budget kernel already implements
(`Kernels/Budget.lean` over `Kernels/BudgetCore.lean`), including
state-advances-only-on-execution.

- `per session`: a monotone counter with a hard cap. This is **exactly**
  `BudgetCore.step` / `run_never_over_budget`, already verified.
- `per hour`: a windowed counter that resets on the fixed clock-hour boundary.
  **No verified windowed automaton exists in the repositories today** —
  `BudgetCore` is total-cap-forever. `per hour` therefore parses but a policy
  using it cannot claim kernel-proved budget semantics until the windowed
  automaton and its proofs land (§9 row 7). The bundle generator enforces
  this: a `per hour` budget makes claim C6 print `[PENDING: windowed-budget
  proofs]` instead of `[PROVED]`. Grammar admits it now so canonical form is
  stable; semantics is gated on proof, not on prose.

### 3.3 Integration with the existing kernel

The evaluator ships as a new `Host.Kernel` instance (`Host/Kernel.lean`
interface: pure `ingest`/`decide`, composition over kernels is a pure fold):

- `boxKernel : Host.Kernel` with `Config := BoxPolicy`, `Evidence` = the
  attribute record plus approval records, `State` = budget counters.
- Registered as a new section of the 7-kernel policy bundle
  (`Seal/PolicyBundle.lean`), wire key `"boxes"`, parsed by a strict-key
  `WireCodec` like every other section. It composes by AND with the existing
  kernels (S/T/C/V/K/L/B); the existing deny-wins composition results
  (`Host/Composition.lean`) apply unchanged.
- Verdict mapping onto the existing host: `allow` → allow; `approve` →
  the existing guarded flow (target digest into the approval provider;
  `rust/src/providers.rs` `InteractiveProvider` prompts on the **full**
  64-hex target — see the North Star V3.3 correction of 2026-07-25 — with
  `ApprovalRecord` TTL capped at 300s per `Policy.approvalTtlMs`); `deny` →
  deny. No new approval plumbing is required for a first deployment; per-call
  Ed25519 approval tokens are ceremony work (§9 row 11), not a prerequisite.

### 3.4 Why each excluded feature is excluded

- **Defaults.** A default is a rule the signer cannot see at the site of the
  rules they can. Closed-world deny is not a configurable default; it is the
  fixed meaning of "no rule matched", printed in the policy header comment and
  proved as the no-match case of the evaluator.
- **Ordering / priority / first-match.** Any order-sensitive semantics makes
  the meaning of a rule depend on where it sits, which makes every diff review
  a whole-file review and every analyzer a sequence analyzer. Meet-combination
  makes permutation provably irrelevant. The V1 engine already paid for this
  lesson and its proofs (`Host.PolicyOverlap.resolve_perm_toEvent`:
  order-independence holds at outcome granularity, and the same file proves
  the reason-string is *not* order-independent — `reason_string_is_order_
  dependent` — which is exactly the honesty granularity boxpol keeps: verdict
  order-free by theorem; the human-readable reason string reported for a deny
  is the lexicographically-first matching deny rule's name, by definition, so
  it is deterministic without being load-bearing).
- **Inheritance / hierarchy.** Entity hierarchies move meaning out of the
  policy text into a second artifact (the hierarchy) with its own two-readers
  problem, and they turn permissiveness comparison into graph reasoning. Flat
  schemas; the schema version bump is the change-control mechanism.
- **`forbid`-overrides-`permit` as a special polarity.** Unnecessary: `deny`
  is just the bottom verdict and meet already makes it dominant. `never-write`
  above is technically redundant against closed-world deny; it exists as a
  **shield** — because combination is meet, that deny permanently dominates
  any grant anyone adds later that overlaps it, and claim C7 in §5 prices that
  redundancy explicitly.

---

## 4. The analyzer

Four operations, one mechanism. The analyzer is a Lean library plus a Lean
executable (`boxpol-analyze`), run at bundle-build time and re-run by the host
at policy load (§5.3). It is **not** in the per-request path.

### 4.1 Grid construction

Input: policies `P`, `Q` (for entailment, `Q` is a claim, which is a box plus
an expected verdict set; for delta, `Q` is the predecessor policy).

Let `Atoms` = all atoms occurring in `P`, `Q`, and the claims under check. Per
attribute `a`, construct a finite partition `Part(a)` of `a`'s domain:

- **enum E**: the singletons `{e}` for `e ∈ E`. (Enum domains are small by
  construction; no residue-class cleverness, keeps the lemma trivial.)
- **int lo..hi**: cut the interval at every endpoint mentioned by any range
  atom on `a`; `Part(a)` = the maximal uncut subintervals. At most `2m+1`
  pieces for `m` mentioned endpoints.
- **subset of U**: let `S₁ … S_k` be the distinct constant sets mentioned by
  subset atoms on `a`. `Part(a)` = the nonempty regions of the truth-vector
  partition of `𝒫(U)`: for `v ∈ {0,1}^k`, region `R_v = { x ⊆ U | ∀i, (x ⊆ Sᵢ ↔
  vᵢ = 1) }`. At most `2^k` regions, `k` = mentioned constants — **not**
  `2^|U|`; the universe can hold 41 tables while `k` is 2 or 3.

The **grid** is the product `Π_a Part(a)`; a **cell** is one choice of piece
per attribute. Empty cells (possible only via unsatisfiable subset truth
vectors) are skipped; soundness is unaffected because they contain no
requests.

**Lemma A (constancy on cells).** For every cell `c`, every atom
`α ∈ Atoms`, and all requests `r₁, r₂ ∈ c`: `α(r₁) = α(r₂)`. Hence every rule
of `P` and `Q` matches `r₁` iff it matches `r₂`, hence
`verdict(P, r₁) = verdict(P, r₂)` and likewise for `Q`.

*Proof shape.* Per attribute-type case: enum pieces are singletons (trivial);
a range atom's endpoints are cut points, so an uncut interval lies wholly
inside or wholly outside every mentioned range; subset regions are *defined*
as the truth-vector classes of the mentioned subset atoms. Constancy of rules
and policies follows because rules are conjunctions of atoms and the verdict
is a function of the match set. This is the load-bearing theorem and it is
short.

**Lemma B (subset representatives, constructive).** For mentioned sets
`S₁ … S_k ⊆ U` and truth vector `v`, let `D_v = ⋂_{i: vᵢ=1} Sᵢ` (empty
intersection = `U`). Then `R_v ≠ ∅` iff for every `j` with `vⱼ = 0`,
`D_v \ Sⱼ ≠ ∅`; and when nonempty,
`x = ⋃_{j: vⱼ=0} {pick(D_v \ Sⱼ)}` is a member of `R_v` (each picked element
lies in `D_v ⊆ Sᵢ` for all `i ∈ v`, and witnesses `x ⊄ Sⱼ`). Both directions
are elementary; the construction gives the analyzer its representative for
free. (For `v` all-ones, `x = ∅`, which is a legal record value; the witness
and teach-back generators prefer nonempty picks for realism, which is
cosmetic, not semantic.)

Representatives for enum pieces and intervals are the value / the low
endpoint.

### 4.2 The four operations as grid walks

1. **Permissiveness comparison** `compare(P, Q)`: for each cell, evaluate both
   policies on the representative; Lemma A lifts the pointwise comparison to
   all requests in the cell. Output: `P ≡ Q`, `P ≤ Q`, `Q ≤ P` (pointwise in
   the lattice order), or incomparable — plus the exact cell list where they
   differ, each with representative and both verdicts. This *is* the delta
   computation of §5: `compare(new, old)`.
2. **Claim entailment** `entail(C, P)`: a claim is a box (same atom language)
   plus an expected verdict set, e.g. "every request in this box gets a
   verdict ≤ approve". Walk the cells intersecting the claim's box; check the
   expected set contains `verdict(P, rep)` in each. A claim failure reports
   the offending cell and representative — which is a counterexample the
   kernel can replay.
3. **Witness generation**: pick any cell of interest (each claim cites some;
   the delta cites the changed ones), take its representative, run it through
   the **kernel evaluator** (not the analyzer), attach the decision receipt.
   Witnesses are therefore self-validating: the generator needs no
   verification because every output is replayed through verified code and
   carries the receipt.
4. **Boundary sampling** (for teach-back, §6): enumerate pairs of cells
   adjacent across one attribute facet (differ in exactly one attribute's
   piece, adjacent pieces) whose verdicts differ; emit (inside-rep,
   outside-rep) pairs. Also self-validating — every emitted question is graded
   by running the kernel.

### 4.3 What is proved in Lean, and what is not

Proved (these are the analyzer's soundness; without them it is decoration):

- P1: partition correctness per attribute — pieces are pairwise disjoint and
  cover the domain; the product grid inherits both.
- P2: Lemma B — region-emptiness decision and representative membership.
- P3: Lemma A — constancy of atoms, rules, verdicts on cells.
- P4: comparison soundness — cell-wise verdict equality/order on
  representatives implies the pointwise statement for **all** requests
  (directly from P1+P3).
- P5: entailment soundness — same lift for claims.
- Evaluator: totality, `verdict = meet over matching rules`, no-match = deny,
  permutation-invariance (fold of a commutative idempotent monoid; the proof
  idiom exists in `Host/PolicyOverlap.lean` and this is the generalization,
  not a fresh start).
- Decoder: canonical bytes → policy value, with strict validation, and
  `decode ∘ encode = id` (round-trip; the SealV2 serializer injectivity
  theorems carry the string/number layers, the boxpol layer adds the
  fixed-key-order object shapes via the `WireCodec` idiom).

Explicitly **not** proved, because self-validating or out of scope:

- witness/boundary/teach-back generators (Rust or unverified Lean; every
  output replays through the kernel with a receipt);
- the pretty-syntax parser and printer (authoring only; signature binds
  canonical bytes);
- the bundle renderer (§5.3 makes renderer lies unable to reach enforcement);
- SHA-256 and Ed25519: same posture as today — `SealCore/Sha256.lean` is pure
  Lean but is a reference implementation, not proved against FIPS (its spec
  *is* the code; differential-tested per North Star sequencing item 3), and
  Ed25519 is the vendored-TweetNaCl trusted assumption A3
  (`SealV2/Crypto.lean`, opaque FFI, deliberately not an axiom). This
  document must not claim more than the repositories do.

### 4.4 The size bound

Cell count = `Π_a |Part(a)|`, computable before any walk. The analyzer prints
the per-attribute factors and **refuses** (hard error naming the largest
factor's attribute) above `2^20` cells. No silent sampling, no fallback
heuristic. For the §5 policy the grid is
`2 (db) × 6 (kind) × ≤2 (tables: one mentioned set) × 7 (dow) × ≤3 (hour)`
≈ 500 cells — milliseconds. UNKNOWN: compiled-Lean walk performance at the
`2^20` bound on realistic hardware; settles with a benchmark during §9 row 5,
and the bound moves down, not up, if it disappoints.

**`2^20` is a compile-time constant, not a default** (ruled by Ben, 2026-07-26).
There is no runtime override, no configuration key, and no operator dial. An
earlier draft of this section said "default `2^20`", which implied a knob while
never saying where it lived or who could turn it; the companion sentence "the
bound only moves down" then bound only the default value and not an override.
That gap was a hole in the constitutional non-growth posture ruled in on
2026-07-26 at 01:32, because an operator-raisable ceiling is exactly the
asterisk §2 says this project exists to not have. Lowering the constant is a
source change reviewed like any other; raising it is a change to the signed
shape and goes through the same scrutiny as any other such change. Nothing
today is close to the ceiling: the §5 policy sits four orders of magnitude
under it.

### 4.5 Where it lives

Today (pre-merge): a new Lean library directory `Boxes/` in `seal-host`
(peer of `Host/` and `Kernels/`, added to `lakefile.toml`), importing
`SealCore` (Digest256, Sha256, Event) and `SealV2` (canonical parser,
serializer, crypto) exactly as `Host/Action.lean` already does; the evaluator
kernel in `Kernels/Boxes.lean`; the bundle section codec beside the existing
ones that follow `Seal/PolicyWire.lean`. After the topology-C merge the paths
move as subtrees, unchanged. Nothing is duplicated from the existing kernel:
digests, canonical bytes, signature gate, budget automaton, kernel interface,
and the composition theorems are all shared, and that sharing is the point of
building it here instead of adopting.

---

## 5. The signing bundle

The bundle is the artifact the human signs. Its sections are fixed: header,
INTENT, CLAIMS, WITNESSES, DELTA, approval-load FORECAST, UNKNOWN, TEACH-BACK
record, SIGNATURE. A size budget (one screen; hard numbers below) is part of
the format: a bundle over budget does not render as signable.

### 5.1 Worked example — the Postgres SELECT scenario (V3.3's sink)

Scenario: the analyst agent may SELECT from three production tables during
Chicago business hours; every query is human-approved; it can never write;
approval traffic is capped. Previous policy: deny-all.

```text
════════════════════════════════════════════════════════════════════
 POLICY BUNDLE — analyst-readonly v1
 core:       sha256:a3f81c…  (canonical form, 412 bytes)
 schema:     postgres.query v7          sha256:99d2e0…
 mode:       LENS (raw SQL classified by sql-lens; see U1–U3, U7)
 lenses:     sql-lens v3 (libpg_query 15.1)   sha256:4be19a…
               [UNVERIFIED; corpus SQLTestSuite@b7e2… 812 vectors,
                11 divergences — cert #x201]
             clock-lens v1                    sha256:c210bd…
               [UNVERIFIED, UNTESTED — no pinned corpus]
 previous:   deny-all v0
 analyzer:   boxpol-analyze 0.1  (Lean; grid=504 cells; factors 2·6·2·7·3)
════════════════════════════════════════════════════════════════════

 INTENT (operator prose, verbatim, non-binding):
   Analyst agent may read order data from three prod tables during
   Chicago business hours. Every query goes through a human. It can
   never write. Cap the approval traffic.

 CLAIMS — each machine-checked against core by verified entailment.
 Claims speak the MODEL's language (lens output), not ground truth;
 model-vs-world gaps live in UNKNOWN, below, on purpose.

  C1  No request classified other-than-select is ever allowed or
      approved.                                    [PROVED: entailment #e101]
  C2  Every non-denied request touches only tables within
      {orders, customers, refunds} per sql-lens.   [PROVED: entailment #e102]
  C3  Nothing is auto-allowed: no rule carries verdict=allow, so every
      non-denied request requires human approval of its request digest.
                                                   [PROVED: syntactic + #e103]
  C4  Outside Mon–Fri 09:00–17:59 America/Chicago (clock-lens),
      everything is denied.                        [PROVED: entailment #e104]
  C5  db=staging: everything denied — no rule matches.
                                                   [PROVED: entailment #e105]
  C6  At most 30 approved executions per SESSION (monotone counter,
      BudgetCore.run_never_over_budget).           [PROVED: budget #e106]
      ⚠ GAP: intent said "cap the approval traffic" with no number and
      no window; the drafter chose 30/session. Confirm or amend.
  C7  Shield check: deleting rule read-three-tables restores exact
      deny-all. Deleting never-write changes NO verdict today, but
      removes the guarantee that future grants cannot enable writes.
                                                   [PROVED: comparison #e107]

 WITNESSES — produced by driving the KERNEL. Each carries a receipt.
  W1  APPROVE  SELECT count(*) FROM orders            Tue 14:12 CT   r-0181
  W2  DENY     UPDATE orders SET state='x'            Tue 14:12 CT   r-0182  (never-write)
  W3  DENY     SELECT * FROM users                    Tue 14:12 CT   r-0183  (table outside allowlist)
  W4  DENY     SELECT count(*) FROM orders            Sat 14:12 CT   r-0184  (dow)
  W5  DENY     SELECT count(*) FROM orders            Tue 08:59 CT   r-0185  (hour, lower boundary)
  W6  APPROVE  SELECT count(*) FROM orders            Tue 17:59 CT   r-0186  (hour, upper boundary — inclusive)
  W7  DENY     SELECT o.*, u.email FROM orders o
               JOIN users u ON …                      Tue 14:12 CT   r-0187  (join drags in users)
  W8  DENY     31st request within session            Tue 14:5x CT   r-0188  (budget exhausted)
  W9  DENY     valid approval attached to W2's digest Tue 14:13 CT   r-0189
      — an approval on a DENIED request is INERT: approvals release
      the gate, they never widen the policy.

 DELTA vs deny-all (analyzer comparison, cell-exact):
   ADDED permissive surface — exactly one box:
     db=prod × kind=select × tables⊆{orders,customers,refunds}
     × dow∈{mon..fri} × hour∈9..17  →  APPROVE, ≤30/session
   REMOVED: nothing. Everything else: deny, unchanged from v0.

 FORECAST — approval load, and this section predicts its own failure:
   worst case 30 approval prompts per session. If sessions are daily,
   ~30/day lands on one human; above ~20/day the predicted failure is
   approval fatigue — median approve-latency in the receipt stream
   collapses toward reflex. That latency IS in the receipts: monitor
   it, and treat collapse as this bundle failing in production.

 UNKNOWN — holes the claims cannot see. Read before signing.
  U1  kind=select ≠ read-only. SELECT can invoke mutating functions:
      SELECT delete_user(1), SELECT pg_sleep(3600). sql-lens
      classifies these select → verdict APPROVE. C1 holds for the
      MODEL only. Mitigation is outside this policy (read-only DB
      role — the V3.3 negative control, which this bundle cannot
      verify and therefore does not claim).
  U2  SELECT … FOR UPDATE takes row locks; sql-lens v3 says select.
  U3  Table extraction is lens output: views, RULEs, and function
      bodies referencing other tables are invisible to libpg_query.
  U4  No result-size bound: one approved SELECT can read all three
      tables in full.
  U5  hour/dow from clock-lens on the host clock: DST transition days
      shift the window; clock skew shifts it arbitrarily.
  U6  Budget counter is kernel state, not persisted across host
      restart: a restart re-arms the session counter.
  U7  Approval UX today is y/N on the full 64-hex request digest
      (providers.rs InteractiveProvider). The digest is complete but
      humanly meaningless — the comprehension burden rides on the
      rendered request text beside it, which is host-rendered and
      unverified. (This is North Star V3.3 criterion 3's open
      problem, not solved here.)

 SIZE BUDGET: 7 claims, 9 witnesses, 7 unknowns — PASS (caps: 10/12/10).

 TEACH-BACK: 5 items, kernel-graded, transcript #t41, result 5/5,
 transcript hash bound into this bundle.

 SIGNATURE binds sha256 of this entire bundle, which embeds the core,
 schema, and lens digests. Ed25519 by: ____________
════════════════════════════════════════════════════════════════════
```

### 5.2 The discipline that makes it honest

Claims speak the **model's** ontology; UNKNOWN carries the model-vs-world gap.
C1 does not say "the agent can never write" — it cannot prove that; U1 says
exactly where classification and reality part, and `SELECT delete_user(1)`
sails through the entire verified apparatus. U1 is the most important line on
the page, which is why teach-back samples it (§6). The ⚠ GAP on C6 is the
intent-vs-policy divergence computed and displayed rather than hidden (the
drafter invented the number 30); the FORECAST predicting approval fatigue with
a measurable symptom is taken from the Kimi reading, as is W9's inert-approval
witness.

### 5.3 The renderer cannot lie its way into enforcement

The rendered page is for the human; the gate is for the machine. Every claim
line carries a certificate id; the bundle embeds the machine-readable claims;
and **the host, at policy load, re-runs the verified entailment checker over
(core, claims) and refuses a bundle whose checks fail** — the checker is
compiled Lean in the same binary, so this is a library call, not a second
implementation. A compromised renderer can fool a person into signing; it
cannot get a false-claimed bundle deployed. (Taken from the Kimi reading.)
Load-gating composes with the existing verify-first-parse-second signature
gate of `Seal/SignedPolicy.lean`.

---

## 6. Teach-back

Before signing, the signer answers `k ≈ 5` forced-choice questions
(allow / approve / deny), generated from the policy's actual decision boundary
and graded by **running the kernel** — there is no hand-authored answer key to
drift from the policy. Failure blocks signing unless the signer performs a
signed, recorded override. A failed teach-back cannot still produce a green
ordinary signing path: by Seal's own doctrine, a control is only real if it
cannot be violated while still getting green. The specified behaviour is BLOCK
WITH A RECORDED OVERRIDE, and it is not implemented at this revision; this
section records the rule Ben chose and does not claim an override mechanism
exists.

Superseded default, replaced by Ben's 2026-08-09 ruling: failure did not block
signing; it stamped the receipt `signed-without-comprehension-evidence`,
permanently, and the failed boundary was quizzed first at the next renewal. The
enemy in that position was the reflex signature, not the assisted one; the
record was the point. This connects to
`docs/archive/COMPREHENSION-CHECK.md` and North Star V3.3 criterion 3: the receipt records
what the human demonstrably understood, not merely that a click happened.

### 6.1 Sampling

Three pools, forced mix:

1. **Facet pairs.** The analyzer's boundary enumeration (§4.2 op 4) yields
   adjacent cell pairs with differing verdicts. Concrete surfaces (timestamps,
   table names, SQL text) are drawn **fresh from cell interiors per session**:
   the cell repeats, the surface never does, so last session's answer sheet
   buys nothing.
2. **UNKNOWN-anchored, mandatory.** At least one question per high-severity
   UNKNOWN. These are the only questions that detect a signer running vibes
   instead of the model, because they are constructed so the honest human
   answer and the kernel answer differ. Example (samples U1): *"Agent submits
   `SELECT log_cleanup_and_purge(30), * FROM orders`, Tuesday 14:00 CT; the
   function deletes rows; sql-lens says kind=select, tables={orders}.
   Verdict?"* Kernel answer: **approve** — the policy judges lens output;
   mutation risk is U1, not a policy control. A signer pattern-matching
   "no writes = deny" fails, and that failure is exactly the comprehension gap
   the ceremony exists to surface.
3. **Delta-weighted.** Boundaries introduced or moved by this delta always
   get a question; boundaries unchanged since the last signed version get
   sampling weight, not certainty.

### 6.2 Why it resists pattern-matching

- **Minimal mutants.** Each question's inside/outside pair differs in exactly
  one attribute facet, so the boundary is the only discriminative signal; a
  memorized polarity ("select on orders → yes") fails on the mutated side.
  Roughly half of signers see the inside instance, half the outside.
  (Taken from the Kimi reading, including the rotating-decoy construction for
  subset semantics: sometimes the join that IS allowed, sometimes the one that
  is not.)
- **Enforced balance.** Construction guarantees ≈50/50 allow-ish/deny correct
  answers, and an all-deny or all-allow answer sheet auto-fails regardless of
  raw score — one-button strategies are detected, not merely wrong. (Kimi.)
- **Kernel-certified grading.** Every item ships with a kernel decision
  receipt; the generator is untrusted and cannot rig the quiz because any item
  can be replayed against the kernel by the signer or an auditor.

---

## 7. The ceiling

Stated as a permanent property of the language, not a backlog:

**boxpol cannot express, and will never express:**

1. **Relational constraints** — `field1 = field2`; "WHERE clause filters on
   the agent's own tenant_id". Diagonals, not boxes; Lemma A dies.
2. **String computation** — regex, glob, prefix-of-variable, concatenation,
   case-insensitive containment. (V1's `starts_with` / `contains_any_ci` are
   exactly this, and they are *dropped*, not inherited.)
3. **Quantification over unbounded collections.**
4. **Delegation and attenuation** — "who may grant what to whom" is a
   different layer; if it ever arrives, it is a second layer above this one,
   never a hole through it.

**The pressure valve: grow the schema, never the logic.** Every real
requirement that is not a box moves into a lens that outputs a new finite
attribute, and the policy stays boxes. Tenant matching: sql-lens learns to
emit `tenant_filter : enum {self, other, none}`; the policy says
`tenant_filter = self`; still a box, still proved. The unverified complexity
accretes in the lens, where the bundle already labels it UNVERIFIED, the
differential corpus already aims at it, and the UNKNOWN section already knows
how to confess it. Equivalently, and preferably where the tool permits: change
the **tool interface** so the attribute arrives structured in the descriptor
and no lens is needed at all (the DeepSeek reading's form of the same valve —
"add `postgres_query_archive` as a tool" rather than "add glob to the
language").

**The constitutional rule:** any construct the analyzer cannot decide by grid
walk **is a parse error**. No `extern` predicate, no host-evaluated escape
hatch, no "checked elsewhere" flag, ever. The rule is enforceable in CI, not
just in prose: the canonical decoder rejects unknown atom tags (strict
`WireCodec` keys), and §8's tripwires make the failure dated if it happens
anyway.

---

## 8. The tripwire

The UNKNOWN entries in §5.1 are honest physics: the **world exceeding the
model** (lens gaps, clock gaps, state-persistence gaps). An UNKNOWN entry
whose cause is a **policy construct** — an atom the analyzer could not decide,
a claim that degraded from PROVED to prose because the language grew — means
the boundary between verified logic and confessed gap has broken. **The first
such entry is an incident, not a line item.** The distinction is mechanical:
every UNKNOWN carries a `cause:` field, `lens | world | state | construct`,
and `construct` pages someone.

Why an incident: the failure mode this system is most likely to die of
(named independently by all four readers) is expressiveness creep
reintroducing rubber-stamping wearing formal clothes — claims quietly migrate
from machine-checked to prose, the page keeps its layout and its checkmarks,
signers habituate, and two years later humans are rubber-stamping
machine-authored policy *with Lean proof digests attached*, which is strictly
worse than never building the apparatus, because the apparatus now projects
confidence over holes. The tripwire does not prevent that failure; it gives it
a **date**, which is the difference between a system that degraded and a
system that lied.

CI proxies, live from day one (both taken from the Kimi reading):

- the renderer may not emit the word PROVED unless the claim line carries a
  kernel certificate id that the load-gate re-verifies;
- any commit touching the atom grammar or the canonical decoder must touch a
  Lean theorem in the same merge, enforced by path-based CI rule;
- the renderer may not print a lens divergence count without a corpus-run
  certificate id; a lens with no pinned corpus renders `[UNVERIFIED,
  UNTESTED]` and may never omit the field (§12.4 revision 6).

Gate-versus-report is not case-by-case taste; the selector is a property of
the hole (argued in §12.1): a hole inside a soundness theorem's domain is
**refused** (parse error); a hole that is finite and machine-enumerable
(axiom set, lens list) is **pinned** — inventoried by machine, drift fails
the build, idiom `Test/Axioms.lean` `#guard_msgs`; a hole that is not
enumerable (lens-vs-world behavior) is **counted** — printed by a
differential harness, never asserted, never allowlisted, idiom
`external_json_corpus.rs`.

When a tripwire fires, the mandated response is not "fix the check"; it is to
reopen the Cedar decision with §9's actuals in hand — by then the real costs
of both routes are known quantities.

---

## 9. What must be built

Two design rules size everything: **one reader** (policy bytes parsed once,
in Lean; the signer reads the kernel's reprint) and **generators untrusted,
checkers verified** (everything displayed carries a certificate; you verify
~2k lines, not ~6k).

| # | Component | Where / language | Size (LoC) | Trust level |
|---|---|---|---|---|
| 1 | Attribute domains + policy/schema types | Lean, `Boxes/` | ~150 | **Verified**; shares `SealCore.Digest256`, `SealCore.Sha256` |
| 2 | Canonical decoder + validator, round-trip proof | Lean | ~250 + ~300 proof | **Verified** — the JSON lesson: the signed bytes get exactly one reader. Reuses SealV2 parser/serializer + injectivity theorems and the `PolicyWire` strict-key codec idiom; do NOT write a second canonical encoding |
| 3 | Evaluator (meet over matching rules) + `boxKernel` | Lean, `Kernels/Boxes.lean` | ~150 + ~150 proof | **Verified**; totality + order-independence are a commutative-monoid fold, idiom already in `Host/PolicyOverlap.lean`; composes via existing `Host/Composition.lean` results |
| 4 | Grid: partitions, Lemma B, Lemma A | Lean | ~300 + ~400 proof | **Verified** — the substrate |
| 5 | Comparison + entailment + soundness (P4, P5); size-bound refusal | Lean | ~250 + ~400 proof | **Verified** — the sign-off primitive and the whole point of the route. Schedule risk lives here. Fallback if proofs drag: certificate style — unverified generator emits the cell trace, a small verified checker validates it; proofs shrink by half (Kimi) |
| 6 | Load-gate: re-run entailment over (core, claims) at policy load; refuse on failure | Lean + host glue | ~150 | **Verified** checker, trusted-but-tested glue; composes with `SignedPolicy` verify-first gate |
| 7 | Windowed budget automaton (`per hour`) + proofs | Lean, extends `BudgetCore` | ~100 + ~150 proof | **Verified**, else `per hour` claims stay PENDING forever; `per session` needs nothing — `BudgetCore` is done and proven |
| 8 | Pretty-syntax parser + printer | Rust | ~800 | Untrusted (authoring only; signature binds canonical form) |
| 9 | Witness + boundary generators | Rust | ~500 | Untrusted — every output replays through the kernel with a receipt |
| 10 | Teach-back generator + grader + transcript binding | Rust | ~800 | Generator untrusted; grader trusted-but-trivial (compares kernel receipts); balance rule is code, not judgment |
| 11 | Bundle renderer + ceremony (delta, forecast, signing, receipts; later per-call Ed25519 approval tokens) | Rust | ~1,500 | Trusted-but-tested; renderer lies blocked by row 6; reuses existing approval provider and signature infra |
| 12 | sql-lens (`libpg_query` wrapper) + clock-lens + differential corpus ("SQLTestSuite", mirroring `external_json_corpus.rs`: vendored pinned corpus, divergences printed and counted, never allowlisted); corpus digest, vector count, and divergence count machine-inserted into every bundle's lens line with a corpus-run certificate (§12.4 revision 6) | Rust | ~600 + corpus | **Unverified, differential-tested** — this is where the next 18 divergences live, and the harness pattern to catch them already exists in the repo |

Lean total ≈ 1,300 code + 1,400 proof — same order as the existing kernel
work. Rust total ≈ 4,200 + corpus. One person part-time, already fluent in
Lean 4: rows 1–3 in 4–8 weeks; rows 4–5 are the long pole at 2–4 months;
rows 8–12 are weekends, shippable incrementally. **Roughly six months
part-time to the first signed bundle**, and it starts after North Star V3.1
(close the proofs-to-bytes gap), because building a verified analyzer on top
of an unverified wire seam would be decorating the wrong layer.

The Cedar route, priced for the same scope: adopting Cedar still requires
rows 8–12 unchanged (lenses, ceremony, teach-back, witnesses are
language-agnostic — the DeepSeek and Kimi readings both landed here), saves
rows 1–5 (call it 2–3 months), and pays with an SMT solver inside the trust
base of the sign-off primitive plus an analyzer blind to approve-verdicts and
budgets. That is the whole trade, and §1 is why this document takes the other
side of it.

---

## 10. Revisions forced by reading the code (not silently applied)

1. **Canonical form: s-expressions → SealV2 canonical JSON.** The original
   answer specified a rigid s-expression grammar, reasoning "not JSON — JSON
   is how you got 18 divergences." Reading `SealV2/` showed the repository
   already owns a *verified* canonical JSON subset with serializer
   injectivity theorems and a canonicality-guarding parser. The 18
   divergences came from two readers of *lenient wire* JSON, not from JSON
   the format; a second bespoke encoding would create a new two-readers seam
   against every existing tool. §2.4 now builds on SealV2.
2. **Approval mechanism overstated.** The original bundle said "human Ed25519
   token required per call." What exists is the guarded-verdict flow: y/N on
   the full 64-hex target digest with a TTL-bounded approval record
   (`providers.rs`, `Policy.approvalTtlMs`). §3.3 now reuses that flow as-is;
   per-call Ed25519 tokens moved to the ceremony build item; U7 confesses the
   comprehension gap the North Star correction documented.
3. **Budget window overstated.** The original wrote `budget 30 per hour`
   with "fixed window, kernel-counted." `BudgetCore` is verified but is a
   monotone *total* cap; no windowed automaton exists. §3.2 splits
   `per session` (proved today) from `per hour` (grammar-admitted,
   claims-gated on new proofs, row 7).
4. **The meet semantics is less novel than presented.** `Host/PolicyOverlap.lean`
   already proves deny-wins quantified over rule lists, ambiguity-fail-closed,
   and permutation-invariance at outcome granularity for the V1 engine —
   including the honest counterexample that reason *strings* are
   order-dependent. Boxpol's algebra is a generalization of an existing proof
   pattern, which improves the §9 schedule estimate's credibility and is now
   said plainly rather than implied away.
5. **V1 relationship stated.** The frozen V1 `MatchSpec` contains
   `startsWith` and `containsAnyCi` — precisely the constructs §7 bans.
   Boxpol is not V1-plus; a V1 policy is not in general expressible in
   boxpol, and no migration claim is made.

Revisions 6–8, forced by the coverage follow-up rather than by reading the
code, are recorded in §12.4 with the same discipline.

## 11. Open UNKNOWNs of this specification

- **U-spec-1**: windowed-budget proofs tractability (§3.2). Settled by
  prototyping the window automaton against `BudgetCore`'s proof style.
- **U-spec-2**: compiled-Lean grid-walk performance at the 2^20 cell bound
  (§4.4). Settled by benchmark during row 5; bound only ever moves down.
- **U-spec-3**: constructor mode vs lens mode for the V3.3 Postgres sink
  (§2.3). Settled by inspecting what the mediated tool surface actually
  passes; today it is raw MCP arguments, which implies lens mode and its
  UNKNOWNs.
- **U-spec-4**: interaction of the boxpol fixed-key-order validator with the
  existing `PolicyWire` codec conventions (§2.4). Settled by writing row 2
  against the real `WireCodec` API.
- **U-spec-5**: whether teach-back stamping (never blocking) is the right
  default for a single-operator deployment, where the signer and the
  policy author are the same person and the stamp shames nobody. Settled by
  Ben on 2026-08-09: block with a recorded override. His accepted argument was
  that Seal's own doctrine says a control is only real if you cannot violate it
  and still get a green, so a stamp you can sign through is injected rather than
  enforced. The superseded stamp-through default remains recorded in §6 for
  provenance. A bare block would be a one-line change; block-with-recorded-
  override is not. It needs a receipt schema, a grant lifetime, a reversion
  path, an escalation ladder for repeat use, and a redemption record. The real
  cost is a subsystem, not a line, and this specification does not invent a
  lines-of-code estimate it cannot defend.

---

## 12. Coverage: the reviewer's three questions, answered against the code (2026-07-26)

Provenance: Ben pushed back on §8's claim that verified apparatus projecting
confidence over holes is worse than no apparatus ("wouldn't the tooling help
to a degree? how does this problem get solved in other tools?"). The reviewer
answered him with three prior-art positions (Astrée-style refusal, SPARK-style
justified exception, seL4-style published assumptions) and posed three
questions back, asking for disagreement where warranted. This section answers
them. Every repository claim below was checked against the working trees on
2026-07-26.

One correction to the reviewer's framing before the questions, because their
answer to Ben is otherwise adopted: "coverage is a reported output, not a
silent assumption" is necessary but not sufficient. It matters *who produces
the report*. "0 findings, 3 files unparsed" is strictly better than "0
findings" only if the "3 files unparsed" line is computed by the analyzer
itself; an authored coverage line degrades exactly the way Q1 predicts
justification fields degrade. The load-bearing property is that the residual
is **computed by machinery at least as trusted as what checks the claim** —
this is clause (i) of §12.3, and it recurs in all three answers.

### 12.1 Q1 — refusal vs justified exception is the wrong dichotomy; the selector is machine-enumerability

The reviewer asks whether a justified-exception model exists whose discipline
is enforced mechanically rather than socially. It exists, and seal-host
already runs it — alongside its deliberate opposite, and the contrast between
the two is the real answer.

**The pinned inventory.** `seal-host/Test/Axioms.lean` contains 264
`#guard_msgs in #print axioms` checks. The axiom set of every decision-bearing
theorem is *computed by the Lean kernel* and *pinned as expected output*; any
drift — a new axiom, a `sorryAx`, an `ofReduceBool` — fails the build itself.
To admit a new assumption you must edit the pin in the same commit: the hole
becomes a build-breaking diff, dated and attributable in git history, and it
cannot accumulate silently because the drifted state does not compile. This is
SPARK's justified exception with the review board replaced by a gate plus
version control — which is exactly what a one-person project has instead of a
review board. The weaker form of the same idiom also exists in the tree and
is instructive: `seal-host/Test/Axioms.lean` is `#print axioms` only — it
prints the assumption sets into evidence output but pins nothing, so drift
there must be *noticed* rather than *caught*. The delta between those two
files is precisely the delta between social and mechanical discipline, and
the pinned form wins for the reviewer's own reason.

**The deliberate non-gate.** `rust/tests/external_json_corpus.rs` takes the
opposite stance on purpose — its header: the `i_*` implementation-defined
class is "observation-only: its Rust and Lean views (and any disagreement) are
printed, never allowlisted or asserted." Why not pin the divergence count too?
Because the count changes whenever the corpus changes, and a gate on it
creates exactly the allowlisting pressure the harness exists to avoid. The
divergences are model-vs-world facts, not trust-base changes.

So the repository already implements **three regimes**, and the selector
between them is a property of the hole, not taste:

1. **Refuse** — when the hole would sit inside the domain a soundness theorem
   quantifies over. A pinned, justified exception inside the policy language
   is still a hole in Lemma A: no justification field repairs a theorem that
   no longer covers its domain. This is where the reviewer's instinct
   ("refusal wins") is right, but on stronger grounds than human weakness —
   soundness-scope, an argument from design.
2. **Pin** — when the hole is finite and machine-enumerable: axiom sets,
   trusted-assumption lists, the lens list of a schema. Machine-computed
   inventory, pinned expected output, drift fails the build. Sustained
   discipline required: zero. This answers Q1's direct question: yes, the
   mechanically-enforced justified-exception model exists, and its shape is
   *the justification is not a prose field but a pinned machine-computed
   inventory whose every change is a red build until re-pinned*.
3. **Count** — when the holes are not enumerable (behavioral divergence of an
   unverified lens against the world): counted and printed by a differential
   harness, never asserted, never allowlisted.

Verdict on Q1: neither pure refusal nor SPARK-style exception "wins", because
they are answers for different regimes. Refusal is correct and stays absolute
in regime 1 (§7 stands unchanged). For regimes 2 and 3 refusal is not even
available — the holes exist whether admitted or not — and there the pinned
inventory beats the prose justification on the reviewer's own degradation
argument: a `#guard_msgs` pin cannot rot into "TODO, revisit" because the
rotted state does not build.

### 12.2 Q2 — the Astrée reading is accurate about the slogan and flattening about the design

Conceded at the top: "no extern, no escape hatch, ever" describes the policy
logic, not the system, and a gap-closing apparatus exists and is load-bearing
— §1 says so in terms ("what the bet honestly relocates rather than
eliminates"), and §2.3/§7 name its parts (lenses, constructor mode, the
pressure valve). So yes: "refusal" was never pure, the document never claimed
purity, and the reviewer is right that §7's slogan invites the purer reading.
Their reconstructed design question — *what shape does the gap-closing
apparatus take* — is the correct question.

The substantive answer is that the shape differs from Astrée's in one
structural way: **which side of the soundness theorem the apparatus sits on.**
Astrée's directives, stubs, and assumption annotations *condition the
analysis*: they change what the analyzer concludes about the same code, so
every verdict is really "sound given these annotations", and the annotations
accumulate in project files under social review. Boxpol's apparatus is
upstream of the decision logic and cannot condition it: a lens produces the
attribute record (it changes what the *inputs* mean), and the analyzer's
theorems quantify over all attribute records unconditionally — there is no
annotation, directive, or stub that alters a verdict. The gap-closure is
squeezed into one typed seam, and the seam's enumeration is machine-checked:
every attribute is `provides`-covered by exactly one lens or by the
descriptor, and an uncovered attribute is a schema error (§2.1). That
coverage rule is clause (ii) of §12.3 enforced at the parser.

Why this shape is available here and not to Astrée: Astrée meets the C code
as found; this project owns the tool interface and may move classification
out of the analyzed artifact entirely (constructor mode being the limit
case, where the gap is deleted rather than relocated). The accurate
restatement of the position, replacing the slogan: **the gap-closing
apparatus may never condition the analysis; it may only produce inputs, its
enumeration is machine-checked, and its behavior is counted, not trusted.**

### 12.3 Q3 — one statement, three instances with unequal grip, and a fourth thing that must not wear the same clothes

The single formal statement exists. Stated so it can fail:

> **Total accounting.** A claim artifact is admissible iff it is a triple
> (D, C, R) where D is a denominator fixed *outside* the tool; C ⊆ D is where
> the guarantee is machine-checked; R = D \ C is the residual; and
> (i) R is produced, or checked, by machinery at least as trusted as what
>     checks C — computed, never authored;
> (ii) C ∪ R = D holds by construction, not by the author's diligence;
> (iii) the guarantee over C and the enumeration of R travel in the same
>     signed artifact;
> (iv) any change to R fails a gate until re-pinned, so every change is a
>     dated diff.

The three levels are genuine instances, and the test the reviewer asked for
exposes exactly how they differ — in how much of (i) and (ii) the machine can
actually hold:

| instance | D | R | (i) computed? | (ii) total by construction? |
|---|---|---|---|---|
| proof assumptions | dependency closure of the theorem | axiom list | yes — the Lean kernel itself | yes — the kernel tracks every axiom; none can hide |
| analyzer coverage | the policy's canonical bytes over the schema's attribute space | ∅ in-language (refusal), plus the displaced residual: the lens list | lens *list*: yes (schema coverage rule, §2.1); lens *behavior*: no — counted by corpus, not enumerated | yes for the list — uncovered attribute is a schema error |
| broker coverage | total agent reachability | UNBROKERED + UNKNOWN rows of the V3.2 report | no — authored today; *making it computed is V3.2's research contribution* | no — the UNKNOWN row is the standing confession that (ii) is not yet mechanical |

So the reviewer's unity survives: one primitive, three instances, and it is a
thesis rather than a pattern-match — but only if stated *with the ordering*.
The instances form a descent: proofs (the accountant is total), analyzer (the
inventory is total, the behavior is only counted), broker (the denominator
itself is the open problem). That descent is the content. Flattened to "we
report coverage at three levels" it is a slogan; with the ordering it says
where the mechanism is strong, where it is approximated, and where making it
mechanical would be publishable — which is why V3.2/V3.4 already call the
broker instance the paper.

Two sharpenings the test produced, one of them a disagreement:

**The refusal trap.** Refusal used alone satisfies "full coverage" by
shrinking D: "the analyzer covers 100% of what it accepts" is the same defect
`docs/archive/NORTH-STAR-V3.md` V3.2 bans in the broker ("a coverage figure computed over
what we already watch is the project's own signature defect wearing a new
hat"). Clause (ii)'s externally-fixed denominator is what separates honest
refusal from denominator-gaming, and the analyzer instance passes only
because the schema forces the displaced residual — the lens list — to be
enumerated where refusal pushed it. This is the strongest reason the three
belong together: the same clause catches the same cheat at all three levels.

**The disagreement.** There is a fourth thing in this spec that
pattern-matches into the unity and must be kept out of it: the world-model
UNKNOWNs (§5.1 U1–U5 — SELECT invoking mutating functions, DST shifts, view
expansion). Their denominator is the world. No machinery enumerates it; they
are authored; they fail clause (i) irreparably, and no design change fixes
that, because the gap is between the model and reality rather than between
two machine-checkable sets. Dressing them as "the same primitive, fourth
instance" would be precisely the §8 failure — confidence projected over a
hole, this time by the coverage thesis itself. The honest structure is:
total accounting where D is machine-enumerable; **authored confession plus a
compensating control** where it is not. The compensating control already
exists in this spec and can now be named as such: teach-back's mandatory
UNKNOWN-anchored questions (§6.1 pool 2). When the machine cannot compute the
residual, the ceremony verifies that the *human* carries it — that is what
pool 2 is *for*, and this section is the first place the spec says so.

What the statement demands that the spec was not doing: clause (i) was
violated at one seam — the bundle's lens lines carried an authored, static
`[UNVERIFIED]` label while the machinery to compute something stronger
(divergence counts from a pinned corpus) was already specified in row 12 but
never wired into the artifact the human signs. Fixed below.

### 12.4 Spec changes forced by this section (not quietly applied; numbering continues §10)

6. **Bundle lens lines now carry machine-inserted corpus evidence** (§5.1,
   §9 row 12). Before: `sql-lens v3 … [UNVERIFIED]` — an authored label,
   clause-(i) violation at the exact seam §1 calls "the new JSON". Now: the
   renderer must print, per lens, the pinned corpus digest, vector count,
   and divergence count from the corpus run, carrying a certificate id; a
   lens with no pinned corpus renders `[UNVERIFIED, UNTESTED]` and may never
   omit the field. The worked example now shows both cases (clock-lens is
   honestly UNTESTED — there is no clock corpus, and the bundle now says so
   instead of implying parity with sql-lens). Idiom:
   `external_json_corpus.rs`, verbatim.
7. **§8 gains the regime selector and a third CI proxy.** Gate-versus-report
   decisions were implicit case-by-case judgment; §12.1's
   refuse/pin/count rule, selected by machine-enumerability, is now stated
   in §8, and the renderer is barred from printing a divergence count
   without a corpus-run certificate.
8. **What did not change, stated so the non-change is visible.** §7's
   constitutional rule stands word for word; the reviewer's "possibly
   absolutist" is rejected for the in-language regime on soundness-scope
   grounds (§12.1) — the absolutism was always scoped to the one place where
   a justified exception is structurally meaningless, and §12.2 replaces the
   slogan's overreach without weakening the rule.

---

## 13. Frisk corrections (Monkey, 2026-07-26 02:00, read-only lane `boxpolfrisk`)

§2 to §9 were checked claim by claim against the working trees. **33 of 38
checkable claims resolved TRUE at the named file and line, and none were
fabrications.** `SealV2`'s coverage is in fact STRONGER than §4.3 claims: a full
canonical-AST round-trip exists, not merely string-layer injectivity. Corrections
are recorded here rather than patched into the prose above, so the delta stays
visible in the same way §10 and §12.4 do.

**Four overstatements. All the same shape as the §12.1 axiom-count error (264
stated, 262 actual): a specific, file-path-carrying claim that reads as verified
because it names a location, and was not counted.**

1. **§4.5** claims `Host/Action.lean` imports `SealCore` (Digest256, Sha256,
   Event) and `SealV2` (canonical parser, serializer, crypto). It imports exactly
   `Lean.Data.Json` and `SealV2.Parser`. The cross-package precedent is real but
   lives elsewhere: `Host/Kernel.lean` imports `SealCore.Event`. Two of the three
   claimed imports are misattributed.
2. **§4.3** names serializer injectivity theorems for the NUMBER layer. Strings
   have them (`escapeString_injective`, `serializeString_injective`,
   `SerializationTheorems.lean:477,488`); numbers do not. What exists is
   `serialize_roundtrip_number` (:512). Round-trip on canonical decimals implies
   injectivity, so the substance survives and the sentence does not.
3. **§4.3 / §9 row 3** call `resolve_perm_toEvent` (`PolicyOverlap.lean:182`) a
   commutative-monoid fold. It is a first-blocking plus guard-agreement
   combinator. It is still the right precedent for "permutation-invariance is
   provable here", and boxpol's fold is simpler, so the schedule survives.
4. **§3.2** attributes "state-advances-only-on-execution" to the budget kernel.
   In `Kernels/Budget.lean` that is a DOCSTRING (:56), not a theorem; `decide` is
   pure and returns a proposed state, so the property is host-glue behaviour
   outside anything proved. The proved parts (`step_monotone`,
   `run_never_over_budget`, `over_budget_denied`) all check.

**Two structural weaknesses, to settle before row 12 or row 5 starts.**

- **§9 row 12 prices the SQL corpus at zero, and it is the largest hidden cost in
  the schedule.** JSONTestSuite was VENDORED. There is no SQLTestSuite upstream,
  so a SQL divergence corpus must be AUTHORED, and the authorship IS the work.
  Compounding it, §5.1's worked example prints
  `SQLTestSuite@b7e2… 812 vectors, 11 divergences` as illustration, in a format
  indistinguishable from a real pinned artifact. A document specifying the cure
  for confident-looking holes should not contain one. **Either mark that line
  ILLUSTRATIVE in the artifact itself, or price the corpus honestly, or both.**
- **§4.4's 2^20 cell bound has an unowned knob.** The bound is a real number and
  the refusal is genuinely specified (compute the count before walking, print the
  per-attribute factors, hard error naming the largest factor's attribute, never
  sample). But "default 2^20" implied a knob and the spec never said where it
  lived or who may turn it, while "the bound only moves down" bound only the
  default. An operator-raisable bound is a quiet hole in the constitutional
  posture of §7. **CLOSED 2026-07-26: Ben ruled it a compile-time constant.**
  The word "default" is gone from §4.4, there is no runtime override and no
  configuration key, and §4.4 now records the reasoning. Lowering it is an
  ordinary source change; raising it is a change to the signed shape.

**One internal inconsistency**: the §2 EBNF requires
`lens … "provides" ident ("," ident)*`, while the §2.1 example writes the provides
list as a comment (`# provides kind, tables`). One of the two is wrong and a
stranger implementing row 8 hits it immediately.

**One unchecked number**: "cvc5 ~500k lines C++" (§1) could not be verified here
and nothing rides on its exact value. Source it or soften it; it is precisely the
kind of figure this document has already been caught stating without counting.
