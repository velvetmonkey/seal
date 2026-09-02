/- SPDX-License-Identifier: Apache-2.0 -/

import SealCore
import Seal.PolicyV2Theorems
import Seal.PolicyBundle
import Seal.NumberGuardTheorems
import Seal.PolicyScan
import Seal.Scaffold
import Seal.GoldenPath
import Seal.SignedPolicy
import Seal.EffectCommitment
import Seal.EncodingInjective
import Seal.GuardTheorems
import SealV2.TamperTheorems
import SealV2.ClassifyTransport
import SealV2.EffectEnvelope
import SealV2.ValidationTheorems
import Test.AxiomAllowlist

#print axioms SealCore.default_deny_never_allowed
#print axioms SealCore.no_allow_guarded_without_matching_approval_in_state
#print axioms SealCore.approval_binds_to_target
#print axioms Seal.adding_deny_cannot_allow
#print axioms Seal.adding_guard_cannot_explicitly_allow
#print axioms Seal.ambiguous_guard_targets_block
#print axioms Seal.full_arguments_preimage_changes
#print axioms Seal.evalTargetParts_congr
#print axioms Seal.evalTargetParts_indep_of_unnamed_paths
#print axioms Seal.evaluateRule_target_congr
#print axioms Seal.p0_2_policy_target_ignores_unnamed
#print axioms Seal.JsonUtil.numberScanStep_worst_le_of_no_digit
#print axioms Seal.effectiveConsensus_isSome_iff
#print axioms Seal.effectiveLinear_isSome_iff
#print axioms Seal.effectiveTemporal_nil_of_disabled
#print axioms Seal.effectiveConvergence_ne_nil_iff
#print axioms Seal.effectiveBudget_ne_nil_iff
#print axioms Seal.effectivePrincipals_isSome_iff
#print axioms Seal.scan_pass_sound
#print axioms Seal.scan_pass_no_orphan_allow
#print axioms SealCore.consumed_approval_not_live
#print axioms SealCore.expired_not_live
#print axioms SealCore.fresh_approval_live

-- Golden-path spec: scaffolder soundness
#print axioms Seal.scaffold_safety
#print axioms Seal.scaffold_safety_not_benign
#print axioms Seal.dangerous_annotation_guarded
#print axioms Seal.scaffoldMode_ne_deny
#print axioms Seal.scaffold_unknown_tool_default_deny
#print axioms Seal.scaffold_readonly_flows

-- Golden-path spec: shell reference cell
#print axioms Seal.shell_exec_requires_live_approval
#print axioms Seal.shell_rm_rf_requires_live_approval
#print axioms Seal.shell_rm_rf_blocks_on_fresh_state
#print axioms Seal.shell_rm_rf_allows_with_fresh_approval
#print axioms Seal.shell_read_flows

-- Stage A: the effect commitment (assumption-conditional theorems)
#print axioms Seal.effect_commitment_injective
#print axioms Seal.commitment_check_iff
#print axioms Seal.commitment_rederivation_stable
#print axioms Seal.preimage_shape
#print axioms Seal.preimage_shape_absent
#print axioms Seal.preimage_shape_present
#print axioms Seal.preimage_shape_mrtr_present
#print axioms Seal.ValidatedMeta.preimageParts_injective
#print axioms Seal.RequestState.preimageParts_injective
#print axioms Seal.InputResponses.preimageParts_injective
#print axioms SealV2.RequestState.ofStage1_preimageParts_ne_iff
#print axioms SealV2.InputResponses.ofStage1_preimageParts_ne_iff
#print axioms SealV2.target_separates_requestState
#print axioms SealV2.target_separates_inputResponses
#print axioms SealV2.targetKey_separates_requestState
#print axioms SealV2.targetKey_separates_inputResponses
#print axioms SealV2.target_requestState_absent_ne_present
#print axioms SealV2.target_inputResponses_absent_ne_present
#print axioms SealV2.targetKey_requestState_absent_ne_present
#print axioms SealV2.targetKey_inputResponses_absent_ne_present
#print axioms SealV2.signedMessageAst_separates_requestState
#print axioms SealV2.signedMessageAst_separates_inputResponses
#print axioms SealV2.approval_separates_requestState
#print axioms SealV2.approval_separates_inputResponses
#print axioms SealV2.replayNamespace_separates_requestState
#print axioms SealV2.replayNamespace_separates_inputResponses
#print axioms SealV2.valid_capability_requestState_bound
#print axioms SealV2.valid_capability_inputResponses_bound
#print axioms SealV2.Effect.optMrtr_inj
#print axioms SealV2.Effect.effectMessage_requestState_absent_ne_present
#print axioms SealV2.Effect.effectMessage_inputResponses_absent_ne_present
#print axioms Seal.guard_target_separates_requestState
#print axioms Seal.guard_target_separates_inputResponses
#print axioms Seal.guard_target_requestState_absent_ne_present
#print axioms Seal.guard_target_inputResponses_absent_ne_present
#print axioms Seal.preimage_separates_tools
#print axioms Seal.preimage_separates_servers

