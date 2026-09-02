/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures
import Test.FieldWarrantCorpus

/-!
# Field-warrant NEGATIVE-WITNESS harness (council requirement, 2026-07-23 01:56)

The mechanical form of the F1 tamper matrix. Instead of 14 hand edits, this
runs a reusable *negative witness* over the whole control corpus
(`Test.FieldWarrant.corpus`, the single source the SHOW suite also consumes):

1. **Drift guard** — re-derive each corpus row's real `effectStep` verdict and
   its reason's sub-assertions; if any row does not reproduce the SHOW suite's
   PASS, fail loudly. Ties the corpus to the shipped fixtures.
2. **Negative witness** — for each row, compute its sensitivity profile
   (flips-under-signature-mutant, gates-that-flip-it) and check it matches the
   declared reason (`Control.profileMatches`). A mismatch is a control passing
   for the wrong reason — the machine form of frisk F1.
3. **Field adequacy** (frisk F-HARNESS-1 repair) — each control's declared
   `field` is checked against the DERIVED perturbation set (`envDiff` vs the
   mint-verified preimage). A control cannot claim a field it does not touch.
4. **Claim-list join** — a HAND-AUTHORED list of every signed field that MUST
   have a profile-passing signature witness. The join is keyed on the DERIVED
   perturbation singleton, not the label string: existence is not adequacy,
   and a mislabelled witness cannot satisfy a required field. A required field
   with no passing witness renders LOUDLY (`MISSING`) and fails the run.
5. **Coverage partition** (frisk F-HARNESS-2 repair) — every label `envDiff`
   can emit must be either a required signature claim or an explicitly named
   gap; dropping an entry from `requiredSignatureFields` fails LOUDLY.
6. **Frisk reproduction** — run the same profile over the pre-F1 naive-forgery
   corpus and count how many pass for the wrong reason, recovering frisk F1's
   9-of-14 mechanically.
-/

open SealV2 SealV2.Effect Test.V2ValidationFixtures Test.FieldWarrant

namespace Test.FieldWarrantMutation

def gateName? : Reason → Option GateSel
  | .gate g => some g
  | _ => none

/-- Reproduce the SHOW suite's verdict for one corpus row from the real
    `effectStep` + `verifyEffect`, matching the reason's sub-assertions. The
    drift guard: if the shipped fixtures change under the corpus, this fails. -/
def reproducesSuiteVerdict (c : Control) : Bool :=
  let blocked := match effectStep authority c.reg c.med c.e c.sig c.st with
    | .Allow _ => false | .Block => true
  let verified := (verifyEffect authority c.reg c.e c.sig).isSome
  let allGatesPass := allGates.all (fun g => gateValue g c.med c.st c.e)
  match c.reason with
  -- `allGatesPass` here is PROVEN redundant with the profile section's
  -- `flipSig` (theorem `flipSig_implies_allGatesPass` below) but KEPT: the
  -- drift guard must stand alone as an interlock if the profile section is
  -- ever edited.
  | .signature => blocked && !verified && allGatesPass
  | .gate g => blocked && verified && (gateValue g c.med c.st c.e == false)
  | .registry => blocked && !verified

/-- `M_sig` (or the identity mutant) can only reach `decide` — and thus
    Allow — through the FULL gate conjunction, so a mutant Allow forces every
    gate to pass. -/
theorem mutant_allow_implies_gates
    (neuter : Bool) (auth : ByteArray) (reg : PrincipalRegistry)
    (med : AdapterId) (e : EffectEnvelope) (sig : String) (st : ApprovalState)
    (h : outAllow (mutantStep neuter [] auth reg med e sig st) = true) :
    allGates.all (fun g => gateValue g med st e) = true := by
  simp only [mutantStep] at h
  by_cases hgates : (allGates.all fun g => gateValue g med st e) = true
  · exact hgates
  · exfalso
    -- `[].contains g || x` is definitionally `x`, so the mutant's gate
    -- conjunction (with `disabled = []`) is the plain one.
    have hb : (allGates.all fun g => List.contains [] g || gateValue g med st e) = false :=
      Bool.eq_false_iff.mpr (fun hx => hgates hx)
    rw [hb] at h
    simp [outAllow] at h

/-- FRISK STRUCTURAL NOTE, settled: for a Blocked control, `flipSig = true`
    already implies every gate passes (the drift guard's `allGatesPass` clause
    for `.signature` is redundant with the profile section). Proven, and the
    clause is kept anyway as an independent interlock. -/
