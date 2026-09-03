/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.EffectEnvelope

/-!
# Principal non-influence — the decision value is invariant under the
# authenticated principal (K2)

**The fact, stated as a property instead of an accident.**
`SealV2.decide : RawBytes → ApprovalState → Decision` has no principal
parameter — the policy language cannot express "who is asking". `effectStep`
authenticates the caller via `verifyEffect`, obtains an `AuthenticatedId`, and
then discards it (`some _`) before judging the line
(`SealV2/EffectEnvelope.lean`, `effectStep`). Until this module, nothing
stated that, nothing enforced it, and nothing would have noticed a change.
This module pins it:

* `effect_step_presence_form` — the equational form: `effectStep` IS an
  expression in which the authenticated principal occurs only as
  `Option.isSome` (a presence bit). The `AuthenticatedId` value has no
  occurrence in the decision expression at all.
* `principal_non_influence` — THE theorem: two verified runs over the same
  judged line and the same approval state produce the same decision, whatever
  their authenticated principals are (including distinct ones), and whatever
  their authorities, registries, mediators, envelopes and signatures are,
  provided each run passes its own gates (all six of the Stage B2 reconciled
  step: adapter, session, effect, expiry, issuedAt, policyVersion).
* `witness_principal_non_influence` — the Step-0 non-vacuity witness: two
  CONCRETE distinct principals (`alice` under an MCP mediator, `bob` under a
  CLI mediator — the envelopes differ in every field the gates allow to
  differ: keyId, nonce, issuedAt, expiresAt, adapter type/version; the
  Stage B2 MANDATORY bindings force session and policyVersion equal to the
  state's, so those fields can no longer differ between gate-passing
  envelopes, and the judged line is the theorem's fixed comparand) both
  authenticate and instantiate the theorem. Conditional on exactly
  two `ed25519Verify = true` facts — the crypto TCB seam (A3); everything
  else (registry lookup, hex decoding, wire widths, all six gates) is
  discharged inside the proof. The runnable control
  (`lake exe principal_non_influence_show`) discharges those two facts
  operationally with real TweetNaCl verification over real, checked-in
  Ed25519 signatures, and additionally shows both runs reach `Allow`.

**What this is NOT (scope — read before citing).** This is a MODEL property
of the Lean pipeline `effectStep`/`decide` only. It does NOT cover:

* the PRESENCE channel — WHETHER a decision is produced does depend on the
  principal (registration, key custody, signature validity). Only the
  decision VALUE, gates passed, is principal-invariant;
* approval issuance — WHO obtained the approvals in `ApprovalState` is
  outside the model; a deployment may well issue approvals per-principal;
* the host runtime (seal-host, Rust seam, receipts, logging), which may
  legitimately record or act on the principal;
* any claim of information-flow noninterference (see prior art below).

**Deliberate refutation target.** A future V2.1-style
`AuthenticatedPrincipal` that threads caller identity into the decision MUST
refute this: `principal_non_influence` breaks at compile time if the
signature changes, and `lake exe principal_non_influence_show` goes RED at
run time if the decision value diverges between alice and bob. That is the
point of stating the property: the change becomes a visible refutation, not
a silent behaviour shift.

**Warrant.**
* WHY: without this stated, per-principal decision behaviour could ship
  silently, and reviewers may assume the policy can narrow "who may ask"
  when it cannot — any registered principal, however unprivileged its
  operator intended it to be, receives exactly the same kernel verdicts for
  the same line and state. Relying on per-principal narrowing at this seam
  is a deployment error; this theorem makes the boundary explicit.
* HOW: `SealV2/Decide.lean` `decide` (no principal parameter);
  `SealV2/EffectEnvelope.lean` `effectStep` (`some _` discard);
  `effect_step_presence_form` below (only-`isSome` occurrence).
* SHOW: `lake exe principal_non_influence_show` (Test/PrincipalNonInfluence
  .lean) — RED if the decision becomes principal-dependent, if the two
  witness principals stop being distinct, or if the Allow leg dies (runtime
  vacuity guard).
* PRIOR ART: "noninfluence" in the literature (von Oheimb, ESORICS 2004:
  Noninfluence = Noninterference + Nonleakage) is a TRACE-based
  information-flow property over state machines. What is proved here is
  strictly weaker and different in kind: pointwise functional invariance of
  one decision function under one input, for fixed other inputs. We
  deliberately do NOT call this "non-interference" or "principal isolation".
  The name follows this repo's established `advisory_non_influence` idiom
  (V2.3 effect-envelope package) and the divergence from the literature term
  is stated here rather than left silent.
-/

namespace SealV2.Effect

/-! ## The equational form: the principal occurs only as a presence bit -/

/-- Equational form of `effect_step_presence_not_value`: `effectStep` equals
    an expression in which the result of `verifyEffect` occurs ONLY under
    `Option.isSome`. The `AuthenticatedId` VALUE — the authenticated
    principal — has no occurrence on the right-hand side: it is
    type-theoretically impossible for the decision value to depend on it.
    MODEL property; see the module docstring for scope. -/
theorem effect_step_presence_form (authority : ByteArray)
    (reg : PrincipalRegistry) (mediator : AdapterId) (e : EffectEnvelope)
    (sigHex : String) (state : ApprovalState) :
    effectStep authority reg mediator e sigHex state
      = (if (verifyEffect authority reg e sigHex).isSome
            && adapterGate mediator e && sessionGate state e
            && effectGate mediator e && expiryGate state e
            && issuedAtGate state e && policyVersionGate state e
        then decide e.line state
        else .Block) := by
  unfold effectStep
  cases h : verifyEffect authority reg e sigHex with
  | none => simp
  | some p => simp [Bool.and_assoc]

/-- Gates passed, the step is the kernel's own verdict on the line — the
    value leg every invariance below reuses. -/
theorem effect_step_value_of_gates {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {p : AuthenticatedId}
    (hv : verifyEffect authority reg e sigHex = some p)
    (hga : adapterGate mediator e = true)
    (hgs : sessionGate state e = true)
    (hge : effectGate mediator e = true)
    (hgx : expiryGate state e = true)
    (hgi : issuedAtGate state e = true)
    (hgp : policyVersionGate state e = true) :
    effectStep authority reg mediator e sigHex state = decide e.line state := by
  unfold effectStep
  rw [hv]
  simp [hga, hgs, hge, hgx, hgi, hgp]

/-! ## THE theorem -/

/-- **Principal non-influence.** For a fixed judged line and a fixed approval
    state, the decision VALUE is invariant under the authenticated principal:
    two runs that each authenticate (`verifyEffect = some pᵢ` — `p₁` and `p₂`
    arbitrary, in particular distinct) and each pass their own gates produce
    the SAME decision, across different authorities, registries, mediators,
    envelopes and signatures. Note this includes the case where the common
    verdict is `.Block` (a blocked line blocks identically for everyone) —
    strictly wider than `advisory_non_influence`, which assumes non-`.Block`
    and does not bind the authenticated principal at all.

    MODEL property. Binds the actual `AuthenticatedId` produced by
    `verifyEffect` — not a namesake envelope field. WHETHER a decision is
    produced (the presence channel) still depends on the principal; approval
    issuance and host-side behaviour are out of scope (module docstring). -/
theorem principal_non_influence {authority₁ authority₂ : ByteArray}
    {reg₁ reg₂ : PrincipalRegistry} {mediator₁ mediator₂ : AdapterId}
    {e₁ e₂ : EffectEnvelope} {sig₁ sig₂ : String} {state : ApprovalState}
    {p₁ p₂ : AuthenticatedId}
    (h₁ : verifyEffect authority₁ reg₁ e₁ sig₁ = some p₁)
    (h₂ : verifyEffect authority₂ reg₂ e₂ sig₂ = some p₂)
    (hline : e₁.line = e₂.line)
    (hga₁ : adapterGate mediator₁ e₁ = true)
    (hgs₁ : sessionGate state e₁ = true)
    (hge₁ : effectGate mediator₁ e₁ = true)
    (hgx₁ : expiryGate state e₁ = true)
    (hgi₁ : issuedAtGate state e₁ = true)
    (hgp₁ : policyVersionGate state e₁ = true)
    (hga₂ : adapterGate mediator₂ e₂ = true)
    (hgs₂ : sessionGate state e₂ = true)
    (hge₂ : effectGate mediator₂ e₂ = true)
    (hgx₂ : expiryGate state e₂ = true)
    (hgi₂ : issuedAtGate state e₂ = true)
    (hgp₂ : policyVersionGate state e₂ = true) :
    effectStep authority₁ reg₁ mediator₁ e₁ sig₁ state
      = effectStep authority₂ reg₂ mediator₂ e₂ sig₂ state := by
  rw [effect_step_value_of_gates h₁ hga₁ hgs₁ hge₁ hgx₁ hgi₁ hgp₁,
    effect_step_value_of_gates h₂ hga₂ hgs₂ hge₂ hgx₂ hgi₂ hgp₂, hline]

/-! ## Step-0 non-vacuity witness

Two concrete, distinct, authenticated principals. The envelopes differ in
EVERY field the gates allow to differ under the Stage B2 reconciled shape:
keyId, nonce, issuedAt, expiresAt, adapter type/version (distinct
mediators) — plus distinct authorities and signatures, one shared registry.
The Stage B2 MANDATORY bindings (session and policyVersion must equal the
state's, nonempty; expiresAt nonzero) mean session and policyVersion are
FORCED equal between any two gate-passing envelopes over the same state:
those two fields are no longer principal-differentiable, by design. They
share exactly the judged `line` (the fixed comparand of the theorem). The
F3 effect claim is DECLARED ABSENT (`none`) in BOTH kernel-witness
envelopes because the F3 gate forces a present claim to equal the
parser-derived effect (kernel evaluation of the parser is not available
to `decide`-style proofs here); the present-claim difference is exercised
by the runtime control instead (`aliceEffectful` run in the SHOW exe).

Keys are the documented test keypairs (seeds `0x00..0x1f` and `0x01..0x20`,
NOT real keys); signatures are real Ed25519, produced by
`test/v2/principal_noninfluence_sign_fixture.py` over exactly the pinned
message bytes below. -/

/-- The judged line both witness envelopes share — byte-identical to
    `Test.V2ValidationFixtures.validRaw` (the SHOW exe asserts this), so the
    runtime control reaches a genuine `Allow` against `baseState`. -/
def wLine : String :=
  "{\"method\":\"tools/call\",\"params\":{\"name\":\"db.execute\",\"action\":\"write\",\"arguments\":{\"database\":\"prod\",\"table\":\"users\",\"amount\":12.34}}}"

/-- Test pubkey for `alice` — seed `0x000102…1f` (same documented test seed
    as `Test.V2ValidationFixtures.testPublicKeyHex`; NOT a real key). -/
def wAlicePubHex : String :=
  "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8"

/-- Test pubkey for `bob` — seed `0x010203…20` (NOT a real key). -/
def wBobPubHex : String :=
  "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664"

/-- ONE registry carrying both witness principals: the interesting case —
    two distinct principals of the same deployment. -/
def wRegistry : PrincipalRegistry :=
  [{ id := "alice", pubkey := wAlicePubHex },
   { id := "bob", pubkey := wBobPubHex }]

def wAuthorityA : ByteArray :=
  ByteArray.mk #[0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9,
    0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5,
    0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf]

def wAuthorityB : ByteArray :=
  ByteArray.mk #[0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9,
    0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf]

/-- `alice`: MCP mediator claim, F3 declared absent, earliest in-window
    issuedAt, tight expiry. Session and policyVersion carry the MANDATORY
    Stage B2 bindings (equal to the fixture state's — see the section
    docstring: gate-passing envelopes cannot differ there). -/
def wAlice : EffectEnvelope :=
  { keyId := "alice"
    nonce := ByteArray.mk #[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
      0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13,
      0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f]
    issuedAt := 3
    expiresAt := 100
    line := wLine
    adapterType := "mcp"
    adapterVersion := "2025-06-18"
    session := "session-1"
    policyVersion := "policy-1"
    effect := none }

