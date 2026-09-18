/- SPDX-License-Identifier: Apache-2.0 -/
import SealCore.Safety
import Kernels.Safety
import Host.Composition
import FfiSpec
import Host.CommitRegistry
import Ffi
import Host.DispatchSpelled
import Lean.Util.CollectAxioms

/-!
The source end of the release correspondence argument. Elaborating this module
checks the named declarations against the same classical axiom allowlist as
Test.Axioms. This does not establish correspondence to any compiled artifact.
-/

open Lean Elab Command in
run_cmd do
  let declarations : Array Name := #[
    `SealCore.guarded_allow_iff_live,
    `Kernels.safetyKernel,
    `Kernels.safety_verdict_allow_iff,
    `Host.composed_non_bypass,
    `Host.step_forward_non_bypass,
    `Ffi.safety_always_registered,
    `Host.commitInstsFor_wiring,
    `Ffi.stepImpl_spelled,
    `Host.dispatch_spelled]
  let allowed : Array Name := #[`propext, `Classical.choice, `Quot.sound]
  let env ← getEnv
  for decl in declarations do
    unless env.contains decl do
      throwError "correspondence proof: missing declaration {decl}"
    let (_, state) := ((CollectAxioms.collect decl).run env).run {}
    let axioms := state.axioms.qsort Name.lt
    for axiomName in axioms do
      unless allowed.contains axiomName do
        throwError "correspondence proof: forbidden axiom {axiomName} in {decl}"
    logInfo m!"correspondence proof: {decl}: {axioms.toList}"
