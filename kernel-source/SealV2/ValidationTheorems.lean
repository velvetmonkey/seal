/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Validation

namespace SealV2

theorem validate_none_no_witness_result (ast : AST) (state : ApprovalState) :
    validate ast state = none → ¬ ∃ checked witness, validate ast state = some ⟨checked, witness⟩ := by
  intro h hSome
  rcases hSome with ⟨checked, witness, hChecked⟩
  rw [h] at hChecked
  contradiction

theorem valid_capability_has_unused_approval {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    witness.approval.consumed = false :=
  witness.approval_unused

theorem valid_capability_has_unexpired_approval {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    state.now <= witness.approval.expiresAt :=
  witness.approval_unexpired

theorem valid_capability_has_signature_verified {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    SignatureVerified state.publicKey witness.approval :=
  witness.signature_verified

theorem valid_capability_target_bound {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    (witness.approval.target == witness.target) = true :=
  witness.approval_target_matches

/-- The validated V2 target carries exactly the complete metadata value parsed
    from the request; `targetFor` neither projects nor replaces it. -/
theorem valid_capability_metadata_bound {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    witness.target.metadata = witness.request.metadata := by
  rw [witness.target_matches]
  rfl

/-- The V2 target carries the complete opaque request-state value parsed from
    the request. -/
theorem valid_capability_requestState_bound {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    witness.target.requestState = witness.request.requestState := by
  rw [witness.target_matches]
  rfl

/-- The V2 target carries the complete input-responses value parsed from the
    request. -/
theorem valid_capability_inputResponses_bound {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    witness.target.inputResponses = witness.request.inputResponses := by
  rw [witness.target_matches]
  rfl

theorem approval_separates_requestState (base : Approval)
    (left right : RequestState) (hne : left ≠ right) :
    { base with target.requestState := left } ≠
      { base with target.requestState := right } := by
  intro h
  exact hne (congrArg (fun approval => approval.target.requestState) h)

theorem approval_separates_inputResponses (base : Approval)
    (left right : InputResponses) (hne : left ≠ right) :
    { base with target.inputResponses := left } ≠
      { base with target.inputResponses := right } := by
  intro h
  exact hne (congrArg (fun approval => approval.target.inputResponses) h)

theorem replayNamespace_separates_requestState (state : ApprovalState)
    (base : Target) (left right : RequestState) (hne : left ≠ right) :
    replayNamespace state { base with requestState := left } ≠
      replayNamespace state { base with requestState := right } := by
  intro h
  apply targetKey_separates_requestState base left right hne
  simpa only [replayNamespace] using congrArg ReplayNamespace.targetKey h

theorem replayNamespace_separates_inputResponses (state : ApprovalState)
    (base : Target) (left right : InputResponses) (hne : left ≠ right) :
    replayNamespace state { base with inputResponses := left } ≠
      replayNamespace state { base with inputResponses := right } := by
  intro h
  apply targetKey_separates_inputResponses base left right hne
  simpa only [replayNamespace] using congrArg ReplayNamespace.targetKey h

theorem valid_capability_session_bound {ast : AST} {state : ApprovalState}
    (witness : ValidApproval ast state) :
    witness.approval.session = state.session :=
  witness.approval_session_matches

theorem signed_parse_canonical (raw : RawBytes) (ast : {ast // IsCanonical ast}) :
    signedParse raw = some ast → raw = serializeAst ast := by
  unfold signedParse
  intro h
  split at h
  · exact absurd h (by simp)
  · rename_i a _
    split at h
    · rename_i hc
      split at h
      · rename_i hbeq
        have := Option.some.inj h
        rw [← this]
        exact eq_of_beq hbeq
      · exact absurd h (by simp)
    · exact absurd h (by simp)

end SealV2