/-- `bob`: CLI mediator claim, F3 declared absent. Differs from `wAlice` in
    every gate-differentiable field: keyId, nonce, issuedAt, expiresAt,
    adapter type/version. -/
def wBob : EffectEnvelope :=
  { keyId := "bob"
    nonce := ByteArray.mk #[0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
      0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33,
      0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f]
    issuedAt := 7
    expiresAt := 777777
    line := wLine
    adapterType := "cli"
    adapterVersion := "9.9"
    session := "session-1"
    policyVersion := "policy-1"
    effect := none }

/-- The mediator `alice`'s run trusts as having mediated. -/
def wMcp : AdapterId := { type := "mcp", version := "2025-06-18" }

/-- The mediator `bob`'s run trusts — a different adapter entirely. -/
def wCli : AdapterId := { type := "cli", version := "9.9" }

/-- Real Ed25519 signature (seed-`alice` key) over
    `effectMessage wAuthorityA wAlice` — regenerate with
    `test/v2/principal_noninfluence_sign_fixture.py`. -/
def wSigAHex : String :=
  "5ffa8362458db9fd4ee92098185b49ee72b3d83e3a833b0ff65d6e71c301d7d3e81300d05711f76e19050372cca53aa6bce314401aaae8b14ce145a5b1c42801"

