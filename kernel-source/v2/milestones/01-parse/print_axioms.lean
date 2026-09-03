/- SPDX-License-Identifier: Apache-2.0 -/

-- Capture input for 01-parse/axioms.txt. Plain (un-guarded) `#print axioms`, so each footprint
-- is emitted rather than swallowed by the `#guard_msgs` checks in Test/V2M1Axioms.lean.
-- Run via: lake env lean v2/milestones/01-parse/print_axioms.lean
-- The build-breaking guard lives in Test/V2M1Axioms.lean; this is the readable evidence
-- artifact, not the enforcement point.

import SealV2

#print axioms SealV2.parse_total
#print axioms SealV2.parse_failure_has_no_ast
