/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures
import Test.FieldWarrantCorpus

/-!
# Dishonest-control probe — the harness-of-the-harness

Permanent regression rebuild of the cold frisk's DISHONEST-A/B/C probes
(2026-07-23 frisk of `77380fe`, finding F-HARNESS-1). Each control is
deliberately dishonest; the exe PASSES iff the harness's defenses catch every
one of them — and iff DISHONEST-A still fools the OLD label-keyed join shape,
proving the probe reproduces the original hole rather than a strawman.

* **A** — genuinely forges `nonce`, labels itself `field := "keyId"`. Passes
  `profileMatches` (it IS a real signature red); must be killed by the derived
  adequacy check and excluded from the derived-keyed join.
* **A2** — same forgery, but also LIES about the mint preimage to make the
  derived diff say `keyId`. Must be killed by mint validity (`sig` does not
  verify over the invented preimage).
* **B** — a real `adapterGate` red (valid sig over its own envelope) labelled
  `.signature`. Killed by the profile (`flipSig = false`).
* **C** — forges `nonce` AND trips `adapterGate`, labelled `.signature`.
  Killed by the profile AND by adequacy (derived set not a singleton).

Plus the SECOND frisk's probes (2026-07-23 frisk of `9b56c63`, finding
F-ADEQ-1) — dishonest controls aimed at the DIFF, not the label:

* **D** — fabricates a step-level `session` witness, for a field the harness
  itself declares an UN-WITNESSABLE NAMED GAP: `e :=` the fully-valid green
  `baseEnvelope`, `sig := sigSession` (existing corpus constant), `mintedE :=`
  sigSession's true preimage. No new crypto. Under the v2 adequacy shape
  (free `mintedE`) it passed profile + adequacy + the derived-keyed join.
  Must be killed by the ANCHOR PIN and by GAP EXCLUSION.
* **E** — the SAME `e`, credited field swapped to `policyVersion` purely by
  choosing a different `mintedE` — proving v2 attribution was a function of
  the author's mint choice, not of `c.e`. Must be killed by the anchor pin.
-/

open SealV2 SealV2.Effect Test.V2ValidationFixtures Test.FieldWarrant

namespace Test.FieldWarrantDishonest

def dishonestA : Control :=
  { name := "DISHONEST-A mislabeled: forges nonce, field=keyId"
    field := "keyId"
    e := { baseEnvelope with nonce := forgedNonce }, sig := sigBase
    st := baseState, med := mediator, reg := registry, reason := .signature }

def dishonestA2 : Control :=
  { dishonestA with
    name := "DISHONEST-A2 invented mint preimage: derived diff says keyId"
    mintedE := { baseEnvelope with nonce := forgedNonce, keyId := "mallory2" } }

def dishonestB : Control :=
  { name := "DISHONEST-B gate-masked: real adapterGate red labelled signature"
    field := "adapterType"
    e := { baseEnvelope with adapterType := "cli" }, sig := sigAdapterType
    st := baseState, med := mediator, reg := registry, reason := .signature }

def dishonestC : Control :=
  { name := "DISHONEST-C overdetermined: forge nonce AND trip adapterGate"
    field := "nonce"
    e := { baseEnvelope with nonce := forgedNonce, adapterType := "cli" }
    sig := sigBase
    st := baseState, med := mediator, reg := registry, reason := .signature }