/-- Real Ed25519 signature (seed-`bob` key) over
    `effectMessage wAuthorityB wBob`. -/
def wSigBHex : String :=
  "4348ecc34f07488b36349ed9eb9062818ed07cb7af9764b2c61f28ee000200993849adcf7a88c27dbb47e27c760bcd0690466f3696943a918b78522dd42c540a"

/-- Decoded `alice` verifying key (the exact bytes `verifyEffect` hands to
    `ed25519Verify`). -/
def wAlicePk : ByteArray := (hexDecode? wAlicePubHex).getD default

def wBobPk : ByteArray := (hexDecode? wBobPubHex).getD default

/-- Decoded `alice` signature bytes. -/
def wSigA : ByteArray := (hexDecode? wSigAHex).getD default

def wSigB : ByteArray := (hexDecode? wSigBHex).getD default

/-- The approval state both witness runs share. The gates read its
    `session`, `policyVersion`, `now` and `maxApprovalTtl` planes (Stage B2
    mandatory bindings + freshness windows); the runtime control uses the
    full fixture `baseState` (same session, same policyVersion, same clock)
    to reach a genuine `Allow`. -/
def wState : ApprovalState :=
  { session := "session-1"
    now := 10
    publicKey := ""
    manifestDigest := ""
    tools := []
    approvals := []
    policyVersion := "policy-1" }