-- K5: encoding injectivity at the hashed-byte surface, A-ENC discharged in-repo
#print axioms Seal.Encoding.encodeParts_injective
#print axioms Seal.Encoding.encodeParts_toUTF8_injective
#print axioms Seal.Encoding.assumptionEncInjective_holds
#print axioms Seal.Encoding.effect_commitment_injective_of_cr_compress
#print axioms Seal.Encoding.cross_scheme_collision
#print axioms Seal.Encoding.witness_no_collision_within_scheme

-- Stage A: guard mode accepts ONLY the full-argument target
#print axioms Seal.guard_requires_full_arguments
#print axioms Seal.bundle_guard_requires_full_arguments
#print axioms Seal.toolRule_guard_full_arguments
#print axioms Seal.guardCheck_ok_guarded
#print axioms Seal.isFullArgumentsTarget_eq_true
#print axioms Seal.guard_partial_target_rejected
#print axioms Seal.guard_empty_target_rejected
#print axioms Seal.guard_starts_with_target_rejected
#print axioms Seal.guard_full_arguments_policy_accepted
#print axioms Seal.allow_partial_target_still_accepted

-- Golden-path spec: tamper ⇒ fail-closed
#print axioms Seal.tampered_policy_fail_closed
#print axioms Seal.tampered_policy_blocks
#print axioms SealV2.tampered_approvals_validate_none
#print axioms SealV2.tampered_approvals_deny
#print axioms SealV2.allow_implies_witness_signature_verified

