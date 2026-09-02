/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.ResponseTransport
import Seal.Classify
import Seal.JsonUtil

/-!
# The wire-classify seam widened onto the transport model (K3/K4)

## Why this file exists (the honesty gap being closed)

Every request model in this repository so far — `ResponseNI.HostEvent.request`
and its byte-transport enrichment in `ResponseTransport` — decides EVERY
request event: `reqDecision` is total and the request arm of `runTrace`
always emits a `.decision`. That mirrors mcp-seal-dev's own FFI
(`Ffi.decideImpl` fails closed), and the `ResponseNI` header says so. But the
deployed seal-host router does NOT hand every wire line to a kernel. It
classifies first (seal-host `Host/Canonical.lean:42-66`, exported as
`seal_host_classify`, consumed at `rust/src/main.rs:1339-1361`):

* `.act`        → mediated: the line reaches a kernel gate;
* `.passthrough`→ the line is written to the CHILD's stdin verbatim, with no
                  decision of any kind (`main.rs:1340-1350`: "the INNER bytes
                  flow to the child", no approval poll, no nonce burn);
* `.refuse`     → the line is answered with a seam error and never forwarded
                  (`main.rs:1352-1361`).

A model whose alphabet cannot express the `.passthrough` transition proves
mediation properties over a world in which passthrough does not exist. This
file WIDENS the model: the observation alphabet gains `.forwarded` (child-
bound bytes, undecided) and `.refused`, and the request transition routes
through the classifier. The point is not that passthrough is safe or unsafe;
it is the exact boundary — which byte class escapes undecided — stated as a
theorem with both sides witnessed.

## Binding the right object

seal-host's `classifyLine` is a thin composition of functions DEFINED IN THIS
REPOSITORY: the raw-wire numeric gates in `Seal.JsonUtil`, `Lean.Json.parse`,
and `Seal.toolsCall?` (`Seal/Classify.lean:113`). The `classifyWire` mirror
below composes those same definitions — not namesakes — in the same order as
`Host/Canonical.lean` (trim, parse-cost refusal, numeric-agreement refusal,
parse, tools-call match). What remains hand-mirrored (cited, not proven) is
only the composition itself and the router's use of it; there is no
refinement proof from seal-host or from the compiled Rust, and no theorem
here transfers to the deployed binary.

## The strict/lenient split (K4)

Routing is STRICT: a line is mediated iff a strict JSON parse of the trimmed
line yields the byte-exact `tools/call` shape. Successfully parsed top-level
arrays are refused because MCP revisions 2025-06-18 and 2026-07-28 do not
admit JSON-RPC batching. The named assumption
A-strict-child (seal-host `RUST_BRIDGE.md:18-24`, `TCB.md` T10) is that the
child parses its protocol equally strictly. A LENIENT child — one that
tolerates a UTF-8 BOM (RFC 8259 §8.1 allows implementations to ignore one),
matches the method case-insensitively, or executes JSON-RPC 2.0 §6 batch
arrays — can interpret some non-array line the router classified as non-call
traffic as a call. `lenientCalls` below deliberately retains all three
historical leniencies, including old/generic JSON-RPC batch execution, so the
closed batch gap remains explicit rather than being deleted from the model.
It is a lower bound on what some lenient child may execute, not a model of
every possible child (the child is arbitrary; no such model exists). The class
`undecidedCallClass = escapesClass ∧ lenientClass` is therefore the proved
LOWER BOUND on the strict-monitor/lenient-child gap — the byte class that
provably escapes undecided AND is executed as a call by the reference
lenient reading. Batch lines remain in `lenientClass` but are excluded from
`undecidedCallClass` by refusal. Prior art calls this failure family a parser differential
(LangSec, Sassaman–Patterson–Bratus); the escape hazard here is the
mediation-side instance of it.

## Modeling conventions, stated so they can be frisked

* One `.request raw now` event is one wire line arriving at the ROUTER — not
  (as in `ResponseNI`/`ResponseTransport`) one call to the kernel's decide.
  The widened model places the classifier between the two.
* The mediated arm's decision function stays `reqDecision` — this repo's
  kernel composition. The deployed seal-host Mediate arm gates through its
  own kernel registry; only the ROUTING is mirrored from seal-host here.
* Refused and passthrough lines leave the approval plane untouched and burn
  no nonce (`main.rs:1332-1338`); the model's arms are state-identity.
* Unmodeled, honestly: failure of the child-stdin write on a passthrough
  forward (`main.rs:1345-1348` — death + seam error; the mediated forward
  has the same unmodeled arm), failure of the seam-error client write on
  refuse (`main.rs:1357-1359`), the envelope inner-byte substitution on
  enveloped lines (`main.rs:1321-1328`: the child receives the INNER bytes;
  this model forwards the wire line), and everything the `ResponseTransport`
  honesty boundary already lists.
* `Lean.Json.parse` is `partial`: the kernel cannot reduce it, so concrete
  class membership of a specific line is pinned by `#guard` (compiler-
  evaluated) and re-confirmed at runtime by `Test/ClassifyEnum.lean`; the
  theorems quantify over lines with the class as a hypothesis.
-/

namespace SealV2.ClassifyTransport

open SealV2 Lean

/- The trace inductions below unfold a request arm that carries the full
   `classifyWire`/`reqDecision` compositions; the default heartbeat budget is
   too small for their `simp` congruence passes. -/
set_option maxHeartbeats 1000000

/-! ## The byte classes: R (refused), S (mediated), and the escape class

Each is a predicate on the input bytes alone. None mentions the router or
the transport model — the theorems connect them to the model's behavior, so
the characterisation cannot collapse into "the router forwards what the
router forwards". -/

/-- The line as the classifier sees it: ASCII-trimmed, exactly
    `Host/Canonical.lean:44` (`line.trimAscii.toString`). -/
def trimmed (line : String) : String := line.trimAscii.toString

/-- Successfully parsed top-level JSON arrays. This is deliberately a
    whole-shape predicate: empty arrays, singleton batches, multi-element
    batches, and arrays of non-object values are all outside MCP's wire
    message grammar. Arrays nested inside an object do not inhabit it. -/
def parsedTopLevelArrayClass (line : String) : Bool :=
  match Json.parse (trimmed line) with
  | .ok json => Seal.isTopLevelArray json
  | .error _ => false

/-- **R** — the refused class: either independent pre-parse number guard
    rejects the line (pathological exponent cost or binary64 disagreement),
    or the safe strict parse yields a top-level array. Refused lines are
    neither mediated nor forwarded. -/
def refusedClass (line : String) : Bool :=
  !Seal.JsonUtil.wireNumbersSafe (trimmed line)
    || !Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line)
    || parsedTopLevelArrayClass line

/-- The strict `tools/call` shape, stated structurally on the parsed JSON
    value: a `method` member that is the string `"tools/call"` byte-exactly,
    and a `params.name` string member. Stated independently of
    `Seal.toolsCall?`; `strictCallShape_eq_toolsCall?` proves it equals the
    deployed matcher. -/
def strictCallShape (j : Json) : Bool :=
  ((j.getObjVal? "method").toOption.bind (·.getStr?.toOption) == some "tools/call")
    && ((j.getObjVal? "params").toOption.bind
          (fun p => (p.getObjVal? "name").toOption.bind (·.getStr?.toOption))).isSome

/-- **S** — the mediated class: safe under both number guards, strict-parses,
    and has the strict `tools/call` shape. A line is decided before forwarding
    iff it is in S (`forwarded_iff_escapes` and friends below). -/
