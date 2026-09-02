/- SPDX-License-Identifier: Apache-2.0 -/

import Batteries.Data.ByteArray
import SealV2.EffectEnvelope
import SealV2.EnvelopeCompleteness
import SealV2.DecideTheorems

/-!
# Nonce ledger — config-pinned `ledgerGeneration`, fail-closed (Option A)

The durable consumed-nonce store the `EnvelopeCompleteness` exemption has
been waiting for, modeled kernel-side, with the generation pin ruled by
council `1e92b551` (2026-07-23) after the store-minted-epoch proposal was
REFUTED: whoever can reset the store can mint the epoch, so the trust
anchor lives in the SIGNED CONFIG (`ApprovalState.ledgerGeneration`, same
pattern and same trust plane as `policyVersion`), never in the store.

**The property claimed — exactly this, never more:**

> No replay within the live authority domain; at most one authority domain
> is live.

The first conjunct is proved here (`consumed_replay_blocks`: within one
store lineage, consume is one-shot). The second is NOT proved here: it is
`crdt-lean`'s authority-frontier result
(`Crdt/AuthorityFrontier.lean:144` `no_disconnected_double_availability`,
`:174` `authority_frontier_card_le_one`) plus deployment discipline; a
one-shot object in a replicating store IS the double-spend problem, and
the checked countermodel (`double_consume_countermodel`) shows what
happens to any flat "replay impossible" claim. Ledger generations are
SUBORDINATE to that single authority: the generation names which store
lineage the one authority currently endorses; it is not a second,
forkable notion of authority.

**The honest limit (STEP 0, demonstrated before anything is claimed):**

* A generation MISMATCH is detectable: `generation_mismatch_blocks`, with
  the built witness `mismatch_witness_blocks`.
* A matching generation over a ROLLED-BACK content set is NOT detectable:
  `generation_gate_content_blind` (the gate is a function of the
  attestation alone) and `rollback_replay_conditional` (an honest store
  blocks the replay; the rolled-back twin with the SAME generation Allows
  it again). Option A defends the LINEAGE LABEL, not the CONTENT SET.
  Detecting same-generation content rollback is rollback-protected-storage
  territory (Memoir, TPM monotonic counters) = rejected Option C, or the
  completeness watermark = Option D, which is UNDEVELOPED and NOT claimed
  (GSN undeveloped goal in the assurance case).
* A SECOND honest limit, named where it is born: legitimate rotation opens
  a bounded replay window (`fresh_store_ignores_history`): an envelope
  consumed under generation N, still unexpired when the authority rotates
  to a fresh store at N+1, consumes AGAIN under N+1. Bound: the envelope
  freshness window `min(issuedAt + maxApprovalTtl, expiresAt)`.
  Deployment obligation shipped with the design: rotate-then-drain (wait
  out the TTL window, or migrate unexpired entries forward).

**Fail-closed, all the way down:** store unavailable ⇒ Block
(`ledger_unavailable_blocks` — cannot verify means deny; in frontier
terms, a node that cannot reach the live domain has no authority to
spend); unconfigured generation 0 ⇒ Block
(`unconfigured_generation_blocks` — the `policyVersion` empty-string
discipline on the storage axis: the default is deny, never a sentinel
bypass); generation mismatch ⇒ Block.

**Atomicity and fencing:** `effectStepLedgered` releases an Allow ONLY
together with the successful consume, in one model step
(`allow_consumes_before_release`) — there is no value of this function
in which the Allow exists and the nonce is unrecorded. The released
decision is FENCED with the generation it was minted under; the executor
spec (`executorAccepts`) rejects a stale generation
(`executor_fences_stale_generation`) — an Allow minted under N is dead
once the authority re-signs at N+1. This is the fencing-token pattern
(Kleppmann 2016, "How to do distributed locking"; Chubby sequencers,
Burrows OSDI 2006), with two deliberate divergences, stated: (1) the
token is minted by the config-signing authority, not a lock service —
the config signature is the trust root this kernel already has; (2) the
store-side check is EQUALITY against the signed config, not
`≥ highest-seen` — a kernel gate has no durable "highest seen" without
begging the storage question this module addresses; monotonicity is the
authority's re-sign discipline (N+1), a named deployment obligation on
the same plane as key custody.

**Shape for Option B (strict superset, no repin):** the store presents a
`LedgerAttestation (storeId, generation, createdAt)` whose canonical byte
encoding (`ledgerAttestationMessage`: `seal.ledger/v1` domain tag + the
Stage B2 `frame`/`u64be` wire kit, injective —
`ledger_attestation_injective`) is defined NOW. Option B is "an authority
signature verifies over exactly these bytes": an ADDED check in front of
an unchanged comparison — B's acceptance set is a subset of A's, no shape
change, no repin. Option A ships with the encoding defined and the
signature check absent, and says so.

**Namespacing (per the ruling):** entries are keyed by
`(authority, keyId, nonce)` — the config trust root, the registry id, and
the signed 32-byte raw nonce (`verified_effect_injective` makes a replay
byte-identical, which is what makes a consumed-set defense sound), and
carry the envelope's mandatory-nonzero `expiresAt` for pruning
(`pruneLedger`). Prune soundness (`pruned_entry_envelope_blocked`): once
an entry is prunable at `state.now`, its envelope can no longer pass
`expiryGate` — conditional on the SAME honest-`state.now` obligation the
expiry gate already carries. A lying clock re-enters the threat family as
"clock-driven early prune": named here, not hidden.

**Model boundary, stated:** this module is the kernel-side SPEC of the
ledgered step. Host-side threading (the durable store behind
`LedgerView`, its crash-consistency, and the config parse of
`ledgerGeneration`) remains the A6 deployment residual; the
`EnvelopeCompleteness` exemption for `nonce` is discharged HERE for the
`effectStepLedgered` cone (see the second completeness command at the
bottom of this file) and retained for the bare `effectStep` cone, which
deliberately threads no store.
-/