theorem flipSig_implies_allGatesPass (c : Control)
    (hbase : c.baseOutcome = false) (hflip : c.flipSig = true) :
    allGates.all (fun g => gateValue g c.med c.st c.e) = true := by
  unfold Control.flipSig at hflip
  rw [hbase] at hflip
  exact mutant_allow_implies_gates true authority c.reg c.med c.e c.sig c.st
    (by revert hflip
        cases outAllow (mutantStep true [] authority c.reg c.med c.e c.sig c.st) <;> simp)

/-- Every label `envDiff` can emit, DERIVED from `envDiff` itself: diff a
    fully-perturbed probe (every scalar seat and every claim sub-field moved)
    plus the presence flip against the warrant base. Feeds the COVERAGE
    PARTITION below (frisk F-HARNESS-2): each derivable label must be either
    a required signature claim or an explicitly named gap — dropping an entry
    from `requiredSignatureFields` now fails LOUDLY. -/
def envDiffLabels : List String :=
  envDiff
    { keyId := "probe", nonce := forgedNonce, issuedAt := 6, expiresAt := 101
      line := spacedRaw, adapterType := "probe", adapterVersion := "probe"
      session := "probe", policyVersion := "probe"
      effect := some {
        resource := "probe", action := "probe", args := "probe",
        metadata := .present "{\"probe\":true}" } }
    baseEnvelope
  ++ envDiff { baseEnvelope with effect := none } baseEnvelope

/- `encodingOnlyFields` (the NAMED GAPS) moved to `Test.FieldWarrantCorpus`:
   `sigAdequate`'s GAP EXCLUSION and this harness's partition + gap sections
   must read the SAME list (frisk F-ADEQ-1 repair). -/

/-- MESSAGE DISTINCTNESS witnesses for the encoding-only fields, recomputed
    here so the claim-list is self-contained. Each pair differs ONLY in the
    named field and must produce different `effectMessage` bytes. -/
def encodingWitness (field : String) : Option Bool :=
  let m := effectMessage authority baseEnvelope
  let auth2 := ByteArray.mk (Array.range 32 |>.map fun i => UInt8.ofNat (0xb0 + i))
  match field with
  | "authority" => some (m != effectMessage auth2 baseEnvelope)
  | "effect.resource" => some
      (m != effectMessage authority { baseEnvelope with effect := some { baseClaim with resource := "db.executex" } })
  | "effect.action" => some
      (m != effectMessage authority { baseEnvelope with effect := some { baseClaim with action := "writex" } })
  | "effect.args" => some
      (m != effectMessage authority { baseEnvelope with effect := some { baseClaim with args := "{}" } })
  | "effect.metadata" => some
      (m != effectMessage authority {
        baseEnvelope with effect := some {
          baseClaim with metadata := .present "{\"probe\":true}" } })
  | "session" => some
      (m != effectMessage authority { baseEnvelope with session := "session-1x" })
  | _ => none

