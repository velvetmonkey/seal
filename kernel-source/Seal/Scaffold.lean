/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Classify

/-!
# Scaffolder soundness — the `seal init` mapping as a theorem

`seal init` reads an MCP tool manifest (names + `readOnlyHint` /
`destructiveHint` annotations) and generates a starting policy. This file
defines that mapping as a total Lean function and proves the safety
guarantee each generated row carries:

* `scaffold_safety` — every manifest tool that scaffolds to guarded mode
  (destructive, unknown, absent, or conflicting annotations) classifies to
  `.guarded` under the generated policy, for EVERY argument value. A
  scaffolded policy cannot silently allow a dangerous tool.
* `scaffold_unknown_tool_default_deny` — the generated policy has exact
  tool names only; a tool absent from the manifest falls to default-deny.
* `scaffold_readonly_flows` — the golden-path liveness leg: a tool whose
  manifest entries all carry an explicit readonly (and no destructive)
  claim classifies `.benign` and flows without approval.

Annotations are TRUSTED INPUT: a manifest that lies about `readOnlyHint`
defeats the allow row. That is exactly why anything short of an explicit
readonly claim scaffolds to guarded, and why generated allow rules must be
surfaced to the operator as unverified suggestions.
-/

namespace Seal

open Lean SealCore

/-- MCP tool annotations as `seal init` consumes them. `none` means the
    manifest did not state the hint. -/
structure ManifestTool where
  name : String
  readOnlyHint : Option Bool := none
  destructiveHint : Option Bool := none
  deriving Repr

abbrev Manifest := List ManifestTool

/-- The `seal init` mode mapping. Allow requires an explicit readonly claim
    AND no conflicting destructive claim; every other combination
    (destructive, unknown, absent, conflicting) is guarded. Never deny: the
    scaffolder cannot brick a server, it can only interpose. -/
def scaffoldMode (tool : ManifestTool) : ToolMode :=
  match tool.readOnlyHint, tool.destructiveHint with
  | some true, some true => .guarded   -- conflicting annotations
  | some true, _ => .allow             -- explicit readonly, not destructive
  | _, _ => .guarded                   -- destructive, unknown, or absent

/-- One generated rule: exact tool name, unconditional match, guard target
    bound to the full canonical arguments. -/
def scaffoldRule (tool : ManifestTool) : ToolRule :=
  { name := tool.name
    mode := scaffoldMode tool
    matcher := .always
    target := [.fullArguments] }

/-- The `seal init` output policy: one rule per manifest tool, exact names
    only (no wildcards by construction). -/
def scaffold (identity : String) (ttlMs : Nat) (approvalFile : System.FilePath)
    (manifest : Manifest) : Policy :=
  { approvalTtlMs := ttlMs
    approvalFile := approvalFile
    serverIdentity := identity
    tools := manifest.map scaffoldRule }

/-- The one target every legacy-era scaffolded guard binds: proposed target
    domain, server identity + tool name + full canonical argument bytes +
    explicit `_meta` absence. Kept symbolic — proofs never evaluate the
    digest. -/
def scaffoldTarget (policy : Policy) (toolName : String) (args : Json) : TargetHash :=
  guardTarget policy toolName [args.compress] .absent

theorem scaffoldMode_ne_deny (tool : ManifestTool) : scaffoldMode tool ≠ .deny := by
  unfold scaffoldMode
  split <;> simp

/-- Annotation → mode bridge: a destructive claim, or anything short of an
    explicit readonly claim, scaffolds to guarded. -/
theorem dangerous_annotation_guarded (tool : ManifestTool)
    (h : tool.destructiveHint = some true ∨ tool.readOnlyHint ≠ some true) :
    scaffoldMode tool = .guarded := by
  unfold scaffoldMode
  rcases hro : tool.readOnlyHint with _ | (_ | _) <;>
    rcases hde : tool.destructiveHint with _ | (_ | _) <;>
      simp_all

theorem evalTargetParts_fullArguments (args : Json) :
    evalTargetParts [.fullArguments] args = some [args.compress] := rfl

/-- How rule evaluation sees one scaffolded rule: matches exactly its tool
    name, and yields the mode's decision with the uniform scaffold target. -/
theorem evaluateRule_scaffoldRule (policy : Policy) (toolName : String) (args : Json)
    (tool : ManifestTool) :
    evaluateRule policy toolName args (scaffoldRule tool) =
      if tool.name = toolName then
        match scaffoldMode tool with
        | .allow => some .allow
        | .guarded => some (.guard (scaffoldTarget policy toolName args)
            (scaffoldTarget policy toolName args).toHex)
        | .deny => some (.deny s!"flat deny: {toolName}")
      else none := by
  by_cases hname : tool.name = toolName
  · subst hname
    rw [if_pos rfl]
    unfold evaluateRule
    cases hmode : scaffoldMode tool <;>
      simp [scaffoldRule, matchRule, matchSpec, evalTargetParts_fullArguments,
        scaffoldTarget, guardTarget, hmode, evaluateRuleWithMeta,
        evaluateRuleWithContext]
  · rw [if_neg hname]
    unfold evaluateRule
    have hne : ((scaffoldRule tool).name != toolName) = true := by
      simp [scaffoldRule, hname]
    simp [hne, evaluateRuleWithMeta, evaluateRuleWithContext]

