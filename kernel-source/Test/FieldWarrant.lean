/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures
import Test.FieldWarrantCorpus

/-!
# Field-warrant SHOW suite — negative controls for every signed envelope field

Ben's warrant doctrine (2026-07-22): every field inside the signature needs a
WHY (threat), a HOW (mechanism at file:line) and a SHOW — a runnable test
that goes RED when the field is tampered with, forged, replayed or dropped.
This file is the SHOW, ported from `feat/field-warrant` onto the Stage B2
reconciled `seal.effect/v2` shape. Real Ed25519 signatures (fixed documented
test seed, minted by `test/v2/field_warrant_sign_fixture.py`, whose
byte-encoder twin is self-checked against BOTH golden-vector pins in
`SealV2/EffectEnvelope.lean`).

**Polarity changes vs the field-warrant branch suite, recorded, not
smoothed over.** The campaign suite's second GREEN control ("seat form:
optional fields empty/0 → Allow") asserted the empty-value fail-open as
correct behaviour. Stage B2 kills that fail-open, so the control does not
survive with its polarity intact:

* session = ""            — was part of GREEN #2; now a GATE RED.
* policyVersion = ""      — was part of GREEN #2; now a GATE RED.
* expiresAt = 0           — was part of GREEN #2; now a GATE RED.
* effect claim ("","","") — was the GREEN #2 spelling of "no claim"; now a
  PRESENT claim, checked and RED on mismatch like any other.
* effect claim DECLARED ABSENT (`none`) — the one legitimately optional
  binding, and the only survivor of GREEN #2: optionality is a signed
  presence byte, so this green asserts declared absence, not a sentinel.

A test that had to be edited to accommodate a security fix is a finding:
the old control was the tripwire the doctrine is meant to catch.

Four control classes:

* GREEN — a fully gate-passing envelope is Allowed (twice: strong form with
  the F3 claim present, and declared-absent form with `effect := none`).
* GATE RED — an attacker WITH the registered key signs an envelope failing
  exactly one gate: valid signature, still `.Block`. Each control checks
  the specific gate Bool AND that the signature actually VERIFIES
  (`verifyEffect … |>.isSome`), so the Block is attributed to the gate,
  not to a malformed fixture signature. Exception, labelled: the
  `keyId=mallory` row has NO gate attribution — its Block is `verifyEffect`
  registry fail-closed (unregistered id), and the row asserts `isNone`.
* SIGNATURE RED — the isolating forgery controls (frisk F1 repair). Each
  row is two-stage: FIRST it proves no gate is the discriminator (all six
  gate Bools pass for the forged envelope under that row's verifier
  configuration), THEN it proves rejection comes from the signature alone
  (`verifyEffect` is `none`, step Blocks). Isolation is achieved by
  forging the field AND aligning the verifier-side trusted input so the
  matching gate passes: twin-registered `keyId` (same pubkey, different
  id), state with the forged `policyVersion`, mediator with the
  forged `adapterType`/`adapterVersion` (the type row rides the
  absent-form base because `effectGate` demands the MCP type for a present
  claim), a whitespace-variant `line` that parses to the SAME derived
  effect, and in-window `nonce`/`issuedAt`/`expiresAt` tampers (never
  gated / still inside their windows). Plus BOTH presence flips of the
  option block (some→none under the base signature, none→some under the
  absent-form signature) — the runnable `optEffect_inj`. If the signature
  stopped binding the forged field, the forgery would verify and the step
  would Allow: the row goes RED. Every SIGNATURE RED is checked
  MECHANICALLY by `Test/FieldWarrantMutation.lean`: it must flip under a
  signature-only mutant and under NO gate mutant, or it is a control passing
  for the wrong reason.
* MESSAGE DISTINCTNESS — the runnable per-field form of
  `effect_message_injective`: for every signed field (all ten, plus
  authority, plus each F3 subfield resource/action/args, plus the presence
  byte) a pair of inputs differing ONLY in that field must produce
  different `effectMessage` bytes. Goes RED the moment a field's bytes are
  dropped from the encoding.

