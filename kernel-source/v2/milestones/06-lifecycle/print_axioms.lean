/- SPDX-License-Identifier: Apache-2.0 -/

-- Capture input for 06-lifecycle/axioms.txt. Plain `#print axioms` so the footprint
-- reaches stdout. The build-breaking guard is Test/V2M6Axioms.lean.
--   lake env lean v2/milestones/06-lifecycle/print_axioms.lean

import SealV2

#print axioms SealV2.consume_records_nonce
#print axioms SealV2.replay_denied
#print axioms SealV2.consume_preserves_live
#print axioms SealV2.consume_only_unexpired
#print axioms SealV2.live_within_ttl_cap
