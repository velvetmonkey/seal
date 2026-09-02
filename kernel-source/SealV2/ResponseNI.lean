/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Decide

/-!
# P6 in a simplified sequential model (scope corrected after adversarial frisk)

**Exactly what is proven here, and no more:** within the simplified
sequential model defined below — in which a response event is state-identity
and decision-silent BY DEFINITION (the `.response` arms of `stepState` and
`observeDecision`) — deleting or inserting response events leaves the
modeled decision/state trace unchanged (`p6_response_noninterference`,
`p6_response_insertion`, `p6_state_noninterference`). The two facts the
headline theorems turn on (`response_state_invariant`,
`response_no_decision`) are `rfl`: they restate how the `.response` arm was
defined. These are specification theorems about THIS model. They are NOT
implementation-refinement theorems about any deployed host.

**What the model mirrors: THIS repository's FFI, nothing else.** The
init/approve/request arms follow mcp-seal-dev's single-state FFI
(`Ffi.lean:32-33`: one `IO.Ref (Option ApprovalState)`; session-touching
exports `seal_v2_init`, `seal_v2_add_approval`, `seal_v2_decide`,
`seal_v2_challenge` (stateless); no response-consuming export). The arms are
the same pure kernel compositions `Ffi.lean` runs (`parseConfig` result,
`signedParse ∘ signedMessageFromAst?` approval append,
`parse → validateAndConsumeWithStore listReplayStore → serialize`).
`response` is the one event that FFI does not have.

**What the model does NOT mirror: the deployed seal-host runtime.** NO
refinement theorem connects this file to seal-host, and this model is not
faithful to it:
* seal-host's exported seam is `seal_host_init` / `seal_host_step` /
  `seal_host_classify` over multiple kernel state refs and a kernel registry
  (seal-host `Ffi.lean:314-334`, `:37-53`, `:94-150`), not the four
  `seal_v2_*` entry points modeled here.
* seal-host's response relay is NOT a stateless byte copy. It reads raw
  `Vec<u8>` frames through `read_bounded_frame`, bounded to 1 MiB,
  distinguishing complete / EOF / unterminated / oversized / IO-error
  (seal-host `rust/src/limits.rs:7,16-68`); every failure arm — and a failed
  enqueue of a complete frame — WRITES transport state (`downstream_dead`,
  readiness: `rust/src/main.rs:1137-1181`); and the request loop observes
  that state BEFORE classification or any Lean call (`main.rs:1209-1216`).
  Output is queued through a bounded sync channel with its own interleaving
  behavior (`rust/src/output.rs`).
* `HostEvent.response (bytes : String)` cannot express any of those cases.
  Concretely: an oversized (> 1 MiB) terminated child frame sets
  `downstream_dead`; the NEXT client request is answered with a seam error
  and the session terminates. Real response output therefore changes the
  subsequent decision trace — a fail-closed denial/termination effect (not
  an unauthorized Allow). In this model the same event is a `.response` with
  identity state and no decision, so the hazard is not expressible here.

These theorems must NOT be summarized as deployed-host response-egress
non-interference. `SealV2/ResponseTransport.lean` enriches this model with
framing outcomes and a transport-death flag: there the purge/insertion
property is REFUTED (witness: the oversized-frame story above) and the
surviving fail-closed property is proven.

**Withdrawn verdict (previously asserted here; not entailed).** An earlier
revision of this header concluded "P6 is confidentiality-only; integrity
clean; named exfiltration risk at the HTTP boundary." No confidentiality,
secret, client, HTTP, exfiltration, or integrity predicate appears anywhere
in this model, so that verdict is not a consequence of these theorems. It is
demoted to an unproven CONJECTURE: the known seal-host counterexample class
is fail-closed (denial/termination), and no response-to-unauthorized-Allow
path is currently known — but a confidentiality assessment would need a
model with secrets and an observer, which this file does not contain.
-/