/-- ATTACK-D, rebuilt verbatim from the F-ADEQ-1 frisk: manufacture a
    step-level `session` signature witness — a DECLARED NAMED GAP — from a
    fully-valid `e`, an existing corpus signature, and an author-chosen
    `mintedE` (the signature's true preimage). Every part is genuine except
    the ATTRIBUTION. -/
def attackD : Control :=
  { name := "ATTACK-D fabricated session witness (e = green base, mintedE = sigSession preimage)"
    field := "session"
    e := baseEnvelope, sig := sigSession
    st := baseState, med := mediator, reg := registry, reason := .signature
    mintedE := { baseEnvelope with session := "session-2" } }

/-- ATTACK-E: identical `e`, credited field steered to `policyVersion` purely
    by swapping `mintedE`/`sig` — v2 attribution was the author's choice. -/
def attackE : Control :=
  { attackD with
    name := "ATTACK-E same e, credited field swapped via mintedE"
    field := "policyVersion"
    sig := sigEmptyPolicyVersion
    mintedE := { baseEnvelope with policyVersion := "" } }

/-- The PRE-REPAIR join shape: keyed on the unverified `c.field` string.
    Kept here ONLY to prove DISHONEST-A reproduces the original hole. -/
def oldJoinWitness (cs : List Control) (field : String) : Option Control :=
  cs.find? (fun c =>
    c.field == field && c.reason == Reason.signature && c.profileMatches)

/-- The v2 adequacy shape (commit `9b56c63`), copied VERBATIM: mint validity +
    singleton + bytes-move over a FREE `mintedE`. Kept here ONLY to prove
    ATTACK-D/E reproduce frisk F-ADEQ-1 rather than a strawman. -/
def sigAdequateV2 (c : Control) : Bool :=
  let mintValid := (verifyEffect authority c.reg c.mintedE c.sig).isSome
  let singleton :=
    match envDiff c.e c.mintedE with
    | [f] =>
        f == c.field &&
        (match patchField f c.e c.mintedE with
         | some patched => patched == c.e
         | none => false)
    | _ => false
  let bytesMove := effectMessage authority c.e != effectMessage authority c.mintedE
  mintValid && singleton && bytesMove

/-- The v2 join (commit `9b56c63`): derived-keyed, but with the free-mint
    v2 adequacy. What ATTACK-D actually defeated. -/
def joinWitnessV2 (cs : List Control) (field : String) : Option Control :=
  cs.find? (fun c =>
    c.reason == Reason.signature && c.profileMatches &&
    sigAdequateV2 c && c.perturbedFields == [field])

/-- ATTACK-D2: the anchor-HONEST session perturbation (`mintedE` = the pinned
    base, `e` differs only in session). The v2 ADEQUACY shape accepted this
    (mint valid, singleton, bytes move); only the profile stood between it and
    credit. v3's GAP EXCLUSION refuses it at the adequacy layer as well — the
    named-gap cross-check the frisk asked for, independent of the profile. -/
def attackD2 : Control :=
  { name := "ATTACK-D2 anchor-honest session perturbation"
    field := "session"
    e := { baseEnvelope with session := "session-2" }, sig := sigBase
    st := baseState, med := mediator, reg := registry, reason := .signature }

/-- DISHONEST-F (frisk F-ADEQ-2): registry substituted with a non-canonical
    pubkey. The anchor pin already forces `sig` to be a corpus constant that
    only the canonical test key verifies, so mint validity dies with it;
    `keysPinned` is the explicit belt that names the defect. -/
def dishonestF : Control :=
  { name := "DISHONEST-F attacker-key registry"
    field := "nonce"
    e := { baseEnvelope with nonce := forgedNonce }, sig := sigBase
    st := baseState, med := mediator
    reg := [{ id := "alice", pubkey := "0000000000000000000000000000000000000000000000000000000000000001" }]
    reason := .signature }

/-- The repaired join shape, exactly as the mutation harness runs it:
    keyed on the DERIVED perturbation singleton + full adequacy. -/
def newJoinWitness (cs : List Control) (field : String) : Option Control :=
  cs.find? (fun c =>
    c.reason == Reason.signature && c.profileMatches &&
    c.sigAdequate && c.perturbedFields == [field])

def main : IO UInt32 := do
  let mut fails : Nat := 0
  let check (name : String) (expected : Bool) (got : Bool) : IO Bool := do
    let ok := got == expected
    IO.println s!"{if ok then "PASS" else "FAIL"}  {name}: expected {expected}, got {got}"
    pure ok

  IO.println "== PROBE VALIDITY (A must reproduce the ORIGINAL hole) =="
  -- A really is a genuine signature red — that is what made the hole a hole.
  if !(← check "A.profileMatches (genuine sig red)" true dishonestA.profileMatches) then
    fails := fails + 1
  -- Substitute A for the real keyId signature row: the old label-keyed join
  -- is fooled and credits keyId.
  let probeCorpus := dishonestA ::
    corpus.filter (fun c => !(c.field == "keyId" && c.reason == Reason.signature))
  match oldJoinWitness probeCorpus "keyId" with
  | some w =>
      IO.println s!"PASS  old label-keyed join FOOLED (as frisked): keyId credited to \"{w.name}\""
  | none =>
      fails := fails + 1
      IO.println "FAIL  old join NOT fooled — probe does not reproduce F-HARNESS-1"

  IO.println "\n== REPAIR (every dishonest control is CAUGHT) =="
  -- A: adequacy kills the mislabel (derived = [nonce], declared = keyId)...
  if !(← check "A.sigAdequate" false dishonestA.sigAdequate) then fails := fails + 1
  IO.println s!"      A derived perturbation = {dishonestA.perturbedFields} (declared keyId)"
  -- ...and the derived-keyed join no longer credits keyId.
  match newJoinWitness probeCorpus "keyId" with
  | some w =>
      fails := fails + 1
      IO.println s!"FAIL  derived-keyed join STILL fooled: keyId credited to \"{w.name}\""
  | none =>
      IO.println "PASS  derived-keyed join: keyId renders MISSING — A caught"
  -- A does not get to witness nonce either: its label lies, adequacy is dead.
  match newJoinWitness [dishonestA] "nonce" with
  | some _ =>
      fails := fails + 1
      IO.println "FAIL  A credited to nonce despite dead adequacy"
  | none =>
      IO.println "PASS  A witnesses NOTHING (label lie kills all credit)"
  -- A2: the invented preimage makes the derived diff say keyId, but the sig
  -- does not verify over it — mint validity kills it.
  if !(← check "A2.sigAdequate (mint validity)" false dishonestA2.sigAdequate) then
    fails := fails + 1
  IO.println s!"      A2 derived perturbation = {dishonestA2.perturbedFields} (mint invalid)"
  -- B: gate-masked — the inverse-profile discriminator, as frisked.
  if !(← check "B.profileMatches" false dishonestB.profileMatches) then fails := fails + 1
  if !(← check "C.profileMatches" false dishonestC.profileMatches) then fails := fails + 1
  -- C also fails adequacy independently: two fields moved at once.
  if !(← check "C.sigAdequate (non-singleton)" false dishonestC.sigAdequate) then
    fails := fails + 1
  IO.println s!"      C derived perturbation = {dishonestC.perturbedFields}"

  IO.println "\n== F-ADEQ-1 PROBE VALIDITY (D/E must reproduce the SECOND frisk's hole) =="
  -- D is a genuine-looking signature red: sigSession is invalid over the green
  -- base, and the base passes every gate — profile cannot see the fabrication.
  if !(← check "D.profileMatches (fabrication invisible to the profile)" true attackD.profileMatches) then
    fails := fails + 1
  if !(← check "D.sigAdequateV2 (v2 adequacy FOOLED)" true (sigAdequateV2 attackD)) then
    fails := fails + 1
  match joinWitnessV2 [attackD] "session" with
  | some _ =>
      IO.println "PASS  v2 derived-keyed join FOOLED (as frisked): session — a DECLARED NAMED GAP — credited"
  | none =>
      fails := fails + 1
      IO.println "FAIL  v2 join NOT fooled — probe does not reproduce F-ADEQ-1"
  if !(← check "E.sigAdequateV2 (same e, mint steers credit)" true (sigAdequateV2 attackE)) then
    fails := fails + 1
  match joinWitnessV2 [attackE] "policyVersion" with
  | some _ =>
      IO.println "PASS  ATTACK-E under v2: SAME e credited policyVersion — attribution was the author's mint choice"
  | none =>
      fails := fails + 1
      IO.println "FAIL  ATTACK-E does not reproduce the mint-steering hole"

  IO.println "\n== F-ADEQ-1/2 REPAIR (anchor pin + gap exclusion + key pin catch D, D2, E, F) =="
  if !(← check "D.sigAdequate (v3: anchor pin + gap exclusion)" false attackD.sigAdequate) then
    fails := fails + 1
  match newJoinWitness (corpus ++ [attackD]) "session" with
  | some w =>
      fails := fails + 1
      IO.println s!"FAIL  v3 join credits session to \"{w.name}\""
  | none =>
      IO.println "PASS  v3 join: session stays UNWITNESSED (named gap intact) even with D in the corpus"
  -- D2: anchor honest, so ONLY gap exclusion (not the pin) refuses adequacy —
  -- proving the named-gap cross-check works independent of the profile.
  if !(← check "D2.sigAdequateV2 (v2 adequacy accepted the anchor-honest form)" true (sigAdequateV2 attackD2)) then
    fails := fails + 1
  if !(← check "D2.sigAdequate (v3: GAP EXCLUSION alone refuses)" false attackD2.sigAdequate) then
    fails := fails + 1
  if !(← check "E.sigAdequate (v3: anchor pin)" false attackE.sigAdequate) then
    fails := fails + 1
  match newJoinWitness [attackE] "policyVersion" with
  | some _ =>
      fails := fails + 1
      IO.println "FAIL  E still credited policyVersion under v3"
  | none =>
      IO.println "PASS  E witnesses nothing under v3"
  if !(← check "F.sigAdequate (v3: key pin + mint validity)" false dishonestF.sigAdequate) then
    fails := fails + 1

  IO.println "\n== HONEST CORPUS UNHARMED (profile + adequacy + full join) =="
  for c in corpus do
    let ok := c.profileMatches && c.fieldAdequate
    if !ok then
      fails := fails + 1
      IO.println s!"FAIL  honest control now rejected: {c.name} (profile={c.profileMatches}, adequate={c.fieldAdequate})"
  for field in requiredSignatureFields do
    match newJoinWitness corpus field with
    | some _ => pure ()
    | none =>
        fails := fails + 1
        IO.println s!"FAIL  required field lost its witness under the repair: {field}"
  if fails == 0 then
    IO.println "PASS  all honest controls keep profile+adequacy; every required field still witnessed"

  IO.println s!"\ndishonest probe: {fails} failures"
  if fails == 0 then
    IO.println "HARNESS HARDENED: A, A2, B, C, D, D2, E, F all caught; honest corpus intact."
  pure (if fails == 0 then 0 else 1)

end Test.FieldWarrantDishonest

def main : IO UInt32 := Test.FieldWarrantDishonest.main
