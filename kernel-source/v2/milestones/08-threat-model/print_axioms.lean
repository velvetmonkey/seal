/- SPDX-License-Identifier: Apache-2.0 -/

-- M8 footprint evidence: the full named-theorem set re-verified for the threat model.
-- Quoted into v2/milestones/08-threat-model/axioms.txt by run.sh (re-run, NOT asserted).
--   lake env lean v2/milestones/08-threat-model/print_axioms.lean

import SealV2

-- Totality / parse (fail-closed by totality)
#print axioms SealV2.parse_total
#print axioms SealV2.parse_failure_has_no_ast
#print axioms SealV2.parse_returns_canonical
-- Serialize / canonical
#print axioms SealV2.canonical_roundtrip
#print axioms SealV2.serializeAst_deterministic
#print axioms SealV2.serialize_validCapability_roundtrip
-- Decide (M4)
#print axioms SealV2.default_deny
#print axioms SealV2.non_bypass
#print axioms SealV2.decide_emit_unique
-- Sign (M5) — origin seam
#print axioms SealV2.signed_parse_canonical
#print axioms SealV2.ed25519Verify
-- Lifecycle (M6)
#print axioms SealV2.consume_records_nonce
#print axioms SealV2.replay_denied
#print axioms SealV2.consume_preserves_live
#print axioms SealV2.consume_only_unexpired
#print axioms SealV2.live_within_ttl_cap