namespace SealV2.ResponseNI

/-- One host-boundary event. The first three mirror the state-bearing FFI
    exports one-to-one (`seal_v2_challenge` is stateless — no event needed);
    `response` is the P6 egress the FFI deliberately has no entry point for.
    `init` carries the PARSED config: the JSON glue is host control (A3), not
    the security surface — same seam as `Ffi.parseConfig`. -/
inductive HostEvent where
  | init (cfg : ApprovalState)
  | approve (rawSigned : String) (sigHex : String)
  | request (raw : RawBytes) (now : Nat)
  | response (bytes : String)

def isResponse : HostEvent → Bool
  | .response _ => true
  | _ => false

/-- The session-state transition, arm-for-arm the writes `Ffi.lean` performs:
    * `init` — replace the session (`initImpl`);
    * `approve` — append the reconstructed approval on the verified
      `signedParse`/`signedMessageFromAst?` path, no-op on any failure
      (`addApprovalImpl`);
    * `request` — run the verified
      `parse → validateAndConsumeWithStore listReplayStore` and persist the
      consumed store (+ clock) ONLY on Allow (`decideImpl` writes `stateRef`
      only in its Allow arm);
    * `response` — IDENTITY BY DEFINITION. This mirrors the absence of a
      response-consuming export in mcp-seal-dev's FFI. It is a MODELING
      CHOICE, and it is exactly where this model diverges from the deployed
      seal-host relay, whose response handling does write transport state
      (see the header). The P6 theorems below hold because of this arm. -/
def stepState (s : Option ApprovalState) : HostEvent → Option ApprovalState
  | .init cfg => some cfg
  | .approve rawSigned sigHex =>
      match s with
      | none => none
      | some st =>
          match signedParse rawSigned with
          | none => some st
          | some ast =>
              match signedMessageFromAst? ast.val with
              | none => some st
              | some sm =>
                  some { st with approvals := st.approvals ++ [{
                    target := sm.target, session := sm.session,
                    issuedAt := sm.issuedAt, expiresAt := sm.expiry,
                    consumed := false, signedMessageRaw := rawSigned,
                    signature := sigHex, nonce := sm.nonce }] }
  | .request raw now =>
      match s with
      | none => none
      | some st0 =>
          let st := { st0 with now := now }
          match parse raw with
          | none => some st0
          | some ast =>
              match validateAndConsumeWithStore listReplayStore
                  st.consumedNonces ast st with
              | none => some st0
              | some (store', _) => some { st with consumedNonces := store' }
  | .response _ => s

