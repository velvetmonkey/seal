/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Classify

namespace Seal

open Lean SealCore

theorem no_matching_rule_blocks :
    resolveRuleDecisions [] = .event .defaultDeny "no matching policy rule" := rfl

theorem explicit_allow_is_an_origin :
    resolveRuleDecisions [.allow] = .event .benign "explicit policy allow" := rfl

theorem guard_dominates_explicit_allow (target : TargetHash) (text : String) :
    resolveRuleDecisions [.allow, .guard target text] = .event (.guarded target) text := by
  simp [resolveRuleDecisions, firstBlocking?, guardDecisions, sameGuardTarget]

theorem blocking_decision_dominates {decisions : List RuleDecision} {reason : String}
    (h : firstBlocking? decisions = some reason) :
    resolveRuleDecisions decisions = .event .defaultDeny reason := by
  simp [resolveRuleDecisions, h]

theorem firstBlocking_append_deny (decisions : List RuleDecision) (reason : String) :
    ∃ found, firstBlocking? (decisions ++ [.deny reason]) = some found := by
  induction decisions with
  | nil => exact ⟨reason, rfl⟩
  | cons decision rest ih =>
      cases decision with
      | deny found => exact ⟨found, rfl⟩
      | invalid found => exact ⟨found, rfl⟩
      | allow => simpa [firstBlocking?] using ih
      | guard target text => simpa [firstBlocking?] using ih

theorem adding_deny_cannot_allow (decisions : List RuleDecision) (reason : String) :
    resolveRuleDecisions (decisions ++ [.deny reason]) ≠
      .event .benign "explicit policy allow" := by
  obtain ⟨found, h⟩ := firstBlocking_append_deny decisions reason
  rw [blocking_decision_dominates h]
  intro contradiction
  cases contradiction

theorem guardDecisions_append_guard (decisions : List RuleDecision)
    (target : TargetHash) (text : String) :
    guardDecisions (decisions ++ [.guard target text]) =
      guardDecisions decisions ++ [(target, text)] := by
  induction decisions with
  | nil => rfl
  | cons decision rest ih =>
      cases decision <;> simp [guardDecisions]

theorem adding_guard_cannot_explicitly_allow (decisions : List RuleDecision)
    (target : TargetHash) (text : String) :
    resolveRuleDecisions (decisions ++ [.guard target text]) ≠
      .event .benign "explicit policy allow" := by
  unfold resolveRuleDecisions
  split
  · intro contradiction; cases contradiction
  · rw [guardDecisions_append_guard]
    cases hguards : guardDecisions decisions with
    | nil => simp [sameGuardTarget]
    | cons first rest =>
        simp only [List.cons_append]
        split <;> intro contradiction <;> cases contradiction

theorem ambiguous_guard_targets_block (a b : TargetHash) (aText bText : String)
    (hne : (b == a) = false) :
    resolveRuleDecisions [.guard a aText, .guard b bText] =
      .event .defaultDeny "ambiguous guard target" := by
  simp [resolveRuleDecisions, firstBlocking?, guardDecisions, sameGuardTarget, hne]

/-- The structural half of full-arguments binding. A changed canonical JSON
    serialization changes the target pre-image. Concluding unequal SHA-256
    digests additionally uses A-CR (`Seal.AssumptionCR`), the named IDEALISED
    hash-injectivity assumption — strictly stronger than collision resistance
    and not satisfied by real SHA-256; that step holds only in the idealised
    collision-free model (see `Seal/EffectCommitment.lean`,
    `docs/ASSUMPTIONS.md`). -/
theorem full_arguments_preimage_changes (left right : Json)
    (h : left.compress ≠ right.compress) :
    [left.compress] ≠ [right.compress] := by
  intro equality
  injection equality with equalCompress
  exact h equalCompress

/-! ## Target stability — the approval target ignores keys the policy does not name

The dual of `full_arguments_preimage_changes`. A `.fullArguments` target binds
the whole canonical argument bytes, so it moves when any argument changes. Every
OTHER target part reads the arguments only at the specific path it names, so a
target built from `literal` + `argPath` parts is a pure function of the values at
those named paths — invariant under inserting an argument key the policy never
names. This is the Track-1 form of the P0-2 finding: a serde-hostile sibling key
(`x:1e309`) cannot change, dodge, or redirect a kernel approval target, and by
the same token a human approval granted for the clean call also covers any variant
that only adds unnamed keys.