namespace SealV2.Effect.Ledger

open SealV2.Effect

/-! ## The attestation and its canonical encoding (the Option-B shape) -/

/-- What the store presents: its identity triple. NOT an attestation in
    the RFC 9334 (RATS) sense under Option A: RATS reserves the word for
    Evidence cryptographically attributable to the attester, and under
    Option A this is an UNSIGNED self-report. Only `generation` is
    checked (fail-closed equality against the SIGNED config's
    `ledgerGeneration`); `storeId` and `createdAt` are carried but
    UNCHECKED, reserved for Option B. The name earns its RATS meaning
    only when Option B's authority signature over
    `ledgerAttestationMessage` is enforced — an added check over
    unchanged bytes, not a reshape. The trust anchor is the config-pinned
    `ledgerGeneration`, never the store's self-report: a store-minted
    value is theatre (council `1e92b551`). -/
structure LedgerAttestation where
  storeId : String
  generation : Nat
  createdAt : Nat
  deriving Repr, BEq

/-- Domain-separation tag for the attestation encoding: `seal.ledger/v1`.
    Byte-separated from every signed plane in the repo: differs from
    `seal.effect/v2` (and every `seal.effect/*` lineage tag) at byte 5
    (`l` vs `e`), from the canonical-JSON plane at byte 0 (`s` vs `{`),
    and from the NETSTRING commitment plane at byte 0 (`s` vs an ASCII
    digit). Trailing NUL terminates the tag unambiguously. -/
def ledgerTag : String := "seal.ledger/v1\x00"

/-- The tag is not the effect-envelope tag (checked, not asserted). -/
theorem ledger_tag_separated : ledgerTag ≠ effectTag := by decide

/-- Canonical attestation bytes:
    `tag ‖ frame(storeId) ‖ u64be(generation) ‖ u64be(createdAt)`.
    Same wire kit as `effectMessage` — the anti-splice lemmas apply.
    Option B signs EXACTLY these bytes. -/
def ledgerAttestationMessage (att : LedgerAttestation) : ByteArray :=
  ledgerTag.toUTF8 ++ frame att.storeId
    ++ u64be att.generation ++ u64be att.createdAt

/-- Injectivity of the attestation encoding under wire-width constraints:
    equal bytes ⇒ equal triples. The lemma Option B's signature will
    stand on — one signature can only ever speak for one attestation. -/
theorem ledger_attestation_injective {a₁ a₂ : LedgerAttestation}
    (hs₁ : a₁.storeId.utf8ByteSize < 2 ^ 64)
    (hs₂ : a₂.storeId.utf8ByteSize < 2 ^ 64)
    (hg₁ : a₁.generation < 2 ^ 64) (hg₂ : a₂.generation < 2 ^ 64)
    (hc₁ : a₁.createdAt < 2 ^ 64) (hc₂ : a₂.createdAt < 2 ^ 64)
    (h : ledgerAttestationMessage a₁ = ledgerAttestationMessage a₂) :
    a₁ = a₂ := by
  unfold ledgerAttestationMessage at h
  simp only [ByteArray.append_assoc] at h
  obtain ⟨-, h⟩ := sized_cancel (a₁ := ledgerTag.toUTF8)
    (a₂ := ledgerTag.toUTF8) rfl rfl h
  obtain ⟨hstore, h⟩ := frame_cancel hs₁ hs₂ h
  obtain ⟨hgen, h⟩ := u64be_cancel hg₁ hg₂ h
  have hcreated : a₁.createdAt = a₂.createdAt := u64be_inj hc₁ hc₂ h
  cases a₁; cases a₂
  simp_all

/-! ## The ledger view, the gate, the consume -/

/-- One consumed entry: `(authority, keyId, nonce)` namespace key plus the
    envelope's mandatory-nonzero `expiresAt` (the prune bound). -/
structure LedgerEntry where
  authority : ByteArray
  keyId : String
  nonce : ByteArray
  expiresAt : Nat
  deriving BEq

/-- The store as the gate sees it: its attestation plus the consumed set.
    The entries are CONCRETE DATA, not an opaque membership oracle — that
    is what makes the STEP-0 rollback distinction expressible at all: an
    oracle could not even state "same generation, smaller content set". -/
structure LedgerView where
  att : LedgerAttestation
  entries : List LedgerEntry
  deriving BEq

/-- The generation gate: the SIGNED config's `ledgerGeneration` must be
    nonzero (unconfigured fails closed — the `policyVersion` discipline)
    and the store's attested generation must equal it. Rotating the store
    therefore requires re-signing the config at N+1: a deliberate
    authority act, not an accident. Reads ONLY the attestation — see
    `generation_gate_content_blind` for what that honestly means. -/
def generationGate (state : ApprovalState) (v : LedgerView) : Bool :=
  state.ledgerGeneration != 0
    && v.att.generation == state.ledgerGeneration

/-- Entry-key match: same `(authority, keyId, nonce)` triple.
    (`Decidable.decide` spelled out — plain `decide` names `SealV2.decide`
    in this namespace, the same shadowing `expiryGate` works around.) -/
def entryMatches (auth : ByteArray) (keyId : String) (nonce : ByteArray)
    (en : LedgerEntry) : Bool :=
  Decidable.decide (en.authority = auth)
    && Decidable.decide (en.keyId = keyId)
    && Decidable.decide (en.nonce = nonce)

/-- The entry a successful consume records for `(auth, e)`. -/
def mintedEntry (auth : ByteArray) (e : EffectEnvelope) : LedgerEntry :=
  { authority := auth, keyId := e.keyId, nonce := e.nonce,
    expiresAt := e.expiresAt }