/-- The authorization decision an event yields, if any: only `request` events
    decide (uninitialized session / parse failure / validation failure all
    deny — the FFI's fail-closed arms). -/
def observeDecision (s : Option ApprovalState) : HostEvent → Option Decision
  | .request raw now =>
      some (match s with
        | none => .Block
        | some st0 =>
            let st := { st0 with now := now }
            match parse raw with
            | none => .Block
            | some ast =>
                match validateAndConsumeWithStore listReplayStore
                    st.consumedNonces ast st with
                | none => .Block
                | some (_, checked) => .Allow (serialize checked))
  | _ => none

/-- The decision trace of a run: every authorization decision, in order. -/
def runTrace (s : Option ApprovalState) : List HostEvent → List Decision
  | [] => []
  | ev :: t =>
      match observeDecision s ev with
      | none => runTrace (stepState s ev) t
      | some d => d :: runTrace (stepState s ev) t

/-- The state after a run. -/
def runState (s : Option ApprovalState) (t : List HostEvent) :
    Option ApprovalState :=
  t.foldl stepState s

/-- Drop every response event. -/
def purgeResponses (t : List HostEvent) : List HostEvent :=
  t.filter (fun ev => !isResponse ev)

/-- A response event neither changes state… -/
theorem response_state_invariant (s : Option ApprovalState) (b : String) :
    stepState s (.response b) = s := rfl

/-- …nor yields a decision. -/
theorem response_no_decision (s : Option ApprovalState) (b : String) :
    observeDecision s (.response b) = none := rfl

/-- **P6, purge form, model-level only.** In THIS model the decision trace
    of any event sequence equals that of the same sequence with every
    response event deleted. Holds because the `.response` arm is defined as
    state-identity and decision-silent; it does not transfer to the deployed
    seal-host relay (see header). -/
theorem p6_response_noninterference (s : Option ApprovalState)
    (t : List HostEvent) : runTrace s (purgeResponses t) = runTrace s t := by
  induction t generalizing s with
  | nil => rfl
  | cons ev t ih =>
      cases ev with
      | response b =>
          show runTrace s (purgeResponses t) = runTrace s (.response b :: t)
          rw [ih s]
          rfl
      | init cfg =>
          show runTrace s (.init cfg :: purgeResponses t) = _
          simp only [runTrace, observeDecision]
          exact ih _
      | approve rawSigned sigHex =>
          show runTrace s (.approve rawSigned sigHex :: purgeResponses t) = _
          simp only [runTrace, observeDecision]
          exact ih _
      | request raw now =>
          show runTrace s (.request raw now :: purgeResponses t) = _
          simp only [runTrace, observeDecision]
          rw [ih _]

/-- **P6, insertion form, model-level only:** in THIS model, injecting a
    response event at any position changes no modeled decision. Same caveat
    as the purge form: this is a property of the model's `.response` arm. -/
theorem p6_response_insertion (s : Option ApprovalState)
    (t₁ t₂ : List HostEvent) (b : String) :
    runTrace s (t₁ ++ .response b :: t₂) = runTrace s (t₁ ++ t₂) := by
  induction t₁ generalizing s with
  | nil =>
      show runTrace s (.response b :: t₂) = runTrace s t₂
      rfl
  | cons ev t ih =>
      cases hobs : observeDecision s ev with
      | none =>
          show runTrace s (ev :: (t ++ .response b :: t₂)) = _
          simp only [List.cons_append, runTrace, hobs]
          exact ih _
      | some d =>
          show runTrace s (ev :: (t ++ .response b :: t₂)) = _
          simp only [List.cons_append, runTrace, hobs]
          rw [ih _]

/-- **P6, state form, model-level only:** the modeled authorization state
    after any run is invariant under purging responses. The model has no
    transport/control state for a response to write; the deployed seal-host
    relay does (see header), and that state is outside this theorem. -/
theorem p6_state_noninterference (s : Option ApprovalState)
    (t : List HostEvent) : runState s (purgeResponses t) = runState s t := by
  induction t generalizing s with
  | nil => rfl
  | cons ev t ih =>
      cases ev with
      | response b => exact ih s
      | init cfg => exact ih _
      | approve rawSigned sigHex => exact ih _
      | request raw now => exact ih _

/-! ## Axiom pins

Count, stated precisely: this file has 3 `#guard_msgs` axiom-diagnostic
pins. The V2.3 package as a whole has 49 `#guard_msgs` commands — 45
axiom-diagnostic pins (42 in `EffectEnvelope.lean` + 3 here), 3 `#eval`
golden-vector pins in `EffectEnvelope.lean` (tag, effect-present,
effect-absent — Stage B2 pins the option encoding as a pair), and 1
envelope-completeness summary pin in `EnvelopeCompleteness.lean`. An
earlier summary said "31 `#guard_msgs` pins"; that number counted the
pre-Stage-B axiom-diagnostic pins only, not `#guard_msgs` commands. -/

/-- info: 'SealV2.ResponseNI.p6_response_noninterference' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms p6_response_noninterference

/-- info: 'SealV2.ResponseNI.p6_response_insertion' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms p6_response_insertion

/-- info: 'SealV2.ResponseNI.p6_state_noninterference' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms p6_state_noninterference

end SealV2.ResponseNI