def mediatedClass (line : String) : Bool :=
  Seal.JsonUtil.wireNumbersSafe (trimmed line)
    && Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line)
    && (match Json.parse (trimmed line) with
        | .error _ => false
        | .ok j => strictCallShape j)

/-- **The escape class** — the exact byte class that is forwarded to the
    child with no decision: not refused, not mediated. Includes malformed
    JSON, BOM-prefixed JSON, non-byte-exact method spellings
    (`"TOOLS/CALL"`) — and ALL legitimate non-call
    traffic (`initialize`, `tools/list`, notifications), whose passthrough
    is the protocol working as designed. Top-level arrays used to be listed
    here; they are now in R. The remaining hazard is this class's intersection
    with what a lenient child executes (`undecidedCallClass`). -/
def escapesClass (line : String) : Bool :=
  !refusedClass line && !mediatedClass line

/-! ## The classifier mirror -/

/-- Wire-line routing verdict, constructor-for-constructor seal-host's
    `Host.LineClass` (`Host/Canonical.lean:26-35`); `.act` carries the
    matched tool name and arguments instead of seal-host's
    `CanonicalAction` record (whose remaining fields — `ast?`, `raw`,
    `requestId` — feed audit and approval binding, not routing). -/
inductive WireClass where
  | passthrough
  | act (tool : String) (args : Json)
  | refuse

/-- The router mirror: the same parse-cost guard → numeric-agreement guard →
    `Json.parse` → `toolsCall?` composition expected at the host boundary,
    over THIS repository's own definitions — the very kernel definitions
    seal-host imports on a deliberate repin. -/
def classifyWire (line : String) : WireClass :=
  if !Seal.JsonUtil.wireNumbersSafe (trimmed line) then
    .refuse
  else if !Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line) then
    .refuse
  else
    match Json.parse (trimmed line) with
    | .error _ => .passthrough
    | .ok json =>
        if Seal.isTopLevelArray json then
          .refuse
        else
          match Seal.toolsCall? json with
          | none => .passthrough
          | some (toolName, toolArgs) => .act toolName toolArgs

/-! ## The reference lenient reading (K4's other half) -/

/-- Strip one leading U+FEFF. RFC 8259 §8.1: implementations MAY ignore a
    byte-order mark; many real parsers do. The strict router does not
    (`Json.parse` fails on it), so a BOM-prefixed call escapes. -/
def stripBom (s : String) : String :=
  if s.startsWith "\uFEFF" then (s.drop 1).toString else s

/-- Case-insensitive method match — the leniency named by seal-host's own
    A-strict-child example (`RUST_BRIDGE.md:20`: `"TOOLS/CALL"`). The first
    disjunct is semantically redundant (a byte-exact match is also a
    case-insensitive match); it is kept so `lenient_extends_strict_value`
    is provable without kernel-evaluating the Unicode tables behind
    `String.toLower`. -/
def lenientMethodIsCall (m : String) : Bool :=
  m == "tools/call" || m.toLower == "tools/call"

/-- One object read leniently: as `Seal.toolsCall?` but with the
    case-insensitive method match. -/
def lenientCallOf? (j : Json) : Option (String × Json) := do
  let methodJson ← (j.getObjVal? "method").toOption
  let method ← methodJson.getStr?.toOption
  if !lenientMethodIsCall method then
    none
  else
    let params ← (j.getObjVal? "params").toOption
    let nameJson ← (params.getObjVal? "name").toOption
    let name ← nameJson.getStr?.toOption
    let args := (params.getObjVal? "arguments").toOption.getD Json.null
    some (name, args)

/-- The calls the reference lenient child executes from one parsed value.
    This historical child model is intentionally unchanged when the router
    closes the batch gap: MCP revision 2025-03-26 inherited JSON-RPC batching,
    while 2025-06-18 removed it, and an older or generic JSON-RPC child may
    still execute each array element. A single object executes its own call,
    if any. The strict matcher sees no call in ANY array
    (`toolsCall?_arr_none`), while the router now refuses the whole array. -/
def lenientCalls : Json → List (String × Json)
  | .arr elems => elems.toList.filterMap lenientCallOf?
  | j => (lenientCallOf? j).toList

/-- The lenient parse: the strict parse if it succeeds, else one retry with
    the BOM stripped. Defined over the SAME `Json.parse (trimmed line)` call
    as `mediatedClass`, so strict ⊆ lenient is provable rather than assumed. -/
def lenientParse (line : String) : Except String Json :=
  match Json.parse (trimmed line) with
  | .ok j => .ok j
  | .error e =>
      match Json.parse (stripBom (trimmed line)) with
      | .ok j => .ok j
      | .error _ => .error e

/-- **L** — the reference lenient child executes at least one call from the
    line. -/
def lenientClass (line : String) : Bool :=
  match lenientParse line with
  | .error _ => false
  | .ok j => !(lenientCalls j).isEmpty

/-- **The K4 class: forwarded undecided AND executable as a call by the
    reference lenient child.** The proved lower bound on the remaining
    strict-monitor/lenient-child gap. Because `escapesClass` excludes refused
    arrays, historical batch execution in `lenientClass` no longer puts a
    batch in this intersection. -/
def undecidedCallClass (line : String) : Bool :=
  escapesClass line && lenientClass line

/-! ## The shape predicate equals the deployed matcher -/

/-- `strictCallShape` — stated structurally, without `Seal.toolsCall?` — is
    exactly the deployed matcher's success. This is the anti-tautology bridge:
    S is defined via the shape, the router runs `toolsCall?`, and this
    theorem connects the two. -/
theorem strictCallShape_eq_toolsCall? (j : Json) :
    strictCallShape j = (Seal.toolsCall? j).isSome := by
  unfold strictCallShape Seal.toolsCall?
  cases hm : (j.getObjVal? "method").toOption with
  | none => simp [hm]
  | some mj =>
      cases hs : mj.getStr?.toOption with
      | none => simp [hm, hs]
      | some m =>
          by_cases hcall : m = "tools/call"
          · subst hcall
            cases hp : (j.getObjVal? "params").toOption with
            | none => simp [hm, hs, hp]
            | some p =>
                cases hn : (p.getObjVal? "name").toOption with
                | none => simp [hm, hs, hp, hn]
                | some nj =>
                    cases hnm : nj.getStr?.toOption with
                    | none => simp [hm, hs, hp, hn, hnm]
                    | some name => simp [hm, hs, hp, hn, hnm]
          · have hne : (m != "tools/call") = true := by
              simpa using hcall
            simp [hm, hs, hne, hcall]

/-- The strict matcher sees no call in any top-level array. Kept before the
    routing equivalences so the `.act` proof can discharge the new refusal
    branch structurally. -/
theorem toolsCall?_arr_none (elems : Array Json) :
    Seal.toolsCall? (Json.arr elems) = none := rfl

theorem strictCallShape_arr (elems : Array Json) :
    strictCallShape (Json.arr elems) = false := rfl

/-! ## Router ↔ classes: the deployed routing is exactly the trichotomy -/