NAMED GAPS, stated honestly rather than faked — signed material with NO
runtime signature-ISOLATED step control, each for a mechanical reason
surfaced by `Test/FieldWarrantMutation.lean`:
* `effect.resource/action/args` — `effectGate` pins a present claim to
  `deriveEffect` of the UNCHANGED signed line, so no verifier config makes
  the gate pass while only a sub-field's signature discriminates.
* `session` — coupled into the decision layer's SIGNED approval
  (`Validation.approvalLiveFor` re-verifies the approval, which covers
  session), so aligning `sessionGate` desyncs that approval and `decide`
  blocks independently of the envelope signature; isolating it would need a
  freshly-minted approval fixture.
* `authority` — the config trust root, not an `EffectEnvelope` field.
Each is witnessed instead by its MESSAGE DISTINCTNESS row, the kernel proofs
(`optEffect_inj`, `effect_message_injective`), and — for session — the two
`sessionGate` GATE REDS proving it is consulted under a valid signature.

Also not showable here: envelope-nonce REPLAY (the enforcing store is host
state — BOUNDARY, exempted with reason in
`SealV2/EnvelopeCompleteness.lean`; there is no gate to trip), and field
DROP at runtime (the envelope is a fixed structure; drop coverage is the
ablation experiment plus the host twin's strict wire shape).
-/

open SealV2 SealV2.Effect Test.V2ValidationFixtures

namespace Test.FieldWarrant

/- Fixtures (`sigBase`, `baseEnvelope`, `registry`, …) and the mutation
   corpus now live in `Test.FieldWarrantCorpus`, the single source shared with
   the mechanical negative-witness harness (`Test.FieldWarrantMutation`). -/

/-- One control: run `effectStep`, compare Allow/Block against expectation,
    (when given) check the attributing gate Bool, and (when given) check
    whether the fixture signature VERIFIES — `some true` for gate reds
    (the Block must not be hiding a malformed signature), `some false` for
    the registry fail-closed row. -/
def control (name : String) (e : EffectEnvelope) (sig : String)
    (state : ApprovalState) (expectAllow : Bool)
    (gate : Option (String × Bool) := none)
    (sigValid : Option Bool := none) : IO Bool := do
  let d := effectStep authority registry mediator e sig state
  let allowed := match d with | .Allow _ => true | .Block => false
  let stepOk := allowed == expectAllow
  let gateOk := match gate with
    | none => true
    | some (_, got) => got == false
  let verified := (verifyEffect authority registry e sig).isSome
  let sigOk := match sigValid with
    | none => true
    | some want => verified == want
  let verdict := if stepOk && gateOk && sigOk then "PASS" else "FAIL"
  let gateNote := match gate with
    | none => ""
    | some (gname, got) => s!" [{gname}={got}]"
  let sigNote := match sigValid with
    | none => ""
    | some want => s!" [sigVerifies={verified} expected={want}]"
  IO.println s!"{verdict}  {name}: step={if allowed then "Allow" else "Block"} expected={if expectAllow then "Allow" else "Block"}{gateNote}{sigNote}"
  pure (stepOk && gateOk && sigOk)

/-- SIGNATURE RED runner — the isolating forgery control, two-stage:

    1. every one of the six gates must PASS for the forged envelope under
       this row's verifier configuration (state/mediator/registry aligned
       with the forgery) — proving no gate is the discriminator;
    2. `verifyEffect` must be `none` and the step must Block — proving the
       signature is the ONLY thing standing.

    If signature binding for the forged field were removed (its bytes
    dropped from `effectMessage` on both signer and verifier side), stage 2
    inverts: the reused signature verifies, the gates still pass, and the
    step Allows — this control goes RED. -/
def sigRed (name : String) (e : EffectEnvelope) (sig : String)
    (st : ApprovalState) (med : AdapterId)
    (reg : PrincipalRegistry := registry) : IO Bool := do
  let gates : List (String × Bool) :=
    [("adapterGate", adapterGate med e),
     ("sessionGate", sessionGate st e),
     ("effectGate", effectGate med e),
     ("expiryGate", expiryGate st e),
     ("issuedAtGate", issuedAtGate st e),
     ("policyVersionGate", policyVersionGate st e)]
  let failedGates := gates.filter (fun g => !g.2) |>.map (·.1)
  let gatesPass := failedGates.isEmpty
  let verified := (verifyEffect authority reg e sig).isSome
  let blocked := match effectStep authority reg med e sig st with
    | .Allow _ => false | .Block => true
  let ok := gatesPass && !verified && blocked
  let verdict := if ok then "PASS" else "FAIL"
  let gateNote := if gatesPass then "all 6 gates pass"
    else s!"gates FAILED: {failedGates}"
  IO.println s!"{verdict}  {name}: [{gateNote}] [sigVerifies={verified} expected=false] [step={if blocked then "Block" else "Allow"} expected=Block]"
  pure ok

