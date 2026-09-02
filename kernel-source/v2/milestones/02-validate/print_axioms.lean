/- SPDX-License-Identifier: Apache-2.0 -/

-- Capture input for 02-validate/axioms.txt. Plain (un-guarded) `#print axioms`, so each footprint
-- is emitted rather than swallowed by the `#guard_msgs` checks in Test/V2M2Axioms.lean.
-- Run via: lake env lean v2/milestones/02-validate/print_axioms.lean
-- The build-breaking guard lives in Test/V2M2Axioms.lean; this is the readable evidence
-- artifact, not the enforcement point.

import SealV2

#print axioms SealV2.validate_none_no_witness_result
#print axioms SealV2.valid_capability_has_unused_approval
#print axioms SealV2.valid_capability_has_unexpired_approval
#print axioms SealV2.valid_capability_has_signature_verified
#print axioms SealV2.valid_capability_target_bound
#print axioms SealV2.valid_capability_session_bound