theorem classifyWire_refuse_iff (line : String) :
    classifyWire line = .refuse ↔ refusedClass line = true := by
  cases hw : Seal.JsonUtil.wireNumbersSafe (trimmed line) with
  | false => simp [classifyWire, refusedClass, hw]
  | true =>
      cases ha : Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line) with
      | false => simp [classifyWire, refusedClass, hw, ha]
      | true =>
          cases hp : Json.parse (trimmed line) with
          | error e =>
              simp [classifyWire, refusedClass, parsedTopLevelArrayClass, hw, ha, hp]
          | ok j =>
              cases hj : Seal.isTopLevelArray j with
              | false =>
                  cases ht : Seal.toolsCall? j <;>
                    simp [classifyWire, refusedClass, parsedTopLevelArrayClass,
                      hw, ha, hp, hj, ht]
              | true =>
                  simp [classifyWire, refusedClass, parsedTopLevelArrayClass,
                    hw, ha, hp, hj]

theorem classifyWire_act_iff (line : String) :
    (∃ n a, classifyWire line = .act n a) ↔ mediatedClass line = true := by
  cases hw : Seal.JsonUtil.wireNumbersSafe (trimmed line) with
  | false => simp [classifyWire, mediatedClass, hw]
  | true =>
      cases ha : Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line) with
      | false => simp [classifyWire, mediatedClass, hw, ha]
      | true =>
          cases hp : Json.parse (trimmed line) with
          | error e => simp [classifyWire, mediatedClass, hw, ha, hp]
          | ok j =>
              cases hj : Seal.isTopLevelArray j with
              | false =>
                  cases ht : Seal.toolsCall? j with
                  | none =>
                      simp [classifyWire, mediatedClass, hw, ha, hp, hj, ht,
                        strictCallShape_eq_toolsCall?]
                  | some c =>
                      obtain ⟨n, a⟩ := c
                      simp [classifyWire, mediatedClass, hw, ha, hp, hj, ht,
                        strictCallShape_eq_toolsCall?]
              | true =>
                  have ht : Seal.toolsCall? j = none := by
                    cases j with
                    | arr elems => exact toolsCall?_arr_none elems
                    | null => simp [Seal.isTopLevelArray] at hj
                    | bool b => simp [Seal.isTopLevelArray] at hj
                    | num n => simp [Seal.isTopLevelArray] at hj
                    | str s => simp [Seal.isTopLevelArray] at hj
                    | obj o => simp [Seal.isTopLevelArray] at hj
                  simp [classifyWire, mediatedClass, hw, ha, hp, hj, ht,
                    strictCallShape_eq_toolsCall?]

theorem classifyWire_passthrough_iff (line : String) :
    classifyWire line = .passthrough ↔ escapesClass line = true := by
  cases hw : Seal.JsonUtil.wireNumbersSafe (trimmed line) with
  | false => simp [classifyWire, escapesClass, refusedClass, hw]
  | true =>
      cases ha : Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line) with
      | false =>
          simp [classifyWire, escapesClass, refusedClass, mediatedClass, hw, ha]
      | true =>
          cases hp : Json.parse (trimmed line) with
          | error e =>
              simp [classifyWire, escapesClass, refusedClass, mediatedClass,
                parsedTopLevelArrayClass, hw, ha, hp]
          | ok j =>
              cases hj : Seal.isTopLevelArray j with
              | false =>
                  cases ht : Seal.toolsCall? j <;>
                    simp [classifyWire, escapesClass, refusedClass, mediatedClass,
                      parsedTopLevelArrayClass, hw, ha, hp, hj, ht,
                      strictCallShape_eq_toolsCall?]
              | true =>
                  simp [classifyWire, escapesClass, refusedClass, mediatedClass,
                    parsedTopLevelArrayClass, hw, ha, hp, hj]

/-- Every line whose strict parse is a top-level array is refused. Earlier
    number-guard refusal only reaches the same verdict, so no safety
    hypotheses are needed. This covers empty, singleton, and multi-element
    arrays uniformly. -/
theorem classifyWire_refuses_parsed_array (line : String) (elems : Array Json)
    (hp : Json.parse (trimmed line) = .ok (.arr elems)) :
    classifyWire line = .refuse := by
  cases hw : Seal.JsonUtil.wireNumbersSafe (trimmed line) with
  | false => simp [classifyWire, hw]
  | true =>
      cases ha : Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line) with
      | false => simp [classifyWire, hw, ha]
      | true => simp [classifyWire, hw, ha, hp, Seal.isTopLevelArray]

theorem parsed_array_refused (line : String) (elems : Array Json)
    (hp : Json.parse (trimmed line) = .ok (.arr elems)) :
    refusedClass line = true :=
  (classifyWire_refuse_iff line).mp (classifyWire_refuses_parsed_array line elems hp)

/-- Closing the batch gap without deleting its child model: a parsed array may
    still satisfy `lenientClass`, but it cannot be forwarded undecided. -/
theorem parsed_array_not_undecided (line : String) (elems : Array Json)
    (hp : Json.parse (trimmed line) = .ok (.arr elems)) :
    undecidedCallClass line = false := by
  have hr := parsed_array_refused line elems hp
  simp [undecidedCallClass, escapesClass, hr]

/-- Transparent mediation's negative control, quantified over every safe
    non-array value: if the existing strict matcher does not recognize a
    `tools/call`, the value still passes through. In particular this covers
    every legitimate object, including objects with nested arrays, because
    only the outer constructor is inspected by the refusal branch. -/
theorem classifyWire_safe_nonarray_noncall_passthrough
    (line : String) (json : Json)
    (hw : Seal.JsonUtil.wireNumbersSafe (trimmed line) = true)
    (ha : Seal.JsonUtil.wireNumbersAgreementSafe (trimmed line) = true)
    (hp : Json.parse (trimmed line) = .ok json)
    (hj : Seal.isTopLevelArray json = false)
    (ht : Seal.toolsCall? json = none) :
    classifyWire line = .passthrough := by
  simp [classifyWire, hw, ha, hp, hj, ht]

/-! ## The classes partition the wire alphabet -/

/-- **Trichotomy.** Every wire line is in exactly one of R, S, escape. -/
theorem classes_partition (line : String) :
    (refusedClass line = true ∧ mediatedClass line = false ∧ escapesClass line = false)
    ∨ (refusedClass line = false ∧ mediatedClass line = true ∧ escapesClass line = false)
    ∨ (refusedClass line = false ∧ mediatedClass line = false ∧ escapesClass line = true) := by
  cases hc : classifyWire line with
  | refuse =>
      have hr := (classifyWire_refuse_iff line).mp hc
      have hm : mediatedClass line = false := by
        cases hmv : mediatedClass line with
        | false => rfl
        | true =>
            obtain ⟨n, a, ha⟩ := (classifyWire_act_iff line).mpr hmv
            rw [hc] at ha
            cases ha
      have he : escapesClass line = false := by simp [escapesClass, hr]
      exact .inl ⟨hr, hm, he⟩
  | act n a =>
      have hm := (classifyWire_act_iff line).mp ⟨n, a, hc⟩
      have hr : refusedClass line = false := by
        cases hrv : refusedClass line with
        | false => rfl
        | true =>
            have href := (classifyWire_refuse_iff line).mpr hrv
            rw [hc] at href
            cases href
      have he : escapesClass line = false := by simp [escapesClass, hr, hm]
      exact .inr (.inl ⟨hr, hm, he⟩)
  | passthrough =>
      have he := (classifyWire_passthrough_iff line).mp hc
      have hr : refusedClass line = false := by
        have h := he
        simp [escapesClass] at h
        exact h.1
      have hm : mediatedClass line = false := by
        have h := he
        simp [escapesClass] at h
        exact h.2
      exact .inr (.inr ⟨hr, hm, he⟩)

/-! ## The strict/lenient split, value level (kernel-checked)

