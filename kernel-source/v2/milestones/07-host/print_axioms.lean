/- SPDX-License-Identifier: Apache-2.0 -/

-- M7 adds the FFI surface (Ffi.lean, IO glue, NO theorems). The CORE proof
-- footprint must be UNCHANGED. Plain `#print axioms` to stdout.
--   lake env lean v2/milestones/07-host/print_axioms.lean

import SealV2

#print axioms SealV2.canonical_roundtrip
#print axioms SealV2.non_bypass
#print axioms SealV2.default_deny
#print axioms SealV2.decide_emit_unique
#print axioms SealV2.signed_parse_canonical
#print axioms SealV2.ed25519Verify
#print axioms SealV2.consume_records_nonce
#print axioms SealV2.replay_denied
#print axioms SealV2.consume_preserves_live
#print axioms SealV2.consume_only_unexpired
#print axioms SealV2.live_within_ttl_cap
