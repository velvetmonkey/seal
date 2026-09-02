/- SPDX-License-Identifier: Apache-2.0 -/

import SealCore.Automaton
import Std.Data.HashMap.Lemmas

namespace SealCore

theorem default_deny_never_allowed (now : Nat) (s : State) :
    (step now s .defaultDeny).1 = .block := by
  rfl

theorem benign_preserves_approved (now : Nat) (s : State) :
    (step now s .benign).2.approved = s.approved := by
  rfl

theorem guarded_allow_iff_live (now : Nat) (s : State) (target : TargetHash) :
    (step now s (.guarded target)).1 = .allow ↔ live s target now = true := by
  unfold step
  by_cases h : live s target now
  · simp [h]
  · simp [h]

theorem no_allow_guarded_without_matching_approval_in_state
    (now : Nat) (s : State) (target : TargetHash) :
    (step now s (.guarded target)).1 = .allow → live s target now = true := by
  intro h
  exact (guarded_allow_iff_live now s target).1 h

theorem approval_binds_to_target
    (now deadline : Nat) (approvedTarget guardedTarget : TargetHash)
    (hneq : approvedTarget ≠ guardedTarget) :
    live { approved := (∅ : Std.HashMap TargetHash Nat).insert approvedTarget deadline } guardedTarget now = false := by
  unfold live
  rw [Std.HashMap.getElem?_insert]
  have hbeq : (approvedTarget == guardedTarget) = false := by
    exact beq_false_of_ne hneq
  simp [hbeq]

/-- An approval for one target does not transfer to another: with only an
    approval for `approvedTarget` in state, a guarded call for a different
    target blocks. Target-binding removes one precondition of confused-deputy
    attacks at this boundary; it does not model the deputy scenario (there is
    no deputy in the model). -/
theorem approval_not_transferable_across_targets
    (now deadline : Nat) (approvedTarget guardedTarget : TargetHash)
    (hneq : approvedTarget ≠ guardedTarget) :
    (step now { approved := (∅ : Std.HashMap TargetHash Nat).insert approvedTarget deadline }
      (.guarded guardedTarget)).1 = .block := by
  have hLive := approval_binds_to_target now deadline approvedTarget guardedTarget hneq
  unfold step
  simp [hLive]

theorem consumed_approval_not_live (now : Nat) (s : State) (target : TargetHash) :
    (step now (step now s (.guarded target)).2 (.guarded target)).1 = .allow →
      (step now s (.guarded target)).1 = .block := by
  intro h
  unfold step at h ⊢
  by_cases hlive : live s target now
  · simp [hlive] at h
    unfold live at h
    rw [Std.HashMap.getElem?_erase_self] at h
    contradiction
  · simp [hlive]

/-- An approval whose deadline is at or before `now` is not live: the gate
    blocks once an approval has expired. -/
theorem expired_not_live (s : State) (target : TargetHash) (now deadline : Nat)
    (hfound : s.approved[target]? = some deadline) (hexp : deadline ≤ now) :
    live s target now = false := by
  unfold live
  rw [hfound]
  simp only [decide_eq_false_iff_not, Nat.not_lt]
  omega

/-- A freshly recorded approval whose deadline is still in the future is live:
    the gate admits the first matching call before the deadline. -/
theorem fresh_approval_live (now deadline : Nat) (s : State) (target : TargetHash)
    (h : now < deadline) :
    live (step now s (.approval target deadline)).2 target now = true := by
  unfold step live
  rw [Std.HashMap.getElem?_insert_self]
  simp only [decide_eq_true_eq]
  omega

end SealCore
