/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.DecideTheorems

/-!
# Tamper ⇒ fail-closed, approval side

The anti-theater guarantee for approval tokens: an approval whose signature
does not verify can never be the witness behind an Allow. Two directions:

* `tampered_approvals_deny` — if no approval in state verifies, `decide`
  blocks every request.
* `allow_implies_witness_signature_verified` — every Allow carries a witness
  approval whose signature DID verify against the session public key.

Crypto correctness of `ed25519Verify` is assumption A3; these theorems are
about the gate's use of it — verification failure is structurally
unreachable from a pass.
-/

namespace SealV2

/-- Liveness of an approval for a target includes signature verification:
    the gate never treats an unverified approval as live. -/
theorem approval_live_implies_signature_verified (state : ApprovalState)
    (target : Target) (approval : Approval)
    (h : approvalLiveFor state target approval = true) :
    verifySignature state.publicKey approval = true := by
  unfold approvalLiveFor at h
  simp only [Bool.and_eq_true] at h
  exact h.2

/-- If every approval in state fails signature verification, no approval is
    found live for any target. -/
theorem tampered_approvals_find_none (state : ApprovalState)
    (h : ∀ a ∈ state.approvals, verifySignature state.publicKey a = false)
    (target : Target) :
    findApproval state target = none := by
  unfold findApproval
  rw [List.find?_eq_none]
  intro a ha hlive
  have hverified := approval_live_implies_signature_verified state target a hlive
  rw [h a ha] at hverified
  cases hverified

/-- **Tamper ⇒ fail-closed (approval), validation layer.** With only
    unverifiable approvals in state, validation refuses every request. -/
theorem tampered_approvals_validate_none (ast : AST) (state : ApprovalState)
    (h : ∀ a ∈ state.approvals, verifySignature state.publicKey a = false) :
    validate ast state = none := by
  cases hval : validate ast state with
  | none => rfl
  | some checked =>
      exfalso
      unfold validate at hval
      split at hval <;> try contradiction
      split at hval <;> try contradiction
      next request _hReq =>
        split at hval <;> try contradiction
        next spec _hSpec =>
          dsimp at hval
          split at hval <;> try contradiction
          next approval hApproval =>
            rw [tampered_approvals_find_none state h] at hApproval
            cases hApproval

/-- **Tamper ⇒ fail-closed (approval), wire layer.** With only unverifiable
    approvals in state, `decide` blocks every raw request — never a pass. -/
theorem tampered_approvals_deny (raw : RawBytes) (state : ApprovalState)
    (h : ∀ a ∈ state.approvals, verifySignature state.publicKey a = false) :
    decide raw state = Decision.Block := by
  cases hp : parse raw with
  | none => exact default_deny raw state (.inl hp)
  | some ast =>
      exact default_deny raw state
        (.inr ⟨ast, hp, tampered_approvals_validate_none ast state h⟩)

/-- **Anti-theater, positive form.** Every Allow carries a witness approval
    whose signature verified against the session public key: a tampered
    token can never be the passing witness. -/
theorem allow_implies_witness_signature_verified (raw : RawBytes)
    (state : ApprovalState) (out : CanonicalBytes)
    (hallow : decide raw state = Decision.Allow out) :
    ∃ ast, parse raw = some ast ∧
      ∃ witness : ValidApproval ast state,
        verifySignature state.publicKey witness.approval = true ∧
        out = serialize (Sigma.mk ast witness) := by
  obtain ⟨ast, hparse, witness, hout⟩ := non_bypass raw state out hallow
  exact ⟨ast, hparse, witness, witness.signature_verified.verified, hout⟩

end SealV2
