/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Environment
import Lean.Util.CollectAxioms
import Lean.Util.Path

namespace Test.AxiomAllowlist

open Lean

private def expectedAxioms : Array Name :=
  #[`propext, `Classical.choice, `Quot.sound]

private def collectAxiomsIn (env : Environment) (decl : Name) : Array Name :=
  let (_, state) := ((CollectAxioms.collect decl).run env).run {}
  state.axioms.qsort Name.lt

def check (moduleName : Name) (declarations : Array Name) : IO UInt32 := do
  initSearchPath (← findSysroot)
  let env ← importModules #[{ module := moduleName }] {}
  let expected := expectedAxioms.qsort Name.lt
  let mut actualUnion : Array Name := #[]
  let mut passed := true

  for decl in declarations do
    unless env.contains decl do
      IO.eprintln s!"axiom allowlist: declaration not found: {decl}"
      passed := false
    let axioms := collectAxiomsIn env decl
    if axioms.isEmpty then
      IO.println s!"'{decl}' does not depend on any axioms"
    else
      IO.println s!"'{decl}' depends on axioms: {axioms.toList}"
    for axiomName in axioms do
      unless expected.contains axiomName do
        IO.eprintln s!"axiom allowlist: unexpected axiom '{axiomName}' in '{decl}'"
        passed := false
      unless actualUnion.contains axiomName do
        actualUnion := actualUnion.push axiomName

  let sortedActual := actualUnion.qsort Name.lt
  unless sortedActual == expected do
    IO.eprintln s!"axiom allowlist: expected exactly {expected.toList}, got {sortedActual.toList}"
    passed := false

  if passed then
    IO.println s!"axiom allowlist: PASS exactly {expected.toList}"
    pure 0
  else
    pure 1

end Test.AxiomAllowlist
