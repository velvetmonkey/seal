/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Environment
import Lean.Util.CollectAxioms
import Lean.Util.Path
import Seal
import SealCore
import SealV2.Crypto
import SealV2.McpVersionGate
import SealV2.SerializationContainerLemmas
import SealV2.SerializationLemmas

/-!
Module-aware axiom gate implementing Ben's 2026-07-28 ruling:

* regular kernel modules retain exactly `[propext, Classical.choice, Quot.sound]`;
* the separately enumerated unsafe compiled-code root `Ffi` has the explicit
  baseline `[propext, Classical.choice, Quot.sound, lcProof]`.

This is not one uniform baseline. `Ffi` is the only module assigned to the
unsafe compiled-code-root baseline. The characterization is limited to kernel
logical soundness of regular declarations. It says nothing about runtime,
memory-safety, or observational purity of the six unsafe wrappers.
-/

namespace Test.ModuleAxiomScan

open Lean

private def kernelBaseline : Array Name :=
  #[`propext, `Classical.choice, `Quot.sound]

private def unsafeCompiledCodeRootBaseline : Array Name :=
  #[`propext, `Classical.choice, `Quot.sound, `lcProof]

private def collectAxiomsIn (env : Environment) (decl : Name) : Array Name :=
  let (_, state) := ((CollectAxioms.collect decl).run env).run {}
  state.axioms.qsort Name.lt

private def kernelBaselineModuleNames : Array Name := #[
  `Seal.Block,
  `Seal.Channel,
  `Seal.Classify,
  `Seal.Hash,
  `Seal.JsonUtil,
  `Seal.Main,
  `Seal.Policy,
  `Seal.PolicyLegacy,
  `Seal.PolicyWire,
  `SealCore.Automaton,
  `SealCore.Event,
  `SealCore.Sha256,
  `SealV2.Canonical,
  `SealV2.Crypto,
  `SealV2.Decide,
  `SealV2.EnvelopeCompleteness,
  `SealV2.Escape,
  `SealV2.McpVersionGate,
  `SealV2.Parser,
  `SealV2.Serialization,
  `SealV2.SerializationContainerLemmas,
  `SealV2.SerializationLemmas,
  `SealCore,
  `Seal,
  `SealV2
]

private def unsafeCompiledCodeRootModuleNames : Array Name := #[
  `Ffi
]

/-
**Warrant — 2026-07-30 count bless: production 50 → 51, kernel baseline 24 → 25.**

Moving an expected-value constant to turn a red green is normally the exact
defect this gate exists to catch, so the reason is recorded at the change site
rather than left in a commit message. Two adjacent constants move here; they are
independent and are named separately below.

* WHY: `SealV2/McpVersionGate.lean` is a real, on-disk production module — the
  single authority for M.7 request admissibility and error rendering
  (`mcpVersionGate`, `McpVersionGateDecision`). It landed at `564c21f`
  (2026-07-29 12:44) after `2db4ed9` (2026-07-28 06:22) pinned
  `expectedProductionModuleCount` at 50, so the disk has read 51 since that
  commit. It was then added to `kernelBaselineModuleNames` and to this file's
  imports by `914ca10` (2026-07-29 23:12), so the array has held 25 entries
  since that commit — but neither commit moved its matching constant. Both
  numbers below are therefore corrections to stale bookkeeping, not a relaxation
  of what is checked: no module is being excused from a baseline, and the
  scanned set is unchanged by this commit.
* WHY KERNEL, NOT THE UNSAFE COMPILED-CODE ROOT BASELINE: the four-name baseline
  `[propext, Classical.choice, Quot.sound, lcProof]` exists for `Ffi` alone,
  because `lcProof` is what a compiled-code root drags in. `McpVersionGate`
  declares no `unsafe`, `partial`, `opaque`, `@[extern]`, `implemented_by`,
  `axiom`, or `sorry`; it is ordinary total Lean over `Lean.Data.Json`,
  `Seal.JsonUtil`, and `SealV2.EffectEnvelope`. It belongs under the three-name
  kernel baseline, and `checkModuleDrift` keeps the assignment exclusive — a
  module named in both arrays is a failure. Assigning it to the unsafe baseline
  instead would silently widen `lcProof` acceptance to a module that does not
  need it, which is a strictly weaker claim about the same code.