`Json.parse` is partial, so per-line class membership is `#guard`-pinned
below; but the SPLIT itself — strict blind to batches and case variants,
lenient not — is kernel-checkable on parsed values. -/

/-- Lenient reads each batch element. -/
theorem lenientCalls_arr (elems : Array Json) :
    lenientCalls (Json.arr elems) = elems.toList.filterMap lenientCallOf? := rfl

/-- **Lenient extends strict, per value:** whatever the deployed strict
    matcher accepts, the reference lenient reading also executes. The gap
    classes below are therefore genuine extensions, not a disjoint
    re-reading. -/
theorem lenient_extends_strict_value {j : Json} {c : String × Json}
    (h : Seal.toolsCall? j = some c) : lenientCallOf? j = some c := by
  unfold Seal.toolsCall? at h
  unfold lenientCallOf?
  cases hm : (j.getObjVal? "method").toOption with
  | none => simp [hm] at h
  | some mj =>
      cases hs : mj.getStr?.toOption with
      | none => simp [hm, hs] at h
      | some m =>
          by_cases hcall : m = "tools/call"
          · subst hcall
            have hlen : lenientMethodIsCall "tools/call" = true := by
              simp [lenientMethodIsCall]
            simp only [hm, hs] at h
            simpa [hm, hs, hlen] using h
          · simp [hm, hs] at h
            exact absurd h.1 hcall

/-- Lenient extends strict, embedded in the call list. -/
theorem lenient_extends_strict {j : Json} {c : String × Json}
    (h : Seal.toolsCall? j = some c) : c ∈ lenientCalls j := by
  have hv := lenient_extends_strict_value h
  cases j with
  | arr elems => rw [toolsCall?_arr_none] at h; cases h
  | null => simp [lenientCalls, hv]
  | bool b => simp [lenientCalls, hv]
  | num n => simp [lenientCalls, hv]
  | str s => simp [lenientCalls, hv]
  | obj o => simp [lenientCalls, hv]

/-- **Strict ⊆ lenient, per line:** every mediated line is also executable by
    the reference lenient child — the lenient reading is a widening of the
    protocol the monitor mediates, so `undecidedCallClass` is the part of the
    extension that still escapes after top-level arrays move to refusal. -/
theorem mediated_lenient (line : String)
    (h : mediatedClass line = true) : lenientClass line = true := by
  unfold mediatedClass at h
  cases hw : Seal.JsonUtil.wireNumbersSafe (trimmed line) with
  | false => simp [hw] at h
  | true =>
      cases hp : Json.parse (trimmed line) with
      | error e => simp [hw, hp] at h
      | ok j =>
          simp only [hw, hp, Bool.true_and] at h
          rw [strictCallShape_eq_toolsCall?] at h
          cases ht : Seal.toolsCall? j with
          | none => simp [ht] at h
          | some c =>
              have hmem := lenient_extends_strict ht
              unfold lenientClass lenientParse
              cases hl : lenientCalls j with
              | nil => rw [hl] at hmem; cases hmem
              | cons a t => simp [hp, hl]

/-! ## Pinned witnesses (compiler-evaluated; `Json.parse` is partial, the
kernel cannot reduce it — see the header. Re-confirmed at runtime, RED on
tamper, by `Test/ClassifyEnum.lean`.) -/

/-- Inside S: the golden mediated call. -/
def mediatedWitness : String :=
  "{\"method\":\"tools/call\",\"params\":{\"name\":\"read_file\",\"arguments\":{\"path\":\"README.md\"}}}"

/-- Escape ∩ lenient: a BOM-prefixed call (RFC 8259 §8.1 tolerance). -/
def bomWitness : String := "\uFEFF" ++ mediatedWitness

/-- Escape ∩ lenient: the non-byte-exact method spelling named by
    `RUST_BRIDGE.md:20`. -/
def caseWitness : String :=
  "{\"method\":\"TOOLS/CALL\",\"params\":{\"name\":\"delete_all\",\"arguments\":{}}}"

/-- Historical batch-gap witness: a one-element top-level array. It remains
    executable in `lenientClass`, but now belongs to R and therefore cannot
    inhabit `escapesClass` or `undecidedCallClass`. -/
def batchWitness : String :=
  "[{\"method\":\"tools/call\",\"params\":{\"name\":\"delete_all\",\"arguments\":{}}}]"

/-- Empty top-level arrays are refused too; no element is needed to trigger
    the whole-shape boundary. -/
def emptyArrayWitness : String := "[]"

/-- Escape ∖ lenient: legitimate non-call traffic — passthrough by design. -/
def listWitness : String := "{\"method\":\"tools/list\"}"

/-- Escape ∖ lenient: malformed JSON. -/
def malformedWitness : String := "{oops"

/-- Inside R: a monster decimal exponent. -/
def monsterWitness : String := "{\"n\":1e9999999}"

/-- Inside R by agreement (but inside the old exponent-cost bound). -/
def agreementUnsafeWitness : String :=
  "{\"method\":\"tools/call\",\"params\":{\"name\":\"x\",\"arguments\":{\"n\":-1e9999}}}"

#guard mediatedClass mediatedWitness = true
#guard undecidedCallClass bomWitness = true
#guard undecidedCallClass caseWitness = true
#guard refusedClass batchWitness = true && lenientClass batchWitness = true
#guard undecidedCallClass batchWitness = false
#guard refusedClass emptyArrayWitness = true
#guard escapesClass listWitness = true && lenientClass listWitness = false
#guard escapesClass malformedWitness = true && lenientClass malformedWitness = false
#guard refusedClass monsterWitness = true
#guard refusedClass agreementUnsafeWitness = true
#guard (match classifyWire agreementUnsafeWitness with | .refuse => true | _ => false)

/-! ## The widened transport model

Input alphabet: `ResponseTransport.HostEvent`, unchanged. What widens is the
request TRANSITION (routed through `classifyWire`, exactly the deployed
order: dead-check `main.rs:1209-1216`, then classify `main.rs:1339`) and the
OBSERVATION alphabet (`.forwarded` — child-bound bytes with no decision —
and `.refused`). `.decision` now carries the decided line so exclusivity is
statable. -/

open SealV2.ResponseTransport (HostState HostEvent ChildRead relayedFrame?
  readKills reqDecision purgeResponses completesOf)

/-- Client/child-boundary observations of the widened model. -/
inductive Obs where
  | decision (line : RawBytes) (d : Decision)
  | refused (line : RawBytes)
  | forwarded (line : RawBytes)
  | seamError
  | relayed (frame : List UInt8)

/-- State transition. Only a MEDIATED request touches the approval plane
    (`main.rs:1332-1338`: no approval poll, no nonce burn on passthrough;
    the refuse arm answers without any kernel call). Everything else steps
    exactly as `ResponseTransport.stepState`. -/
def stepState (s : HostState) : HostEvent → HostState
  | .init cfg => SealV2.ResponseTransport.stepState s (.init cfg)
  | .approve r sig => SealV2.ResponseTransport.stepState s (.approve r sig)
  | .response r => SealV2.ResponseTransport.stepState s (.response r)
  | .request raw now =>
      match classifyWire raw with
      | .act _ _ => SealV2.ResponseTransport.stepState s (.request raw now)
      | _ => s

/-- Response observations: as `ResponseTransport.responseObs`, re-typed into
    the widened `Obs`. -/
def responseObs (s : HostState) (r : ChildRead) : List Obs :=
  if s.dead then []
  else
    match relayedFrame? r with
    | some f => [.relayed f]
    | none => []

