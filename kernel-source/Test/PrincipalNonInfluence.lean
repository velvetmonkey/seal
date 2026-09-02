/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import SealV2.PrincipalNonInfluence
import Test.V2ValidationFixtures

/-!
# Principal non-influence — the runnable SHOW control (K2)

The runtime leg of `SealV2/PrincipalNonInfluence.lean`. Real TweetNaCl
Ed25519 (the linked `lean_seal_ed25519_verify` leaf) verifies the checked-in
witness signatures, discharging operationally the two crypto hypotheses the
kernel witness is conditional on, and the full pipeline runs against the
fixture `baseState` (real approval, real approval signature) so both
principals reach a genuine `Allow`.

Run: `lake exe principal_non_influence_show`             (all controls)
     `lake exe principal_non_influence_show messages`    (signing targets)

GREEN/RED lines, nonzero exit on any RED. This control goes RED if a future
change makes the decision value principal-dependent (the refutation channel
for a V2.1-style `AuthenticatedPrincipal`), if the witness principals stop
authenticating as two DISTINCT ids, or if either leg stops reaching `Allow`
(runtime vacuity guard). Signature regeneration:
`test/v2/principal_noninfluence_sign_fixture.py`.
-/

open SealV2 SealV2.Effect Test.V2ValidationFixtures

/-- `alice`'s envelope with the F3 effect claim PRESENT (Option-encoded,
    signed presence byte) and SET to the parser-derived effect of the judged
    line — the present-claim difference the kernel witness cannot evaluate
    is exercised here at runtime. `none` if the fixture line stops parsing
    as a capability request (that is a RED). -/
def aliceEffectful : Option EffectEnvelope :=
  match deriveEffect wAlice.line with
  | none => none
  | some claim => some { wAlice with effect := some claim }

/-- Real Ed25519 signature (seed-`alice` key) over
    `effectMessage wAuthorityA aliceEffectful` — regenerate with
    `test/v2/principal_noninfluence_sign_fixture.py`. -/
def sigAliceFxHex : String :=
  "45fed61e414100c885bb6ff90772e48354690e055b9c5f88b6d4d031782bcdf94a600f4e93a00092f31081464810efb78bb3d31e763e2774b871d0cab69e6300"

/-- Tampered signature: `wSigAHex` with its last hex digit flipped (`01` →
    `08`) — must fail verification. The control below asserts the coupling
    (same length, differs from the pin) so a regenerated `wSigAHex` cannot
    silently leave this stale-but-equal. -/
def sigATampered : String :=
  "5ffa8362458db9fd4ee92098185b49ee72b3d83e3a833b0ff65d6e71c301d7d3e81300d05711f76e19050372cca53aa6bce314401aaae8b14ce145a5b1c42808"

structure Outcome where
  failures : Nat := 0

def check (o : Outcome) (name : String) (ok : Bool) : IO Outcome := do
  if ok then
    IO.println s!"GREEN  {name}"
    pure o
  else
    IO.println s!"RED    {name}"
    pure { o with failures := o.failures + 1 }

def describe : Decision → String
  | .Block => "Block"
  | .Allow out => s!"Allow {out}"

def runControls : IO UInt32 := do
  let mut o : Outcome := {}

  -- Fixture coupling: the witness line IS the fixture's valid line.
  o ← check o "witness line equals fixture validRaw" (wAlice.line == validRaw)
  o ← check o "witness session equals fixture baseState.session"
    (wState.session == baseState.session)

  -- R1/R2: both witness principals authenticate, with real crypto.
  let vA := verifyEffect wAuthorityA wRegistry wAlice wSigAHex
  let vB := verifyEffect wAuthorityB wRegistry wBob wSigBHex
  o ← check o "alice authenticates (verifyEffect = some, id = alice)"
    (match vA with | some p => p.id == "alice" | none => false)
  o ← check o "bob authenticates (verifyEffect = some, id = bob)"
    (match vB with | some p => p.id == "bob" | none => false)

  -- R3: the principals are DISTINCT (non-vacuity: two different callers).
  o ← check o "authenticated principals are distinct"
    (match vA, vB with | some pa, some pb => pa != pb | _, _ => false)

  -- R4/R5: both runs reach a genuine Allow (runtime vacuity guard).
  let dA := effectStep wAuthorityA wRegistry wMcp wAlice wSigAHex baseState
  let dB := effectStep wAuthorityB wRegistry wCli wBob wSigBHex baseState
  o ← check o s!"alice run reaches Allow (got: {describe dA})"
    (match dA with | .Allow _ => true | .Block => false)
  o ← check o s!"bob run reaches Allow (got: {describe dB})"
    (match dB with | .Allow _ => true | .Block => false)

  -- R6: THE control — decision value invariant under the principal.
  o ← check o "PRINCIPAL NON-INFLUENCE: alice and bob decisions are equal"
    (dA == dB)

  -- R7: nonempty advisory F3 (alice signs her true derived effect) — still
  -- Allow, still the same decision.
  match aliceEffectful with
  | none =>
      o ← check o "effectful alice envelope derivable" false
  | some eFx => do
      let dFx := effectStep wAuthorityA wRegistry wMcp eFx sigAliceFxHex baseState
      o ← check o s!"effectful alice reaches Allow (got: {describe dFx})"
        (match dFx with | .Allow _ => true | .Block => false)
      o ← check o "effectful alice decision equals plain alice decision"
        (dFx == dA)

  -- R8: negative control — real crypto, not a stub: tampered sig rejects.
  o ← check o "tampered signature constant is coupled to wSigAHex"
    (sigATampered.length == wSigAHex.length && sigATampered != wSigAHex)
  o ← check o "tampered alice signature fails closed (verify = none)"
    ((verifyEffect wAuthorityA wRegistry wAlice sigATampered).isNone)
  o ← check o "tampered alice signature blocks"
    (effectStep wAuthorityA wRegistry wMcp wAlice sigATampered baseState
      == .Block)

  if o.failures == 0 then
    IO.println "ALL GREEN — principal non-influence control passed"
    pure 0
  else
    IO.println s!"{o.failures} RED control(s)"
    pure 1

def printMessages : IO UInt32 := do
  IO.println s!"alice {bytesToHex (effectMessage wAuthorityA wAlice)}"
  IO.println s!"bob {bytesToHex (effectMessage wAuthorityB wBob)}"
  match aliceEffectful with
  | none => IO.println "alice-effectful DERIVE-FAILED"; pure 1
  | some eFx =>
      IO.println s!"alice-effectful {bytesToHex (effectMessage wAuthorityA eFx)}"
      pure 0

def main (args : List String) : IO UInt32 := do
  match args with
  | [] => runControls
  | ["messages"] => printMessages
  | _ =>
      IO.eprintln "usage: principal_non_influence_show [messages]"
      pure 2