-- The witness proofs kernel-evaluate `wireSizedB` over the 134-char judged
-- line and 64/128-char hex decodes; the default recursion depth is too small
-- for that reduction. Scoped to the rest of this file (witness section only).
set_option maxRecDepth 16384

/-- `alice` authenticates, conditional on exactly ONE fact about the opaque
    crypto seam: her registered key verifies her signature over her message
    bytes. Registry lookup, hex decoding, widths and the fail-closed `if`
    are all discharged here. -/
theorem witness_verify_alice
    (hcrypto : ed25519Verify wAlicePk (effectMessage wAuthorityA wAlice)
        wSigA = true) :
    ∃ p : AuthenticatedId,
      verifyEffect wAuthorityA wRegistry wAlice wSigAHex = some p
        ∧ p.id = "alice" := by
  have hfind : wRegistry.find? (fun k => k.id == wAlice.keyId)
      = some { id := "alice", pubkey := wAlicePubHex } := rfl
  have hpk : hexDecode? wAlicePubHex = some wAlicePk := rfl
  have hsig : hexDecode? wSigAHex = some wSigA := rfl
  have hpre : (wAuthorityA.size == 32 && wAlicePk.size == 32
      && wireSizedB wAlice) = true := by decide
  unfold verifyEffect
  simp only [hfind, hpk, hsig, hpre, Bool.true_and, hcrypto, if_true]
  exact ⟨_, rfl, rfl⟩

/-- `bob` authenticates — same discharge, second principal. -/
theorem witness_verify_bob
    (hcrypto : ed25519Verify wBobPk (effectMessage wAuthorityB wBob)
        wSigB = true) :
    ∃ p : AuthenticatedId,
      verifyEffect wAuthorityB wRegistry wBob wSigBHex = some p
        ∧ p.id = "bob" := by
  have hfind : wRegistry.find? (fun k => k.id == wBob.keyId)
      = some { id := "bob", pubkey := wBobPubHex } := rfl
  have hpk : hexDecode? wBobPubHex = some wBobPk := rfl
  have hsig : hexDecode? wSigBHex = some wSigB := rfl
  have hpre : (wAuthorityB.size == 32 && wBobPk.size == 32
      && wireSizedB wBob) = true := by decide
  unfold verifyEffect
  simp only [hfind, hpk, hsig, hpre, Bool.true_and, hcrypto, if_true]
  exact ⟨_, rfl, rfl⟩

/-- Distinct ids force distinct principals (id observation is injective —
    `AuthenticatedId.ext_id`). -/
theorem witness_principals_distinct {p q : AuthenticatedId}
    (hp : p.id = "alice") (hq : q.id = "bob") : p ≠ q := by
  intro h
  subst h
  exact absurd (hp.symm.trans hq) (by decide)