/-- The widened trace. A request that finds the transport dead seam-errors
    and TERMINATES the run (as in `ResponseTransport`); a live request is
    routed by `classifyWire`: refused (seam-error answer, session continues,
    `main.rs:1352-1361`), forwarded child-bound with NO decision
    (`main.rs:1340-1350`), or mediated (`main.rs:1362` onward). -/
def runTrace (s : HostState) : List HostEvent → List Obs
  | [] => []
  | .init cfg :: t => runTrace (stepState s (.init cfg)) t
  | .approve r sig :: t => runTrace (stepState s (.approve r sig)) t
  | .response r :: t => responseObs s r ++ runTrace (stepState s (.response r)) t
  | .request raw now :: t =>
      if s.dead then [.seamError]
      else
        match classifyWire raw with
        | .refuse => .refused raw :: runTrace s t
        | .passthrough => .forwarded raw :: runTrace s t
        | .act _ _ =>
            .decision raw (reqDecision s.approval raw now)
              :: runTrace (stepState s (.request raw now)) t

/-- A passthrough or refused request is state-identity: the approval plane —
    including the consumed-nonce store — never moves. -/
theorem non_act_state_invariant (s : HostState) (raw : RawBytes) (now : Nat)
    (h : ∀ n a, classifyWire raw ≠ .act n a) :
    stepState s (.request raw now) = s := by
  cases hc : classifyWire raw with
  | passthrough => simp [stepState, hc]
  | refuse => simp [stepState, hc]
  | act n a => exact absurd hc (by simpa using h n a)

/-! ## The characterisation: single-request exact forms -/

/-- **Escape side.** A live request in the escape class is forwarded
    child-bound, undecided — the trace is exactly the forward. -/
theorem run_single_escape (a : Option ApprovalState) (raw : RawBytes) (now : Nat)
    (h : escapesClass raw = true) :
    runTrace ⟨a, false⟩ [.request raw now] = [.forwarded raw] := by
  have hc := (classifyWire_passthrough_iff raw).mpr h
  simp [runTrace, hc]

/-- **Mediated side.** A live request in S is decided — the trace is exactly
    one decision of that line. -/
theorem run_single_mediated (a : Option ApprovalState) (raw : RawBytes) (now : Nat)
    (h : mediatedClass raw = true) :
    runTrace ⟨a, false⟩ [.request raw now]
      = [.decision raw (reqDecision a raw now)] := by
  obtain ⟨n, ar, hc⟩ := (classifyWire_act_iff raw).mpr h
  simp [runTrace, hc]

/-- **Refused side.** A live request in R is answered refused — never
    forwarded, never decided. -/
theorem run_single_refused (a : Option ApprovalState) (raw : RawBytes) (now : Nat)
    (h : refusedClass raw = true) :
    runTrace ⟨a, false⟩ [.request raw now] = [.refused raw] := by
  have hc := (classifyWire_refuse_iff raw).mpr h
  simp [runTrace, hc]

/-- **The boundary, iff form (K4).** A live request is forwarded undecided
    IFF its bytes are in the escape class — for every approval state. The
    class is a byte predicate stated without the model (`escapesClass`); the
    model routes by the deployed classifier; this theorem is the bridge. -/
theorem forwarded_iff_escapes (a : Option ApprovalState) (raw : RawBytes) (now : Nat) :
    runTrace ⟨a, false⟩ [.request raw now] = [.forwarded raw]
      ↔ escapesClass raw = true := by
  constructor
  · intro h
    rcases classes_partition raw with ⟨hr, _, _⟩ | ⟨_, hm, _⟩ | ⟨_, _, he⟩
    · rw [run_single_refused a raw now hr] at h
      exact absurd (List.cons.inj h).1 (by intro hx; cases hx)
    · rw [run_single_mediated a raw now hm] at h
      exact absurd (List.cons.inj h).1 (by intro hx; cases hx)
    · exact he
  · exact run_single_escape a raw now

/-- Dual boundary: a live request is decided IFF its bytes are in S. -/
theorem decided_iff_mediated (a : Option ApprovalState) (raw : RawBytes) (now : Nat) :
    (∃ d, runTrace ⟨a, false⟩ [.request raw now] = [.decision raw d])
      ↔ mediatedClass raw = true := by
  constructor
  · rintro ⟨d, h⟩
    rcases classes_partition raw with ⟨hr, _, _⟩ | ⟨_, hm, _⟩ | ⟨_, _, he⟩
    · rw [run_single_refused a raw now hr] at h
      exact absurd (List.cons.inj h).1 (by intro hx; cases hx)
    · exact hm
    · rw [run_single_escape a raw now he] at h
      exact absurd (List.cons.inj h).1 (by intro hx; cases hx)
  · intro h
    exact ⟨reqDecision a raw now, run_single_mediated a raw now h⟩

/-! ## Soundness over arbitrary traces -/

/-- Anything ever forwarded child-bound is in the escape class — over every
    start state and every event sequence. -/
theorem forwarded_mem_escapes :
    ∀ (t : List HostEvent) (s : HostState) (raw : RawBytes),
      .forwarded raw ∈ runTrace s t → escapesClass raw = true := by
  intro t
  induction t with
  | nil => intro s raw h; cases h
  | cons ev t ih =>
      intro s raw h
      cases ev with
      | init cfg => exact ih _ _ h
      | approve r sig => exact ih _ _ h
      | response r =>
          simp only [runTrace] at h
          rcases List.mem_append.mp h with hin | hin
          · unfold responseObs at hin
            cases hd : s.dead with
            | true => simp [hd] at hin
            | false =>
                simp only [hd, Bool.false_eq_true, if_false] at hin
                cases hrf : relayedFrame? r with
                | some f => simp [hrf] at hin
                | none => simp [hrf] at hin
          · exact ih _ _ hin
      | request r now =>
          simp only [runTrace] at h
          cases hd : s.dead with
          | true => simp [hd] at h
          | false =>
              simp only [hd, Bool.false_eq_true, if_false] at h
              cases hc : classifyWire r with
              | refuse =>
                  simp only [hc] at h
                  rcases List.mem_cons.mp h with heq | hin
                  · cases heq
                  · exact ih _ _ hin
              | passthrough =>
                  simp only [hc] at h
                  rcases List.mem_cons.mp h with heq | hin
                  · injection heq with h1
                    subst h1
                    exact (classifyWire_passthrough_iff _).mp hc
                  · exact ih _ _ hin
              | act n ar =>
                  simp only [hc] at h
                  rcases List.mem_cons.mp h with heq | hin
                  · cases heq
                  · exact ih _ _ hin