/-- Atomic membership-check-and-insert: `none` when the `(authority,
    keyId, nonce)` key is already consumed (fail-closed: the replay
    verdict), `some` with the entry recorded otherwise. ONE function, so
    there is no check/insert window to interleave. -/
def consumeNonce (v : LedgerView) (auth : ByteArray) (e : EffectEnvelope) :
    Option LedgerView :=
  if v.entries.any (entryMatches auth e.keyId e.nonce) then none
  else some { v with entries := mintedEntry auth e :: v.entries }

/-- Prune: drop entries whose `expiresAt` has passed. Sound because a
    pruned entry's envelope can no longer pass `expiryGate`
    (`pruned_entry_envelope_blocked`) — under the standing honest-clock
    obligation. Pruning EARLY (a lying clock) is a member of the
    loss-of-history threat family, named in the module doc. -/
def pruneLedger (now : Nat) (v : LedgerView) : LedgerView :=
  { v with entries :=
    v.entries.filter fun en => Decidable.decide (now ≤ en.expiresAt) }

/-! ## The fenced decision and the executor spec -/

/-- A decision fenced with the generation it was minted under. The
    fencing-token pattern: the executor (the Codex seam) must check the
    fence, so an Allow minted under generation N dies when the authority
    re-signs at N+1. -/
structure FencedDecision where
  decision : Decision
  generation : Nat
  deriving Repr, BEq

/-- The executor-side fence check: accept only a nonzero generation equal
    to the live config's. THE SPEC THE EXECUTOR MUST BIND TO — an
    executor that ignores the fence reopens exactly the stale-authority
    window the token exists to close. -/
def executorAccepts (state : ApprovalState) (fd : FencedDecision) : Bool :=
  fd.generation != 0 && fd.generation == state.ledgerGeneration

/-! ## The ledgered step -/

/-- **The ledgered judgment step**: the six-gate `effectStep`
    (UNCHANGED — this is a wrapper, not a fork) plus the ledger seam.
    Order, and why:

    1. no ledger ⇒ Block (store-unavailable fails closed);
    2. `generationGate` fails ⇒ Block (mismatch or unconfigured);
    3. `effectStep` Blocks ⇒ Block, ledger untouched (a blocked envelope
       burns nothing);
    4. `effectStep` Allows ⇒ `consumeNonce` decides: only a successful
       atomic consume releases the Allow, and the (decision, ledger′)
       pair is one model step — consume-before-execution, no window.

    The Allow is released fenced with the minting generation. -/
def effectStepLedgered (authority : ByteArray) (reg : PrincipalRegistry)
    (mediator : AdapterId) (e : EffectEnvelope) (sigHex : String)
    (state : ApprovalState) (ledger? : Option LedgerView) :
    FencedDecision × Option LedgerView :=
  match ledger? with
  | none => (⟨.Block, 0⟩, none)
  | some v =>
      if generationGate state v then
        match effectStep authority reg mediator e sigHex state with
        | .Block => (⟨.Block, state.ledgerGeneration⟩, some v)
        | .Allow out =>
            match consumeNonce v authority e with
            | none => (⟨.Block, state.ledgerGeneration⟩, some v)
            | some v' => (⟨.Allow out, state.ledgerGeneration⟩, some v')
      else (⟨.Block, 0⟩, some v)

/-! ## Generation declassification and the honest LOW view -/

/-- **The generation declassification, made explicit.** The observable
    fence is exactly the live config's `ledgerGeneration` when a ledger is
    present and its generation gate passes. Store absence or a failed gate
    produces the fail-closed `0` sentinel. This is definitional disclosure,
    not an inferred side channel. -/
theorem ledgered_generation_declassified (authority : ByteArray)
    (reg : PrincipalRegistry) (mediator : AdapterId) (e : EffectEnvelope)
    (sigHex : String) (state : ApprovalState)
    (ledger? : Option LedgerView) :
    (effectStepLedgered authority reg mediator e sigHex state
      ledger?).1.generation =
      match ledger? with
      | none => 0
      | some v =>
          if generationGate state v then state.ledgerGeneration else 0 := by
  cases ledger? with
  | none => rfl
  | some v =>
      unfold effectStepLedgered
      cases hg : generationGate state v with
      | false => simp [hg]
      | true =>
          simp only [hg, ↓reduceIte]
          cases effectStep authority reg mediator e sigHex state with
          | Block => rfl
          | Allow out =>
              cases consumeNonce v authority e <;> rfl

/-- The base ledger-path authorization bit. Unlike the host theorem's
    parse/validate-only `authView`, this view covers the complete
    `effectStep`, including its envelope binding and freshness gates. The
    allowed bytes remain a function of the fixed judged line, so this one
    bit determines the base decision for fixed LOW inputs. -/
def effectAuthView (authority : ByteArray) (reg : PrincipalRegistry)
    (mediator : AdapterId) (e : EffectEnvelope) (sigHex : String)
    (state : ApprovalState) : Bool :=
  match effectStep authority reg mediator e sigHex state with
  | .Block => false
  | .Allow _ => true

/-- For fixed envelope inputs, the base authorization bit determines the
    entire base decision. If both sides Allow, `decide_emit_unique` makes
    their payload the serialization of the same parsed line; validation
    witnesses cannot influence serialization. -/
