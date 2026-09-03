/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import Seal.Policy
import Seal.PolicyBundle
import Seal.PolicyLegacy
import Aesop

/-!
# Layer-1 equivalence: codec parse = pre-codec parse

THE safety property of the codec refactor: the schema-carrying codec parsers
accept EXACTLY the wire language the pre-codec parsers accepted — same
verdict, same parsed value, same error text — proven as full function
equality against the verbatim spec copies in `Seal/PolicyLegacy.lean`.

The two shared constants (`parseMatch`, `parseTargetPart`) are identical on
both sides BY CONSTRUCTION (the codec reuses the constants), so the theorems
below close over them opaquely — no behavioral claim about their interiors is
needed, and none would be provable for the `partial` `parseMatch`.

Proof method, uniform across the theorems: `funext`; unfold the codec
combinators and the legacy definitions (entry-level parsers are first proven
equal and then rewritten as opaque constants, so `List.mapM` runs the same
function on both sides); normalize the `Except` monad (associativity,
pure/throw absorption, ite distribution); unfold `>>=` into its `match` form;
then exhaustively case-split every wire effect (`repeat' (split <;> try rfl)`)
and discharge the leaf bookkeeping (tuple projections, contradictory branch
hypotheses) with `aesop`. Where a derived strict-key allowlist orders keys
differently than the legacy literal list (`safetyShallowKeys`,
`approvalKeys`), `expectObjKeys` is first rewritten via set-membership
congruence — `expectObjKeys` acceptance depends only on the key SET, and the
sets are proven equal below.
-/

namespace Seal.PolicyEquiv

open Lean
open Seal.JsonUtil

/-! ## Except-monad normalization -/

private theorem bind_assoc {α β γ : Type} (m : Except String α)
    (f : α → Except String β) (g : β → Except String γ) :
    m >>= f >>= g = m >>= fun a => f a >>= g := by
  cases m <;> rfl

private theorem pure_bind {α β : Type} (a : α) (f : α → Except String β) :
    (pure a : Except String α) >>= f = f a := rfl

private theorem throw_bind {α β : Type} (e : String) (f : α → Except String β) :
    (throw e : Except String α) >>= f = throw e := rfl

private theorem ite_bind {α β : Type} (c : Prop) [Decidable c]
    (t e : Except String α) (f : α → Except String β) :
    (if c then t else e) >>= f = if c then t >>= f else e >>= f := by
  split <;> rfl

private theorem bind_def {α β : Type} (m : Except String α)
    (f : α → Except String β) : m >>= f = Except.bind m f := rfl

private theorem pure_def {α : Type} (a : α) :
    (pure a : Except String α) = Except.ok a := rfl

private theorem throw_def {α : Type} (e : String) :
    (throw e : Except String α) = Except.error e := rfl

/-! ## Strict-key allowlist congruence

The derived allowlists for the safety shallow keys and the approval keys
carry the same key SET as the legacy literals in a different order;
`expectObjKeys` only ever asks `contains`, so the parse is unchanged. -/

private theorem expectObjKeys_congr (j : Json) {l₁ l₂ : List String} (ctx : String)
    (h : ∀ k, l₁.contains k = l₂.contains k) :
    expectObjKeys j l₁ ctx = expectObjKeys j l₂ ctx := by
  have hf : (fun k => !l₁.contains k) = (fun k => !l₂.contains k) :=
    funext fun k => by rw [h k]
  simp only [expectObjKeys, hf]

private theorem safetyShallowKeys_reduce :
    Seal.safetyShallowKeys = ["approval", "server", "tools"] := by rfl

private theorem approvalKeys_reduce :
    Seal.approvalKeys = ["ttl_seconds", "control_file", "replay_store"] := by rfl

private theorem safetyShallowKeys_contains (k : String) :
    Seal.safetyShallowKeys.contains k = PolicyLegacy.safetyShallowKeys.contains k := by
  rw [safetyShallowKeys_reduce]
  simp only [PolicyLegacy.safetyShallowKeys]
  cases hA : k == "approval" <;> cases hS : k == "server" <;>
    cases hT : k == "tools" <;>
      simp [List.contains, List.elem, hA, hS, hT]

private theorem approvalKeys_contains (k : String) :
    Seal.approvalKeys.contains k = PolicyLegacy.approvalKeys.contains k := by
  rw [approvalKeys_reduce]
  simp only [PolicyLegacy.approvalKeys]
  cases hT : k == "ttl_seconds" <;> cases hC : k == "control_file" <;>
    cases hR : k == "replay_store" <;>
      simp [List.contains, List.elem, hT, hC, hR]

private theorem bundleTopLevelKeys_eq :
    Seal.bundleTopLevelKeys = PolicyLegacy.bundleTopLevelKeys := by rfl