/-- Every decision a scaffolded policy produces for `toolName` is an allow or
    a guard bound to THE scaffold target — never a deny/invalid, never a
    second target. -/
theorem scaffold_decision_shape (policy : Policy) (toolName : String) (args : Json)
    (manifest : Manifest) (d : RuleDecision)
    (hd : d ∈ manifest.filterMap (evaluateRule policy toolName args ∘ scaffoldRule)) :
    d = .allow ∨ d = .guard (scaffoldTarget policy toolName args)
      (scaffoldTarget policy toolName args).toHex := by
  obtain ⟨tool, _hmem, heval⟩ := List.mem_filterMap.mp hd
  rw [Function.comp_apply, evaluateRule_scaffoldRule] at heval
  by_cases hname : tool.name = toolName
  · rw [if_pos hname] at heval
    cases hmode : scaffoldMode tool with
    | allow => rw [hmode] at heval; exact .inl (Option.some.inj heval).symm
    | guarded => rw [hmode] at heval; exact .inr (Option.some.inj heval).symm
    | deny => exact absurd hmode (scaffoldMode_ne_deny tool)
  · rw [if_neg hname] at heval
    cases heval

theorem firstBlocking?_eq_none_of_shape (decisions : List RuleDecision)
    (h : ∀ d ∈ decisions, d = .allow ∨ ∃ target text, d = .guard target text) :
    firstBlocking? decisions = none := by
  induction decisions with
  | nil => rfl
  | cons d rest ih =>
      have hrest := ih fun x hx => h x (List.mem_cons_of_mem _ hx)
      rcases h d (List.mem_cons_self ..) with rfl | ⟨target, text, rfl⟩ <;>
        simpa [firstBlocking?] using hrest

theorem guardDecisions_shape (decisions : List RuleDecision)
    (target : TargetHash) (text : String)
    (h : ∀ d ∈ decisions, d = .allow ∨ d = .guard target text) :
    ∀ p ∈ guardDecisions decisions, p = (target, text) := by
  intro p hp
  obtain ⟨d, hd, hsome⟩ := List.mem_filterMap.mp hp
  rcases h d hd with rfl | rfl
  · cases hsome
  · exact (Option.some.inj hsome).symm

/-- Resolution of a uniform decision list: no blockers, every guard bound to
    the same target, at least one guard present ⇒ the classifier emits
    exactly that guard. -/
