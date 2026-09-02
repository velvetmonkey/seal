/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Decide

/-!
# V2.3 effect envelope — `seal.effect/v2` (Stage B strip + B2 reconciliation)

**What this module is.** The V2.3 signed message shape and its proof package.
Seal bumps the signed request envelope from V2.2 (`seal/v2.2/principal-envelope`,
host-side `Host/Principal.lean` in seal-host) to ONE signed object carrying the
fields that are actually authenticated AND interpreted. The original
`seal.effect/v1` layout (council `bf01363f`) seated every candidate field; the
E1★ ballot (Ben, 2026-07-22) killed the uninterpreted seats; Stage B stripped
them; Stage B2 reconciles that strip with the field-warrant campaign verdicts
(`/home/monkey/.mega-monkey/field-warrant-report.md`) BEFORE the tag ships —
one domain-tag bump covers every shape change, per the repin razor.

**Killed and STRIPPED:** F4 `idempotency_key`, F6 `on_behalf_of` /
`parent_capability_ref`, `audience`, `causality_token` (E1★, campaign
concurs), and — Stage B2 — F7 `revocation_subject`. Why the last one goes:
revocation is a statement by the AUTHORITY about standing trust; a request
field is a statement by the REQUESTER. Every candidate theorem either forbids
nothing or inverts the trust direction (request data shrinking trust). Seal's
actual revocation channel is config re-sign (revocation-by-re-sign, TCB note
below); keeping the field invites routing revocation through request data.
SEAT, wrong plane — stripped exactly as the E1★ seats were.

**RESCUED and GATED (Stage B2, field-warrant campaign):** `expires_at` and
`policy_version` were on the Stage B strip list, but the campaign PROVED
their gates using state already in this cone (`expired_envelope_blocks`,
`policy_version_spoof_blocks`). Stripping a field that is one gate from real,
then re-adding it in v3, is the double repin the razor exists to prevent. So
they stay — checked, not seated. `issuedAt` likewise graduates from
tuple-member-only to gated (`issuedAtGate`, ported with them).

**The audience consequence, stated where the strip is recorded (do not let
the slot and the defence disappear silently):** `audience` stays stripped,
but its ABSENCE is security-relevant — it is the classic token-redirection
boundary (`aud` confusion): an envelope accepted at mediator/host A being
replayed to mediator/host B wherever the same authority/registry is
accepted. What closes that threat today: the now-MANDATORY session binding
(`sessionGate`). Every envelope must carry the verifier's boot/config
session, and the host issues that value per boot from 32 bytes of entropy
(`issue_session_id`, seal-host), so an envelope minted for verifier A names
a session verifier B does not have. This closure is CONDITIONAL on a
deployment invariant, not a theorem: session values must be per-verifier
unique and never shared or reused across verifiers. Two mediators
deliberately booted with one shared config+session are indistinguishable to
this kernel. The clean fix remains a host self-identity (`selfId`) and an
`audienceGate` at the next repin — recorded for Ben (field-warrant report
§6). Before Stage B2, empty-session envelopes were exactly the portable
ones; the mandatory session binding is what upgrades this from "documented
hole" to "closed modulo the named invariant".

**No magic empty/zero bypasses (Stage B2, Task 4 ruling).** Prior art found
several named security bindings were checked when non-empty and silently
accepted when `""`/`0` — an insecure default wearing a security name, the
same class as the poison-the-receipt ruling. In this shape, for every signed
binding: either it is MANDATORY (empty/zero fails closed) or its optionality
is DECLARED in the signed object, never implied by a sentinel value:
* `session` — MANDATORY. Empty blocks (`empty_session_blocks`). This also
  aligns the kernel with the host, which already rejected empty sessions
  (seal-host `verify()`): the kernel seat was a plane divergence.
* `policy_version` — MANDATORY. Empty blocks (`empty_policy_version_blocks`).
  Consequence: the signed config MUST declare a nonempty `policyVersion`
  (fail-closed on unconfigured deployments, by design).
* `expires_at` — MANDATORY nonzero (`zero_expiry_blocks`). The signer must
  bound its own exposure window; a signer with no preference signs
  `issuedAt + ttl`. Effective lifetime is
  `min(issuedAt + maxApprovalTtl, expiresAt)` — the composite deadline.
* F3 `effect` — stays OPTIONAL (advisory by design; its strip-vs-keep is
  Ben's separate flagged F3 call, NOT decided here), but the optionality is
  now a DECLARED property: the claim is `Option EffectClaim`, wire-encoded
  with a signed presence byte (`0x00` absent / `0x01` present). The retired
  `("", "", "")` sentinel is now an ordinary CLAIM and gets equality-checked
  (and blocked on mismatch) like any other; absence is a distinct signed
  byte. Presence itself is signed: flipping it is a forgery.
* Not bypasses, for the record: `nonce` is signed randomness awaiting a
  replay ledger (exempted, with reason, in `EnvelopeCompleteness`); `keyId`
  is a registry lookup that fails closed on any unregistered value including
  `""`; `issuedAt`/`line`/`adapter{type,version}` are checked unconditionally.

**Bound fields, retained:**
* BIND `line` by value — the exact judged bytes, never digest-downgraded,
  framed (`u64be(len) ‖ bytes`) like every variable-width field.
* BIND `authority` (32 raw bytes), `keyId`, `nonce` (32 raw bytes) — the
  V2.2 Fix B config-authority bind, folded in unchanged in meaning.
* BIND + GATE `issuedAt` — freshness (`issuedAtGate`): never future-dated,
  never older than `state.maxApprovalTtl` (documented reuse as the envelope
  freshness window). Honest `state.now` is a standing host obligation.
* BIND + GATE `expiresAt` — mandatory signer-declared deadline (`expiryGate`).
* BIND F1 `adapter{type,version}` — host must equality-check against the
  adapter that actually mediated (`adapter_bind` / `adapter_mismatch_blocks`).
* BIND F2 `principal.session` — the approval/replay-namespace SESSION PLANE
  (`ApprovalState.session`, the value the SIGNED CONFIG names), explicitly
  NOT the receipt pid string. MANDATORY equality (`session_bind`,
  `session_spoof_blocks`, `empty_session_blocks`).
* BIND F5 `policy_version` — the anti-downgrade pin: an envelope signed
  against policy X cannot be judged under policy Y (`policy_version_bind`,
  `policy_version_spoof_blocks`). Mandatory equality against
  `state.policyVersion`.
* BIND-declared-optional F3
  `effect : Option {resource, action, args, metadata, requestState,
  inputResponses}` —
  ADVISORY but INTERPRETED: a present claim is equality-enforced against the
  parser-derived effect (`mcp_effect_equality`), never the decision value
  (`effect_step_presence_not_value`). The F3 claim is under a SEPARATE,
  FLAGGED strip decision (the ballot realized F3 as the kernel-computed
  `effect_commitment`); it is deliberately NOT stripped here.
* Encoding: every variable-width field `u64be(len) ‖ bytes`; fixed-width
  fields raw (authority 32, nonce 32, u64be at 8); the F3 option block is
  `0x00`, or
  `0x01 ‖ frame(resource) ‖ frame(action) ‖ frame(args) ‖ optMeta(metadata)
  ‖ optMrtr(requestState,inputResponses)`.

**Specification-only members of the byte-formula defect family:** a
repository-wide fixed-string search at `6c74b61` found no kernel occurrence
of `judged_request_sha256`, `trust_context_ref` /
`canonical_plane_encoding`, threshold metadata `m_code`/`n_code` and
`m_pol`/`n_pol`, nested registry or revocation row encoding, or
`permitted_profiles[]`. They exist only in the design specification
(`d017ac1` records the search). Do not add kernel machinery for them unless
one becomes an actual signed input here; then its byte formula must be
pinned at that boundary.

**The proof package** (full-tuple injectivity alone is necessary, NOT
sufficient — both council seats):
1. `effect_message_injective` — equal messages ⇒ equal (authority, full field
   tuple), under wire-width constraints; `verified_effect_injective`
   discharges the width constraints from the runtime checks, so for VERIFIED
   envelopes injectivity is unconditional.
2. Framing lemmas — `u64be_inj` (width-checked), `u64be_cancel`,
   `sized_cancel`, `frame_cancel`, `frame_inj`, `optEffect_inj`: every
   variable-width field is length-framed and append-injective; the option
   block is presence-byte-separated; no field can splice into another.
3. Advisory non-influence — `effect_step_presence_not_value` /
   `advisory_non_influence` / `allow_value_from_line_and_state`: the decision
   VALUE is `SealV2.decide e.line state` — a function of the judged line and
   the trusted config/state only. Envelope fields (the advisory claim
   included) gate only WHETHER a decision is produced, never WHICH bytes are
   allowed.
4. Gate theorems, one pair per binding, all fail-closed: F1 adapter, F2
   session (mandatory), F3 MCP effect-equality, F5 policy version
   (mandatory), expiry (mandatory), issuedAt freshness.
5. Cross-version + cross-plane separation — `effect_cross_version_v1_separated`
   (no `seal.effect/v1` receipt can verify under `seal.effect/v2`, nor vice
   versa — and the Stage B2 reshape rides the SAME v1→v2 bump: the tag has
   never shipped between shapes), `effect_cross_version_v22_separated`,
   `effect_cross_version_v21_separated`, `effect_cross_plane_separated`.

**Trusted, named, never proven (the crypto TCB at this seam)** — unchanged
from V2.2: `ed25519Verify` extern faithfulness; Ed25519 existential
unforgeability; nonce-freshness (A3, Rust seam); key custody / rotation /
revocation-by-re-sign; that the `authority` bytes threaded in ARE the config
trust root (pinned by construction at init, host-side); `state.now` honesty
(shared with M6).
-/

namespace SealV2.Effect

/-! ## Wire primitives: u64be and the length frame -/

/-- 8-byte big-endian encoding of a (u64-ranged) natural — fixed-width so the
    signed message framing is injective without separators. Same layout as the
    V2.2 `Host.u64be`; restated kernel-side because V2.3 makes the shape a
    kernel contract. -/
def u64be (n : Nat) : ByteArray :=
  ByteArray.mk #[
    UInt8.ofNat (n >>> 56), UInt8.ofNat (n >>> 48), UInt8.ofNat (n >>> 40),
    UInt8.ofNat (n >>> 32), UInt8.ofNat (n >>> 24), UInt8.ofNat (n >>> 16),
    UInt8.ofNat (n >>> 8), UInt8.ofNat n]

theorem u64be_size (n : Nat) : (u64be n).size = 8 := rfl