* HOW: `expectedProductionModuleCount` is what `productionModuleCount` below
  measures — `.lean` files under `Seal/`, `SealCore/`, `SealV2/` plus the four
  root files that exist: 20 + 4 + 23 + 4 = 51, measured on disk at `fa499b5`.
  `expectedKernelBaselineModuleCount` is the length of
  `kernelBaselineModuleNames` above: 22 dotted modules plus the three roots
  `Seal`, `SealCore`, `SealV2` = 25.
* SHOW: `lake exe module_axiom_check` — exit 0 and `MODULE_DRIFT_GUARD PASS`
  only when both numbers match what is measured. Creating or deleting any
  production `.lean` file moves the first; adding or removing an entry from
  `kernelBaselineModuleNames` moves the second. `checkModuleDrift` collects all
  drift failures before throwing rather than throwing at the first, so one run
  names every constant that has drifted — do not regress that to `throw`, or a
  second stale constant hides behind the first.
* WHAT MOVES THESE AGAIN: `expectedProductionModuleCount` is deliberately a
  human-facing tripwire on the whole tree, not a mirror of the scanned set. It
  goes red on any new production module, and that red is the prompt to decide
  whether the module also needs a baseline assignment above. The two constants
  are independent, and the gap between them is real: 51 modules are on disk
  while 25 are named for per-module axiom scanning. A future module that moves
  only the first number is a legitimate end state ONLY if a warrant here records
  why it is out of scan scope. Bumping either number without recording that
  decision reproduces exactly the defect this block documents.
-/
private def expectedProductionModuleCount : Nat := 51
private def expectedKernelBaselineModuleCount : Nat := 25
private def expectedUnsafeCompiledCodeRootModuleCount : Nat := 1

private def productionModuleCount : IO Nat := do
  let mut count := 0
  for root in #["Seal", "SealCore", "SealV2"] do
    let paths ← (System.FilePath.mk root).walkDir
    count := count + (paths.filter fun path => path.extension == some "lean").size
  for root in #["Seal.lean", "SealCore.lean", "SealV2.lean", "Ffi.lean"] do
    if ← (System.FilePath.mk root).pathExists then
      count := count + 1
  pure count

private def checkModuleDrift : IO Unit := do
  let actual ← productionModuleCount
  IO.println s!"PRODUCTION_MODULES_ON_DISK\t{actual}"
  IO.println s!"PRODUCTION_MODULES_EXPECTED\t{expectedProductionModuleCount}"
  let mut failures : Array String := #[]
  unless actual == expectedProductionModuleCount do
    failures := failures.push
      s!"module scan: production module count drifted from {expectedProductionModuleCount} to {actual}; review the measured scan scope"
  unless kernelBaselineModuleNames.size == expectedKernelBaselineModuleCount do
    failures := failures.push
      s!"module scan: kernel-baseline assignment count drifted from {expectedKernelBaselineModuleCount} to {kernelBaselineModuleNames.size}"
  unless unsafeCompiledCodeRootModuleNames.size ==
      expectedUnsafeCompiledCodeRootModuleCount do
    failures := failures.push
      s!"module scan: unsafe compiled-code-root assignment count drifted from {expectedUnsafeCompiledCodeRootModuleCount} to {unsafeCompiledCodeRootModuleNames.size}"
  unless unsafeCompiledCodeRootModuleNames == #[`Ffi] do
    failures := failures.push
      "module scan: Ffi must be the only unsafe compiled-code-root module"
  for moduleName in unsafeCompiledCodeRootModuleNames do
    if kernelBaselineModuleNames.contains moduleName then
      failures := failures.push
        s!"module scan: {moduleName} is assigned to both axiom baselines"
  unless failures.isEmpty do
    throw <| IO.userError (String.intercalate "\n" failures.toList)
  IO.println s!"KERNEL_BASELINE\t{kernelBaseline.toList}"
  IO.println
    s!"UNSAFE_COMPILED_CODE_ROOT_BASELINE\t{unsafeCompiledCodeRootBaseline.toList}"
  IO.println
    s!"KERNEL_BASELINE_MODULES\t{kernelBaselineModuleNames.toList}"
  IO.println
    s!"UNSAFE_COMPILED_CODE_ROOT_MODULES\t{unsafeCompiledCodeRootModuleNames.toList}"
  IO.println "MODULE_DRIFT_GUARD\tPASS"