/-- Anything ever decided is in S. -/
theorem decision_mem_mediated :
    ∀ (t : List HostEvent) (s : HostState) (raw : RawBytes) (d : Decision),
      .decision raw d ∈ runTrace s t → mediatedClass raw = true := by
  intro t
  induction t with
  | nil => intro s raw d h; cases h
  | cons ev t ih =>
      intro s raw d h
      cases ev with
      | init cfg => exact ih _ _ _ h
      | approve r sig => exact ih _ _ _ h
      | response r =>
          simp only [runTrace] at h
          rcases List.mem_append.mp h with hin | hin
          · unfold responseObs at hin
            cases hd : s.dead with
            | true => simp [hd] at hin
            | false =>
                simp only [hd, Bool.false_eq_true, if_false] at hin
                cases hrf : relayedFrame? r with
                | some f => simp [hrf] at hin
                | none => simp [hrf] at hin
          · exact ih _ _ _ hin
      | request r now =>
          simp only [runTrace] at h
          cases hd : s.dead with
          | true => simp [hd] at h
          | false =>
              simp only [hd, Bool.false_eq_true, if_false] at h
              cases hc : classifyWire r with
              | refuse =>
                  simp only [hc] at h
                  rcases List.mem_cons.mp h with heq | hin
                  · cases heq
                  · exact ih _ _ _ hin
              | passthrough =>
                  simp only [hc] at h
                  rcases List.mem_cons.mp h with heq | hin
                  · cases heq
                  · exact ih _ _ _ hin
              | act n ar =>
                  simp only [hc] at h
                  rcases List.mem_cons.mp h with heq | hin
                  · injection heq with h1 h2
                    subst h1
                    exact (classifyWire_act_iff _).mp ⟨n, ar, hc⟩
                  · exact ih _ _ _ hin

/-- **Exclusivity.** A line forwarded child-bound in some run is never
    decided in ANY run (same or different), and vice versa: S and the escape
    class are disjoint by `classes_partition`. -/
theorem forwarded_never_decided
    {t₁ t₂ : List HostEvent} {s₁ s₂ : HostState} {raw : RawBytes}
    (hf : .forwarded raw ∈ runTrace s₁ t₁) (d : Decision) :
    .decision raw d ∉ runTrace s₂ t₂ := by
  intro hd
  have he := forwarded_mem_escapes t₁ s₁ raw hf
  have hm := decision_mem_mediated t₂ s₂ raw d hd
  unfold escapesClass at he
  rw [hm] at he
  simp at he

/-! ## Mediation over the widened alphabet: what fails, what survives

The property "every child-bound line was decided first" is FALSE on the
widened model — `run_single_escape` exhibits the failing runs, one per
escape-class line, and `forwarded_never_decided` shows no decision for such
a line exists anywhere. That is the honest verdict: classifier passthrough
IS a mediation bypass for exactly the escape class, `undecidedCallClass`
being the sub-class a lenient child executes.

What SURVIVES splits by carrier — three parts, three different warrants:

1. Child bytes can only truncate the Allow stream — carried by
   `widened_fail_closed` below (run vs response-purged twin). The purge
   removes RESPONSE events only, so that theorem is silent about escape
   events.
2. No escaping line is ever the SUBJECT of an Allow — carried by
   `decision_mem_mediated` (every decision observation's line is in S; an
   Allow observation is a decision, see `allowsOf`) together with
   `classes_partition` (S disjoint from the escape class);
   `forwarded_never_decided` states it for forwarded lines directly,
   cross-run.
3. Escape events cannot alter or reorder OTHER lines' Allows — carried by
   `escape_events_no_influence` below: the Allow outputs of any run EQUAL —
   same content, same order — those of the same run with every escape-class
   request event purged, for every start state and every interleaving.
   `allows_eq_of_purgeEscapes_eq` and `escape_insertion_allows_invariant`
   restate it as insertion/removal invariance. (Formerly an untheoremed
   reading, true only by construction of the passthrough arm; the theorem
   now states the trace-level fact the construction was read as.) -/

/-- The Allow outputs of a widened trace, in order. Forwarded and refused
    lines contribute none, by construction of the trace — the content is
    that the DEPLOYED routing (mirrored in `runTrace`) never asks the kernel
    on those arms. -/
def allowsOf : List Obs → List CanonicalBytes
  | [] => []
  | .decision _ (.Allow out) :: t => out :: allowsOf t
  | .decision _ .Block :: t => allowsOf t
  | .refused _ :: t => allowsOf t
  | .forwarded _ :: t => allowsOf t
  | .seamError :: t => allowsOf t
  | .relayed _ :: t => allowsOf t

/-- The relayed frames of a widened trace, in order. -/
def relayedOf : List Obs → List (List UInt8)
  | [] => []
  | .relayed f :: t => f :: relayedOf t
  | .decision _ _ :: t => relayedOf t
  | .refused _ :: t => relayedOf t
  | .forwarded _ :: t => relayedOf t
  | .seamError :: t => relayedOf t

private theorem allowsOf_responseObs (s : HostState) (r : ChildRead)
    (l : List Obs) : allowsOf (responseObs s r ++ l) = allowsOf l := by
  unfold responseObs
  by_cases h : s.dead
  · simp [h]
  · simp only [h, if_false, Bool.false_eq_true]
    cases relayedFrame? r <;> simp [allowsOf]

/-- A dead transport allows nothing (widened port of
    `ResponseTransport.dead_no_allows`). -/
theorem dead_no_allows :
    ∀ (t : List HostEvent) (s : HostState), s.dead = true →
      allowsOf (runTrace s t) = [] := by
  intro t
  induction t with
  | nil => intro s _; rfl
  | cons ev t ih =>
      intro s h
      cases ev with
      | init cfg =>
          exact ih _ (by simp [stepState, SealV2.ResponseTransport.stepState, h])
      | approve r sig =>
          exact ih _ (by simp [stepState, SealV2.ResponseTransport.stepState, h])
      | response r =>
          simp only [runTrace]
          rw [allowsOf_responseObs]
          exact ih _ (by simp [stepState, SealV2.ResponseTransport.stepState, h])
      | request raw now => simp [runTrace, h, allowsOf]

/-- A dead transport relays nothing. -/
theorem dead_no_relays :
    ∀ (t : List HostEvent) (s : HostState), s.dead = true →
      relayedOf (runTrace s t) = [] := by
  intro t
  induction t with
  | nil => intro s _; rfl
  | cons ev t ih =>
      intro s h
      cases ev with
      | init cfg =>
          exact ih _ (by simp [stepState, SealV2.ResponseTransport.stepState, h])
      | approve r sig =>
          exact ih _ (by simp [stepState, SealV2.ResponseTransport.stepState, h])
      | response r =>
          simp only [runTrace]
          have : responseObs s r = [] := by simp [responseObs, h]
          rw [this, List.nil_append]
          exact ih _ (by simp [stepState, SealV2.ResponseTransport.stepState, h])
      | request raw now => simp [runTrace, h, relayedOf]

/-- **Fail-closed survives the widening — the child-bytes half ONLY.** For
    ANY start state and ANY event sequence, the Allow outputs of the run
    form a prefix of the Allow outputs of the response-purged run: child
    bytes can only truncate the Allow stream. This theorem compares a run
    against its RESPONSE-purged twin; `purgeResponses` removes no request
    events, so it says nothing about escaping lines. The escaping-line
    guarantee lives elsewhere: `decision_mem_mediated` (no escaping line is
    ever the subject of an Allow), and `escape_events_no_influence` (escape
    events leave the Allow stream of the rest of the run unchanged — see
    the section comment above). (Port of `ResponseTransport.p6_fail_closed`;
    the two new request arms are Allow-silent and state-identity.) -/
