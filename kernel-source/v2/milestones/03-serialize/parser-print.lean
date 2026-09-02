/- SPDX-License-Identifier: Apache-2.0 -/

-- Capture input for 03-serialize/parser-axioms.txt. Plain (un-guarded) `#print axioms`, so each footprint
-- is emitted rather than swallowed by the `#guard_msgs` checks in Test/V2M3ParserAxioms.lean.
-- Run via: lake env lean v2/milestones/03-serialize/parser-print.lean
-- The build-breaking guard lives in Test/V2M3ParserAxioms.lean; this is the readable evidence
-- artifact, not the enforcement point.

import SealV2

#print axioms SealV2.guardCanonicalResult_returns_canonical
#print axioms SealV2.guardCanonicalStringResult_returns_canonical
#print axioms SealV2.parseStringChars_preserves_canonical
#print axioms SealV2.parseNumber_returns_canonical
#print axioms SealV2.parseArrayFuel_returns_canonical
#print axioms SealV2.parseObjectFuel_returns_canonical
#print axioms SealV2.parse_returns_canonical
