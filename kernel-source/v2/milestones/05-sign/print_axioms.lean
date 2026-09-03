/- SPDX-License-Identifier: Apache-2.0 -/

-- Capture input for 05-sign/axioms.txt. Plain (un-guarded) `#print axioms` so the
-- footprint reaches stdout. M5 swaps the signature stub for real Ed25519 behind an
-- `opaque @[extern]` seam (SealV2/Crypto.lean); the footprint MUST be unchanged
-- (`opaque` adds no axiom). The build-breaking guard remains Test/V2M4Axioms.lean.
--   lake env lean v2/milestones/05-sign/print_axioms.lean

import SealV2

#print axioms SealV2.canonical_roundtrip
#print axioms SealV2.serialize_validCapability_roundtrip
#print axioms SealV2.decide_emit_unique
#print axioms SealV2.non_bypass
#print axioms SealV2.default_deny
#print axioms SealV2.signed_parse_canonical
-- The crypto seam itself adds no axioms:
#print axioms SealV2.ed25519Verify