private def constantKind : ConstantInfo → String
  | .axiomInfo _  => "axiom"
  | .defnInfo _   => "definition"
  | .thmInfo _    => "theorem"
  | .opaqueInfo _ => "opaque"
  | .quotInfo _   => "quotient"
  | .inductInfo _ => "inductive"
  | .ctorInfo _   => "constructor"
  | .recInfo _    => "recursor"

private def bumpDistribution
    (distribution : List (List Name × Nat)) (footprint : List Name) :
    List (List Name × Nat) :=
  match distribution with
  | [] => [(footprint, 1)]
  | (seen, count) :: rest =>
      if seen == footprint then
        (seen, count + 1) :: rest
      else
        (seen, count) :: bumpDistribution rest footprint

private structure ScanResult where
  declarations : Nat
  outsideKernelBaseline : Nat

def scanModule
    (env : Environment)
    (moduleName : Name)
    (baselineLabel : String)
    (baseline : Array Name) :
    IO ScanResult := do
  let some moduleIdx := env.getModuleIdx? moduleName
    | throw <| IO.userError s!"module scan: module index not found for {moduleName}"
  let some moduleData := env.header.moduleData[moduleIdx]?
    | throw <| IO.userError s!"module scan: module data not found for {moduleName}"
  let declarations :=
    env.constants.fold (init := #[]) (fun names name _ =>
      if env.getModuleIdxFor? name == some moduleIdx then names.push name else names)
    |>.qsort Name.lt
  let moduleDataDeclarations := moduleData.constNames.qsort Name.lt
  unless declarations == moduleDataDeclarations do
    throw <| IO.userError
      s!"module scan: Environment.constants and ModuleData.constNames disagree for {moduleName}"
  let privateCount := declarations.filter isPrivateName |>.size
  let internalCount := declarations.filter Name.isInternalDetail |>.size
  let irNamesWithConstantInfo :=
    moduleData.extraConstNames.filter fun name => (env.find? name).isSome

  IO.println s!"MODULE\t{moduleName}"
  IO.println s!"MODULE_BASELINE\t{moduleName}\t{baselineLabel}\t{baseline.toList}"
  IO.println s!"MODULE_INDEX\t{moduleIdx}"
  IO.println s!"DECLARATIONS\t{declarations.size}"
  IO.println "MODULE_DATA_CONSTNAMES_MATCH\ttrue"
  IO.println s!"PRIVATE_DECLARATIONS\t{privateCount}"
  IO.println s!"INTERNAL_DETAIL_DECLARATIONS\t{internalCount}"
  IO.println s!"IR_ONLY_NAMES_EXCLUDED\t{moduleData.extraConstNames.size}"
  IO.println s!"IR_NAMES_WITH_CONSTANT_INFO\t{irNamesWithConstantInfo.size}"
  unless irNamesWithConstantInfo.isEmpty do
    IO.println s!"IR_NAMES_WITH_CONSTANT_INFO_LIST\t{irNamesWithConstantInfo.toList}"

  let mut distribution : List (List Name × Nat) := []
  let mut outsideKernelBaselineCount := 0
  for decl in declarations do
    let some info := env.find? decl
      | throw <| IO.userError s!"module scan: ConstantInfo not found for {decl}"
    let axioms := collectAxiomsIn env decl
    distribution := bumpDistribution distribution axioms.toList
    let outside := axioms.filter fun axiomName => !baseline.contains axiomName
    unless outside.isEmpty do
      IO.println
        s!"OUTSIDE_BASELINE\t{moduleName}\t{decl}\t{constantKind info}\tOUTSIDE={outside.toList}\tFULL={axioms.toList}"
      throw <| IO.userError s!"module scan: outside-baseline footprint in {moduleName}.{decl}"
    let outsideKernel :=
      axioms.filter fun axiomName => !kernelBaseline.contains axiomName
    unless outsideKernel.isEmpty do
      outsideKernelBaselineCount := outsideKernelBaselineCount + 1
      IO.println
        s!"OUTSIDE_KERNEL_BASELINE\t{moduleName}\t{decl}\t{constantKind info}\tOUTSIDE={outsideKernel.toList}\tFULL={axioms.toList}"

  for (footprint, count) in distribution do
    IO.println s!"FOOTPRINT\t{moduleName}\t{count}\t{footprint}"
  IO.println "OUTSIDE_BASELINE_COUNT\t0"
  IO.println
    s!"OUTSIDE_KERNEL_BASELINE_COUNT\t{outsideKernelBaselineCount}"
  IO.println s!"MODULE_COMPLETE\t{moduleName}\t{declarations.size}"
  pure {
    declarations := declarations.size
    outsideKernelBaseline := outsideKernelBaselineCount
  }

