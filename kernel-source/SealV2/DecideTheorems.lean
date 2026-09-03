/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Decide

namespace SealV2

private theorem validate_success_shape (ast : AST) (state : ApprovalState)
    (checked : Sigma fun checkedAst => ValidApproval checkedAst state) :
    validate ast state = some checked →
      ∃ witness : ValidApproval ast state, checked = Sigma.mk ast witness := by
  intro h
  unfold validate at h
  split at h <;> try contradiction
  next hCan =>
    split at h <;> try contradiction
    next request hReq =>
      split at h <;> try contradiction
      next spec hSpec =>
        dsimp at h
        split at h <;> try contradiction
        next approval hApproval =>
          split at h <;> try contradiction
          next hSig =>
            split at h <;> try contradiction
            next hTools =>
              split at h <;> try contradiction
              next hAction =>
                split at h <;> try contradiction
                next hApprovals =>
                  split at h <;> try contradiction
                  next hTarget =>
                    split at h <;> try contradiction
                    next hSession =>
                      split at h <;> try contradiction
                      next hUnused =>
                        split at h <;> try contradiction
                        next hExpiry =>
                          injection h with hChecked
                          subst checked
                          exact ⟨_, rfl⟩

theorem decide_emit_unique (raw : RawBytes) (state : ApprovalState) (out : CanonicalBytes) :
    decide raw state = Decision.Allow out ↔
      ∃ ast, parse raw = some ast ∧
        ∃ witness : ValidApproval ast state,
          validate ast state = some (Sigma.mk ast witness) ∧
            out = serialize (Sigma.mk ast witness) := by
  constructor
  · intro hAllow
    unfold decide at hAllow
    cases hParse : parse raw with
    | none =>
        simp [hParse] at hAllow
    | some ast =>
        cases hValidate : validate ast state with
        | none =>
            simp [hParse, hValidate] at hAllow
        | some checked =>
            simp [hParse, hValidate] at hAllow
            obtain ⟨witness, hChecked⟩ := validate_success_shape ast state checked hValidate
            subst checked
            exact ⟨ast, rfl, witness, hValidate, hAllow.symm⟩
  · intro hChain
    rcases hChain with ⟨ast, hParse, witness, hValidate, hOut⟩
    simp [decide, hParse, hValidate, hOut]

theorem non_bypass (raw : RawBytes) (state : ApprovalState) (out : CanonicalBytes) :
    decide raw state = Decision.Allow out →
      ∃ ast, parse raw = some ast ∧
        ∃ witness : ValidApproval ast state,
          out = serialize (Sigma.mk ast witness) := by
  intro hAllow
  obtain ⟨ast, hParse, witness, _hValidate, hOut⟩ :=
    (decide_emit_unique raw state out).mp hAllow
  exact ⟨ast, hParse, witness, hOut⟩

theorem default_deny (raw : RawBytes) (state : ApprovalState) :
    (parse raw = none ∨
      ∃ ast, parse raw = some ast ∧ validate ast state = none) →
    decide raw state = Decision.Block := by
  intro hDeny
  rcases hDeny with hParseNone | ⟨ast, hParse, hValidate⟩
  · simp [decide, hParseNone]
  · simp [decide, hParse, hValidate]

end SealV2
