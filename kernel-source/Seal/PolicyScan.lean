/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Classify

namespace Seal

open Lean SealCore

inductive ManifestEffect where
  | readonly
  | mutating
  deriving Repr, BEq, DecidableEq

/-- One concrete operation in a finite pinned manifest. Arguments are part of
    the manifest because conditional match rules cannot be checked soundly from
    tool names alone. -/
structure ManifestEntry where
  id : String
  tool : String
  arguments : Json
  effect : ManifestEffect

def entrySafe (policy : Policy) (entry : ManifestEntry) : Bool :=
  match entry.effect with
  | .readonly => true
  | .mutating => decide (
      (classifyToolCall policy entry.tool entry.arguments).toEvent ≠ .benign)

def noOrphanExplicitAllows (policy : Policy) (manifest : List ManifestEntry) : Bool :=
  policy.tools.all fun rule =>
    rule.mode != .allow || manifest.any (fun entry => entry.tool == rule.name)

def scanPass (policy : Policy) (manifest : List ManifestEntry) : Bool :=
  manifest.all (entrySafe policy) && noOrphanExplicitAllows policy manifest

/-- Coverage-completeness over the supplied finite manifest: if scan passes,
    every entry annotated mutating is denied or guarded, never explicitly
    allowed. This theorem says nothing about operations absent from the
    manifest or the correctness of its effect annotations. -/
theorem scan_pass_sound (policy : Policy) (manifest : List ManifestEntry)
    (hpass : scanPass policy manifest = true) (entry : ManifestEntry)
    (hmember : entry ∈ manifest) (heffect : entry.effect = .mutating) :
    (classifyToolCall policy entry.tool entry.arguments).toEvent ≠ .benign := by
  have both : (∀ item ∈ manifest, entrySafe policy item = true) ∧
      noOrphanExplicitAllows policy manifest = true := by
    simpa [scanPass, List.all_eq_true] using hpass
  have hall := both.1
  have hsafe := hall entry hmember
  simp [entrySafe, heffect] at hsafe
  exact hsafe

theorem scan_pass_no_orphan_allow (policy : Policy) (manifest : List ManifestEntry)
    (hpass : scanPass policy manifest = true) :
    noOrphanExplicitAllows policy manifest = true :=
  by
    have both : (∀ item ∈ manifest, entrySafe policy item = true) ∧
        noOrphanExplicitAllows policy manifest = true := by
      simpa [scanPass, List.all_eq_true] using hpass
    exact both.2

end Seal
