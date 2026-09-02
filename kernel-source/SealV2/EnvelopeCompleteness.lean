/- SPDX-License-Identifier: Apache-2.0 -/

import Lean
import SealV2.EffectEnvelope

/-!
# Envelope completeness — the mechanical omission check

Ben's rule (2026-07-22 18:22): every field signed in `effectMessage` must
either be CONSULTED by a gate in the `effectStep` cone, or appear on the
explicit exemption list below with a written reason. This command FAILS THE
BUILD otherwise. It is the SHOW rule pointed at omissions: "did we remember"
becomes "the build fails if we did not".

Ported onto the Stage B branch from `feat/field-warrant` (commit `56e58b7`)
as part of the Stage B2 reconciliation: this check is the mechanical guard
against exactly the omission class B2 fixes (a signed, security-named field
nobody gates). The exemption list is re-cut for the reconciled shape — of
the six pre-strip exemptions, five named fields that no longer exist
(idempotencyKey, parentCapabilityRef, revocationSubject, audience,
causalityToken); only `nonce` remains, awaiting its replay ledger.

Mechanics — nothing here is a hand-maintained field list:

* The field list is read from the environment (`getStructureFields` on
  `EffectEnvelope`), so adding an eleventh field automatically extends the
  obligation.
* "Consulted" is computed by walking the transitive constant closure of
  `effectStep` (restricted to the `SealV2` namespace) and collecting which
  `EffectEnvelope` field projections occur. Deleting a gate, or detaching it
  from `effectStep`, removes its projections from the closure and the build
  fails.
* The walk CUTS at `wireSizedB` and `effectMessage`: those consult every
  field by construction (width checks, encoding), which is tuple MEMBERSHIP,
  not meaning — precisely the distinction the ablation established. Counting
  them would make this check vacuously green forever. This cut list is the
  check's own trusted kernel: a new encoding-only consumer of all fields
  appended here without justification would weaken the check.
* Both directions fail: a signed field with no gate and no exemption
  (omission — the `audience` failure mode), and an exemption for a field
  that IS gated (stale exemption — rot in the other direction). An
  exemption naming a nonexistent field also fails (typo guard).

The `#guard_msgs` pin on the summary line makes the gated/exempted COUNTS
part of the build contract too: silently changing either count fails.
-/

open Lean Elab Command

namespace SealV2.Effect.Completeness

/-- Signed fields DELIBERATELY not consulted by any gate, each carrying its
    written reason (verdicts from the field-warrant report,
    `/home/monkey/.mega-monkey/field-warrant-report.md`). Removing a gate
    without adding an exemption fails the build; gating an exempted field
    without removing its exemption also fails. -/
def exemptions : List (Name × String) := [
  (`nonce,
    "BOUNDARY for THIS cone only: the bare effectStep deliberately " ++
    "threads no store, so nonce is uninterpreted here. The ledgered step " ++
    "(SealV2/NonceLedger.lean, effectStepLedgered) consumes it and " ++
    "carries its own zero-exemption completeness check; host-side " ++
    "threading of the durable store remains the A6 deployment residual")]

/-- Encoding/width-only consumers of the whole tuple: consulting a field
    HERE is membership, not meaning. The closure walk cuts at these. -/
def encodingOnly : List Name :=
  [``SealV2.Effect.wireSizedB, ``SealV2.Effect.effectMessage]

/-- Transitive constant closure from `roots`, cut at `cut`, restricted to
    the `SealV2` namespace; returns the set of members of `projs`
    encountered. -/
partial def consultedProjections (env : Environment) (projs : NameSet)
    (cut : NameSet) : List Name → NameSet → NameSet → NameSet
  | [], _, acc => acc
  | c :: rest, visited, acc =>
    if visited.contains c then
      consultedProjections env projs cut rest visited acc
    else
      let visited := visited.insert c
      match env.find? c with
      | none => consultedProjections env projs cut rest visited acc
      | some info =>
          let used := (info.value?.map (·.getUsedConstants)).getD #[]
          let (acc, work) := used.foldl (init := (acc, rest))
            fun (acc, work) u =>
              if projs.contains u then (acc.insert u, work)
              else if cut.contains u then (acc, work)
              else if (`SealV2).isPrefixOf u then (acc, u :: work)
              else (acc, work)
          consultedProjections env projs cut work visited acc

/--
info: envelope completeness: 9 gated, 1 exempted, 10 signed fields reconciled
-/
#guard_msgs in
run_cmd do
  let env ← getEnv
  let structName := ``SealV2.Effect.EffectEnvelope
  let fields := getStructureFields env structName
  if fields.isEmpty then
    throwError "envelope completeness: could not read fields of {structName}"
  let projs : NameSet :=
    fields.foldl (init := {}) fun s f => s.insert (structName ++ f)
  let cut : NameSet :=
    encodingOnly.foldl (init := {}) fun s n => s.insert n
  let consulted :=
    consultedProjections env projs cut [``SealV2.Effect.effectStep] {} {}
  -- typo guard: every exemption must name a real field
  for (f, _) in exemptions do
    unless fields.contains f do
      throwError "envelope completeness: exemption names unknown field '{f}'"
  let mut errors : List String := []
  let mut gated := 0
  let mut exempted := 0
  for f in fields do
    let isGated := consulted.contains (structName ++ f)
    let isExempt := exemptions.any (·.1 == f)
    if isGated && isExempt then
      errors := errors ++
        [s!"'{f}' is gated AND exempted — remove the stale exemption"]
    else if isGated then
      gated := gated + 1
    else if isExempt then
      exempted := exempted + 1
    else
      errors := errors ++
        [s!"'{f}' is SIGNED but neither consulted by a gate in the " ++
          "effectStep cone nor exempted with a reason — add a gate or an " ++
          "exemption (SealV2/EnvelopeCompleteness.lean)"]
  unless errors.isEmpty do
    throwError "envelope completeness FAILED:\n  {String.intercalate "\n  " errors}"
  logInfo s!"envelope completeness: {gated} gated, {exempted} exempted, {fields.size} signed fields reconciled"

end SealV2.Effect.Completeness