theorem effectAuthView_determines_decision (authority : ByteArray)
    (reg : PrincipalRegistry) (mediator : AdapterId) (e : EffectEnvelope)
    (sigHex : String) (s1 s2 : ApprovalState)
    (h : effectAuthView authority reg mediator e sigHex s1 =
      effectAuthView authority reg mediator e sigHex s2) :
    effectStep authority reg mediator e sigHex s1 =
      effectStep authority reg mediator e sigHex s2 := by
  cases h1 : effectStep authority reg mediator e sigHex s1 with
  | Block =>
      cases h2 : effectStep authority reg mediator e sigHex s2 with
      | Block => rfl
      | Allow out2 => simp [effectAuthView, h1, h2] at h
  | Allow out1 =>
      cases h2 : effectStep authority reg mediator e sigHex s2 with
      | Block => simp [effectAuthView, h1, h2] at h
      | Allow out2 =>
          have hd1 : SealV2.decide e.line s1 = .Allow out1 :=
            allow_value_from_line_and_state h1
          have hd2 : SealV2.decide e.line s2 = .Allow out2 :=
            allow_value_from_line_and_state h2
          obtain ⟨ast1, hp1, witness1, -, hout1⟩ :=
            (SealV2.decide_emit_unique e.line s1 out1).mp hd1
          obtain ⟨ast2, hp2, witness2, -, hout2⟩ :=
            (SealV2.decide_emit_unique e.line s2 out2).mp hd2
          have hast : ast1 = ast2 := by
            rw [hp1] at hp2
            exact Option.some.inj hp2
          subst ast2
          apply congrArg Decision.Allow
          rw [hout1, hout2]
          rfl

/-- The honest LOW view for the ledgered path: the base envelope-step
    authorization bit together with the config-pinned generation that is
    copied into the returned fence. -/
def ledgeredLowView (authority : ByteArray) (reg : PrincipalRegistry)
    (mediator : AdapterId) (e : EffectEnvelope) (sigHex : String)
    (state : ApprovalState) : Bool × Nat :=
  (effectAuthView authority reg mediator e sigHex state,
    state.ledgerGeneration)

/-- **Ledgered non-interference with the honest LOW view.** For the same
    request and ledger input, states agreeing on the complete base
    authorization view and on `ledgerGeneration` produce identical
    observable `FencedDecision`s. Ledger evolution is deliberately not in
    this conclusion; only the fenced decision is the observer named here. -/
theorem ledgered_lowView_noninterference (authority : ByteArray)
    (reg : PrincipalRegistry) (mediator : AdapterId) (e : EffectEnvelope)
    (sigHex : String) (s1 s2 : ApprovalState)
    (ledger? : Option LedgerView)
    (h : ledgeredLowView authority reg mediator e sigHex s1 =
      ledgeredLowView authority reg mediator e sigHex s2) :
    (effectStepLedgered authority reg mediator e sigHex s1 ledger?).1 =
      (effectStepLedgered authority reg mediator e sigHex s2 ledger?).1 := by
  have hauth : effectAuthView authority reg mediator e sigHex s1 =
      effectAuthView authority reg mediator e sigHex s2 :=
    congrArg Prod.fst h
  have hgen : s1.ledgerGeneration = s2.ledgerGeneration :=
    congrArg Prod.snd h
  have hstep := effectAuthView_determines_decision authority reg mediator e
    sigHex s1 s2 hauth
  cases ledger? with
  | none => rfl
  | some v =>
      have hgate : generationGate s1 v = generationGate s2 v := by
        unfold generationGate
        rw [hgen]
      simp only [effectStepLedgered]
      rw [hgate, hstep, hgen]

/-! ## Fail-closed theorems -/

/-- Store unavailable ⇒ Block. Cannot verify means deny. -/
theorem ledger_unavailable_blocks (authority : ByteArray)
    (reg : PrincipalRegistry) (mediator : AdapterId) (e : EffectEnvelope)
    (sigHex : String) (state : ApprovalState) :
    effectStepLedgered authority reg mediator e sigHex state none
      = (⟨.Block, 0⟩, none) := rfl

/-- A failing generation gate ⇒ Block, before any judgment. -/
theorem generation_gate_false_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {v : LedgerView}
    (h : generationGate state v = false) :
    (effectStepLedgered authority reg mediator e sigHex state
      (some v)).1.decision = .Block := by
  unfold effectStepLedgered
  simp [h]

/-- **STEP 0, positive half: a generation MISMATCH is detectable.** Any
    store attesting a generation other than the signed config's is
    Blocked. -/
theorem generation_mismatch_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {v : LedgerView}
    (h : v.att.generation ≠ state.ledgerGeneration) :
    (effectStepLedgered authority reg mediator e sigHex state
      (some v)).1.decision = .Block :=
  generation_gate_false_blocks (by simp [generationGate, h])

/-- Unconfigured (`ledgerGeneration = 0`) ⇒ Block. The default is deny. -/
theorem unconfigured_generation_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {v : LedgerView}
    (h : state.ledgerGeneration = 0) :
    (effectStepLedgered authority reg mediator e sigHex state
      (some v)).1.decision = .Block :=
  generation_gate_false_blocks (by simp [generationGate, h])

/-! ## Consume spec, atomicity, one-shot -/

/-- What a successful consume did: attestation preserved, the entry for
    exactly this `(authority, keyId, nonce, expiresAt)` pushed. -/
