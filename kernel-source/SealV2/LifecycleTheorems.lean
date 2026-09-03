/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Validation

/-!
# M6 lifecycle / TTL invariants

Named invariants over the replay store state-machine
(`validateAndConsumeWithStore` against the reference `listReplayStore`):

* `consume_records_nonce`   — atomicity: a successful consume records the nonce.
* `replay_denied`           — single-use: re-presenting a just-consumed token denies.
* `consume_preserves_live`  — state monotonicity: live consumed entries are preserved.
* `consume_only_unexpired`  — expiry: a consumed approval is unexpired.
* `live_within_ttl_cap`     — TTL cap: a live approval is within the cap.

Honesty boundary (see `v2/milestones/06-lifecycle/NOTES.md`): these hold GIVEN serialized
access to the store (A4 — host obligation, OS-level TOCTOU-freedom not proven here) and are
proven for the concrete reference `listReplayStore` (A5 — the deployed host store must refine
its semantics; refinement not yet proven). Expiry blocking a valid signature is the M5 point
restated: authenticating origin is not authorizing intent.
-/

namespace SealV2

/-! ## Reflexivity helpers (replay-detection path uses only `a == a`) -/

theorem replayNs_refl (ns : ReplayNamespace) : (ns == ns) = true := by
  unfold BEq.beq instBEqReplayNamespace; unfold instBEqReplayNamespace.beq; simp

theorem nonce_refl (n : Nonce) : (n == n) = true := by simp [BEq.beq]

/-! ## Normal form of the consume transition over the reference store -/

/-- `validateAndConsumeWithStore` against `listReplayStore` reduces to: validate, prune by
    `now`, and (unless the nonce is already present) cons the new entry — one state-threading
    transition with no exposed intermediate state. -/
theorem vacws_list (store : List ConsumedNonce) (ast : AST) (state : ApprovalState) :
    validateAndConsumeWithStore listReplayStore store ast state =
      match validate ast state with
      | none => none
      | some checked =>
          let ns := replayNamespace state checked.snd.target
          let pruned := pruneConsumedNonces state.now store
          let entry : ConsumedNonce :=
            { ns := ns, nonce := checked.snd.approval.nonce, expiresAt := checked.snd.approval.expiresAt }
          if (pruned.any (fun e => e.ns == ns && e.nonce == checked.snd.approval.nonce)) = true then none
          else some (entry :: pruned, checked) := by
  unfold validateAndConsumeWithStore listReplayStore
  cases validate ast state with
  | none => rfl
  | some checked =>
      dsimp only
      cases hb : (pruneConsumedNonces state.now store).any
          (fun e => e.ns == replayNamespace state checked.snd.target && e.nonce == checked.snd.approval.nonce) <;>
        simp_all

/-! ## Invariants -/

/-- ATOMICITY: a successful consume records the nonce in the returned store — the witness is
    never handed back without the nonce having been persisted. -/
theorem consume_records_nonce {store store' : List ConsumedNonce} {ast state checked} :
    validateAndConsumeWithStore listReplayStore store ast state = some (store', checked) →
    (listReplayStore.contains? store'
      (replayNamespace state checked.snd.target) checked.snd.approval.nonce) = .ok true := by
  intro h
  rw [vacws_list] at h
  cases hv : validate ast state with
  | none => rw [hv] at h; simp at h
  | some c =>
      rw [hv] at h
      simp only at h
      split at h
      · simp at h
      · simp only [Option.some.injEq, Prod.mk.injEq] at h
        obtain ⟨hs, hc⟩ := h
        subst hs; subst hc
        simp only [listReplayStore, List.any_cons, replayNs_refl, nonce_refl, Bool.and_self,
          Bool.true_or]

/-- SINGLE-USE / REPLAY: re-presenting a just-consumed token to the post-state denies. The
    inserted entry survives pruning (the approval is unexpired) and matches, so the second
    `contains?` hits. Scope: same-`now` replay; post-expiry denial is `consume_only_unexpired`. -/
theorem replay_denied {store store' : List ConsumedNonce} {ast state checked} :
    validateAndConsumeWithStore listReplayStore store ast state = some (store', checked) →
    validateAndConsumeWithStore listReplayStore store' ast state = none := by
  intro h
  rw [vacws_list] at h
  cases hv : validate ast state with
  | none => rw [hv] at h; simp at h
  | some c =>
      rw [hv] at h
      simp only at h
      split at h
      · simp at h
      · simp only [Option.some.injEq, Prod.mk.injEq] at h
        obtain ⟨hs, _⟩ := h
        subst hs
        have hexp : state.now ≤ c.snd.approval.expiresAt := c.snd.approval_unexpired
        rw [vacws_list, hv]
        simp only
        rw [if_pos]
        apply List.any_eq_true.mpr
        refine ⟨{ ns := replayNamespace state c.snd.target, nonce := c.snd.approval.nonce,
                  expiresAt := c.snd.approval.expiresAt }, ?_, ?_⟩
        · apply List.mem_filter.mpr
          exact ⟨List.mem_cons_self, by simpa using hexp⟩
        · simp [replayNs_refl, nonce_refl]

/-- STATE MONOTONICITY: a consumed entry that is still live is preserved across a successful
    consume (the set of live consumed nonces only grows; expired entries may be pruned). -/
theorem consume_preserves_live {store store' : List ConsumedNonce} {ast state checked}
    (e : ConsumedNonce) :
    validateAndConsumeWithStore listReplayStore store ast state = some (store', checked) →
    e ∈ store → state.now ≤ e.expiresAt → e ∈ store' := by
  intro h hmem hlive
  rw [vacws_list] at h
  cases hv : validate ast state with
  | none => rw [hv] at h; simp at h
  | some c =>
      rw [hv] at h
      simp only at h
      split at h
      · simp at h
      · simp only [Option.some.injEq, Prod.mk.injEq] at h
        obtain ⟨hs, _⟩ := h
        subst hs
        apply List.mem_cons_of_mem
        exact List.mem_filter.mpr ⟨hmem, by simpa using hlive⟩

/-- EXPIRY: a successful consume implies the approval is unexpired. A valid signature on an
    expired approval is still denied — origin authenticated is not authorization. -/
theorem consume_only_unexpired {σ} {ops : ReplayStoreOps σ} {store store' : σ}
    {ast : AST} {state : ApprovalState} {checked} :
    validateAndConsumeWithStore ops store ast state = some (store', checked) →
    state.now ≤ checked.snd.approval.expiresAt :=
  fun _ => checked.snd.approval_unexpired

/-- TTL CAP: any approval the system treats as live is within the configured TTL cap;
    over-cap approvals are rejected before they can be consumed. -/
theorem live_within_ttl_cap {state : ApprovalState} {target : Target} {approval : Approval} :
    findApproval state target = some approval → ttlWithinCap state approval = true := by
  intro h
  have hlive := List.find?_some h
  unfold approvalLiveFor at hlive
  simp_all

end SealV2