/-- The one wire formula for an absolute V2 time:

    `unixSecondsBE(t) = uint64_be(seconds_since_1970-01-01T00:00:00Z)`.

    `UnixSeconds` fixes both the Unix epoch and the whole-second unit;
    `u64be` fixes the eight-byte width and big-endian order. This wrapper is
    definitionally byte-identical to the previously shipped `u64be` call. -/
def unixSecondsBE (t : UnixSeconds) : ByteArray :=
  u64be t

/-- `u64be` is injective below `2^64` (the wire range). The framing lemma every
    length prefix stands on. -/
theorem u64be_inj {n m : Nat} (hn : n < 2 ^ 64) (hm : m < 2 ^ 64)
    (h : u64be n = u64be m) : n = m := by
  have hl : [UInt8.ofNat (n >>> 56), UInt8.ofNat (n >>> 48), UInt8.ofNat (n >>> 40),
      UInt8.ofNat (n >>> 32), UInt8.ofNat (n >>> 24), UInt8.ofNat (n >>> 16),
      UInt8.ofNat (n >>> 8), UInt8.ofNat n]
      = [UInt8.ofNat (m >>> 56), UInt8.ofNat (m >>> 48), UInt8.ofNat (m >>> 40),
      UInt8.ofNat (m >>> 32), UInt8.ofNat (m >>> 24), UInt8.ofNat (m >>> 16),
      UInt8.ofNat (m >>> 8), UInt8.ofNat m] :=
    congrArg (fun b : ByteArray => b.data.toList) h
  simp only [List.cons.injEq, and_true] at hl
  obtain ⟨h7, h6, h5, h4, h3, h2, h1, h0⟩ := hl
  have e7 := congrArg UInt8.toNat h7
  have e6 := congrArg UInt8.toNat h6
  have e5 := congrArg UInt8.toNat h5
  have e4 := congrArg UInt8.toNat h4
  have e3 := congrArg UInt8.toNat h3
  have e2 := congrArg UInt8.toNat h2
  have e1 := congrArg UInt8.toNat h1
  have e0 := congrArg UInt8.toNat h0
  simp only [UInt8.toNat_ofNat', Nat.shiftRight_eq_div_pow] at e7 e6 e5 e4 e3 e2 e1 e0
  omega

/-- Unix-second timestamps have an injective wire encoding throughout the
    verifier-enforced unsigned-64-bit range. -/
theorem unixSecondsBE_inj {t₁ t₂ : UnixSeconds}
    (h₁ : t₁ < 2 ^ 64) (h₂ : t₂ < 2 ^ 64)
    (h : unixSecondsBE t₁ = unixSecondsBE t₂) : t₁ = t₂ :=
  u64be_inj h₁ h₂ h

/-- Negative control: interpreting the same logical instant as `1` Unix
    second or as `1000` Unix milliseconds cannot silently produce the same
    signed bytes under the pinned seconds formula. -/
theorem unixSeconds_vs_milliseconds_negative_control :
    unixSecondsBE 1 ≠ unixSecondsBE 1000 := by decide

/- Evaluated negative-control output:
   `([0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 3, 232])`. -/
#eval ((unixSecondsBE 1).data.toList, (unixSecondsBE 1000).data.toList)

/-- One variable-width field on the wire: `u64be(byte length) ‖ UTF-8 bytes`. -/
def frame (s : String) : ByteArray :=
  u64be s.utf8ByteSize ++ s.toUTF8

/-! ## Framing cancellation lemmas — the anti-splice kit

Each lemma peels ONE field off the front of an equal pair of messages and
returns the field equality plus the equality of the remainders. Missing one
variable-width field's frame is exactly the splice the council flagged; the
kit makes every field's peel explicit. -/

/-- Fixed-width peel: equal-size prefixes cancel. -/
theorem sized_cancel {k : Nat} {a₁ a₂ r₁ r₂ : ByteArray}
    (h₁ : a₁.size = k) (h₂ : a₂.size = k)
    (h : a₁ ++ r₁ = a₂ ++ r₂) : a₁ = a₂ ∧ r₁ = r₂ := by
  have ha : a₁ = a₂ := ByteArray.append_inj_left h (h₁.trans h₂.symm)
  rw [ha, ByteArray.append_right_inj] at h
  exact ⟨ha, h⟩

/-- u64be peel: the 8-byte prefix cancels and the values agree (wire range). -/
theorem u64be_cancel {n₁ n₂ : Nat} {r₁ r₂ : ByteArray}
    (h₁ : n₁ < 2 ^ 64) (h₂ : n₂ < 2 ^ 64)
    (h : u64be n₁ ++ r₁ = u64be n₂ ++ r₂) : n₁ = n₂ ∧ r₁ = r₂ := by
  have hb : u64be n₁ = u64be n₂ := ByteArray.append_inj_left h rfl
  have hn : n₁ = n₂ := u64be_inj h₁ h₂ hb
  rw [hb, ByteArray.append_right_inj] at h
  exact ⟨hn, h⟩

/-- Variable-width peel: a length-framed field cancels — the length prefixes
    agree (u64be injectivity), so the field bytes split at the same boundary,
    so the fields agree (UTF-8 injectivity) and the remainders agree. THE
    anti-splice lemma: no tail of one field can leak into the next. -/
theorem frame_cancel {s₁ s₂ : String} {r₁ r₂ : ByteArray}
    (h₁ : s₁.utf8ByteSize < 2 ^ 64) (h₂ : s₂.utf8ByteSize < 2 ^ 64)
    (h : frame s₁ ++ r₁ = frame s₂ ++ r₂) : s₁ = s₂ ∧ r₁ = r₂ := by
  unfold frame at h
  simp only [ByteArray.append_assoc] at h
  obtain ⟨hsz, h⟩ := u64be_cancel h₁ h₂ h
  have hu : s₁.toUTF8 = s₂.toUTF8 := ByteArray.append_inj_left h (by
    simpa [String.toUTF8_eq_toByteArray, String.size_toByteArray] using hsz)
  rw [hu, ByteArray.append_right_inj] at h
  refine ⟨?_, h⟩
  simpa [String.toUTF8_eq_toByteArray, String.toByteArray_inj] using hu

/-- Terminal-field peel: equal frames with NOTHING after them force equal
    strings — `frame_cancel` specialized to empty remainders, for the last
    field of the message. -/
theorem frame_inj {s₁ s₂ : String}
    (h₁ : s₁.utf8ByteSize < 2 ^ 64) (h₂ : s₂.utf8ByteSize < 2 ^ 64)
    (h : frame s₁ = frame s₂) : s₁ = s₂ :=
  (frame_cancel h₁ h₂ (congrArg (· ++ ByteArray.empty) h)).1

/-! ## Domain tags -/

/-- Domain-separation tag for Stage B effect envelopes: `seal.effect/v2`.
    The v1→v2 bump IS the strip: `seal.effect/v1` signed fields this layout
    no longer carries, so a tag bump is mandatory — otherwise one byte
    string could be a valid v1 message and a valid stripped message with
    different semantics. The Stage B2 reconciliation (rescues, the
    revocation-subject strip, the option-encoded F3 claim, the mandatory
    bindings) rides the SAME bump: the v2 tag has never shipped between
    shapes, so one repin covers every Stage B shape change. Distinct from
    the retired `effectTagV1` at byte 13 (`'2'` vs `'1'`), from both retired
    principal-envelope tags at byte 4 (`.` vs `/`), and from every
    canonical-JSON plane at byte 0 (`s` vs `{`). The trailing NUL terminates
    the tag unambiguously.

    NOT in this lineage: the Stage A commitment preimage tag
    `seal.effect/v3` (`Seal.effectDomainTag`). That string is part 0 of a
    NETSTRING-framed hash preimage — on the wire it only ever appears inside
    `encodeParts` output, which begins with an ASCII digit and carries no
    NUL — never as a raw signed-message prefix. The two planes are
    byte-separated at offset 0; the version numbers are lineage-local. -/
def effectTag : String := "seal.effect/v2\x00"

/-- The RETIRED Stage A/`bf01363f` envelope tag. SPEC-ONLY: kept so the
    v1→v2 cross-version separation is a theorem, not a changelog note. Every
    retired-layout message is `effectTagV1.toUTF8 ++ rest` for some `rest`,
    so `effect_cross_version_v1_separated` covers the entire retired layout
    without restating its 18-field shape. -/
def effectTagV1 : String := "seal.effect/v1\x00"

/-- The RETIRED V2.2 tag. SPEC-ONLY: kept so cross-version separation is a
    theorem, not a changelog note. -/
def envelopeTagV22 : String := "seal/v2.2/principal-envelope\x00"

/-- The RETIRED V2.1 tag. SPEC-ONLY, same purpose. -/
def envelopeTagV21 : String := "seal/v2.1/principal-envelope\x00"

/-! ## The envelope and its message bytes -/

/-- The F3 advisory effect claim — what the client BELIEVES the judged line
    does. Never the decision input; a PRESENT claim is equality-checked
    against the parser-derived effect (`effectGate`) and blocks on mismatch.
    Grouped as one structure so presence is all-or-nothing: there is no
    "resource claimed, action unclaimed" state to reason about. -/
structure EffectClaim where
  resource : String
  action : String
  args : String
  /-- Complete validated request `_meta`, including explicit absence. -/
  metadata : MetaValue
  /-- Complete opaque MCP request state, including structural absence. -/
  requestState : RequestState := .absent
  /-- Complete MCP input responses, including structural absence. -/
  inputResponses : InputResponses := .absent
  deriving Repr, BEq, DecidableEq, ReflBEq, LawfulBEq

/-- The Stage B2 effect envelope — every field both authenticated AND
    interpreted; the killed seats (E1★ plus the Stage B2 revocation-subject
    strip) are STRIPPED from the structure, so a killed field cannot even be
    expressed, let alone signed. Raw request fields exactly as marshalled;
    only `verifyEffect` gives them meaning. `authority` is NOT a field: it
    is the config trust root, threaded in by the session (never request
    data). -/
structure EffectEnvelope where
  /-- Wire-claimed registry id (Fix B bind). -/
  keyId : String
  /-- 32 raw bytes (width enforced by `verifyEffect`). -/
  nonce : ByteArray
  /-- Unit and epoch are carried by the `UnixSeconds` type itself (declared in
      `SealV2/Validation.lean`). Recorded here because the type alone does not
      say why it is load-bearing: `u64be` already fixed the WIDTH and the
      ENDIANNESS of these fields, but not their MEANING, so two conforming
      verifiers reading the same signed bytes as seconds and as milliseconds
      would both accept and silently disagree. Changing the epoch or the unit
      is a signed-format repin, not a refactor. -/
  issuedAt : UnixSeconds
  /-- MANDATORY nonzero signer-declared deadline (`expiryGate`). -/
  expiresAt : UnixSeconds
  /-- THE judged line, bound BY VALUE (non-negotiable). -/
  line : String
  /-- F1: the adapter the client believes is mediating. -/
  adapterType : String
  adapterVersion : String
  /-- F2: session plane, MANDATORY equality with the boot/config session. -/
  session : String
  /-- F5: policy version, MANDATORY equality — the anti-downgrade pin. -/
  policyVersion : String
  /-- F3 (advisory, INTERPRETED — separate flagged strip decision):
      `none` = declared absent (signed presence byte), `some` = checked. -/
  effect : Option EffectClaim
  deriving BEq

/-- Wire form of the metadata value inside a present effect claim. -/
def optMeta : MetaValue → ByteArray
  | .absent => ByteArray.mk #[0]
  | .present canonicalObject => ByteArray.mk #[1] ++ frame canonicalObject

/-- Compatibility-preserving MRTR block. The legacy all-absent shape remains
    empty until the coordinated Phase-M repin. Every other structural shape
    has a distinct mode byte, followed by length-framed complete canonical
    JSON values:

    * `0x01 ‖ frame(requestState)` — state present, responses absent;
    * `0x02 ‖ frame(inputResponses)` — state absent, responses present;
    * `0x03 ‖ frame(requestState) ‖ frame(inputResponses)` — both present.

    No JSON value is reserved as an absence sentinel. -/
def optMrtr : RequestState → InputResponses → ByteArray
  | .absent, .absent => ByteArray.empty
  | .present state, .absent => ByteArray.mk #[1] ++ frame state
  | .absent, .present responses => ByteArray.mk #[2] ++ frame responses
  | .present state, .present responses =>
      ByteArray.mk #[3] ++ frame state ++ frame responses

/-- Wire form of the option-encoded F3 claim: `0x00` = declared absent;
    `0x01 ‖ frame(resource) ‖ frame(action) ‖ frame(args) ‖ optMeta(metadata)
      ‖ optMrtr(requestState,inputResponses)`
    = present. The
    presence byte is INSIDE the signed message: absence is a distinct signed
    value, not an inference from empty strings, and flipping presence is a
    forgery (`optEffect_inj`). -/
def optEffect : Option EffectClaim → ByteArray
  | none => ByteArray.mk #[0]
  | some c => ByteArray.mk #[1] ++ frame c.resource ++ frame c.action
      ++ frame c.args ++ optMeta c.metadata
      ++ optMrtr c.requestState c.inputResponses

/-- **The canonical signed message** — the cross-language contract:

        tag ‖ authority(32) ‖ frame(keyId) ‖ nonce(32)
            ‖ u64be(issuedAt) ‖ u64be(expiresAt)
            ‖ frame(line)
            ‖ frame(adapterType) ‖ frame(adapterVersion)
            ‖ frame(session) ‖ frame(policyVersion)
            ‖ optEffect(effect)

    with `frame(s) = u64be(|s| in UTF-8 bytes) ‖ s-bytes`. Every field is
    fixed-width, length-framed, or presence-byte-discriminated, so the
    encoding is injective in the FULL tuple (`effect_message_injective`);
    no separate digest needed (Ed25519 hashes internally). -/
def effectMessage (authority : ByteArray) (e : EffectEnvelope) : ByteArray :=
  effectTag.toUTF8 ++ authority
    ++ frame e.keyId ++ e.nonce
    ++ unixSecondsBE e.issuedAt ++ unixSecondsBE e.expiresAt
    ++ frame e.line
    ++ frame e.adapterType ++ frame e.adapterVersion
    ++ frame e.session ++ frame e.policyVersion
    ++ optEffect e.effect

/-- The RETIRED V2.2 message layout (spec-only; layout frozen in
    `Host/Principal.lean`), kept so cross-version separation is a theorem. -/
def envelopeMessageV22 (authority : ByteArray) (keyId : String)
    (nonce : ByteArray) (issuedAt : Nat) (line : String) : ByteArray :=
  envelopeTagV22.toUTF8 ++ authority ++ u64be keyId.utf8ByteSize ++ keyId.toUTF8
    ++ nonce ++ u64be issuedAt ++ line.toUTF8

/-- The RETIRED V2.1 message layout (spec-only). -/
def envelopeMessageV21 (nonce : ByteArray) (issuedAt : Nat) (line : String) :
    ByteArray :=
  envelopeTagV21.toUTF8 ++ nonce ++ u64be issuedAt ++ line.toUTF8

/-! ## Wire-width constraints -/

/-- The wire-range side conditions injectivity needs: nonce fixed at 32,
    every u64be argument (lengths, issuedAt, expiresAt) in u64 range.
    `verifyEffect` CHECKS all of these at runtime (`wireSizedB`), so verified
    envelopes satisfy them by theorem (`verifyEffect_wireSized`). -/
structure WireSized (e : EffectEnvelope) : Prop where
  nonce32 : e.nonce.size = 32
  keyId : e.keyId.utf8ByteSize < 2 ^ 64
  issuedAt : e.issuedAt < 2 ^ 64
  expiresAt : e.expiresAt < 2 ^ 64
  line : e.line.utf8ByteSize < 2 ^ 64
  adapterType : e.adapterType.utf8ByteSize < 2 ^ 64
  adapterVersion : e.adapterVersion.utf8ByteSize < 2 ^ 64
  session : e.session.utf8ByteSize < 2 ^ 64
  policyVersion : e.policyVersion.utf8ByteSize < 2 ^ 64
  effect : ∀ c, e.effect = some c →
    c.resource.utf8ByteSize < 2 ^ 64 ∧ c.action.utf8ByteSize < 2 ^ 64
      ∧ c.args.utf8ByteSize < 2 ^ 64
      ∧ (match c.metadata with
         | .absent => True
         | .present canonicalObject => canonicalObject.utf8ByteSize < 2 ^ 64)
      ∧ (match c.requestState with
         | .absent => True
         | .present canonicalValue => canonicalValue.utf8ByteSize < 2 ^ 64)
      ∧ (match c.inputResponses with
         | .absent => True
         | .present canonicalValue => canonicalValue.utf8ByteSize < 2 ^ 64)

/-- Decidable form of `WireSized`, checked by `verifyEffect` at runtime. -/
def wireSizedB (e : EffectEnvelope) : Bool :=
  (e.nonce.size == 32)
    && Decidable.decide (e.keyId.utf8ByteSize < 2 ^ 64)
    && Decidable.decide (e.issuedAt < 2 ^ 64)
    && Decidable.decide (e.expiresAt < 2 ^ 64)
    && Decidable.decide (e.line.utf8ByteSize < 2 ^ 64)
    && Decidable.decide (e.adapterType.utf8ByteSize < 2 ^ 64)
    && Decidable.decide (e.adapterVersion.utf8ByteSize < 2 ^ 64)
    && Decidable.decide (e.session.utf8ByteSize < 2 ^ 64)
    && Decidable.decide (e.policyVersion.utf8ByteSize < 2 ^ 64)
    && (match e.effect with
        | none => true
        | some c =>
            Decidable.decide (c.resource.utf8ByteSize < 2 ^ 64)
              && Decidable.decide (c.action.utf8ByteSize < 2 ^ 64)
              && Decidable.decide (c.args.utf8ByteSize < 2 ^ 64)
              && (match c.metadata with
                  | .absent => true
                  | .present canonicalObject =>
                      Decidable.decide (canonicalObject.utf8ByteSize < 2 ^ 64))
              && (match c.requestState with
                  | .absent => true
                  | .present canonicalValue =>
                      Decidable.decide (canonicalValue.utf8ByteSize < 2 ^ 64))
              && (match c.inputResponses with
                  | .absent => true
                  | .present canonicalValue =>
                      Decidable.decide (canonicalValue.utf8ByteSize < 2 ^ 64)))

theorem wireSizedB_spec {e : EffectEnvelope} (h : wireSizedB e = true) :
    WireSized e := by
  unfold wireSizedB at h
  simp only [Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at h
  obtain ⟨⟨⟨⟨⟨⟨⟨⟨⟨h0, h1⟩, h2⟩, h3⟩, h4⟩, h5⟩, h6⟩, h7⟩, h8⟩, heff⟩ := h
  refine ⟨h0, h1, h2, h3, h4, h5, h6, h7, h8, ?_⟩
  intro c hc
  rw [hc] at heff
  simp only [Bool.and_eq_true, decide_eq_true_eq] at heff
  refine ⟨heff.1.1.1.1.1, heff.1.1.1.1.2, heff.1.1.1.2,
    ?_, ?_, ?_⟩
  · cases hm : c.metadata <;> simp_all
  · cases hs : c.requestState <;> simp_all
  · cases hi : c.inputResponses <;> simp_all

/-! ## 1 + 2: full-tuple injectivity, by sequential peel -/

/-- Two byte strings with a distinguishing byte inside both prefixes never
    agree, whatever the tails — the one-lemma core of every separation
    theorem below (and of the option block's presence discrimination). -/
theorem prefix_byte_separated {p₁ p₂ : ByteArray} {i : Nat}
    (hi₁ : i < p₁.size) (hi₂ : i < p₂.size)
    (hne : p₁[i]'hi₁ ≠ p₂[i]'hi₂) :
    ∀ r₁ r₂ : ByteArray, p₁ ++ r₁ ≠ p₂ ++ r₂ := by
  intro r₁ r₂ h
  apply hne
  have hL : i < (p₁ ++ r₁).size := by
    rw [ByteArray.size_append]; omega
  have hR : i < (p₂ ++ r₂).size := by
    rw [ByteArray.size_append]; omega
  calc p₁[i]'hi₁ = (p₁ ++ r₁)[i]'hL := (ByteArray.getElem_append_left hi₁).symm
    _ = (p₂ ++ r₂)[i]'hR := by simp only [h]
    _ = p₂[i]'hi₂ := ByteArray.getElem_append_left hi₂

/-- The metadata block is injective: absence and presence have distinct first
    bytes, and a present complete canonical object is length-framed. -/
theorem optMeta_inj {m₁ m₂ : MetaValue}
    (h₁ : match m₁ with
      | .absent => True
      | .present canonicalObject => canonicalObject.utf8ByteSize < 2 ^ 64)
    (h₂ : match m₂ with
      | .absent => True
      | .present canonicalObject => canonicalObject.utf8ByteSize < 2 ^ 64)
    (h : optMeta m₁ = optMeta m₂) : m₁ = m₂ := by
  match m₁, m₂ with
  | .absent, .absent => rfl
  | .absent, .present value =>
      exfalso
      have h' := congrArg (· ++ ByteArray.empty) h
      simp only [optMeta, ByteArray.append_assoc] at h'
      exact prefix_byte_separated (i := 0)
        (p₁ := ByteArray.mk #[0]) (p₂ := ByteArray.mk #[1])
        (by decide) (by decide) (by decide) _ _ h'
  | .present value, .absent =>
      exfalso
      have h' := congrArg (· ++ ByteArray.empty) h.symm
      simp only [optMeta, ByteArray.append_assoc] at h'
      exact prefix_byte_separated (i := 0)
        (p₁ := ByteArray.mk #[0]) (p₂ := ByteArray.mk #[1])
        (by decide) (by decide) (by decide) _ _ h'
  | .present value₁, .present value₂ =>
      have h' := congrArg (· ++ ByteArray.empty) h
      simp only [optMeta, ByteArray.append_assoc] at h'
      rw [ByteArray.append_right_inj] at h'
      obtain ⟨hvalue, _⟩ := frame_cancel h₁ h₂ h'
      cases hvalue
      rfl

private theorem empty_ne_tagged (tag : UInt8) (tail : ByteArray) :
    ByteArray.empty ≠ ByteArray.mk #[tag] ++ tail := by
  intro h
  have hs := congrArg ByteArray.size h
  have hempty : ByteArray.empty.size = 0 := rfl
  have htag : (ByteArray.mk #[tag]).size = 1 := rfl
  rw [hempty, ByteArray.size_append, htag] at hs
  omega

private theorem tagged_cancel {tag₁ tag₂ : UInt8} {tail₁ tail₂ : ByteArray}
    (h : ByteArray.mk #[tag₁] ++ tail₁ =
      ByteArray.mk #[tag₂] ++ tail₂) :
    tag₁ = tag₂ ∧ tail₁ = tail₂ := by
  obtain ⟨htag, htail⟩ := sized_cancel (k := 1) rfl rfl h
  have htag' := congrArg (fun b : ByteArray => b[0]!) htag
  simpa using ⟨htag', htail⟩

/-- The MRTR block is jointly injective. Its mode byte distinguishes all four
    presence combinations; present payloads are complete length-framed
    canonical JSON values. -/
theorem optMrtr_inj {s₁ s₂ : RequestState} {i₁ i₂ : InputResponses}
    (hs₁ : match s₁ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hs₂ : match s₂ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hi₁ : match i₁ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hi₂ : match i₂ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (h : optMrtr s₁ i₁ = optMrtr s₂ i₂) :
    s₁ = s₂ ∧ i₁ = i₂ := by
  match s₁, i₁, s₂, i₂ with
  | .absent, .absent, .absent, .absent => exact ⟨rfl, rfl⟩
  | .present left, .absent, .present right, .absent =>
      have h' : frame left = frame right :=
        by simpa [optMrtr] using h
      have hv := frame_inj hs₁ hs₂ h'
      exact ⟨by cases hv; rfl, rfl⟩
  | .absent, .present left, .absent, .present right =>
      have h' : frame left = frame right :=
        by simpa [optMrtr] using h
      have hv := frame_inj hi₁ hi₂ h'
      exact ⟨rfl, by cases hv; rfl⟩
  | .present state₁, .present responses₁,
      .present state₂, .present responses₂ =>
      have h' : frame state₁ ++ frame responses₁ =
          frame state₂ ++ frame responses₂ :=
        by simpa [optMrtr, ByteArray.append_assoc] using h
      obtain ⟨hstate, hresponsesFrame⟩ :=
        frame_cancel hs₁ hs₂ h'
      have hresponses := frame_inj hi₁ hi₂ hresponsesFrame
      exact ⟨by cases hstate; rfl, by cases hresponses; rfl⟩
  | .absent, .absent, .present value, .absent =>
      exact absurd h (empty_ne_tagged 1 (frame value))
  | .absent, .absent, .absent, .present value =>
      exact absurd h (empty_ne_tagged 2 (frame value))
  | .absent, .absent, .present state, .present responses =>
      exact absurd h (empty_ne_tagged 3 (frame state ++ frame responses))
  | .present value, .absent, .absent, .absent =>
      exact absurd h.symm (empty_ne_tagged 1 (frame value))
  | .absent, .present value, .absent, .absent =>
      exact absurd h.symm (empty_ne_tagged 2 (frame value))
  | .present state, .present responses, .absent, .absent =>
      exact absurd h.symm (empty_ne_tagged 3 (frame state ++ frame responses))
  | .present _, .absent, .absent, .present _
  | .present _, .absent, .present _, .present _
  | .absent, .present _, .present _, .absent
  | .absent, .present _, .present _, .present _
  | .present _, .present _, .present _, .absent
  | .present _, .present _, .absent, .present _ =>
      have htag := (tagged_cancel (by
        simpa [optMrtr, ByteArray.append_assoc] using h)).1
      contradiction

theorem optMrtr_requestState_absent_ne_present
    (inputResponses : InputResponses) (canonicalValue : CanonicalBytes) :
    optMrtr .absent inputResponses ≠
      optMrtr (.present canonicalValue) inputResponses := by
  cases inputResponses with
  | absent =>
      exact empty_ne_tagged 1 (frame canonicalValue)
  | present responses =>
      intro h
      have htag := (tagged_cancel (by
        simpa [optMrtr, ByteArray.append_assoc] using h)).1
      contradiction

theorem optMrtr_inputResponses_absent_ne_present
    (requestState : RequestState) (canonicalValue : CanonicalBytes) :
    optMrtr requestState .absent ≠
      optMrtr requestState (.present canonicalValue) := by
  cases requestState with
  | absent =>
      exact empty_ne_tagged 2 (frame canonicalValue)
  | present state =>
      intro h
      have htag := (tagged_cancel (by
        simpa [optMrtr, ByteArray.append_assoc] using h)).1
      contradiction

/-- Metadata followed by MRTR is jointly injective, including every structural
    absence/presence boundary. -/
theorem optMetaMrtr_inj {m₁ m₂ : MetaValue}
    {s₁ s₂ : RequestState} {i₁ i₂ : InputResponses}
    (hm₁ : match m₁ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hm₂ : match m₂ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hs₁ : match s₁ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hs₂ : match s₂ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hi₁ : match i₁ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (hi₂ : match i₂ with
      | .absent => True
      | .present value => value.utf8ByteSize < 2 ^ 64)
    (h : optMeta m₁ ++ optMrtr s₁ i₁ =
      optMeta m₂ ++ optMrtr s₂ i₂) :
    m₁ = m₂ ∧ s₁ = s₂ ∧ i₁ = i₂ := by
  match m₁, m₂ with
  | .absent, .absent =>
      have hmrtr : optMrtr s₁ i₁ = optMrtr s₂ i₂ :=
        by simpa [optMeta, ByteArray.append_assoc] using h
      obtain ⟨hs, hi⟩ := optMrtr_inj hs₁ hs₂ hi₁ hi₂ hmrtr
      exact ⟨rfl, hs, hi⟩
  | .present left, .present right =>
      have h' : frame left ++ optMrtr s₁ i₁ =
          frame right ++ optMrtr s₂ i₂ :=
        by simpa [optMeta, ByteArray.append_assoc] using h
      obtain ⟨hm, hmrtr⟩ := frame_cancel hm₁ hm₂ h'
      obtain ⟨hs, hi⟩ := optMrtr_inj hs₁ hs₂ hi₁ hi₂ hmrtr
      exact ⟨by cases hm; rfl, hs, hi⟩
  | .absent, .present _ | .present _, .absent =>
      have htag := (tagged_cancel (by
        simpa [optMeta, ByteArray.append_assoc] using h)).1
      contradiction

/-- The option block is injective: the signed presence byte separates
    `none` from `some` (0x00 vs 0x01 at offset 0), and present claims peel
    field-by-field like the rest of the message. Flipping presence, or any
    claim component, is a distinct signed message. -/
theorem optEffect_inj {o₁ o₂ : Option EffectClaim}
    (h₁ : ∀ c, o₁ = some c → c.resource.utf8ByteSize < 2 ^ 64
      ∧ c.action.utf8ByteSize < 2 ^ 64 ∧ c.args.utf8ByteSize < 2 ^ 64
      ∧ (match c.metadata with
         | .absent => True
         | .present canonicalObject => canonicalObject.utf8ByteSize < 2 ^ 64)
      ∧ (match c.requestState with
         | .absent => True
         | .present canonicalValue => canonicalValue.utf8ByteSize < 2 ^ 64)
      ∧ (match c.inputResponses with
         | .absent => True
         | .present canonicalValue => canonicalValue.utf8ByteSize < 2 ^ 64))
    (h₂ : ∀ c, o₂ = some c → c.resource.utf8ByteSize < 2 ^ 64
      ∧ c.action.utf8ByteSize < 2 ^ 64 ∧ c.args.utf8ByteSize < 2 ^ 64
      ∧ (match c.metadata with
         | .absent => True
         | .present canonicalObject => canonicalObject.utf8ByteSize < 2 ^ 64)
      ∧ (match c.requestState with
         | .absent => True
         | .present canonicalValue => canonicalValue.utf8ByteSize < 2 ^ 64)
      ∧ (match c.inputResponses with
         | .absent => True
         | .present canonicalValue => canonicalValue.utf8ByteSize < 2 ^ 64))
    (h : optEffect o₁ = optEffect o₂) : o₁ = o₂ := by
  match o₁, o₂ with
  | none, none => rfl
  | none, some c =>
      exfalso
      have h' := congrArg (· ++ ByteArray.empty) h
      simp only [optEffect, ByteArray.append_assoc] at h'
      exact prefix_byte_separated (i := 0)
        (p₁ := ByteArray.mk #[0]) (p₂ := ByteArray.mk #[1])
        (by decide) (by decide) (by decide) _ _ h'
  | some c, none =>
      exfalso
      have h' := congrArg (· ++ ByteArray.empty) h.symm
      simp only [optEffect, ByteArray.append_assoc] at h'
      exact prefix_byte_separated (i := 0)
        (p₁ := ByteArray.mk #[0]) (p₂ := ByteArray.mk #[1])
        (by decide) (by decide) (by decide) _ _ h'
  | some c₁, some c₂ =>
      obtain ⟨hr₁, ha₁, hg₁, hm₁, hs₁, hi₁⟩ := h₁ c₁ rfl
      obtain ⟨hr₂, ha₂, hg₂, hm₂, hs₂, hi₂⟩ := h₂ c₂ rfl
      have h' := congrArg (· ++ ByteArray.empty) h
      simp only [optEffect, ByteArray.append_assoc] at h'
      rw [ByteArray.append_right_inj] at h'
      obtain ⟨hres, h'⟩ := frame_cancel hr₁ hr₂ h'
      obtain ⟨hact, h'⟩ := frame_cancel ha₁ ha₂ h'
      obtain ⟨hargs, htail⟩ := frame_cancel hg₁ hg₂ h'
      have hmetaAndMrtr :
          optMeta c₁.metadata ++ optMrtr c₁.requestState c₁.inputResponses =
          optMeta c₂.metadata ++ optMrtr c₂.requestState c₂.inputResponses := by
        simpa using htail
      obtain ⟨hmetadata, hstate, hresponses⟩ :=
        optMetaMrtr_inj hm₁ hm₂ hs₁ hs₂ hi₁ hi₂ hmetaAndMrtr
      have hc : c₁ = c₂ := by
        cases c₁; cases c₂
        simp only [EffectClaim.mk.injEq]
        exact ⟨hres, hact, hargs, hmetadata, hstate, hresponses⟩
      rw [hc]

theorem optEffect_requestState_absent_ne_present
    (base : EffectClaim) (canonicalValue : CanonicalBytes) :
    optEffect (some { base with requestState := .absent }) ≠
      optEffect (some { base with requestState := .present canonicalValue }) := by
  intro h
  apply optMrtr_requestState_absent_ne_present base.inputResponses canonicalValue
  simpa [optEffect, ByteArray.append_assoc] using h

theorem optEffect_inputResponses_absent_ne_present
    (base : EffectClaim) (canonicalValue : CanonicalBytes) :
    optEffect (some { base with inputResponses := .absent }) ≠
      optEffect (some { base with inputResponses := .present canonicalValue }) := by
  intro h
  apply optMrtr_inputResponses_absent_ne_present base.requestState canonicalValue
  simpa [optEffect, ByteArray.append_assoc] using h

theorem effectMessage_requestState_absent_ne_present
    (authority : ByteArray) (base : EffectEnvelope) (claim : EffectClaim)
    (canonicalValue : CanonicalBytes) :
    effectMessage authority
        { base with effect := some { claim with requestState := .absent } } ≠
      effectMessage authority
        { base with effect := some {
          claim with requestState := .present canonicalValue } } := by
  intro h
  apply optEffect_requestState_absent_ne_present claim canonicalValue
  simpa [effectMessage, ByteArray.append_assoc] using h

theorem effectMessage_inputResponses_absent_ne_present
    (authority : ByteArray) (base : EffectEnvelope) (claim : EffectClaim)
    (canonicalValue : CanonicalBytes) :
    effectMessage authority
        { base with effect := some { claim with inputResponses := .absent } } ≠
      effectMessage authority
        { base with effect := some {
          claim with inputResponses := .present canonicalValue } } := by
  intro h
  apply optEffect_inputResponses_absent_ne_present claim canonicalValue
  simpa [effectMessage, ByteArray.append_assoc] using h

/-- **The Stage B2 bind, at the encoding.** Equal messages force equal
    authority AND an equal FULL field tuple — the `seal.effect/v1` theorem
    re-proven over the reconciled tuple, same strength. Each variable-width
    field is peeled by `frame_cancel` (the terminal option block by
    `optEffect_inj`); miss one and adjacent fields would splice — this proof
    is the machine-checked witness that none is missed. -/
theorem effect_message_injective {authority₁ authority₂ : ByteArray}
    {e₁ e₂ : EffectEnvelope}
    (ha₁ : authority₁.size = 32) (ha₂ : authority₂.size = 32)
    (hw₁ : WireSized e₁) (hw₂ : WireSized e₂)
    (h : effectMessage authority₁ e₁ = effectMessage authority₂ e₂) :
    authority₁ = authority₂ ∧ e₁ = e₂ := by
  unfold effectMessage at h
  simp only [ByteArray.append_assoc] at h
  rw [ByteArray.append_right_inj] at h
  obtain ⟨hauth, h⟩ := sized_cancel ha₁ ha₂ h
  obtain ⟨hkeyId, h⟩ := frame_cancel hw₁.keyId hw₂.keyId h
  obtain ⟨hnonce, h⟩ := sized_cancel hw₁.nonce32 hw₂.nonce32 h
  obtain ⟨hissuedAt, h⟩ := u64be_cancel hw₁.issuedAt hw₂.issuedAt h
  obtain ⟨hexpiresAt, h⟩ := u64be_cancel hw₁.expiresAt hw₂.expiresAt h
  obtain ⟨hline, h⟩ := frame_cancel hw₁.line hw₂.line h
  obtain ⟨hadapterType, h⟩ := frame_cancel hw₁.adapterType hw₂.adapterType h
  obtain ⟨hadapterVersion, h⟩ :=
    frame_cancel hw₁.adapterVersion hw₂.adapterVersion h
  obtain ⟨hsession, h⟩ := frame_cancel hw₁.session hw₂.session h
  obtain ⟨hpolicyVersion, h⟩ :=
    frame_cancel hw₁.policyVersion hw₂.policyVersion h
  have heffect : e₁.effect = e₂.effect :=
    optEffect_inj hw₁.effect hw₂.effect h
  refine ⟨hauth, ?_⟩
  cases e₁; cases e₂
  simp only [EffectEnvelope.mk.injEq]
  exact ⟨hkeyId, hnonce, hissuedAt, hexpiresAt, hline, hadapterType,
    hadapterVersion, hsession, hpolicyVersion, heffect⟩

/-! ## 5: cross-version + cross-plane domain separation -/

/-- **Cross-version separation, v2 vs v1 — the Stage B acceptance theorem.**
    No byte string is both a `seal.effect/v2` message and ANY
    `seal.effect/v1`-tagged byte string (the retired 18-field layout signed
    messages of exactly that form): the tags differ at byte 13 (`'2'` vs
    `'1'`). A receipt signed under the seated v1 layout can never verify as a
    Stage B2 envelope, nor vice versa, modulo only Ed25519 verifying the
    exact message bytes. Quantifying over an ARBITRARY tail makes this
    stronger than a layout-to-layout statement: every retired v1 message is
    an instance of `effectTagV1.toUTF8 ++ rest`. -/
theorem effect_cross_version_v1_separated (authority : ByteArray)
    (e : EffectEnvelope) (rest : ByteArray) :
    effectMessage authority e ≠ effectTagV1.toUTF8 ++ rest := by
  unfold effectMessage
  simp only [ByteArray.append_assoc]
  exact prefix_byte_separated (i := 13) (by decide) (by decide) (by decide) _ rest

/-- **Cross-version separation, V2.3 vs V2.2.** No byte string is both a
    `seal.effect/v2` message and a `seal/v2.2/principal-envelope` message:
    the tags differ at byte 4 (`.` vs `/`). A V2.2 principal signature can
    never verify as a V2.3 effect envelope, nor vice versa, modulo only
    Ed25519 verifying the exact message bytes. -/
theorem effect_cross_version_v22_separated (authority : ByteArray)
    (e : EffectEnvelope) (a' : ByteArray) (k' : String) (n' : ByteArray)
    (t' : Nat) (l' : String) :
    effectMessage authority e ≠ envelopeMessageV22 a' k' n' t' l' := by
  unfold effectMessage envelopeMessageV22
  simp only [ByteArray.append_assoc]
  exact prefix_byte_separated (i := 4) (by decide) (by decide) (by decide) _ _

/-- **Cross-version separation, V2.3 vs V2.1.** Same distinguishing byte. -/
theorem effect_cross_version_v21_separated (authority : ByteArray)
    (e : EffectEnvelope) (n' : ByteArray) (t' : Nat) (l' : String) :
    effectMessage authority e ≠ envelopeMessageV21 n' t' l' := by
  unfold effectMessage envelopeMessageV21
  simp only [ByteArray.append_assoc]
  exact prefix_byte_separated (i := 4) (by decide) (by decide) (by decide) _ _

/-- **Cross-plane separation.** Every canonical-JSON plane signs bytes that
    begin with `{` (0x7b): the config plane (raw canonical payload) AND the
    V2 approval plane (`signedMessageRaw`, a canonical JSON object). An
    effect-envelope message begins with the tag byte `s` (0x73). So no byte
    string is both — an effect signature can never double as a config or
    approval signature, or vice versa. (The Stage A commitment preimage plane
    is separated the same way: `encodeParts` output begins with an ASCII
    digit, never `s`.) -/
theorem effect_cross_plane_separated (authority : ByteArray)
    (e : EffectEnvelope) (rest : ByteArray) :
    effectMessage authority e ≠ "{".toUTF8 ++ rest := by
  unfold effectMessage
  simp only [ByteArray.append_assoc]
  exact prefix_byte_separated (i := 0) (by decide) (by decide) (by decide) _ rest

/-! ## The verifier: registry, widths, signature — fail-closed -/

/-- One registered principal (id, Ed25519 verifying-key hex). The registry
    rides INSIDE the signed config — out-of-band trust, never request data.
    Kernel-side twin of `Host.PrincipalKey`. -/
structure PrincipalKey where
  id : String
  pubkey : String
  deriving Repr, BEq

abbrev PrincipalRegistry := List PrincipalKey

/-- The authenticated caller id. Private constructor: the sole producer in
    this module is `verifyEffect` — observation is free, construction is not
    (same discipline as `Host.AuthenticatedPrincipal`). -/
structure AuthenticatedId where
  private mk ::
  id : String
  deriving Repr, BEq, DecidableEq

/-- Exported because the constructor is private. -/
theorem AuthenticatedId.ext_id {p q : AuthenticatedId} (h : p.id = q.id) :
    p = q := by
  cases p; cases q; simpa using h

/-- **The sole smart constructor.** Fail-closed `none` on: unregistered keyId,
    malformed hex (key or sig), authority/pubkey width, ANY wire-width check
    (`wireSizedB` — nonce 32, every u64be argument in range), or verification
    failure. `some ⟨k.id⟩` ONLY when the registered key verifies the signature
    over `effectMessage authority e` — the full Stage B2 tuple. The extern
    result is only ever cased on as an opaque `Bool` (crypto TCB). -/
def verifyEffect (authority : ByteArray) (reg : PrincipalRegistry)
    (e : EffectEnvelope) (sigHex : String) : Option AuthenticatedId :=
  match reg.find? (fun k => k.id == e.keyId) with
  | none => none
  | some k =>
      match hexDecode? k.pubkey, hexDecode? sigHex with
      | some pk, some sig =>
          if authority.size == 32 && pk.size == 32 && wireSizedB e
              && ed25519Verify pk (effectMessage authority e) sig
          then some ⟨k.id⟩ else none
      | _, _ => none

/-- Verified envelopes satisfy every wire-width constraint: the runtime checks
    discharge the injectivity side conditions. -/
theorem verifyEffect_wireSized {authority : ByteArray}
    {reg : PrincipalRegistry} {e : EffectEnvelope} {sigHex : String}
    {p : AuthenticatedId}
    (h : verifyEffect authority reg e sigHex = some p) :
    authority.size = 32 ∧ WireSized e := by
  unfold verifyEffect at h
  split at h
  · cases h
  · split at h
    · split at h
      · next hcond =>
          simp only [Bool.and_eq_true, beq_iff_eq] at hcond
          exact ⟨hcond.1.1.1, wireSizedB_spec hcond.1.2⟩
      · cases h
    · cases h

/-- **Injectivity, unconditionally, for anything that verifies.** Two verified
    envelopes with equal message bytes are equal in authority and in the FULL
    field tuple — no width side conditions left: `verifyEffect` checked them.
    With Ed25519 verifying exact message bytes (TCB), one signature can only
    ever speak for ONE tuple. -/
theorem verified_effect_injective {authority₁ authority₂ : ByteArray}
    {reg₁ reg₂ : PrincipalRegistry} {e₁ e₂ : EffectEnvelope}
    {sig₁ sig₂ : String} {p₁ p₂ : AuthenticatedId}
    (h₁ : verifyEffect authority₁ reg₁ e₁ sig₁ = some p₁)
    (h₂ : verifyEffect authority₂ reg₂ e₂ sig₂ = some p₂)
    (hmsg : effectMessage authority₁ e₁ = effectMessage authority₂ e₂) :
    authority₁ = authority₂ ∧ e₁ = e₂ :=
  have hw₁ := verifyEffect_wireSized h₁
  have hw₂ := verifyEffect_wireSized h₂
  effect_message_injective hw₁.1 hw₂.1 hw₁.2 hw₂.2 hmsg

/-- **The envelope gates PRESENCE, never VALUE** (V2.2 idiom, V2.3 surface):
    whenever `verifyEffect` returns `some p`, `p.id` is the registry entry the
    keyId selected — a function of the config registry and the keyId lookup
    ONLY. Every other envelope field decides only whether `some` appears. -/
theorem effect_gates_presence_not_value (authority : ByteArray)
    (reg : PrincipalRegistry) (e : EffectEnvelope) (sigHex : String)
    (p : AuthenticatedId)
    (h : verifyEffect authority reg e sigHex = some p) :
    ∃ k, reg.find? (fun k => k.id == e.keyId) = some k ∧ p.id = k.id := by
  unfold verifyEffect at h
  split at h
  · cases h
  · next k hf =>
      refine ⟨k, hf, ?_⟩
      split at h
      · split at h
        · injection h with h
          subst h
          rfl
        · cases h
      · cases h

/-- Fail-closed: an unregistered keyId yields `none`. -/
theorem verifyEffect_none_of_unregistered (authority : ByteArray)
    (reg : PrincipalRegistry) (e : EffectEnvelope) (sigHex : String)
    (h : reg.find? (fun k => k.id == e.keyId) = none) :
    verifyEffect authority reg e sigHex = none := by
  unfold verifyEffect
  rw [h]

/-- Registry closure: every produced id is a registered id. -/
theorem verifyEffect_id_registered (authority : ByteArray)
    (reg : PrincipalRegistry) (e : EffectEnvelope) (sigHex : String)
    (p : AuthenticatedId)
    (h : verifyEffect authority reg e sigHex = some p) :
    ∃ k ∈ reg, k.id = p.id := by
  obtain ⟨k, hf, hid⟩ :=
    effect_gates_presence_not_value authority reg e sigHex p h
  exact ⟨k, List.mem_of_find?_eq_some hf, hid.symm⟩

/-! ## 3 + 4: the judgment pipeline and its gates

`effectStep` is the V2.3 judgment spec the host binds to at repin: verify the
envelope, equality-check the host-known facts (mediating adapter, boot/config
session, policy version, clocks, parser-derived effect), then judge the LINE
with the verified kernel. The gates are equality/window checks against
TRUSTED values; none of them ever substitutes a client-signed value into the
judgment. Honest `state.now` is a standing host obligation — the same class
as the mediator identity (F1) and the boot/config session (F2).
`issuedAtGate` reuses `state.maxApprovalTtl` as the envelope freshness
window (a documented reuse, not a new config knob). -/

/-- The adapter identity the HOST knows actually mediated this call — a
    trusted input (deployment fact), never request data. -/
structure AdapterId where
  type : String
  version : String
  deriving Repr, BEq, DecidableEq

/-- The adapter type whose effect derivation this kernel defines. -/
def mcpAdapterType : String := "mcp"

/-! ### M.2/M.2a: discovery set, scalar signed fact

The complete supported capability is a duplicate-free set projected into
`server/discover`. It is never an `EffectEnvelope` field. The envelope keeps
one scalar `adapterVersion`, obtained from the received entry-call shape that
selected the semantics for this child session.

M.7 owns validation of `protocolVersion` and `clientCapabilities`; the method
mapping below is the typed seam only. There is no default from an arbitrary
or absent method to the legacy revision. -/

inductive McpAdapterRevision where
  | legacy2025_06_18
  | current2026_07_28
  deriving Repr, BEq, DecidableEq

def McpAdapterRevision.version : McpAdapterRevision → String
  | .legacy2025_06_18 => "2025-06-18"
  | .current2026_07_28 => "2026-07-28"

/-- Set representation used by cooperating `server/discover` producers. -/
def mcpSupportedAdapterRevisions : List McpAdapterRevision :=
  [.legacy2025_06_18, .current2026_07_28]

def mcpDiscoverySupportedRevisionStrings : List String :=
  mcpSupportedAdapterRevisions.map McpAdapterRevision.version

theorem mcp_supported_adapter_revisions_nodup :
    mcpSupportedAdapterRevisions.Nodup := by
  decide

inductive McpEntryCall where
  | initialize
  | serverDiscover
  deriving Repr, BEq, DecidableEq

/-- Derive only from the received entry method. Unknown/non-entry methods do
    not silently acquire legacy semantics. -/
def mcpEntryCallOfMethod : String → Option McpEntryCall
  | "initialize" => some .initialize
  | "server/discover" => some .serverDiscover
  | _ => none

def McpEntryCall.revision : McpEntryCall → McpAdapterRevision
  | .initialize => .legacy2025_06_18
  | .serverDiscover => .current2026_07_28

def McpAdapterRevision.adapterId (revision : McpAdapterRevision) : AdapterId :=
  { type := mcpAdapterType, version := revision.version }

def mcpAdapterForEntryMethod (method : String) : Option AdapterId :=
  (mcpEntryCallOfMethod method).map fun entry => entry.revision.adapterId

/-- The only ruled mixed-version behavior. No translation-profile or paired
    client/child revisions exist because no byte translation is claimed. -/
inductive McpMixedVersionPolicy where
  | transparentDualEra
  deriving Repr, BEq, DecidableEq

def mcpMixedVersionPolicy : McpMixedVersionPolicy :=
  .transparentDualEra

theorem mcp_entry_eras_distinct :
    mcpAdapterForEntryMethod "initialize" ≠
      mcpAdapterForEntryMethod "server/discover" := by
  decide

/-- The effect the VERIFIED parser derives from the judged line:
    (resource = tool, action, canonical args serialization, complete
    validated metadata) of the parsed
    `tools/call`. `none` when the line does not parse as a capability request.
    Kernel twin of the host receipt's `seal.effect-view/v0` (which is
    explicitly `authoritative: false`); THIS derivation is the authoritative
    comparand for the F3 equality gate. -/
def deriveEffect (line : RawBytes) : Option EffectClaim :=
  match parse line with
  | none => none
  | some ast =>
      match requestFromAst ast with
      | none => none
      | some req => some {
          resource := req.tool,
          action := req.action,
          args := serializeAstValue req.arguments,
          metadata := req.metadata,
          requestState := req.requestState,
          inputResponses := req.inputResponses
        }

/-- F1 gate: the signed adapter claim must equal the adapter that actually
    mediated. -/
def adapterGate (mediator : AdapterId) (e : EffectEnvelope) : Bool :=
  e.adapterType == mediator.type && e.adapterVersion == mediator.version

/-- F2 gate: the signed session must be nonempty AND equal the boot/config
    session (the `ApprovalState.session` plane — `bootAssigner`'s plane, not
    the receipt pid). MANDATORY: the empty-string seat was a fail-open
    bypass (a session-named binding that vanished when unset) and made
    empty-session envelopes portable across verifiers — the exact
    token-redirection shape the stripped `audience` field would have
    guarded. Killed in Stage B2. -/
def sessionGate (state : ApprovalState) (e : EffectEnvelope) : Bool :=
  e.session != "" && e.session == state.session

/-- F5 gate: the signed policy version must be nonempty AND equal the
    config's policy version — the anti-downgrade pin. MANDATORY: empty
    defeated the pin (prior art: "optional security-binding bypass").
    Consequence, deliberate: a deployment whose config declares no
    `policyVersion` fails closed. -/
def policyVersionGate (state : ApprovalState) (e : EffectEnvelope) : Bool :=
  e.policyVersion != "" && e.policyVersion == state.policyVersion

/-- Expiry gate: the signer-declared deadline is MANDATORY (nonzero) and the
    envelope is usable only while `state.now ≤ expiresAt`. The `0 = unset`
    escape was a sentinel-valued bypass ("good forever, by my own bound");
    killed in Stage B2. A signer with no tighter preference signs
    `issuedAt + ttl`. Effective lifetime is the composite deadline
    `min(issuedAt + maxApprovalTtl, expiresAt)`. -/
def expiryGate (state : ApprovalState) (e : EffectEnvelope) : Bool :=
  e.expiresAt != 0 && Decidable.decide (state.now ≤ e.expiresAt)

/-- issuedAt freshness gate: never future-dated, and no older than the
    state's TTL cap. Freshness, NOT replay uniqueness — never present this
    as replay defense (that is the nonce ledger seam, still BOUNDARY). -/
def issuedAtGate (state : ApprovalState) (e : EffectEnvelope) : Bool :=
  Decidable.decide (e.issuedAt ≤ state.now)
    && Decidable.decide (state.now - e.issuedAt ≤ state.maxApprovalTtl)

/-- F3 gate: a DECLARED-ABSENT effect claim (`none`) always passes — the
    optionality is explicit in the signed object, not inferred from empty
    strings. A PRESENT claim passes ONLY under the MCP adapter and ONLY if
    it equals the parser-derived effect of the judged line. Any other
    combination — a mismatch, an unparseable line, or a non-MCP adapter
    claiming an effect this kernel cannot derive — FAILS CLOSED: accepting
    an uncheckable claim would authenticate a lie. Note `some ⟨"", "", ""⟩`
    is a PRESENT claim and is checked like any other: the retired all-empty
    sentinel buys nothing. -/
def effectGate (mediator : AdapterId) (e : EffectEnvelope) : Bool :=
  e.effect.all fun c =>
    mediator.type == mcpAdapterType
      && (deriveEffect e.line == some c)

/-- **The V2.3 judgment step** — the spec the host binds to at repin. -/
def effectStep (authority : ByteArray) (reg : PrincipalRegistry)
    (mediator : AdapterId) (e : EffectEnvelope) (sigHex : String)
    (state : ApprovalState) : Decision :=
  match verifyEffect authority reg e sigHex with
  | none => .Block
  | some _ =>
      if adapterGate mediator e && sessionGate state e && effectGate mediator e
          && expiryGate state e && issuedAtGate state e
          && policyVersionGate state e
      then decide e.line state
      else .Block

/-- Anything that is not blocked passed every gate. -/
theorem effect_step_gates {authority : ByteArray} {reg : PrincipalRegistry}
    {mediator : AdapterId} {e : EffectEnvelope} {sigHex : String}
    {state : ApprovalState}
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    (∃ p, verifyEffect authority reg e sigHex = some p)
      ∧ adapterGate mediator e = true
      ∧ sessionGate state e = true
      ∧ effectGate mediator e = true
      ∧ expiryGate state e = true
      ∧ issuedAtGate state e = true
      ∧ policyVersionGate state e = true := by
  unfold effectStep at h
  split at h
  · exact absurd rfl h
  · next p hp =>
      split at h
      · next hg =>
          simp only [Bool.and_eq_true] at hg
          exact ⟨⟨p, hp⟩, hg.1.1.1.1.1, hg.1.1.1.1.2, hg.1.1.1.2,
            hg.1.1.2, hg.1.2, hg.2⟩
      · exact absurd rfl h

/-- Decidability of blocking, constructively: the step is `.Block` or provably
    not — the case split every fail-closed theorem below stands on (no
    classical contradiction needed). -/
theorem effect_step_block_or_not (authority : ByteArray)
    (reg : PrincipalRegistry) (mediator : AdapterId) (e : EffectEnvelope)
    (sigHex : String) (state : ApprovalState) :
    effectStep authority reg mediator e sigHex state = .Block
      ∨ effectStep authority reg mediator e sigHex state ≠ .Block := by
  cases h : effectStep authority reg mediator e sigHex state with
  | Block => exact .inl rfl
  | Allow out => exact .inr fun hc => Decision.noConfusion hc

/-- **Presence, not value** — the factorization at the pipeline level: the
    step either blocks or returns EXACTLY `SealV2.decide e.line state`. The
    decision VALUE is a function of the judged line and the trusted
    config/state alone; every envelope field — the advisory F3 claim, the
    mandatory bindings, all of them — gates only WHETHER a decision is
    produced. Advisory fields cannot appear in `SealV2.decide`: it never
    receives them. -/
theorem effect_step_presence_not_value (authority : ByteArray)
    (reg : PrincipalRegistry) (mediator : AdapterId) (e : EffectEnvelope)
    (sigHex : String) (state : ApprovalState) :
    effectStep authority reg mediator e sigHex state = .Block
      ∨ effectStep authority reg mediator e sigHex state
          = decide e.line state := by
  unfold effectStep
  split
  · exact .inl rfl
  · split
    · exact .inr rfl
    · exact .inl rfl

/-- Every Allow the pipeline emits is the kernel's own verdict on the line. -/
theorem allow_value_from_line_and_state {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {out : CanonicalBytes}
    (h : effectStep authority reg mediator e sigHex state = .Allow out) :
    decide e.line state = .Allow out := by
  rcases effect_step_presence_not_value authority reg mediator e sigHex state
    with hb | hd
  · rw [h] at hb; cases hb
  · rw [← hd, h]

/-- **Advisory non-influence.** Two envelopes carrying the SAME judged line —
    under different registries, authorities, mediators, signatures, advisory
    claims, everything — that both pass the gates produce the SAME decision.
    The advisory fields have no influence channel into the decision value. -/
theorem advisory_non_influence {authority₁ authority₂ : ByteArray}
    {reg₁ reg₂ : PrincipalRegistry} {mediator₁ mediator₂ : AdapterId}
    {e₁ e₂ : EffectEnvelope} {sig₁ sig₂ : String} {state : ApprovalState}
    (hline : e₁.line = e₂.line)
    (h₁ : effectStep authority₁ reg₁ mediator₁ e₁ sig₁ state ≠ .Block)
    (h₂ : effectStep authority₂ reg₂ mediator₂ e₂ sig₂ state ≠ .Block) :
    effectStep authority₁ reg₁ mediator₁ e₁ sig₁ state
      = effectStep authority₂ reg₂ mediator₂ e₂ sig₂ state := by
  rcases effect_step_presence_not_value authority₁ reg₁ mediator₁ e₁ sig₁ state
    with hb₁ | hd₁
  · exact absurd hb₁ h₁
  · rcases effect_step_presence_not_value authority₂ reg₂ mediator₂ e₂ sig₂
      state with hb₂ | hd₂
    · exact absurd hb₂ h₂
    · rw [hd₁, hd₂, hline]

/-- **F1: the adapter bind.** Anything not blocked signed the identity of the
    adapter that actually mediated. -/
theorem adapter_bind {authority : ByteArray} {reg : PrincipalRegistry}
    {mediator : AdapterId} {e : EffectEnvelope} {sigHex : String}
    {state : ApprovalState}
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    e.adapterType = mediator.type ∧ e.adapterVersion = mediator.version := by
  obtain ⟨_, hg, _, _, _, _, _⟩ := effect_step_gates h
  unfold adapterGate at hg
  simp only [Bool.and_eq_true, beq_iff_eq] at hg
  exact hg

/-- F1 fail-closed: an adapter-claim mismatch blocks. -/
theorem adapter_mismatch_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (hne : e.adapterType ≠ mediator.type ∨ e.adapterVersion ≠ mediator.version) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · have := adapter_bind hnb
    rcases hne with hne | hne
    · exact absurd this.1 hne
    · exact absurd this.2 hne

/-- **F2: the session bind, MANDATORY.** Anything not blocked carries a
    NONEMPTY session claim EXACTLY equal to the boot/config session. A
    client-signed session value never enters the judgment plane: `decide`
    reads `state.session` (trusted config), never the envelope field. The
    empty seat is gone: before Stage B2 an empty session was silently
    accepted (and portable across verifiers). -/
theorem session_bind {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    e.session ≠ "" ∧ e.session = state.session := by
  obtain ⟨_, _, hg, _, _, _, _⟩ := effect_step_gates h
  unfold sessionGate at hg
  simp only [Bool.and_eq_true, bne_iff_ne, beq_iff_eq, ne_eq] at hg
  exact hg

/-- F2 fail-closed, the killed bypass: an EMPTY session claim blocks. The
    negative control for the "checked when non-empty, accepted when empty"
    fail-open. -/
theorem empty_session_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (he : e.session = "") :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · exact absurd he (session_bind hnb).1

/-- F2 fail-closed: a session claim that differs from the boot/config
    session blocks — the spoof theorem. -/
theorem session_spoof_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (hnm : e.session ≠ state.session) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · exact absurd (session_bind hnb).2 hnm

/-- **F5: the policy-version bind, MANDATORY.** Anything not blocked carries
    a NONEMPTY policy-version claim EXACTLY equal to the config's — the
    anti-downgrade pin, with the empty bypass killed. -/
theorem policy_version_bind {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    e.policyVersion ≠ "" ∧ e.policyVersion = state.policyVersion := by
  obtain ⟨_, _, _, _, _, _, hg⟩ := effect_step_gates h
  unfold policyVersionGate at hg
  simp only [Bool.and_eq_true, bne_iff_ne, beq_iff_eq, ne_eq] at hg
  exact hg

/-- F5 fail-closed, the killed bypass: an EMPTY policy-version claim blocks.
    Before Stage B2 (on the v1 layout), empty silently defeated the pin. -/
theorem empty_policy_version_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (he : e.policyVersion = "") :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · exact absurd he (policy_version_bind hnb).1

/-- F5 fail-closed: a policy-version claim that differs from the config's
    blocks — the anti-downgrade theorem. An envelope signed against policy X
    cannot be judged under policy Y ≠ X. Ported from the field-warrant
    campaign (`policy_version_spoof_blocks`), strengthened: the empty escape
    hatch no longer exists. -/
theorem policy_version_spoof_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (hnm : e.policyVersion ≠ state.policyVersion) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · exact absurd (policy_version_bind hnb).2 hnm

/-- **Expiry respected, MANDATORY.** Anything not blocked declares a nonzero
    deadline and is still live at `state.now`. Ported from the field-warrant
    campaign (`envelope_expiry_respected`), strengthened: the `0 = unset`
    seat no longer exists. -/
theorem envelope_expiry_respected {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    e.expiresAt ≠ 0 ∧ state.now ≤ e.expiresAt := by
  obtain ⟨_, _, _, _, hg, _, _⟩ := effect_step_gates h
  unfold expiryGate at hg
  simp only [Bool.and_eq_true, bne_iff_ne, decide_eq_true_eq, ne_eq] at hg
  exact hg

/-- Expiry fail-closed, the killed bypass: `expiresAt = 0` blocks. Before
    Stage B2, zero meant "good forever, by my own bound". -/
theorem zero_expiry_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (he : e.expiresAt = 0) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · exact absurd he (envelope_expiry_respected hnb).1

/-- Expiry fail-closed: an `expiresAt` in the past blocks. An attacker
    holding a validly signed envelope cannot use it after its declared
    expiry (given an honest `state.now`). Ported from the field-warrant
    campaign (`expired_envelope_blocks`). -/
theorem expired_envelope_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (hlt : e.expiresAt < state.now) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · have h' := (envelope_expiry_respected hnb).2
    exact False.elim (Nat.not_lt_of_ge h' hlt)

/-- **issuedAt is never future-dated** on anything not blocked. Ported from
    the field-warrant campaign. -/
theorem issuedAt_not_future {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    e.issuedAt ≤ state.now := by
  obtain ⟨_, _, _, _, _, hg, _⟩ := effect_step_gates h
  unfold issuedAtGate at hg
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hg
  exact hg.1

/-- **issuedAt freshness window**: anything not blocked was issued within
    the state's TTL cap of `state.now`. Ported from the field-warrant
    campaign. -/
theorem issuedAt_within_window {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    state.now - e.issuedAt ≤ state.maxApprovalTtl := by
  obtain ⟨_, _, _, _, _, hg, _⟩ := effect_step_gates h
  unfold issuedAtGate at hg
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hg
  exact hg.2

/-- issuedAt fail-closed, future: a post-dated envelope blocks. -/
theorem future_issued_envelope_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (hf : state.now < e.issuedAt) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · have h' := issuedAt_not_future hnb
    exact False.elim (Nat.not_lt_of_ge h' hf)

/-- issuedAt fail-closed, stale: an envelope older than the freshness
    window blocks — a signed envelope cannot be banked indefinitely. -/
theorem stale_envelope_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState}
    (hs : state.maxApprovalTtl < state.now - e.issuedAt) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · have h' := issuedAt_within_window hnb
    exact False.elim (Nat.not_lt_of_ge h' hs)

/-- **F3: MCP effect-equality.** Under the MCP mediator, anything not
    blocked that carries a PRESENT effect claim carries EXACTLY the
    parser-derived effect of the judged line. The signature never
    authenticates an effect nobody checked — the confused-deputy closure.
    Note this covers `some ⟨"", "", ""⟩`: the retired all-empty sentinel is
    a present claim and must match the derivation like any other. -/
theorem mcp_effect_equality {authority : ByteArray} {reg : PrincipalRegistry}
    {mediator : AdapterId} {e : EffectEnvelope} {sigHex : String}
    {state : ApprovalState} {c : EffectClaim}
    (hm : mediator.type = mcpAdapterType) (hc : e.effect = some c)
    (h : effectStep authority reg mediator e sigHex state ≠ .Block) :
    deriveEffect e.line = some c := by
  obtain ⟨_, _, _, hg, _, _, _⟩ := effect_step_gates h
  unfold effectGate at hg
  rw [hc] at hg
  simp only [Option.all_some, Bool.and_eq_true, beq_iff_eq] at hg
  exact hg.2

/-- F3 fail-closed, mismatch: a present effect claim that differs from the
    parser-derived effect blocks (this includes an unparseable line, where
    `deriveEffect = none`). -/
theorem mcp_effect_mismatch_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {c : EffectClaim}
    (hm : mediator.type = mcpAdapterType) (hc : e.effect = some c)
    (hmis : deriveEffect e.line ≠ some c) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · exact absurd (mcp_effect_equality hm hc hnb) hmis

/-- F3 fail-closed, non-MCP: an adapter this kernel defines no effect
    derivation for cannot carry a present effect claim at all. -/
theorem nonmcp_effect_claim_blocks {authority : ByteArray}
    {reg : PrincipalRegistry} {mediator : AdapterId} {e : EffectEnvelope}
    {sigHex : String} {state : ApprovalState} {c : EffectClaim}
    (hm : mediator.type ≠ mcpAdapterType) (hc : e.effect = some c) :
    effectStep authority reg mediator e sigHex state = .Block := by
  rcases effect_step_block_or_not authority reg mediator e sigHex state
    with hb | hnb
  · exact hb
  · obtain ⟨_, _, _, hg, _, _, _⟩ := effect_step_gates hnb
    unfold effectGate at hg
    rw [hc] at hg
    simp only [Option.all_some, Bool.and_eq_true, beq_iff_eq] at hg
    exact absurd hg.1 hm

/-! ## Golden vectors — the cross-language signed-message contract

These `#eval` pins are ALSO the kernel-side negative control for the strip
and the reconciliation: re-adding any killed field, dropping a rescued one,
or reverting the presence-byte encoding changes the golden hex (and the Rust
twin corpus), so reverting breaks the build here, not just review. Two pins:
one with the F3 claim PRESENT (0x01 block) and one DECLARED ABSENT (the
signed 0x00 presence byte) — the pair pins the option encoding itself. -/

/-- Hex of a byte array (lowercase) — for golden-vector pins. -/
def bytesToHex (b : ByteArray) : String :=
  String.ofList (b.toList.flatMap fun byte =>
    let hi := byte.toNat / 16
    let lo := byte.toNat % 16
    let digit := fun (n : Nat) =>
      if n < 10 then Char.ofNat (48 + n) else Char.ofNat (87 + n)
    [digit hi, digit lo])

/-- info: "7365616c2e6566666563742f763200" -/
#guard_msgs in
#eval bytesToHex effectTag.toUTF8

/--
info: "7365616c2e6566666563742f763200a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf0000000000000005616c696365000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00000000000004d2000000000000162e00000000000000077b226d223a317d00000000000000036d6370000000000000000a323032352d30362d31380000000000000006736573732d310000000000000005706f6c2d3101000000000000000a64622e65786563757465000000000000000463616c6c00000000000000077b2271223a317d00"
-/
#guard_msgs in
#eval bytesToHex (effectMessage
  (ByteArray.mk (Array.range 32 |>.map fun i => UInt8.ofNat (0xa0 + i)))
  { keyId := "alice"
    nonce := ByteArray.mk (Array.range 32 |>.map UInt8.ofNat)
    issuedAt := 1234
    expiresAt := 5678
    line := "{\"m\":1}"
    adapterType := "mcp"
    adapterVersion := "2025-06-18"
    session := "sess-1"
    policyVersion := "pol-1"
    effect := some { resource := "db.execute", action := "call",
                     args := "{\"q\":1}", metadata := .absent } })

/--
info: "7365616c2e6566666563742f763200a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf0000000000000005616c696365000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00000000000004d2000000000000162e00000000000000077b226d223a317d00000000000000036d6370000000000000000a323032352d30362d31380000000000000006736573732d310000000000000005706f6c2d3100"
-/
#guard_msgs in
#eval bytesToHex (effectMessage
  (ByteArray.mk (Array.range 32 |>.map fun i => UInt8.ofNat (0xa0 + i)))
  { keyId := "alice"
    nonce := ByteArray.mk (Array.range 32 |>.map UInt8.ofNat)
    issuedAt := 1234
    expiresAt := 5678
    line := "{\"m\":1}"
    adapterType := "mcp"
    adapterVersion := "2025-06-18"
    session := "sess-1"
    policyVersion := "pol-1"
    effect := none })

/-! ## Axiom pins — the honesty razor, machine-checked

Every theorem in the package sits on the standard trio (or less). No new
axioms; `ed25519Verify` is `opaque` (TCB seam), not an axiom. -/

/-- info: 'SealV2.Effect.u64be_inj' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms u64be_inj

/-- info: 'SealV2.Effect.unixSecondsBE_inj' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms unixSecondsBE_inj

/-- info: 'SealV2.Effect.sized_cancel' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms sized_cancel

/-- info: 'SealV2.Effect.u64be_cancel' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms u64be_cancel

/-- info: 'SealV2.Effect.frame_cancel' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms frame_cancel

/-- info: 'SealV2.Effect.frame_inj' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms frame_inj

/-- info: 'SealV2.Effect.optEffect_inj' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms optEffect_inj

/-- info: 'SealV2.Effect.optMeta_inj' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms optMeta_inj

/-- info: 'SealV2.Effect.wireSizedB_spec' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms wireSizedB_spec

/-- info: 'SealV2.Effect.effect_message_injective' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effect_message_injective

/-- info: 'SealV2.Effect.prefix_byte_separated' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms prefix_byte_separated

/-- info: 'SealV2.Effect.effect_cross_version_v1_separated' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effect_cross_version_v1_separated

/-- info: 'SealV2.Effect.effect_cross_version_v22_separated' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effect_cross_version_v22_separated

/-- info: 'SealV2.Effect.effect_cross_version_v21_separated' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effect_cross_version_v21_separated

/-- info: 'SealV2.Effect.effect_cross_plane_separated' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effect_cross_plane_separated

/-- info: 'SealV2.Effect.verifyEffect_wireSized' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms verifyEffect_wireSized

/-- info: 'SealV2.Effect.verified_effect_injective' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms verified_effect_injective

/-- info: 'SealV2.Effect.effect_gates_presence_not_value' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms effect_gates_presence_not_value

/-- info: 'SealV2.Effect.verifyEffect_none_of_unregistered' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms verifyEffect_none_of_unregistered

/-- info: 'SealV2.Effect.verifyEffect_id_registered' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms verifyEffect_id_registered

/-- info: 'SealV2.Effect.AuthenticatedId.ext_id' depends on axioms: [propext] -/
#guard_msgs in
#print axioms AuthenticatedId.ext_id

/-- info: 'SealV2.Effect.effect_step_gates' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms effect_step_gates

/-- info: 'SealV2.Effect.effect_step_block_or_not' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms effect_step_block_or_not

/-- info: 'SealV2.Effect.effect_step_presence_not_value' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms effect_step_presence_not_value

/-- info: 'SealV2.Effect.allow_value_from_line_and_state' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms allow_value_from_line_and_state

/-- info: 'SealV2.Effect.advisory_non_influence' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms advisory_non_influence

/-- info: 'SealV2.Effect.adapter_bind' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms adapter_bind

/-- info: 'SealV2.Effect.adapter_mismatch_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms adapter_mismatch_blocks

/-- info: 'SealV2.Effect.session_bind' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms session_bind

/-- info: 'SealV2.Effect.empty_session_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms empty_session_blocks

/-- info: 'SealV2.Effect.session_spoof_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms session_spoof_blocks

/-- info: 'SealV2.Effect.policy_version_bind' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms policy_version_bind

/-- info: 'SealV2.Effect.empty_policy_version_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms empty_policy_version_blocks

/-- info: 'SealV2.Effect.policy_version_spoof_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms policy_version_spoof_blocks

/-- info: 'SealV2.Effect.envelope_expiry_respected' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms envelope_expiry_respected

/-- info: 'SealV2.Effect.zero_expiry_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms zero_expiry_blocks

/-- info: 'SealV2.Effect.expired_envelope_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms expired_envelope_blocks

/-- info: 'SealV2.Effect.issuedAt_not_future' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms issuedAt_not_future

/-- info: 'SealV2.Effect.issuedAt_within_window' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms issuedAt_within_window

/-- info: 'SealV2.Effect.future_issued_envelope_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms future_issued_envelope_blocks

/-- info: 'SealV2.Effect.stale_envelope_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms stale_envelope_blocks

/-- info: 'SealV2.Effect.mcp_effect_equality' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms mcp_effect_equality

/-- info: 'SealV2.Effect.mcp_effect_mismatch_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms mcp_effect_mismatch_blocks

/-- info: 'SealV2.Effect.nonmcp_effect_claim_blocks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms nonmcp_effect_claim_blocks

end SealV2.Effect