def main : IO UInt32 := do
  let mut fails : Nat := 0

  IO.println "== ANCHOR VALIDATION (both mint anchors GREEN under canonical config) =="
  -- The F-ADEQ-1 pin is only as good as the anchors: each canonical
  -- (envelope, sig) pair must verify AND Allow under the canonical
  -- state/mediator/registry. A corrupted anchor fails the WHOLE corpus here —
  -- it cannot selectively fabricate one field's credit.
  for (a, sig) in mintAnchors do
    let verified := (verifyEffect authority registry a sig).isSome
    let allowed := match effectStep authority registry mediator a sig baseState with
      | .Allow _ => true | .Block => false
    let ok := verified && allowed
    if !ok then fails := fails + 1
    IO.println s!"{if ok then "PASS" else "FAIL"}  anchor effect={if a.effect.isSome then "present" else "absent"}: sigVerifies={verified} step={if allowed then "Allow" else "Block"}"

  IO.println "\n== DRIFT GUARD (corpus reproduces the SHOW-suite verdict) =="
  for c in corpus do
    let ok := reproducesSuiteVerdict c
    if !ok then fails := fails + 1
    IO.println s!"{if ok then "PASS" else "FAIL"}  [{c.reason.describe}] {c.name}"

  IO.println "\n== NEGATIVE WITNESS (sensitivity profile matches declared reason) =="
  for c in corpus do
    let ok := c.profileMatches
    if !ok then fails := fails + 1
    let sens := (c.sensGates.map (·.name))
    IO.println s!"{if ok then "PASS" else "FAIL"}  [{c.reason.describe}] {c.name}: flipSig={c.flipSig} sensGates={sens}"

  IO.println "\n== FIELD ADEQUACY (derived perturbation matches the declared field) =="
  for c in corpus do
    let ok := c.fieldAdequate
    if !ok then fails := fails + 1
    IO.println s!"{if ok then "PASS" else "FAIL"}  [{c.reason.describe}] {c.name}: declared={c.field} derived={c.perturbedFields}"

  IO.println "\n== CLAIM-LIST JOIN (keyed on the DERIVED perturbation, not the label) =="
  for field in requiredSignatureFields do
    let witnesses := corpus.filter (fun c =>
      c.reason == Reason.signature && c.profileMatches &&
      c.sigAdequate && c.perturbedFields == [field])
    match witnesses with
    | [] =>
        fails := fails + 1
        IO.println s!"FAIL  MISSING SIGNATURE WITNESS: {field}"
    | w :: _ =>
        IO.println s!"PASS  {field}: witnessed by \"{w.name}\" (derived={w.perturbedFields})"

  IO.println "\n== COVERAGE PARTITION (every derivable field label claimed or gap-named) =="
  let gapFields := encodingOnlyFields.map (·.1)
  for lbl in envDiffLabels do
    let claimed := requiredSignatureFields.contains lbl
    let gapped := gapFields.contains lbl
    if claimed && gapped then
      fails := fails + 1
      IO.println s!"FAIL  {lbl}: BOTH claimed and gap-named (partition broken)"
    else if !claimed && !gapped then
      fails := fails + 1
      IO.println s!"FAIL  {lbl}: UNCLAIMED — neither a required signature claim nor a named gap"
    else
      IO.println s!"PASS  {lbl}: {if claimed then "required signature claim" else "named gap"}"

  IO.println "\n== GAP EXCLUSION (a declared named-gap field can NEVER be credited) =="
  -- Frisk F-ADEQ-1's forward-looking danger: a fabricated-base control
  -- "closing" a named gap would defeat the gap machinery's whole purpose.
  -- Assert the join yields NO witness for any gap field over the live corpus
  -- (sigAdequate also refuses gap fields structurally; this is the join-level
  -- interlock).
  for (field, _) in encodingOnlyFields do
    let credited := corpus.filter (fun c =>
      c.reason == Reason.signature && c.profileMatches &&
      c.sigAdequate && c.perturbedFields == [field])
    match credited with
    | [] => IO.println s!"PASS  {field}: no signature control credits the gap"
    | w :: _ =>
        fails := fails + 1
        IO.println s!"FAIL  {field}: GAP CREDITED by \"{w.name}\" — named-gap machinery defeated"

  IO.println "\n== NAMED GAPS (no step-level sig control — MESSAGE DISTINCTNESS + kernel proofs) =="
  for (field, why) in encodingOnlyFields do
    match encodingWitness field with
    | some true => IO.println s!"PASS  {field}: named gap ({why}); bytes distinct"
    | some false =>
        fails := fails + 1
        IO.println s!"FAIL  {field}: MESSAGE DISTINCTNESS witness collapsed"
    | none =>
        fails := fails + 1
        IO.println s!"FAIL  {field}: no encoding witness defined"

  IO.println "\n== FRISK REPRODUCTION (pre-F1 naive forgeries, all CLAIM .signature) =="
  let mut wrongReason : Nat := 0
  for c in naiveCorpus do
    let ok := c.profileMatches
    if !ok then wrongReason := wrongReason + 1
    let why := if ok then "measures signature"
      else if c.flipSig then "sig-sensitive but gate-coupled"
      else s!"NOT sig-sensitive — masked by {(c.gateFalseSet.map (·.name))}/registry"
    IO.println s!"{if ok then "honest" else "WRONG-REASON"}  {c.name}: {why}"
  IO.println s!"frisk reproduction: {wrongReason} of {naiveCorpus.length} naive controls pass for the WRONG reason"
  let pct := wrongReason * 100 / naiveCorpus.length
  IO.println s!"  = {pct}% (frisk hand-analysis said 9/14; council threshold was ≥20% more than honest)"

  IO.println s!"\nnegative-witness harness: {fails} failures across anchor+drift+profile+adequacy+claim-list+partition+gap-exclusion+gap"
  if fails == 0 then
    IO.println "REPAIRED CORPUS: 0 controls pass for the wrong reason; every required field witnessed."
  pure (if fails == 0 then 0 else 1)

end Test.FieldWarrantMutation

def main : IO UInt32 := Test.FieldWarrantMutation.main