theorem resolve_uniform_guard (decisions : List RuleDecision)
    (target : TargetHash) (text : String)
    (hshape : ∀ d ∈ decisions, d = .allow ∨ d = .guard target text)
    (hguard : .guard target text ∈ decisions) :
    resolveRuleDecisions decisions = .event (.guarded target) text := by
  have hblock : firstBlocking? decisions = none :=
    firstBlocking?_eq_none_of_shape _ fun d hd =>
      (hshape d hd).imp id fun hg => ⟨target, text, hg⟩
  have hguards := guardDecisions_shape decisions target text hshape
  have hmem : (target, text) ∈ guardDecisions decisions :=
    List.mem_filterMap.mpr ⟨.guard target text, hguard, rfl⟩
  unfold resolveRuleDecisions
  rw [hblock]
  cases hg : guardDecisions decisions with
  | nil => rw [hg] at hmem; cases hmem
  | cons first rest =>
      have hfirst : first = (target, text) :=
        hguards first (hg ▸ List.mem_cons_self ..)
      have hsame : sameGuardTarget first rest = true := by
        unfold sameGuardTarget
        rw [List.all_eq_true]
        intro next hnext
        have hnext' : next = (target, text) :=
          hguards next (hg ▸ List.mem_cons_of_mem _ hnext)
        rw [hnext', hfirst]
        exact beq_self_eq_true target
      rw [hfirst] at hsame ⊢
      simp [hsame]

/-- **Scaffolder soundness.** Every manifest tool that scaffolds to guarded
    mode classifies to `.guarded` (bound to the uniform scaffold target)
    under the generated policy, for every argument value — even when a
    duplicate manifest entry with the same name maps to allow (guard
    dominates and all scaffolded guards share the target). -/
theorem scaffold_safety (identity : String) (ttlMs : Nat)
    (approvalFile : System.FilePath) (manifest : Manifest) (tool : ManifestTool)
    (hmem : tool ∈ manifest) (hmode : scaffoldMode tool = .guarded) (args : Json) :
    classifyToolCall (scaffold identity ttlMs approvalFile manifest) tool.name args =
      .event
        (.guarded (scaffoldTarget (scaffold identity ttlMs approvalFile manifest)
          tool.name args))
        (scaffoldTarget (scaffold identity ttlMs approvalFile manifest)
          tool.name args).toHex := by
  rw [classifyToolCall_eq_resolve]
  have htools : (scaffold identity ttlMs approvalFile manifest).tools
      = manifest.map scaffoldRule := rfl
  rw [htools, List.filterMap_map]
  refine resolve_uniform_guard _ _ _
    (fun d hd => scaffold_decision_shape _ _ _ manifest d hd) ?_
  refine List.mem_filterMap.mpr ⟨tool, hmem, ?_⟩
  rw [Function.comp_apply, evaluateRule_scaffoldRule, if_pos rfl, hmode]

/-- Corollary in the goal's phrasing: a scaffolded policy can NEVER classify
    a guarded-mode manifest tool as benign. -/
theorem scaffold_safety_not_benign (identity : String) (ttlMs : Nat)
    (approvalFile : System.FilePath) (manifest : Manifest) (tool : ManifestTool)
    (hmem : tool ∈ manifest) (hmode : scaffoldMode tool = .guarded) (args : Json) :
    (classifyToolCall (scaffold identity ttlMs approvalFile manifest)
      tool.name args).toEvent ≠ .benign := by
  rw [scaffold_safety identity ttlMs approvalFile manifest tool hmem hmode args]
  intro h
  cases h

/-- No wildcards, with teeth: a tool name absent from the manifest falls to
    default-deny under the scaffolded policy. -/
theorem scaffold_unknown_tool_default_deny (identity : String) (ttlMs : Nat)
    (approvalFile : System.FilePath) (manifest : Manifest)
    (toolName : String) (habs : ∀ tool ∈ manifest, tool.name ≠ toolName) (args : Json) :
    classifyToolCall (scaffold identity ttlMs approvalFile manifest) toolName args =
      .event .defaultDeny "no matching policy rule" := by
  rw [classifyToolCall_eq_resolve]
  have htools : (scaffold identity ttlMs approvalFile manifest).tools
      = manifest.map scaffoldRule := rfl
  rw [htools, List.filterMap_map]
  have hnil : manifest.filterMap
      (evaluateRule (scaffold identity ttlMs approvalFile manifest) toolName args
        ∘ scaffoldRule) = [] := by
    refine List.filterMap_eq_nil_iff.mpr fun tool hmem => ?_
    rw [Function.comp_apply, evaluateRule_scaffoldRule, if_neg (habs tool hmem)]
  rw [hnil]
  rfl

/-- Golden-path liveness: a tool name whose manifest entries all scaffold to
    allow classifies `.benign` — the readonly leg flows without approval. -/
theorem scaffold_readonly_flows (identity : String) (ttlMs : Nat)
    (approvalFile : System.FilePath) (manifest : Manifest)
    (toolName : String) (args : Json)
    (hall : ∀ tool ∈ manifest, tool.name = toolName → scaffoldMode tool = .allow)
    (hsome : ∃ tool ∈ manifest, tool.name = toolName) :
    classifyToolCall (scaffold identity ttlMs approvalFile manifest) toolName args =
      .event .benign "explicit policy allow" := by
  rw [classifyToolCall_eq_resolve]
  have htools : (scaffold identity ttlMs approvalFile manifest).tools
      = manifest.map scaffoldRule := rfl
  rw [htools, List.filterMap_map]
  generalize hdecisions : manifest.filterMap
    (evaluateRule (scaffold identity ttlMs approvalFile manifest) toolName args
      ∘ scaffoldRule) = decisions
  have hshape : ∀ d ∈ decisions, d = .allow := by
    intro d hd
    rw [← hdecisions] at hd
    obtain ⟨tool, hmem, heval⟩ := List.mem_filterMap.mp hd
    rw [Function.comp_apply, evaluateRule_scaffoldRule] at heval
    by_cases hname : tool.name = toolName
    · rw [if_pos hname, hall tool hmem hname] at heval
      exact (Option.some.inj heval).symm
    · rw [if_neg hname] at heval
      cases heval
  have hmemallow : RuleDecision.allow ∈ decisions := by
    rw [← hdecisions]
    obtain ⟨tool, hmem, hname⟩ := hsome
    refine List.mem_filterMap.mpr ⟨tool, hmem, ?_⟩
    rw [Function.comp_apply, evaluateRule_scaffoldRule, if_pos hname,
      hall tool hmem hname]
  have hblock : firstBlocking? decisions = none :=
    firstBlocking?_eq_none_of_shape _ fun d hd => .inl (hshape d hd)
  have hguards : guardDecisions decisions = [] := by
    unfold guardDecisions
    refine List.filterMap_eq_nil_iff.mpr fun d hd => ?_
    rw [hshape d hd]
  have hallow : hasExplicitAllow decisions = true :=
    List.any_eq_true.mpr ⟨.allow, hmemallow, rfl⟩
  unfold resolveRuleDecisions
  rw [hblock, hguards, hallow]
  rfl

end Seal