Scope note: the last mile — that inserting a concrete key into an argument object
leaves `atPath` at the named paths unchanged — is NOT proved here: `atPath`
(`Seal.JsonUtil`) is a `partial def` and exposes no equational lemma, so that step
would need either a structural re-definition of `atPath` (a kernel change) or a
`native_decide` (which dirties the axiom gate). It is instead witnessed on disk by
the seal-host integration test `approval_target_ignores_keys_not_in_policy_target`,
which drives the real kernel and observes byte-identical approval targets. The
lemmas below prove the general invariance modulo that `atPath`-agreement hypothesis. -/

open Seal.JsonUtil

/-- Resolution of a single target part. A literal ignores the arguments entirely;
    an `argPath` reads them solely via `atPath` at that one path; `fullArguments`
    reads the whole canonical bytes. `evalTargetParts` is `mapM` of this. -/
def partEval (part : TargetPart) (args : Json) : Option String :=
  match part with
  | .literal value => some value
  | .argPath path => atPath args path >>= jsonScalarToString
  | .fullArguments => some args.compress

theorem evalTargetParts_eq_mapM (parts : List TargetPart) (args : Json) :
    evalTargetParts parts args = parts.mapM (fun p => partEval p args) := rfl

/-- Core congruence: the resolved target parts depend on the arguments only
    through `partEval` of each part. Two argument values that make every part
    resolve identically yield the identical target-part list — hence the identical
    target hash. Needs no `atPath` internals, which is why it holds despite the
    opaque (`partial`) path lookup. -/
theorem evalTargetParts_congr (parts : List TargetPart) (a b : Json)
    (h : ∀ part ∈ parts, partEval part a = partEval part b) :
    evalTargetParts parts a = evalTargetParts parts b := by
  rw [evalTargetParts_eq_mapM, evalTargetParts_eq_mapM]
  induction parts with
  | nil => rfl
  | cons p ps ih =>
      simp only [List.mapM_cons]
      rw [h p (List.mem_cons_self ..), ih (fun q hq => h q (List.mem_cons_of_mem _ hq))]

/-- The P0-2 defence, general form: when a target names no `fullArguments`, the
    resolved target depends on the arguments ONLY at the paths it explicitly names.
    Any two argument objects agreeing at every named `argPath` produce the identical
    target — so an unnamed argument key cannot change the approval target. -/
theorem evalTargetParts_indep_of_unnamed_paths (parts : List TargetPart) (a b : Json)
    (hfull : TargetPart.fullArguments ∉ parts)
    (hpaths : ∀ path, TargetPart.argPath path ∈ parts → atPath a path = atPath b path) :
    evalTargetParts parts a = evalTargetParts parts b := by
  apply evalTargetParts_congr
  intro part hpart
  cases part with
  | literal v => rfl
  | argPath p => simp only [partEval, hpaths p hpart]
  | fullArguments => exact absurd hpart hfull

/-- Lifted to the kernel decision: for a guarded rule whose match verdict and
    resolved target parts are unchanged between two argument values, the rule yields
    the identical decision — in particular the SAME approval `TargetHash`. Composed
    with `evalTargetParts_indep_of_unnamed_paths`, an unnamed argument key cannot
    change, dodge, or redirect the approval target the kernel emits. -/
theorem evaluateRule_target_congr (policy : Policy) (toolName : String) (a b : Json)
    (rule : ToolRule)
    (hmatch : matchRule rule a = matchRule rule b)
    (htarget : evalTargetParts rule.target a = evalTargetParts rule.target b) :
    evaluateRule policy toolName a rule = evaluateRule policy toolName b rule := by
  unfold evaluateRule evaluateRuleWithMeta evaluateRuleWithContext
  rw [hmatch, htarget]

/-- The exact P0-2 policy target `[db, arg database, write, arg sql]`: its
    resolution is a function of `database` and `sql` alone. This is the on-disk
    integration test's property as a machine-checked theorem. -/
theorem p0_2_policy_target_ignores_unnamed (a b : Json)
    (hdb : atPath a ["database"] = atPath b ["database"])
    (hsql : atPath a ["sql"] = atPath b ["sql"]) :
    evalTargetParts [.literal "db", .argPath ["database"], .literal "write", .argPath ["sql"]] a
      = evalTargetParts [.literal "db", .argPath ["database"], .literal "write", .argPath ["sql"]] b := by
  apply evalTargetParts_indep_of_unnamed_paths
  · simp
  · intro path hp
    simp only [List.mem_cons, List.not_mem_nil, or_false, reduceCtorEq, false_or] at hp
    rcases hp with h | h <;> injection h with hpath <;> subst hpath <;> assumption

end Seal