/-! ## Safety (S) -/

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parseToolRule_eq :
    Seal.toolRuleCodec.parse = PolicyLegacy.parseToolRule := by
  funext j
  simp only [Seal.toolRuleCodec, WireCodec.openObj, Seal.toolRuleSpec,
    ObjSpec.emit, ObjSpec.check, ObjSpec.fieldD, ObjSpec.field, ObjSpec.start,
    Seal.strCodec, Seal.modeCodec, Seal.matchCodec, Seal.targetListCodec,
    PolicyLegacy.parseToolRule, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 3200000 in
set_option maxRecDepth 8192 in
theorem parsePolicyJson_eq :
    Seal.parsePolicyJson = PolicyLegacy.parsePolicyJson := by
  funext j
  simp only [Seal.parsePolicyJson, Seal.policyCodec, WireCodec.openObj,
    Seal.policySpecWith, Seal.approvalSpec, ObjSpec.emit, ObjSpec.allowKey,
    ObjSpec.fieldD, ObjSpec.field, ObjSpec.start, Seal.strCodec,
    Seal.natCodec, Seal.arrCodec, parseToolRule_eq,
    PolicyLegacy.parsePolicyJson, getObjString, getObjNatD,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

/-! ## Section entry parsers (proven first, then treated as opaque so
`List.mapM` runs the same constant on both sides) -/

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem temporalRule_eq :
    Seal.temporalRuleCodec.parse = PolicyLegacy.parseTemporalRule := by
  funext j
  simp only [Seal.temporalRuleCodec, WireCodec.strictObj,
    Seal.temporalRuleSpec, Seal.noAfterCodec, ObjSpec.emit, ObjSpec.fieldD,
    ObjSpec.field, ObjSpec.start, ObjSpec.keys, Seal.strCodec, Seal.arrCodec,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseTemporalRule, PolicyLegacy.parseStringList,
    getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem convergentTool_eq :
    Seal.convergentToolCodec.parse = PolicyLegacy.parseConvergentTool := by
  funext j
  simp only [Seal.convergentToolCodec, WireCodec.strictObj,
    Seal.convergentToolSpec, ObjSpec.emit, ObjSpec.field, ObjSpec.start,
    ObjSpec.keys, Seal.strCodec, Seal.pathCodec,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseConvergentTool, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem linearTool_eq :
    Seal.linearToolCodec.parse = PolicyLegacy.parseLinearTool := by
  funext j
  simp only [Seal.linearToolCodec, WireCodec.strictObj, Seal.linearToolSpec,
    ObjSpec.emit, ObjSpec.field, ObjSpec.start, ObjSpec.keys, Seal.strCodec,
    Seal.pathCodec,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseLinearTool, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem budgetRule_eq :
    Seal.budgetRuleCodec.parse = PolicyLegacy.parseBudgetRule := by
  funext j
  simp only [Seal.budgetRuleCodec, WireCodec.strictObj, Seal.budgetRuleSpec,
    ObjSpec.emit, ObjSpec.fieldOpt, ObjSpec.field, ObjSpec.start,
    ObjSpec.keys, Seal.strCodec, Seal.natCodec, Seal.pathCodec, Seal.arrCodec,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseBudgetRule, PolicyLegacy.parseStringList, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem principalKey_eq :
    Seal.principalKeyCodec.parse = PolicyLegacy.parsePrincipalKey := by
  funext j
  simp only [Seal.principalKeyCodec, WireCodec.strictObj, Seal.principalKeySpec,
    ObjSpec.emit, ObjSpec.check, ObjSpec.field, ObjSpec.start, ObjSpec.keys,
    Seal.principalIdCodec, Seal.principalPubkeyCodec, Seal.strCodec,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parsePrincipalKey, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parsePrincipalsSection_eq :
    Seal.parsePrincipalsSection = PolicyLegacy.parsePrincipalsSection := by
  funext j
  simp only [Seal.parsePrincipalsSection, Seal.principalsSectionCodec,
    WireCodec.strictObj, Seal.principalsSectionSpec, ObjSpec.emit,
    ObjSpec.fieldD, ObjSpec.field, ObjSpec.start, ObjSpec.keys,
    Seal.boolCodec, Seal.arrCodec, principalKey_eq, budgetRule_eq,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parsePrincipalsSection, PolicyLegacy.parseEnabled,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

/-! ## Sections (T/C/V/K/L/B) -/

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parseTemporalSection_eq :
    Seal.parseTemporalSection = PolicyLegacy.parseTemporalSection := by
  funext j
  simp only [Seal.parseTemporalSection, Seal.temporalSectionCodec,
    WireCodec.strictObj, Seal.temporalSectionSpec, ObjSpec.emit,
    ObjSpec.fieldD, ObjSpec.field, ObjSpec.start, ObjSpec.keys,
    Seal.boolCodec, Seal.arrCodec, temporalRule_eq,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseTemporalSection, PolicyLegacy.parseEnabled,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parseConsensusSection_eq :
    Seal.parseConsensusSection = PolicyLegacy.parseConsensusSection := by
  funext j
  simp only [Seal.parseConsensusSection, Seal.consensusSectionCodec,
    WireCodec.strictObj, Seal.consensusSectionSpec, ObjSpec.emit,
    ObjSpec.fieldD, ObjSpec.field, ObjSpec.start, ObjSpec.keys,
    Seal.strCodec, Seal.boolCodec, Seal.natCodec, Seal.arrCodec,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseConsensusSection, PolicyLegacy.parseEnabled,
    PolicyLegacy.parseStringList, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parseConvergenceSection_eq :
    Seal.parseConvergenceSection = PolicyLegacy.parseConvergenceSection := by
  funext j
  simp only [Seal.parseConvergenceSection, Seal.convergenceSectionCodec,
    WireCodec.strictObj, Seal.convergenceSectionSpec, ObjSpec.emit,
    ObjSpec.fieldD, ObjSpec.field, ObjSpec.start, ObjSpec.keys,
    Seal.boolCodec, Seal.arrCodec, convergentTool_eq,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseConvergenceSection, PolicyLegacy.parseEnabled,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parseCalibrationSection_eq :
    Seal.parseCalibrationSection = PolicyLegacy.parseCalibrationSection := by
  funext j
  simp only [Seal.parseCalibrationSection, Seal.calibrationSectionCodec,
    WireCodec.strictObj, Seal.calibrationSectionSpec, ObjSpec.emit,
    ObjSpec.check, ObjSpec.fieldD, ObjSpec.field, ObjSpec.start, ObjSpec.keys,
    Seal.strCodec, Seal.boolCodec, Seal.natCodec, Seal.arrCodec,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseCalibrationSection, PolicyLegacy.parseEnabled,
    PolicyLegacy.parseStringList, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parseLinearSection_eq :
    Seal.parseLinearSection = PolicyLegacy.parseLinearSection := by
  funext j
  simp only [Seal.parseLinearSection, Seal.linearSectionCodec,
    WireCodec.strictObj, Seal.linearSectionSpec, ObjSpec.emit, ObjSpec.fieldD,
    ObjSpec.field, ObjSpec.start, ObjSpec.keys, Seal.strCodec, Seal.boolCodec,
    Seal.arrCodec, linearTool_eq,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseLinearSection, PolicyLegacy.parseEnabled, getObjString,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

set_option maxHeartbeats 1600000 in
set_option maxRecDepth 8192 in
theorem parseBudgetSection_eq :
    Seal.parseBudgetSection = PolicyLegacy.parseBudgetSection := by
  funext j
  simp only [Seal.parseBudgetSection, Seal.budgetSectionCodec,
    WireCodec.strictObj, Seal.budgetSectionSpec, ObjSpec.emit, ObjSpec.fieldD,
    ObjSpec.field, ObjSpec.start, ObjSpec.keys, Seal.boolCodec, Seal.arrCodec,
    budgetRule_eq,
    List.map_cons, List.map_nil, List.append_nil, List.nil_append,
    List.cons_append,
    PolicyLegacy.parseBudgetSection, PolicyLegacy.parseEnabled,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

/-! ## The bundle -/

set_option maxHeartbeats 3200000 in
set_option maxRecDepth 8192 in
theorem parsePolicyBundle_eq :
    Seal.parsePolicyBundle = PolicyLegacy.parsePolicyBundle := by
  funext j
  have hsafety : ∀ x, expectObjKeys x Seal.safetyShallowKeys "safety section" =
      expectObjKeys x PolicyLegacy.safetyShallowKeys "safety section" :=
    fun x => expectObjKeys_congr x "safety section" safetyShallowKeys_contains
  have happroval : ∀ x, expectObjKeys x Seal.approvalKeys "safety approval" =
      expectObjKeys x PolicyLegacy.approvalKeys "safety approval" :=
    fun x => expectObjKeys_congr x "safety approval" approvalKeys_contains
  simp only [Seal.parsePolicyBundle, PolicyLegacy.parsePolicyBundle,
    bundleTopLevelKeys_eq, hsafety, happroval, parsePolicyJson_eq,
    parseTemporalSection_eq, parseConsensusSection_eq,
    parseConvergenceSection_eq, parseCalibrationSection_eq,
    parseLinearSection_eq, parseBudgetSection_eq, parsePrincipalsSection_eq,
    Seal.parseOptSection, PolicyLegacy.parseOptSection,
    bind_assoc, pure_bind, throw_bind, ite_bind]
  try simp only [bind_def, pure_def, throw_def, Except.bind]
  try repeat' (split <;> try rfl)
  all_goals aesop

/-! ## Axiom pins -/

/-- info: 'Seal.PolicyEquiv.parsePolicyJson_eq' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms parsePolicyJson_eq

/-- info: 'Seal.PolicyEquiv.parsePolicyBundle_eq' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms parsePolicyBundle_eq

end Seal.PolicyEquiv