/-- **The Step-0 witness, packaged.** Conditional on the two crypto facts —
    which `lake exe principal_non_influence_show` discharges with real
    TweetNaCl verification over the checked-in signatures — two DISTINCT
    authenticated principals exist whose runs instantiate
    `principal_non_influence`: same line, same state, every other
    envelope-expressible difference, same decision. Non-vacuity of the
    theorem reduces exactly to the crypto TCB seam (A3), nothing else. -/
theorem witness_principal_non_influence
    (hA : ed25519Verify wAlicePk (effectMessage wAuthorityA wAlice)
        wSigA = true)
    (hB : ed25519Verify wBobPk (effectMessage wAuthorityB wBob)
        wSigB = true) :
    ∃ pA pB : AuthenticatedId,
      verifyEffect wAuthorityA wRegistry wAlice wSigAHex = some pA
        ∧ verifyEffect wAuthorityB wRegistry wBob wSigBHex = some pB
        ∧ pA ≠ pB
        ∧ effectStep wAuthorityA wRegistry wMcp wAlice wSigAHex wState
            = effectStep wAuthorityB wRegistry wCli wBob wSigBHex wState := by
  obtain ⟨pA, hvA, hidA⟩ := witness_verify_alice hA
  obtain ⟨pB, hvB, hidB⟩ := witness_verify_bob hB
  exact ⟨pA, pB, hvA, hvB, witness_principals_distinct hidA hidB,
    principal_non_influence hvA hvB rfl
      (by decide) (by decide) (by decide) (by decide) (by decide) (by decide)
      (by decide) (by decide) (by decide) (by decide) (by decide) (by decide)⟩

/-! ## Build-time pins

The witness gates hold by evaluation, and the signed-message bytes are
pinned so the signature fixture has a fixed target: if the envelope shape or
any witness field drifts, the pin (and then the SHOW control) goes red. -/

/-- info: true -/
#guard_msgs in
#eval adapterGate wMcp wAlice && sessionGate wState wAlice
  && effectGate wMcp wAlice && expiryGate wState wAlice
  && issuedAtGate wState wAlice && policyVersionGate wState wAlice

/-- info: true -/
#guard_msgs in
#eval adapterGate wCli wBob && sessionGate wState wBob && effectGate wCli wBob
  && expiryGate wState wBob && issuedAtGate wState wBob
  && policyVersionGate wState wBob

/--
info: "7365616c2e6566666563742f763200a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf0000000000000005616c696365000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f0000000000000003000000000000006400000000000000867b226d6574686f64223a22746f6f6c732f63616c6c222c22706172616d73223a7b226e616d65223a2264622e65786563757465222c22616374696f6e223a227772697465222c22617267756d656e7473223a7b226461746162617365223a2270726f64222c227461626c65223a227573657273222c22616d6f756e74223a31322e33347d7d7d00000000000000036d6370000000000000000a323032352d30362d3138000000000000000973657373696f6e2d310000000000000008706f6c6963792d3100"
-/
#guard_msgs in
#eval bytesToHex (effectMessage wAuthorityA wAlice)

/--
info: "7365616c2e6566666563742f763200b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf0000000000000003626f62202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f000000000000000700000000000bde3100000000000000867b226d6574686f64223a22746f6f6c732f63616c6c222c22706172616d73223a7b226e616d65223a2264622e65786563757465222c22616374696f6e223a227772697465222c22617267756d656e7473223a7b226461746162617365223a2270726f64222c227461626c65223a227573657273222c22616d6f756e74223a31322e33347d7d7d0000000000000003636c690000000000000003392e39000000000000000973657373696f6e2d310000000000000008706f6c6963792d3100"
-/
#guard_msgs in
#eval bytesToHex (effectMessage wAuthorityB wBob)

/-! ## Axiom pins — the honesty razor, machine-checked -/

/-- info: 'SealV2.Effect.effect_step_presence_form' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms effect_step_presence_form

/-- info: 'SealV2.Effect.effect_step_value_of_gates' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms effect_step_value_of_gates

/-- info: 'SealV2.Effect.principal_non_influence' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms principal_non_influence

/-- info: 'SealV2.Effect.witness_verify_alice' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms witness_verify_alice

/-- info: 'SealV2.Effect.witness_verify_bob' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms witness_verify_bob

/-- info: 'SealV2.Effect.witness_principals_distinct' does not depend on any axioms -/
#guard_msgs in
#print axioms witness_principals_distinct

/-- info: 'SealV2.Effect.witness_principal_non_influence' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms witness_principal_non_influence

end SealV2.Effect
