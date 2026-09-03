/- SPDX-License-Identifier: Apache-2.0 -/

-- Capture input for 04-decide/axioms.txt. Plain (un-guarded) `#print axioms`,
-- so the footprint line is emitted to stdout rather than swallowed by the
-- `#guard_msgs` checks in `Test/V2M4Axioms.lean`. Run via:
--   lake env lean v2/milestones/04-decide/print_axioms.lean
-- The build-breaking guard lives in Test/V2M4Axioms.lean; this is the readable
-- evidence artifact, not the enforcement point.

import SealV2

#print axioms SealV2.canonical_roundtrip
#print axioms SealV2.serialize_validCapability_roundtrip
#print axioms SealV2.decide_emit_unique
#print axioms SealV2.non_bypass
#print axioms SealV2.default_deny
#print axioms SealV2.signed_parse_canonical