/-- MESSAGE DISTINCTNESS runner — runnable per-field
    `effect_message_injective`: the two messages (inputs differing ONLY in
    the named field) must be different bytes. Goes RED the moment the
    field's bytes are dropped from the encoding. -/
def byteRow (name : String) (m₁ m₂ : ByteArray) : IO Bool := do
  let ok := m₁ != m₂
  IO.println s!"{if ok then "PASS" else "FAIL"}  bytes[{name}]: messages distinct={ok}"
  pure ok

def main : IO UInt32 := do
  let s := baseState
  let mut results : List Bool := []

  IO.println "== GREEN controls =="
  results := results ++ [← control "green: strong form (all bindings populated, F3 claim present)"
    baseEnvelope sigBase s true]
  results := results ++ [← control "green: F3 claim declared absent (effect := none, signed presence byte)"
    { baseEnvelope with effect := none } sigNoEffectClaim s true]

  IO.println "== GATE REDS (VERIFIED signature, one gate tripped) =="
  results := results ++ [← control "adapterType=cli"
    { baseEnvelope with adapterType := "cli" } sigAdapterType s false
    (some ("adapterGate", adapterGate mediator { baseEnvelope with adapterType := "cli" }))
    (sigValid := some true)]
  results := results ++ [← control "adapterVersion=9999-01-01"
    { baseEnvelope with adapterVersion := "9999-01-01" } sigAdapterVersion s false
    (some ("adapterGate", adapterGate mediator { baseEnvelope with adapterVersion := "9999-01-01" }))
    (sigValid := some true)]
  results := results ++ [← control "session=\"\" (killed bypass: was GREEN seat form on feat/field-warrant)"
    { baseEnvelope with session := "" } sigEmptySession s false
    (some ("sessionGate", sessionGate s { baseEnvelope with session := "" }))
    (sigValid := some true)]
  results := results ++ [← control "session=session-2"
    { baseEnvelope with session := "session-2" } sigSession s false
    (some ("sessionGate", sessionGate s { baseEnvelope with session := "session-2" }))
    (sigValid := some true)]
  results := results ++ [← control "policyVersion=\"\" (killed bypass: was GREEN seat form)"
    { baseEnvelope with policyVersion := "" } sigEmptyPolicyVersion s false
    (some ("policyVersionGate", policyVersionGate s { baseEnvelope with policyVersion := "" }))
    (sigValid := some true)]
  results := results ++ [← control "policyVersion=policy-2"
    { baseEnvelope with policyVersion := "policy-2" } sigPolicyVersion s false
    (some ("policyVersionGate", policyVersionGate s { baseEnvelope with policyVersion := "policy-2" }))
    (sigValid := some true)]
  results := results ++ [← control "expiresAt=0 (killed bypass: was GREEN seat form)"
    { baseEnvelope with expiresAt := 0 } sigZeroExpiry s false
    (some ("expiryGate", expiryGate s { baseEnvelope with expiresAt := 0 }))
    (sigValid := some true)]
  results := results ++ [← control "expiresAt=1 in the past"
    { baseEnvelope with expiresAt := 1 } sigExpired s false
    (some ("expiryGate", expiryGate s { baseEnvelope with expiresAt := 1 }))
    (sigValid := some true)]
  results := results ++ [← control "issuedAt=11 future-dated"
    { baseEnvelope with issuedAt := 11 } sigFutureIssued s false
    (some ("issuedAtGate", issuedAtGate s { baseEnvelope with issuedAt := 11 }))
    (sigValid := some true)]
  -- (The "stale, now=400" issuedAt gate red was removed: at expiresAt=100 it
  --  trips expiryGate AND the decision layer too, so the mutation harness
  --  flagged it as not cleanly attributable to issuedAtGate. issuedAt=11
  --  covers the gate cleanly; the too-old direction is a kernel-theorem gap.)
  let emptyClaim : EffectEnvelope :=
    { baseEnvelope with effect := some {
        resource := "", action := "", args := "", metadata := .absent } }
  results := results ++ [← control "effect=some(\"\",\"\",\"\") (retired sentinel is now a checked claim)"
    emptyClaim sigEmptyStringClaim s false
    (some ("effectGate", effectGate mediator emptyClaim))
    (sigValid := some true)]
  results := results ++ [← control "effect.resource=fs.read"
    { baseEnvelope with effect := some { baseClaim with resource := "fs.read" } } sigEffectResource s false
    (some ("effectGate", effectGate mediator
      { baseEnvelope with effect := some { baseClaim with resource := "fs.read" } }))
    (sigValid := some true)]
  results := results ++ [← control "effect.action=delete"
    { baseEnvelope with effect := some { baseClaim with action := "delete" } } sigEffectAction s false
    (some ("effectGate", effectGate mediator
      { baseEnvelope with effect := some { baseClaim with action := "delete" } }))
    (sigValid := some true)]
  let tamperedArgs := "{\"database\":\"prod\",\"table\":\"users\",\"amount\":99}"
  results := results ++ [← control "effect.args amount=99"
    { baseEnvelope with effect := some { baseClaim with args := tamperedArgs } } sigEffectArgs s false
    (some ("effectGate", effectGate mediator
      { baseEnvelope with effect := some { baseClaim with args := tamperedArgs } }))
    (sigValid := some true)]
  -- (The "line swapped to fs.read" effectGate red was removed: the swapped
  --  line ALSO fails the decision layer, so its Block is overdetermined and
  --  the mutation harness flagged it. effectGate is covered cleanly by the
  --  effect.resource/action/args rows; the line field's signature binding is
  --  covered by its SIGNATURE RED and MESSAGE DISTINCTNESS row below.)
  results := results ++ [← control "keyId=mallory (NO gate: verifyEffect registry fail-closed)"
    { baseEnvelope with keyId := "mallory" } sigBase s false
    (sigValid := some false)]

  IO.println "== SIGNATURE REDS (all gates pass, ONLY the signature blocks) =="
  -- keyId: alice2 is REGISTERED with the same pubkey (twin registry), so
  -- neither fail-closed nor any gate discriminates — only frame(keyId).
  results := results ++ [← sigRed "forged keyId=alice2 (twin-registered, same pubkey)"
    { baseEnvelope with keyId := "alice2" } sigBase s mediator (reg := registryTwin)]
  -- nonce: never gated (replay ledger is BOUNDARY) — signature only.
  results := results ++ [← sigRed "forged nonce (+1 bytes)"
    { baseEnvelope with nonce := ByteArray.mk (Array.range 32 |>.map fun i => UInt8.ofNat (i + 1)) }
    sigBase s mediator]
  -- issuedAt/expiresAt: forged values stay INSIDE the gate windows.
  results := results ++ [← sigRed "forged issuedAt=6 (still in freshness window)"
    { baseEnvelope with issuedAt := 6 } sigBase s mediator]
  results := results ++ [← sigRed "forged expiresAt=101 (still unexpired, nonzero)"
    { baseEnvelope with expiresAt := 101 } sigBase s mediator]
  -- line: whitespace variant — parses to the SAME AST, so deriveEffect and
  -- the decision are unchanged and effectGate passes; only the BYTES differ.
  let spacedRaw := "{\"method\":\"tools/call\", \"params\":{\"name\":\"db.execute\",\"action\":\"write\",\"arguments\":{\"database\":\"prod\",\"table\":\"users\",\"amount\":12.34}}}"
  results := results ++ [← sigRed "forged line (whitespace variant, same derived effect)"
    { baseEnvelope with line := spacedRaw } sigBase s mediator]
  -- adapterType: mediator aligned with the forgery so adapterGate passes;
  -- rides the ABSENT-form base because effectGate demands the MCP type for
  -- a present claim.
  results := results ++ [← sigRed "forged adapterType=mcp2 (mediator aligned, absent-form base)"
    { baseEnvelope with effect := none, adapterType := "mcp2" } sigNoEffectClaim s
    { type := "mcp2", version := "2025-06-18" }]
  results := results ++ [← sigRed "forged adapterVersion=2025-06-19 (mediator aligned)"
    { baseEnvelope with adapterVersion := "2025-06-19" } sigBase s
    { type := "mcp", version := "2025-06-19" }]
  -- NO session SIGNATURE RED: session is coupled into the decision layer's
  -- SIGNED approval (`approvalLiveFor` re-verifies it), so no state alignment
  -- isolates session's envelope signature at the step without minting a fresh
  -- approval fixture. Named gap; session's signature binding is witnessed by
  -- MESSAGE DISTINCTNESS (`bytes[session]`) + `effect_message_injective`, and
  -- its consultation by the two sessionGate GATE REDS above.
  -- policyVersion: state aligned; `decide` does not consult policyVersion, so
  -- no approval alignment is needed.
  results := results ++ [← sigRed "forged policyVersion=policy-1x (state aligned)"
    { baseEnvelope with policyVersion := "policy-1x" } sigBase
    { baseState with policyVersion := "policy-1x" } mediator]
  -- both presence flips: runnable optEffect_inj (gates pass on both sides
  -- of the flip; the signed presence byte is the only discriminator).
  results := results ++ [← sigRed "forged effect presence flip some→none"
    { baseEnvelope with effect := none } sigBase s mediator]
  results := results ++ [← sigRed "forged effect presence flip none→some"
    baseEnvelope sigNoEffectClaim s mediator]

  IO.println "== MESSAGE DISTINCTNESS (runnable effect_message_injective, per field) =="
  let msgOf (e : EffectEnvelope) : ByteArray := effectMessage authority e
  let mBase := msgOf baseEnvelope
  let authority2 := ByteArray.mk (Array.range 32 |>.map fun i => UInt8.ofNat (0xb0 + i))
  results := results ++ [← byteRow "authority" mBase (effectMessage authority2 baseEnvelope)]
  results := results ++ [← byteRow "keyId" mBase (msgOf { baseEnvelope with keyId := "alice2" })]
  results := results ++ [← byteRow "nonce" mBase
    (msgOf { baseEnvelope with nonce := ByteArray.mk (Array.range 32 |>.map fun i => UInt8.ofNat (i + 1)) })]
  results := results ++ [← byteRow "issuedAt" mBase (msgOf { baseEnvelope with issuedAt := 6 })]
  results := results ++ [← byteRow "expiresAt" mBase (msgOf { baseEnvelope with expiresAt := 101 })]
  results := results ++ [← byteRow "line" mBase (msgOf { baseEnvelope with line := spacedRaw })]
  results := results ++ [← byteRow "adapterType" mBase (msgOf { baseEnvelope with adapterType := "mcp2" })]
  results := results ++ [← byteRow "adapterVersion" mBase (msgOf { baseEnvelope with adapterVersion := "2025-06-19" })]
  results := results ++ [← byteRow "session" mBase (msgOf { baseEnvelope with session := "session-1x" })]
  results := results ++ [← byteRow "policyVersion" mBase (msgOf { baseEnvelope with policyVersion := "policy-1x" })]
  results := results ++ [← byteRow "effect.resource" mBase
    (msgOf { baseEnvelope with effect := some { baseClaim with resource := "db.executex" } })]
  results := results ++ [← byteRow "effect.action" mBase
    (msgOf { baseEnvelope with effect := some { baseClaim with action := "writex" } })]
  results := results ++ [← byteRow "effect.args" mBase
    (msgOf { baseEnvelope with effect := some { baseClaim with args := "{}" } })]
  results := results ++ [← byteRow "effect.metadata" mBase
    (msgOf { baseEnvelope with effect := some {
      baseClaim with metadata := .present "{\"probe\":true}" } })]
  results := results ++ [← byteRow "effect presence" mBase (msgOf { baseEnvelope with effect := none })]

  let failures := results.filter (fun r => !r) |>.length
  IO.println s!"field-warrant: {results.length} controls, {failures} failures"
  pure (if failures == 0 then 0 else 1)

end Test.FieldWarrant

def main : IO UInt32 := Test.FieldWarrant.main