-- K3/K4: the classify-seam characterisation capstones
#print axioms SealV2.ClassifyTransport.classes_partition
#print axioms SealV2.ClassifyTransport.strictCallShape_eq_toolsCall?
#print axioms SealV2.ClassifyTransport.forwarded_iff_escapes
#print axioms SealV2.ClassifyTransport.decided_iff_mediated
#print axioms SealV2.ClassifyTransport.forwarded_never_decided
#print axioms SealV2.ClassifyTransport.lenient_extends_strict
#print axioms SealV2.ClassifyTransport.mediated_lenient
#print axioms SealV2.ClassifyTransport.widened_fail_closed
#print axioms SealV2.ClassifyTransport.widened_relay_verbatim
#print axioms SealV2.ClassifyTransport.escape_events_no_influence
#print axioms SealV2.ClassifyTransport.allows_eq_of_purgeEscapes_eq
#print axioms SealV2.ClassifyTransport.escape_insertion_allows_invariant

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.Axioms #[
    `SealCore.default_deny_never_allowed,
    `SealCore.no_allow_guarded_without_matching_approval_in_state,
    `SealCore.approval_binds_to_target,
    `Seal.adding_deny_cannot_allow,
    `Seal.adding_guard_cannot_explicitly_allow,
    `Seal.ambiguous_guard_targets_block,
    `Seal.full_arguments_preimage_changes,
    `Seal.evalTargetParts_congr,
    `Seal.evalTargetParts_indep_of_unnamed_paths,
    `Seal.evaluateRule_target_congr,
    `Seal.p0_2_policy_target_ignores_unnamed,
    `Seal.JsonUtil.numberScanStep_worst_le_of_no_digit,
    `Seal.effectiveConsensus_isSome_iff,
    `Seal.effectiveLinear_isSome_iff,
    `Seal.effectiveTemporal_nil_of_disabled,
    `Seal.effectiveConvergence_ne_nil_iff,
    `Seal.effectiveBudget_ne_nil_iff,
    `Seal.effectivePrincipals_isSome_iff,
    `Seal.scan_pass_sound,
    `Seal.scan_pass_no_orphan_allow,
    `SealCore.consumed_approval_not_live,
    `SealCore.expired_not_live,
    `SealCore.fresh_approval_live,
    `Seal.scaffold_safety,
    `Seal.scaffold_safety_not_benign,
    `Seal.dangerous_annotation_guarded,
    `Seal.scaffoldMode_ne_deny,
    `Seal.scaffold_unknown_tool_default_deny,
    `Seal.scaffold_readonly_flows,
    `Seal.shell_exec_requires_live_approval,
    `Seal.shell_rm_rf_requires_live_approval,
    `Seal.shell_rm_rf_blocks_on_fresh_state,
    `Seal.shell_rm_rf_allows_with_fresh_approval,
    `Seal.shell_read_flows,
    `Seal.effect_commitment_injective,
    `Seal.commitment_check_iff,
    `Seal.commitment_rederivation_stable,
    `Seal.preimage_shape,
    `Seal.preimage_shape_absent,
    `Seal.preimage_shape_present,
    `Seal.preimage_shape_mrtr_present,
    `Seal.ValidatedMeta.preimageParts_injective,
    `Seal.RequestState.preimageParts_injective,
    `Seal.InputResponses.preimageParts_injective,
    `SealV2.RequestState.ofStage1_preimageParts_ne_iff,
    `SealV2.InputResponses.ofStage1_preimageParts_ne_iff,
    `SealV2.target_separates_requestState,
    `SealV2.target_separates_inputResponses,
    `SealV2.targetKey_separates_requestState,
    `SealV2.targetKey_separates_inputResponses,
    `SealV2.target_requestState_absent_ne_present,
    `SealV2.target_inputResponses_absent_ne_present,
    `SealV2.targetKey_requestState_absent_ne_present,
    `SealV2.targetKey_inputResponses_absent_ne_present,
    `SealV2.signedMessageAst_separates_requestState,
    `SealV2.signedMessageAst_separates_inputResponses,
    `SealV2.approval_separates_requestState,
    `SealV2.approval_separates_inputResponses,
    `SealV2.replayNamespace_separates_requestState,
    `SealV2.replayNamespace_separates_inputResponses,
    `SealV2.valid_capability_requestState_bound,
    `SealV2.valid_capability_inputResponses_bound,
    `SealV2.Effect.optMrtr_inj,
    `SealV2.Effect.effectMessage_requestState_absent_ne_present,
    `SealV2.Effect.effectMessage_inputResponses_absent_ne_present,
    `Seal.guard_target_separates_requestState,
    `Seal.guard_target_separates_inputResponses,
    `Seal.guard_target_requestState_absent_ne_present,
    `Seal.guard_target_inputResponses_absent_ne_present,
    `Seal.preimage_separates_tools,
    `Seal.preimage_separates_servers,
    `Seal.Encoding.encodeParts_injective,
    `Seal.Encoding.encodeParts_toUTF8_injective,
    `Seal.Encoding.assumptionEncInjective_holds,
    `Seal.Encoding.effect_commitment_injective_of_cr_compress,
    `Seal.Encoding.cross_scheme_collision,
    `Seal.Encoding.witness_no_collision_within_scheme,
    `Seal.guard_requires_full_arguments,
    `Seal.bundle_guard_requires_full_arguments,
    `Seal.toolRule_guard_full_arguments,
    `Seal.guardCheck_ok_guarded,
    `Seal.isFullArgumentsTarget_eq_true,
    `Seal.guard_partial_target_rejected,
    `Seal.guard_empty_target_rejected,
    `Seal.guard_starts_with_target_rejected,
    `Seal.guard_full_arguments_policy_accepted,
    `Seal.allow_partial_target_still_accepted,
    `Seal.tampered_policy_fail_closed,
    `Seal.tampered_policy_blocks,
    `SealV2.tampered_approvals_validate_none,
    `SealV2.tampered_approvals_deny,
    `SealV2.allow_implies_witness_signature_verified,
    `SealV2.ClassifyTransport.classes_partition,
    `SealV2.ClassifyTransport.strictCallShape_eq_toolsCall?,
    `SealV2.ClassifyTransport.forwarded_iff_escapes,
    `SealV2.ClassifyTransport.decided_iff_mediated,
    `SealV2.ClassifyTransport.forwarded_never_decided,
    `SealV2.ClassifyTransport.lenient_extends_strict,
    `SealV2.ClassifyTransport.mediated_lenient,
    `SealV2.ClassifyTransport.widened_fail_closed,
    `SealV2.ClassifyTransport.widened_relay_verbatim,
    `SealV2.ClassifyTransport.escape_events_no_influence,
    `SealV2.ClassifyTransport.allows_eq_of_purgeEscapes_eq,
    `SealV2.ClassifyTransport.escape_insertion_allows_invariant
  ]
