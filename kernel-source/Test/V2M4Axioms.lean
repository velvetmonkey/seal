/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.AxiomAllowlist

/-- info: 'SealV2.canonical_roundtrip' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.canonical_roundtrip

/-- info: 'SealV2.serialize_validCapability_roundtrip' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.serialize_validCapability_roundtrip

/-- info: 'SealV2.decide_emit_unique' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.decide_emit_unique

/-- info: 'SealV2.non_bypass' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.non_bypass

/-- info: 'SealV2.default_deny' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.default_deny

/-- info: 'SealV2.signed_parse_canonical' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.signed_parse_canonical

namespace SealV2
/-- No omitted action can be resolved when the matching specs offer zero
    or at least two candidate actions (counting duplicates). -/
theorem resolveAction_omitted_not_singleton (tool : ToolName) (tools : List ToolSpec)
    (h : ((tools.filter (fun spec => spec.tool == tool)).flatMap ToolSpec.actions).length ≠ 1) :
    resolveAction tool none tools = none := by
  unfold resolveAction
  cases hs : tools.filter (fun spec => spec.tool == tool) with
  | nil => rfl
  | cons spec rest =>
      cases rest with
      | cons other tail => rfl
      | nil =>
          cases ha : spec.actions with
          | nil => simp [ha]
          | cons action tail =>
              cases tail with
              | cons other tail => simp [ha]
              | nil => simp [hs, ha] at h

end SealV2

#print axioms SealV2.resolveAction_omitted_not_singleton

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.V2M4Axioms #[
    `SealV2.resolveAction_omitted_not_singleton,
    `SealV2.canonical_roundtrip,
    `SealV2.serialize_validCapability_roundtrip,
    `SealV2.decide_emit_unique,
    `SealV2.non_bypass,
    `SealV2.default_deny,
    `SealV2.signed_parse_canonical
  ]
