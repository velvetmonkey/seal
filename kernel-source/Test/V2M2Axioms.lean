/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.AxiomAllowlist

#print axioms SealV2.validate_none_no_witness_result
#print axioms SealV2.MetaValue.ofStage1_preimageParts
#print axioms SealV2.valid_capability_has_unused_approval
#print axioms SealV2.valid_capability_has_unexpired_approval
#print axioms SealV2.valid_capability_has_signature_verified
#print axioms SealV2.valid_capability_target_bound
#print axioms SealV2.valid_capability_metadata_bound
#print axioms SealV2.valid_capability_session_bound

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.V2M2Axioms #[
    `SealV2.MetaValue.ofStage1_preimageParts,
    `SealV2.validate_none_no_witness_result,
    `SealV2.valid_capability_has_unused_approval,
    `SealV2.valid_capability_has_unexpired_approval,
    `SealV2.valid_capability_has_signature_verified,
    `SealV2.valid_capability_target_bound,
    `SealV2.valid_capability_metadata_bound,
    `SealV2.valid_capability_session_bound
  ]
