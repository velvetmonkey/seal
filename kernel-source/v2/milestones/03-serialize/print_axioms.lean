/- SPDX-License-Identifier: Apache-2.0 -/

-- Capture input for 03-serialize/axioms.txt. Plain (un-guarded) `#print axioms`, so each footprint
-- is emitted rather than swallowed by the `#guard_msgs` checks in Test/V2M3Axioms.lean.
-- Run via: lake env lean v2/milestones/03-serialize/print_axioms.lean
-- The build-breaking guard lives in Test/V2M3Axioms.lean; this is the readable evidence
-- artifact, not the enforcement point.

import SealV2

#print axioms SealV2.parseStringChars_preserves_canonical
#print axioms SealV2.parseNumber_returns_canonical
#print axioms SealV2.parseArrayFuel_returns_canonical
#print axioms SealV2.parseObjectFuel_returns_canonical
#print axioms SealV2.parse_returns_canonical
#print axioms SealV2.serialize_roundtrip_null
#print axioms SealV2.serialize_roundtrip_bool
#print axioms SealV2.serialize_roundtrip_number
#print axioms SealV2.serialize_roundtrip_string
#print axioms SealV2.serialize_roundtrip_array
#print axioms SealV2.serialize_roundtrip_object
#print axioms SealV2.canonical_roundtrip
#print axioms SealV2.serializeAst_deterministic
#print axioms SealV2.serialize_validCapability_roundtrip
#print axioms SealV2.escapeList_injective
#print axioms SealV2.escapeString_injective
#print axioms SealV2.serializeString_injective
#print axioms SealV2.cafeWitness_isCanonical
#print axioms SealV2.cafeWitness_roundtrips
#print axioms SealV2.escapeChar_astral_witness
#print axioms SealV2.escapeChar_bmp_witness_eacute
#print axioms SealV2.escapeChar_bmp_witness_coffee
#print axioms SealV2.escapeList_distinguishes_eacute_e
#print axioms SealV2.reject_uppercase_hex
#print axioms SealV2.reject_longform_control
#print axioms SealV2.reject_literal_nonascii
#print axioms SealV2.reject_lone_high_surrogate
