/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.AxiomAllowlist

/-!
# Axiom-footprint pins (M3 serialization chain + canonical escapes)

`#guard_msgs in #print axioms` turns each footprint into a BUILD-TIME
assertion: the pinned theorems stay within the baseline-3 kernel axioms
`[propext, Classical.choice, Quot.sound]` (or fewer). Any drift — a stray
`sorry`, a `native_decide`, a new axiom — changes the printed message and
fails the build. The escape-grammar deliverables (injectivity, the
`café ☕` witnesses, and the four reject lemmas) are pinned alongside the
pre-existing chain.
-/

/-- info: 'SealV2.parseStringChars_preserves_canonical' depends on axioms: [propext] -/
#guard_msgs in #print axioms SealV2.parseStringChars_preserves_canonical

/-- info: 'SealV2.parseNumber_returns_canonical' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.parseNumber_returns_canonical

/-- info: 'SealV2.parseArrayFuel_returns_canonical' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.parseArrayFuel_returns_canonical

/-- info: 'SealV2.parseObjectFuel_returns_canonical' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.parseObjectFuel_returns_canonical

/-- info: 'SealV2.parse_returns_canonical' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.parse_returns_canonical

/-- info: 'SealV2.serialize_roundtrip_null' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serialize_roundtrip_null

/-- info: 'SealV2.serialize_roundtrip_bool' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serialize_roundtrip_bool

/-- info: 'SealV2.serialize_roundtrip_number' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serialize_roundtrip_number

/-- info: 'SealV2.serialize_roundtrip_string' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serialize_roundtrip_string

/-- info: 'SealV2.serialize_roundtrip_array' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serialize_roundtrip_array

/-- info: 'SealV2.serialize_roundtrip_object' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serialize_roundtrip_object

/-- info: 'SealV2.canonical_roundtrip' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.canonical_roundtrip

/-- info: 'SealV2.serializeAst_deterministic' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serializeAst_deterministic

/-- info: 'SealV2.serialize_validCapability_roundtrip' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serialize_validCapability_roundtrip

/-! ## Canonical-escape deliverables -/

/-- info: 'SealV2.escapeList_injective' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.escapeList_injective

/-- info: 'SealV2.escapeString_injective' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.escapeString_injective

/-- info: 'SealV2.serializeString_injective' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.serializeString_injective

/-- info: 'SealV2.cafeWitness_isCanonical' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.cafeWitness_isCanonical

/-- info: 'SealV2.cafeWitness_roundtrips' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms SealV2.cafeWitness_roundtrips

/-- info: 'SealV2.escapeChar_astral_witness' does not depend on any axioms -/
#guard_msgs in #print axioms SealV2.escapeChar_astral_witness

/-- info: 'SealV2.escapeChar_bmp_witness_eacute' does not depend on any axioms -/
#guard_msgs in #print axioms SealV2.escapeChar_bmp_witness_eacute

/-- info: 'SealV2.escapeChar_bmp_witness_coffee' does not depend on any axioms -/
#guard_msgs in #print axioms SealV2.escapeChar_bmp_witness_coffee

/-- info: 'SealV2.escapeList_distinguishes_eacute_e' does not depend on any axioms -/
#guard_msgs in #print axioms SealV2.escapeList_distinguishes_eacute_e

/-- info: 'SealV2.reject_uppercase_hex' depends on axioms: [propext] -/
#guard_msgs in #print axioms SealV2.reject_uppercase_hex

/-- info: 'SealV2.reject_longform_control' depends on axioms: [propext] -/
#guard_msgs in #print axioms SealV2.reject_longform_control

/-- info: 'SealV2.reject_literal_nonascii' depends on axioms: [propext] -/
#guard_msgs in #print axioms SealV2.reject_literal_nonascii

/-- info: 'SealV2.reject_lone_high_surrogate' depends on axioms: [propext] -/
#guard_msgs in #print axioms SealV2.reject_lone_high_surrogate

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.V2M3Axioms #[
    `SealV2.parseStringChars_preserves_canonical,
    `SealV2.parseNumber_returns_canonical,
    `SealV2.parseArrayFuel_returns_canonical,
    `SealV2.parseObjectFuel_returns_canonical,
    `SealV2.parse_returns_canonical,
    `SealV2.serialize_roundtrip_null,
    `SealV2.serialize_roundtrip_bool,
    `SealV2.serialize_roundtrip_number,
    `SealV2.serialize_roundtrip_string,
    `SealV2.serialize_roundtrip_array,
    `SealV2.serialize_roundtrip_object,
    `SealV2.canonical_roundtrip,
    `SealV2.serializeAst_deterministic,
    `SealV2.serialize_validCapability_roundtrip,
    `SealV2.escapeList_injective,
    `SealV2.escapeString_injective,
    `SealV2.serializeString_injective,
    `SealV2.cafeWitness_isCanonical,
    `SealV2.cafeWitness_roundtrips,
    `SealV2.escapeChar_astral_witness,
    `SealV2.escapeChar_bmp_witness_eacute,
    `SealV2.escapeChar_bmp_witness_coffee,
    `SealV2.escapeList_distinguishes_eacute_e,
    `SealV2.reject_uppercase_hex,
    `SealV2.reject_longform_control,
    `SealV2.reject_literal_nonascii,
    `SealV2.reject_lone_high_surrogate
  ]