theorem consumeNonce_some {v v' : LedgerView} {auth : ByteArray}
    {e : EffectEnvelope} (h : consumeNonce v auth e = some v') :
    v'.att = v.att ∧
    v'.entries = mintedEntry auth e :: v.entries := by
  unfold consumeNonce at h
  split at h
  · cases h
  · injection h with h
    subst h
    exact ⟨rfl, rfl⟩

/-- One-shot at the consume: consuming again with the same key fails. -/
theorem consumeNonce_replay {v v' : LedgerView} {auth : ByteArray}
    {e : EffectEnvelope} (h : consumeNonce v auth e = some v') :
    consumeNonce v' auth e = none := by
  obtain ⟨-, hent⟩ := consumeNonce_some h
  unfold consumeNonce
  rw [hent]
  simp [entryMatches, mintedEntry]

/-- **Consume-atomically-before-release.** An Allow out of the ledgered
    step implies: the gate passed, the six-gate step Allowed, the fence
    carries the live generation, and the consume ALREADY SUCCEEDED — the
    returned ledger records the nonce. There is no value of this
    function in which the Allow exists and the nonce is unrecorded. -/
theorem allow_consumes_before_release {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {v : LedgerView}
    {out : CanonicalBytes}
    (h : (effectStepLedgered authority reg mediator e sigHex state
      (some v)).1.decision = .Allow out) :
    generationGate state v = true ∧
    effectStep authority reg mediator e sigHex state = .Allow out ∧
    (effectStepLedgered authority reg mediator e sigHex state
      (some v)).1.generation = state.ledgerGeneration ∧
    ∃ v', consumeNonce v authority e = some v' ∧
      (effectStepLedgered authority reg mediator e sigHex state
        (some v)).2 = some v' ∧
      v'.entries = mintedEntry authority e :: v.entries := by
  cases hg : generationGate state v with
  | false =>
      exfalso
      have hb := generation_gate_false_blocks (authority := authority)
        (reg := reg) (mediator := mediator) (e := e) (sigHex := sigHex)
        (state := state) (v := v) hg
      rw [h] at hb
      simp at hb
  | true =>
      cases hstep : effectStep authority reg mediator e sigHex state with
      | Block =>
          exfalso
          have hb : (effectStepLedgered authority reg mediator e sigHex
              state (some v)).1.decision = .Block := by
            unfold effectStepLedgered
            simp [hg, hstep]
          rw [h] at hb
          simp at hb
      | Allow out' =>
          cases hc : consumeNonce v authority e with
          | none =>
              exfalso
              have hb : (effectStepLedgered authority reg mediator e sigHex
                  state (some v)).1.decision = .Block := by
                unfold effectStepLedgered
                simp [hg, hstep, hc]
              rw [h] at hb
              simp at hb
          | some v' =>
              have hdec : (effectStepLedgered authority reg mediator e
                  sigHex state (some v)).1.decision = .Allow out' := by
                unfold effectStepLedgered
                simp [hg, hstep, hc]
              have hEq : Decision.Allow out' = Decision.Allow out :=
                hdec.symm.trans h
              injection hEq with hout
              subst hout
              -- `cases hg/hstep/hc` rewrote the goal's occurrences of the
              -- gate, step, and consume scrutinees, so those conjuncts are
              -- now refl
              refine ⟨rfl, rfl, ?_, v', rfl, ?_,
                (consumeNonce_some hc).2⟩
              · unfold effectStepLedgered
                simp [hg, hstep, hc]
              · unfold effectStepLedgered
                simp [hg, hstep, hc]

/-- **No replay within the lineage (the first conjunct of the honest
    property).** If the ledgered step Allowed and handed back ledger
    `v'`, the SAME envelope against `v'` Blocks. One-shot consume within
    the live store lineage. -/
theorem consumed_replay_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {v v' : LedgerView}
    {out : CanonicalBytes}
    (h : (effectStepLedgered authority reg mediator e sigHex state
      (some v)).1.decision = .Allow out)
    (h2 : (effectStepLedgered authority reg mediator e sigHex state
      (some v)).2 = some v') :
    (effectStepLedgered authority reg mediator e sigHex state
      (some v')).1.decision = .Block := by
  obtain ⟨hg, hstep, -, ⟨v'', hc, hl, -⟩⟩ := allow_consumes_before_release h
  rw [h2] at hl
  injection hl with hl
  subst hl
  have hcr := consumeNonce_replay hc
  have hatt := (consumeNonce_some hc).1
  have hg' : generationGate state v' = true := by
    unfold generationGate at hg ⊢
    rw [hatt]
    exact hg
  unfold effectStepLedgered
  simp [hg', hstep, hcr]

/-! ## Non-influence: the ledger gates PRESENCE, never VALUE -/

/-- The K2/advisory idiom ported to the ledger seam: whenever the
    ledgered step Allows, the allowed bytes are `SealV2.decide e.line
    state` — a function of the judged line and the trusted config/state
    only. The ledger (its generation, its content, its availability)
    decides WHETHER an Allow is released, never WHICH bytes are
    allowed. -/
theorem ledgered_value_from_line_and_state {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {ledger? : Option LedgerView}
    {out : CanonicalBytes}
    (h : (effectStepLedgered authority reg mediator e sigHex state
      ledger?).1.decision = .Allow out) :
    SealV2.decide e.line state = .Allow out := by
  match ledger? with
  | none => simp [effectStepLedgered] at h
  | some v =>
      exact allow_value_from_line_and_state
        (allow_consumes_before_release h).2.1

/-! ## STEP 0, negative half: what this design honestly cannot see -/

/-- **The gate is content-blind — the honest limit as a theorem.** The
    generation gate is a function of the store's ATTESTATION alone: two
    views with the same attestation — an honest one and one whose content
    set was rolled back, selectively deleted, or early-pruned — are
    INDISTINGUISHABLE to it. Option A defends the lineage label, not the
    content set. (Completeness is Option D: UNDEVELOPED, not claimed.) -/
theorem generation_gate_content_blind (state : ApprovalState)
    {v₀ v₁ : LedgerView} (hatt : v₀.att = v₁.att) :
    generationGate state v₀ = generationGate state v₁ := by
  unfold generationGate
  rw [hatt]

/-- **STEP 0, negative witness (conditional on the crypto seam, discharged
    at runtime with real Ed25519 in the SHOW — the K2 pattern).** Take any
    envelope the six-gate step Allows under a configured generation, and
    any store `v₁` attesting that generation. `vC` is the store after the
    envelope was consumed; `v₀` is the ROLLBACK twin: SAME attestation,
    content set erased. Then:

    * the gate cannot tell `vC` from `v₀` (content-blindness, applied);
    * the honest store `vC` Blocks the replay;
    * the rolled-back `v₀` **Allows it again**.

    A matching generation with a rolled-back content set is NOT
    detectable. That is the honest limit of Option A, demonstrated before
    anything is claimed. -/
theorem rollback_replay_conditional {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {out : CanonicalBytes}
    (hstep : effectStep authority reg mediator e sigHex state = .Allow out)
    (v₁ : LedgerView)
    (hgen : generationGate state v₁ = true) :
    generationGate state
        { att := v₁.att, entries := mintedEntry authority e :: v₁.entries }
      = generationGate state { att := v₁.att, entries := [] } ∧
    (effectStepLedgered authority reg mediator e sigHex state
      (some { att := v₁.att,
              entries := mintedEntry authority e :: v₁.entries })).1.decision
      = .Block ∧
    (effectStepLedgered authority reg mediator e sigHex state
      (some { att := v₁.att, entries := [] })).1.decision
      = .Allow out := by
  -- both twins share v₁'s attestation definitionally, so the gate verdict
  -- transports by defeq
  have hgC : generationGate state
      { att := v₁.att,
        entries := mintedEntry authority e :: v₁.entries } = true := hgen
  have hg0 : generationGate state
      { att := v₁.att, entries := [] } = true := hgen
  refine ⟨hgC.trans hg0.symm, ?_, ?_⟩
  · have hcr : consumeNonce
        { att := v₁.att, entries := mintedEntry authority e :: v₁.entries }
        authority e = none := by
      unfold consumeNonce
      simp [entryMatches, mintedEntry]
    unfold effectStepLedgered
    simp [hgC, hstep, hcr]
  · have hc0 : consumeNonce { att := v₁.att, entries := [] } authority e
        = some { att := v₁.att, entries := [mintedEntry authority e] } := by
      unfold consumeNonce
      simp
    unfold effectStepLedgered
    simp [hg0, hstep, hc0]

/-- **Honest limit #2: a fresh store at a new generation ignores all
    prior history (the rotation replay window), conditional form.** After
    the authority rotates (re-signs at a new generation) and the store is
    honestly fresh, any still-live envelope — including one consumed
    under the PREVIOUS generation — Allows again: the fresh store's
    content is honestly empty and the gate, by design, sees only the
    lineage label. The window is bounded by the envelope freshness window
    `min(issuedAt + maxApprovalTtl, expiresAt)` (six-gate `expiryGate` +
    `issuedAtGate`). Deployment obligation: rotate-then-drain. -/
theorem fresh_store_ignores_history {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state₂ : ApprovalState} {out : CanonicalBytes}
    (hstep : effectStep authority reg mediator e sigHex state₂ = .Allow out)
    (v₂ : LedgerView)
    (hgen : generationGate state₂ v₂ = true)
    (hempty : v₂.entries = []) :
    (effectStepLedgered authority reg mediator e sigHex state₂
      (some v₂)).1.decision = .Allow out := by
  have hc : consumeNonce v₂ authority e
      = some { v₂ with entries := [mintedEntry authority e] } := by
    unfold consumeNonce
    simp [hempty]
  unfold effectStepLedgered
  simp [hgen, hstep, hc]

/-! ## Prune soundness -/

/-- An entry `pruneLedger` may drop at `now` is one whose `expiresAt` has
    passed; the envelope that minted it (same `expiresAt`, by
    `consumeNonce_some`) can no longer pass `expiryGate` at that clock.
    So pruning at an HONEST clock never re-opens a replay: the expiry
    gate holds the line the ledger lets go of. (A lying clock breaks the
    hypothesis, not the theorem — clock-driven early prune is a named
    member of the loss-of-history family.) -/
theorem pruned_entry_envelope_blocked {state : ApprovalState}
    {e : EffectEnvelope} (h : ¬ state.now ≤ e.expiresAt) :
    expiryGate state e = false := by
  simp [expiryGate, h]

/-- Lifted to the step: an envelope whose ledger entry is prunable at the
    state clock is Blocked by the six-gate step, hence by the ledgered
    step — for ANY ledger value, including a rolled-back one. -/
theorem pruned_envelope_step_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {ledger? : Option LedgerView}
    (h : ¬ state.now ≤ e.expiresAt) :
    (effectStepLedgered authority reg mediator e sigHex state
      ledger?).1.decision = .Block := by
  have hgate := pruned_entry_envelope_blocked (state := state) (e := e) h
  have hstep : effectStep authority reg mediator e sigHex state = .Block := by
    unfold effectStep
    split
    · rfl
    · split
      case isTrue hcond =>
        exfalso
        simp only [Bool.and_eq_true] at hcond
        exact absurd hcond.1.1.2 (by simp [hgate])
      case isFalse _ => rfl
  match ledger? with
  | none => rfl
  | some v =>
      unfold effectStepLedgered
      cases hg : generationGate state v with
      | false => simp [hg]
      | true => simp [hg, hstep]

/-! ## Executor fencing -/

/-- The fence spec, both directions: accepted iff nonzero and equal to
    the live config's generation. -/
theorem executorAccepts_spec (state : ApprovalState) (fd : FencedDecision) :
    executorAccepts state fd = true ↔
      fd.generation ≠ 0 ∧ fd.generation = state.ledgerGeneration := by
  simp [executorAccepts]

/-- **The fence closes the stale-authority window**: a decision minted
    under any generation other than the live config's is rejected by the
    executor spec — an Allow minted under N is dead at N+1. -/
theorem executor_fences_stale_generation {state : ApprovalState}
    {fd : FencedDecision} (h : fd.generation ≠ state.ledgerGeneration) :
    executorAccepts state fd = false := by
  simp [executorAccepts, h]

/-- The step's own Allow is accepted by the executor it was minted for —
    the fence is not vacuously closed (non-vacuity for the fence pair). -/
theorem minted_allow_passes_live_fence {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {v : LedgerView}
    {out : CanonicalBytes}
    (h : (effectStepLedgered authority reg mediator e sigHex state
      (some v)).1.decision = .Allow out) :
    executorAccepts state
      (effectStepLedgered authority reg mediator e sigHex state
        (some v)).1 = true := by
  obtain ⟨hg, -, hgen, -⟩ := allow_consumes_before_release h
  rw [executorAccepts_spec, hgen]
  have hne : state.ledgerGeneration ≠ 0 := by
    unfold generationGate at hg
    simp only [Bool.and_eq_true, bne_iff_ne, ne_eq] at hg
    exact hg.1
  exact ⟨hne, rfl⟩

/-! ## Built witnesses (crypto-free legs — the crypto legs run in the
SHOW with real Ed25519, `lake exe nonce_ledger_show`) -/

/-- Tiny fixture state: generation 2 configured. -/
private def wState : ApprovalState :=
  { session := "session-1", now := 10, publicKey := "",
    manifestDigest := "", tools := [], approvals := [],
    policyVersion := "policy-1", maxApprovalTtl := 300,
    ledgerGeneration := 2 }

private def wAtt1 : LedgerAttestation :=
  { storeId := "store-a", generation := 1, createdAt := 5 }

private def wAtt2 : LedgerAttestation :=
  { storeId := "store-a", generation := 2, createdAt := 7 }

private def wEnv : EffectEnvelope :=
  { keyId := "alice", nonce := ByteArray.mk #[0x01], issuedAt := 5,
    expiresAt := 100, line := "", adapterType := "mcp",
    adapterVersion := "1", session := "session-1",
    policyVersion := "policy-1", effect := none }

private def wMediator : AdapterId := { type := "mcp", version := "1" }

/-- BUILT witness: generation mismatch (store 1, config 2) Blocks. -/
theorem mismatch_witness_blocks :
    (effectStepLedgered ByteArray.empty [] wMediator wEnv "" wState
      (some { att := wAtt1, entries := [] })).1.decision = .Block :=
  generation_mismatch_blocks (by decide)

/-- BUILT witness: store unavailable Blocks. -/
theorem unavailable_witness_blocks :
    (effectStepLedgered ByteArray.empty [] wMediator wEnv "" wState
      none).1.decision = .Block := rfl

/-- BUILT witness: unconfigured generation (0) Blocks even with a store
    attesting 0 — 0 is deny, never a magic match. -/
theorem unconfigured_witness_blocks :
    (effectStepLedgered ByteArray.empty [] wMediator wEnv ""
      { wState with ledgerGeneration := 0 }
      (some { att := { wAtt1 with generation := 0 }, entries := [] })
      ).1.decision = .Block :=
  unconfigured_generation_blocks rfl

/-- BUILT witness: the executor fence rejects a stale generation — a
    fenced decision minted at 1 dies at the config's 2. -/
theorem stale_fence_witness :
    executorAccepts wState ⟨.Allow "x", 1⟩ = false :=
  executor_fences_stale_generation (by decide)

/-- BUILT witness (content-blindness, concrete): a consumed store and its
    rollback twin — same attestation, different content — get the SAME
    gate verdict, and the two content sets really differ (non-vacuity). -/
theorem content_blind_witness :
    generationGate wState
        { att := wAtt2, entries := [mintedEntry ByteArray.empty wEnv] }
      = generationGate wState { att := wAtt2, entries := [] } ∧
    [mintedEntry ByteArray.empty wEnv] ≠ ([] : List LedgerEntry) :=
  ⟨generation_gate_content_blind wState rfl, by simp⟩

/-- **Non-vacuity for the honest ledgered LOW view.** These states differ
    genuinely in the clock, agree on the full base authorization bit and
    generation, and produce the same fenced decision against the same
    ledger. As in the host NI witness, the deliberately malformed request
    exercises the Block observation without any crypto assumption. -/
theorem ledgered_lowView_noninterference_nonvacuous :
    ∃ s1 s2 : ApprovalState, s1 ≠ s2 ∧
      ledgeredLowView ByteArray.empty [] wMediator wEnv "" s1 =
        ledgeredLowView ByteArray.empty [] wMediator wEnv "" s2 ∧
      (effectStepLedgered ByteArray.empty [] wMediator wEnv "" s1
        (some { att := wAtt2, entries := [] })).1 =
      (effectStepLedgered ByteArray.empty [] wMediator wEnv "" s2
        (some { att := wAtt2, entries := [] })).1 := by
  refine ⟨wState, { wState with now := 11 }, ?_, rfl, rfl⟩
  intro h
  exact absurd (congrArg ApprovalState.now h) (by decide)

/-- **Negative control: generation is not HIGH on this path.** The two
    states are the same record except for `ledgerGeneration` (`1` versus
    `2`). Against the same generation-2 ledger and all the same request
    inputs, the observer sees different fenced decisions: generation `0`
    from the mismatching state and generation `2` from the matching state.
    The base decisions are both Block; the distinguishing field is exactly
    the fence generation. -/
theorem ledgered_generation_negative_control :
    { wState with ledgerGeneration := 1 } ≠ wState ∧
    (effectStepLedgered ByteArray.empty [] wMediator wEnv ""
      { wState with ledgerGeneration := 1 }
      (some { att := wAtt2, entries := [] })).1 = ⟨.Block, 0⟩ ∧
    (effectStepLedgered ByteArray.empty [] wMediator wEnv "" wState
      (some { att := wAtt2, entries := [] })).1 = ⟨.Block, 2⟩ ∧
    (effectStepLedgered ByteArray.empty [] wMediator wEnv ""
      { wState with ledgerGeneration := 1 }
      (some { att := wAtt2, entries := [] })).1 ≠
    (effectStepLedgered ByteArray.empty [] wMediator wEnv "" wState
      (some { att := wAtt2, entries := [] })).1 := by
  refine ⟨?_, rfl, rfl, ?_⟩
  · intro h
    exact absurd (congrArg ApprovalState.ledgerGeneration h) (by decide)
  · intro h
    exact absurd (congrArg FencedDecision.generation h) (by decide)

/- Evaluated negative-control output:
    `({ decision := Block, generation := 0 },
      { decision := Block, generation := 2 })`. -/
#eval (
  (effectStepLedgered ByteArray.empty [] wMediator wEnv ""
    { wState with ledgerGeneration := 1 }
    (some { att := wAtt2, entries := [] })).1,
  (effectStepLedgered ByteArray.empty [] wMediator wEnv "" wState
    (some { att := wAtt2, entries := [] })).1)

/-! ## Axiom pins — the build fails if any theorem picks up an axiom
beyond the standard trio (no `sorry`, no `native_decide`, no
`ofReduceBool`) -/

/-- info: 'SealV2.Effect.Ledger.ledger_tag_separated' does not depend on any axioms -/
#guard_msgs in
#print axioms ledger_tag_separated

/-- info: 'SealV2.Effect.Ledger.ledger_attestation_injective' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms ledger_attestation_injective

/-- info: 'SealV2.Effect.Ledger.ledger_unavailable_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ledger_unavailable_blocks

/-- info: 'SealV2.Effect.Ledger.generation_mismatch_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms generation_mismatch_blocks

/-- info: 'SealV2.Effect.Ledger.unconfigured_generation_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms unconfigured_generation_blocks

/-- info: 'SealV2.Effect.Ledger.consumeNonce_replay' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms consumeNonce_replay

/-- info: 'SealV2.Effect.Ledger.allow_consumes_before_release' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms allow_consumes_before_release

/-- info: 'SealV2.Effect.Ledger.consumed_replay_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms consumed_replay_blocks

/-- info: 'SealV2.Effect.Ledger.ledgered_value_from_line_and_state' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ledgered_value_from_line_and_state

/-- info: 'SealV2.Effect.Ledger.generation_gate_content_blind' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms generation_gate_content_blind

/-- info: 'SealV2.Effect.Ledger.rollback_replay_conditional' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms rollback_replay_conditional

/-- info: 'SealV2.Effect.Ledger.fresh_store_ignores_history' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms fresh_store_ignores_history

/-- info: 'SealV2.Effect.Ledger.pruned_entry_envelope_blocked' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms pruned_entry_envelope_blocked

/-- info: 'SealV2.Effect.Ledger.pruned_envelope_step_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms pruned_envelope_step_blocks

/-- info: 'SealV2.Effect.Ledger.executorAccepts_spec' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms executorAccepts_spec

/-- info: 'SealV2.Effect.Ledger.executor_fences_stale_generation' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms executor_fences_stale_generation

/-- info: 'SealV2.Effect.Ledger.minted_allow_passes_live_fence' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms minted_allow_passes_live_fence

/-- info: 'SealV2.Effect.Ledger.mismatch_witness_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms mismatch_witness_blocks

/-- info: 'SealV2.Effect.Ledger.unavailable_witness_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms unavailable_witness_blocks

/-- info: 'SealV2.Effect.Ledger.unconfigured_witness_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms unconfigured_witness_blocks

/-- info: 'SealV2.Effect.Ledger.stale_fence_witness' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms stale_fence_witness

/-- info: 'SealV2.Effect.Ledger.content_blind_witness' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms content_blind_witness

/-- info: 'SealV2.Effect.Ledger.ledgered_generation_declassified' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ledgered_generation_declassified

/-- info: 'SealV2.Effect.Ledger.effectAuthView_determines_decision' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms effectAuthView_determines_decision

/-- info: 'SealV2.Effect.Ledger.ledgered_lowView_noninterference' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ledgered_lowView_noninterference

/--
info: 'SealV2.Effect.Ledger.ledgered_lowView_noninterference_nonvacuous' depends on axioms: [propext,
 Classical.choice,
 Quot.sound]
-/
#guard_msgs in
#print axioms ledgered_lowView_noninterference_nonvacuous

/-- info: 'SealV2.Effect.Ledger.ledgered_generation_negative_control' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ledgered_generation_negative_control

end SealV2.Effect.Ledger

/-! ## Ledgered completeness — the mechanical reconciliation

Same mechanics as `SealV2/EnvelopeCompleteness.lean`, walked from
`effectStepLedgered`: in the LEDGERED cone every signed field must be
consulted by a gate — INCLUDING `nonce`, whose exemption is discharged
here (consumed by `consumeNonce`) and retained only for the bare
`effectStep` cone. Zero exemptions: a signed field this step ignores
fails the build. -/

open Lean Elab Command

/--
info: ledgered completeness: 10 gated, 0 exempted, 10 signed fields reconciled
-/
#guard_msgs in
run_cmd do
  let env ← getEnv
  let structName := ``SealV2.Effect.EffectEnvelope
  let fields := getStructureFields env structName
  if fields.isEmpty then
    throwError "ledgered completeness: could not read fields of {structName}"
  let projs : Lean.NameSet :=
    fields.foldl (init := {}) fun s f => s.insert (structName ++ f)
  let cut : Lean.NameSet :=
    SealV2.Effect.Completeness.encodingOnly.foldl (init := {})
      fun s n => s.insert n
  let consulted := SealV2.Effect.Completeness.consultedProjections env projs
    cut [``SealV2.Effect.Ledger.effectStepLedgered] {} {}
  let mut errors : List String := []
  let mut gated := 0
  for f in fields do
    if consulted.contains (structName ++ f) then
      gated := gated + 1
    else
      errors := errors ++
        [s!"'{f}' is SIGNED but not consulted in the effectStepLedgered cone"]
  unless errors.isEmpty do
    throwError "ledgered completeness FAILED:\n  {String.intercalate "\n  " errors}"
  logInfo s!"ledgered completeness: {gated} gated, 0 exempted, {fields.size} signed fields reconciled"