theorem widened_fail_closed :
    ∀ (t : List HostEvent) (s : HostState),
      allowsOf (runTrace s t) <+: allowsOf (runTrace s (purgeResponses t)) := by
  intro t
  induction t with
  | nil => intro s; exact List.prefix_refl _
  | cons ev t ih =>
      intro s
      cases ev with
      | init cfg =>
          have hp : purgeResponses (HostEvent.init cfg :: t)
              = .init cfg :: purgeResponses t := by
            simp [purgeResponses, SealV2.ResponseTransport.isResponse]
          rw [hp]
          simp only [runTrace]
          exact ih _
      | approve r sig =>
          have hp : purgeResponses (HostEvent.approve r sig :: t)
              = .approve r sig :: purgeResponses t := by
            simp [purgeResponses, SealV2.ResponseTransport.isResponse]
          rw [hp]
          simp only [runTrace]
          exact ih _
      | response r =>
          have hp : purgeResponses (HostEvent.response r :: t)
              = purgeResponses t := by
            simp [purgeResponses, SealV2.ResponseTransport.isResponse]
          rw [hp]
          simp only [runTrace]
          rw [allowsOf_responseObs]
          obtain ⟨a, d⟩ := s
          cases d with
          | true =>
              rw [dead_no_allows t _ (by
                simp [stepState, SealV2.ResponseTransport.stepState])]
              exact List.nil_prefix
          | false =>
              cases hk : readKills r with
              | true =>
                  rw [dead_no_allows t _ (by
                    simp [stepState, SealV2.ResponseTransport.stepState, hk])]
                  exact List.nil_prefix
              | false =>
                  have hs : stepState ⟨a, false⟩ (.response r) = ⟨a, false⟩ := by
                    simp [stepState, SealV2.ResponseTransport.stepState, hk]
                  rw [hs]
                  exact ih _
      | request raw now =>
          have hp : purgeResponses (HostEvent.request raw now :: t)
              = .request raw now :: purgeResponses t := by
            simp [purgeResponses, SealV2.ResponseTransport.isResponse]
          rw [hp]
          obtain ⟨a, d⟩ := s
          cases d with
          | true =>
              simp only [runTrace]
              simp [allowsOf]
          | false =>
              simp only [runTrace]
              simp only [Bool.false_eq_true, if_false]
              cases hc : classifyWire raw with
              | refuse => simpa [allowsOf] using ih _
              | passthrough => simpa [allowsOf] using ih _
              | act n ar =>
                  cases hD : reqDecision a raw now with
                  | Block => simpa [allowsOf] using ih _
                  | Allow out =>
                      simp only [allowsOf]
                      exact (List.prefix_cons_inj _).2 (ih _)

/-- **Relay integrity survives the widening**: relayed frames remain a
    byte-identical, in-order prefix of the child's complete frames (port of
    `ResponseTransport.relay_verbatim`). -/
theorem widened_relay_verbatim :
    ∀ (t : List HostEvent) (s : HostState),
      relayedOf (runTrace s t) <+: completesOf t := by
  intro t
  induction t with
  | nil => intro s; exact List.prefix_refl _
  | cons ev t ih =>
      intro s
      cases ev with
      | init cfg =>
          simp only [runTrace, completesOf]
          exact ih _
      | approve r sig =>
          simp only [runTrace, completesOf]
          exact ih _
      | response r =>
          simp only [runTrace, completesOf]
          obtain ⟨a, d⟩ := s
          cases d with
          | true =>
              have h0 : responseObs ⟨a, true⟩ r = [] := by simp [responseObs]
              rw [h0, List.nil_append,
                dead_no_relays t _ (by
                  simp [stepState, SealV2.ResponseTransport.stepState])]
              exact List.nil_prefix
          | false =>
              cases hr : relayedFrame? r with
              | some f =>
                  have h1 : responseObs ⟨a, false⟩ r = [.relayed f] := by
                    simp [responseObs, hr]
                  rw [h1]
                  simp only [List.cons_append, relayedOf]
                  have hk : readKills r = false := by
                    cases r with
                    | ioError => simp [relayedFrame?] at hr
                    | chunk bytes =>
                        simp only [relayedFrame?] at hr
                        simp only [readKills]
                        cases hf : SealV2.ResponseTransport.framingOf bytes <;>
                          simp [hf, SealV2.ResponseTransport.framingKills] at hr ⊢
                  have hs : stepState ⟨a, false⟩ (.response r) = ⟨a, false⟩ := by
                    simp [stepState, SealV2.ResponseTransport.stepState, hk]
                  rw [hs]
                  exact (List.prefix_cons_inj _).2 (ih _)
              | none =>
                  have h1 : responseObs ⟨a, false⟩ r = [] := by
                    simp [responseObs, hr]
                  rw [h1, List.nil_append]
                  have hk : readKills r = true := by
                    cases r with
                    | ioError => rfl
                    | chunk bytes =>
                        simp only [relayedFrame?] at hr
                        simp only [readKills]
                        cases hf : SealV2.ResponseTransport.framingOf bytes <;>
                          simp [hf, SealV2.ResponseTransport.framingKills] at hr ⊢
                  rw [dead_no_relays t _ (by
                    simp [stepState, SealV2.ResponseTransport.stepState, hk])]
                  exact List.nil_prefix
      | request raw now =>
          simp only [runTrace, completesOf]
          obtain ⟨a, d⟩ := s
          cases d with
          | true => simp [relayedOf]
          | false =>
              simp only [Bool.false_eq_true, if_false]
              cases hc : classifyWire raw with
              | refuse => simpa [relayedOf] using ih _
              | passthrough => simpa [relayedOf] using ih _
              | act n ar => simpa [relayedOf] using ih (stepState ⟨a, false⟩ (.request raw now))

/-! ## Escape events: no influence on the Allow stream (part-3 carrier)

The purge-escape-events analogue whose absence the frisk flagged. The purge
deletes exactly the escape-class request events; the theorem states that the
Allow outputs of ANY run — every start state, every interleaving — are EQUAL
to those of the purged run: same content, same order. Contrast the response
purge, where only a PREFIX survives (`widened_fail_closed`): child bytes can
kill the session and truncate; escape events cannot even do that to the
Allow stream (a dead transport allows nothing with or without them). -/

/-- An escape event: a request whose bytes are in the escape class — exactly
    the events the router forwards child-bound with no decision
    (`forwarded_iff_escapes`). -/
def isEscapeEvent : HostEvent → Bool
  | .request raw _ => escapesClass raw
  | _ => false

/-- Delete every escape-class request event (same purge shape as
    `purgeResponses`). -/
def purgeEscapes (t : List HostEvent) : List HostEvent :=
  t.filter (fun ev => !isEscapeEvent ev)

/-- **Escape events cannot create, alter, or reorder Allows.** For ANY start
    state and ANY event sequence, the Allow outputs of the run are EQUAL —
    same content, same order, not merely a prefix — to the Allow outputs of
    the same run with every escape-class request event deleted. Quantifying
    over all traces `t` covers arbitrary interleavings: any number of escape
    events at any positions (`allows_eq_of_purgeEscapes_eq` /
    `escape_insertion_allows_invariant` restate this as insertion/removal
    invariance between two traces).

    Scope of the name, checked against the literature: this is a
    Goguen–Meseguer-style purge equality on ONE observable — the `allowsOf`
    projection. It is NOT von Oheimb "noninfluence" (no secret-variation or
    paired-state bisimulation is stated), and NOT full-trace
    non-interference: escape events visibly influence the trace (their own
    `.forwarded` observations; on a dead transport an escape request still
    terminates the run at the seam error), and their bytes DO reach the
    child undecided (`run_single_escape` — that is the K3/K4 bypass
    verdict, unretracted). The claim is exactly: the Allow stream is
    invariant under inserting or removing escape events. -/
