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

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.V2M4Axioms #[
    `SealV2.canonical_roundtrip,
    `SealV2.serialize_validCapability_roundtrip,
    `SealV2.decide_emit_unique,
    `SealV2.non_bypass,
    `SealV2.default_deny,
    `SealV2.signed_parse_canonical
  ]