def scanAll : IO Unit := do
  checkModuleDrift
  initSearchPath (← findSysroot)
  let kernelStart ← IO.monoMsNow
  -- The two serialization-lemma modules both define
  -- `SealV2.skipWs_cons_of_not_ws`, so scan `SerializationLemmas` in an
  -- isolated environment to keep module provenance unambiguous.
  let sharedKernelModuleNames :=
    kernelBaselineModuleNames.filter fun moduleName =>
      moduleName != `SealV2.SerializationLemmas
  let imports : Array Import :=
    sharedKernelModuleNames.map fun moduleName => { module := moduleName }
  let env ← importModules imports {} (level := .private)
  let mut kernelDeclarationTotal := 0
  for moduleName in sharedKernelModuleNames do
    let result ← scanModule env moduleName "KERNEL" kernelBaseline
    kernelDeclarationTotal := kernelDeclarationTotal + result.declarations
  let serializationLemmasEnv ←
    importModules #[{ module := `SealV2.SerializationLemmas }] {} (level := .private)
  let serializationResult ←
    scanModule serializationLemmasEnv `SealV2.SerializationLemmas
      "KERNEL" kernelBaseline
  kernelDeclarationTotal :=
    kernelDeclarationTotal + serializationResult.declarations
  let kernelElapsedMs := (← IO.monoMsNow) - kernelStart
  IO.println
    s!"BASELINE_COMPLETE\tKERNEL\tMODULES={kernelBaselineModuleNames.size}\tDECLARATIONS={kernelDeclarationTotal}\tWALL_CLOCK_MS={kernelElapsedMs}"

  -- `Ffi` and `Seal.Main` both define root `main`, so the explicitly assigned
  -- unsafe compiled-code root is imported and scanned in an isolated environment.
  let unsafeStart ← IO.monoMsNow
  let ffiEnv ← importModules #[{ module := `Ffi }] {} (level := .private)
  let ffiResult ←
    scanModule ffiEnv `Ffi "UNSAFE_COMPILED_CODE_ROOT"
      unsafeCompiledCodeRootBaseline
  let unsafeElapsedMs := (← IO.monoMsNow) - unsafeStart
  IO.println
    s!"BASELINE_COMPLETE\tUNSAFE_COMPILED_CODE_ROOT\tMODULES={unsafeCompiledCodeRootModuleNames.size}\tDECLARATIONS={ffiResult.declarations}\tWALL_CLOCK_MS={unsafeElapsedMs}"
  IO.println
    s!"UNSAFE_COMPILED_CODE_ROOT_OUTSIDE_KERNEL_BASELINE_DECLARATIONS\t{ffiResult.outsideKernelBaseline}"
  IO.println
    s!"MODULES_COMPLETE\t{kernelBaselineModuleNames.size + unsafeCompiledCodeRootModuleNames.size}"
  IO.println
    s!"DECLARATIONS_COMPLETE\t{kernelDeclarationTotal + ffiResult.declarations}"

end Test.ModuleAxiomScan

def main : IO UInt32 := do
  try
    Test.ModuleAxiomScan.scanAll
    pure 0
  catch error =>
    IO.eprintln s!"module axiom check: FAIL: {error}"
    pure 1