theorem escape_events_no_influence :
    ∀ (t : List HostEvent) (s : HostState),
      allowsOf (runTrace s t) = allowsOf (runTrace s (purgeEscapes t)) := by
  intro t
  induction t with
  | nil => intro s; rfl
  | cons ev t ih =>
      intro s
      cases ev with
      | init cfg =>
          have hp : purgeEscapes (HostEvent.init cfg :: t)
              = .init cfg :: purgeEscapes t := by
            simp [purgeEscapes, isEscapeEvent]
          rw [hp]
          simp only [runTrace]
          exact ih _
      | approve r sig =>
          have hp : purgeEscapes (HostEvent.approve r sig :: t)
              = .approve r sig :: purgeEscapes t := by
            simp [purgeEscapes, isEscapeEvent]
          rw [hp]
          simp only [runTrace]
          exact ih _
      | response r =>
          have hp : purgeEscapes (HostEvent.response r :: t)
              = .response r :: purgeEscapes t := by
            simp [purgeEscapes, isEscapeEvent]
          rw [hp]
          simp only [runTrace]
          rw [allowsOf_responseObs, allowsOf_responseObs]
          exact ih _
      | request raw now =>
          cases he : escapesClass raw with
          | false =>
              have hp : purgeEscapes (HostEvent.request raw now :: t)
                  = .request raw now :: purgeEscapes t := by
                simp [purgeEscapes, isEscapeEvent, he]
              rw [hp]
              obtain ⟨a, d⟩ := s
              cases d with
              | true => simp [runTrace, allowsOf]
              | false =>
                  simp only [runTrace]
                  simp only [Bool.false_eq_true, if_false]
                  cases hc : classifyWire raw with
                  | passthrough =>
                      have := (classifyWire_passthrough_iff raw).mp hc
                      rw [he] at this
                      cases this
                  | refuse => simpa [allowsOf] using ih _
                  | act n ar =>
                      cases hD : reqDecision a raw now with
                      | Block => simpa [allowsOf] using ih _
                      | Allow out =>
                          simp only [allowsOf]
                          rw [ih _]
          | true =>
              have hp : purgeEscapes (HostEvent.request raw now :: t)
                  = purgeEscapes t := by
                simp [purgeEscapes, isEscapeEvent, he]
              rw [hp]
              obtain ⟨a, d⟩ := s
              cases d with
              | true =>
                  rw [dead_no_allows (purgeEscapes t) ⟨a, true⟩ rfl]
                  simp [runTrace, allowsOf]
              | false =>
                  have hc := (classifyWire_passthrough_iff raw).mpr he
                  simp only [runTrace]
                  simp only [Bool.false_eq_true, if_false, hc]
                  simpa [allowsOf] using ih _

/-- The two-trace interleaving form: any two event sequences that agree
    after deleting escape events — i.e. differ ONLY by inserted or removed
    escape-class requests, at any positions — produce identical Allow
    streams from every start state. -/
theorem allows_eq_of_purgeEscapes_eq {t₁ t₂ : List HostEvent}
    (h : purgeEscapes t₁ = purgeEscapes t₂) (s : HostState) :
    allowsOf (runTrace s t₁) = allowsOf (runTrace s t₂) := by
  rw [escape_events_no_influence t₁ s, escape_events_no_influence t₂ s, h]

/-- Single-insertion corollary, the direct contrast to
    `ResponseTransport.transport_p6_insertion_refuted`: injecting one
    escape-class request at ANY position changes no Allow. -/
theorem escape_insertion_allows_invariant (s : HostState)
    (t₁ t₂ : List HostEvent) (raw : RawBytes) (now : Nat)
    (h : escapesClass raw = true) :
    allowsOf (runTrace s (t₁ ++ .request raw now :: t₂))
      = allowsOf (runTrace s (t₁ ++ t₂)) := by
  apply allows_eq_of_purgeEscapes_eq
  simp [purgeEscapes, List.filter_append, isEscapeEvent, h]

/-! ## Axiom pins -/

/-- info: 'SealV2.ClassifyTransport.classes_partition' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms classes_partition

/-- info: 'SealV2.ClassifyTransport.strictCallShape_eq_toolsCall?' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms strictCallShape_eq_toolsCall?

/-- info: 'SealV2.ClassifyTransport.classifyWire_refuse_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms classifyWire_refuse_iff

/-- info: 'SealV2.ClassifyTransport.classifyWire_act_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms classifyWire_act_iff

/-- info: 'SealV2.ClassifyTransport.classifyWire_passthrough_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms classifyWire_passthrough_iff

/-- info: 'SealV2.ClassifyTransport.classifyWire_refuses_parsed_array' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms classifyWire_refuses_parsed_array

/-- info: 'SealV2.ClassifyTransport.parsed_array_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms parsed_array_refused

/-- info: 'SealV2.ClassifyTransport.parsed_array_not_undecided' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms parsed_array_not_undecided

/-- info: 'SealV2.ClassifyTransport.classifyWire_safe_nonarray_noncall_passthrough' depends on axioms: [propext,
 Classical.choice,
 Quot.sound] -/
#guard_msgs in
#print axioms classifyWire_safe_nonarray_noncall_passthrough

/-- info: 'SealV2.ClassifyTransport.toolsCall?_arr_none' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms toolsCall?_arr_none

/-- info: 'SealV2.ClassifyTransport.strictCallShape_arr' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms strictCallShape_arr

/-- info: 'SealV2.ClassifyTransport.lenientCalls_arr' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms lenientCalls_arr

/-- info: 'SealV2.ClassifyTransport.lenient_extends_strict_value' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms lenient_extends_strict_value

/-- info: 'SealV2.ClassifyTransport.lenient_extends_strict' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms lenient_extends_strict

/-- info: 'SealV2.ClassifyTransport.mediated_lenient' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms mediated_lenient

/-- info: 'SealV2.ClassifyTransport.non_act_state_invariant' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms non_act_state_invariant

/-- info: 'SealV2.ClassifyTransport.run_single_escape' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms run_single_escape

/-- info: 'SealV2.ClassifyTransport.run_single_mediated' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms run_single_mediated

/-- info: 'SealV2.ClassifyTransport.run_single_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms run_single_refused

/-- info: 'SealV2.ClassifyTransport.forwarded_iff_escapes' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms forwarded_iff_escapes

/-- info: 'SealV2.ClassifyTransport.decided_iff_mediated' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms decided_iff_mediated

/-- info: 'SealV2.ClassifyTransport.forwarded_mem_escapes' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms forwarded_mem_escapes

/-- info: 'SealV2.ClassifyTransport.decision_mem_mediated' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms decision_mem_mediated

/-- info: 'SealV2.ClassifyTransport.forwarded_never_decided' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms forwarded_never_decided

/-- info: 'SealV2.ClassifyTransport.dead_no_allows' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms dead_no_allows

/-- info: 'SealV2.ClassifyTransport.dead_no_relays' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms dead_no_relays

/-- info: 'SealV2.ClassifyTransport.widened_fail_closed' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms widened_fail_closed

/-- info: 'SealV2.ClassifyTransport.widened_relay_verbatim' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms widened_relay_verbatim

/-- info: 'SealV2.ClassifyTransport.escape_events_no_influence' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms escape_events_no_influence

/-- info: 'SealV2.ClassifyTransport.allows_eq_of_purgeEscapes_eq' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms allows_eq_of_purgeEscapes_eq

/-- info: 'SealV2.ClassifyTransport.escape_insertion_allows_invariant' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms escape_insertion_allows_invariant

end SealV2.ClassifyTransport
