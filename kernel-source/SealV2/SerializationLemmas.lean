/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Serialization

/-
  Bridge lemmas for the serialize/parse roundtrip proofs.

  These are the small "leading character is not whitespace" facts that a blind
  proof search keeps missing: the arithmetic bridge from `isDigit` to `isWs`,
  the defining equation of `skipWs` on a non-whitespace head, and the concrete
  facts that '-' and '.' are not whitespace. With these named, the per-type
  roundtrip theorems in SerializationTheorems.lean climb a much shorter ladder.

  No `sorry`, no `native_decide`. Intended axiom footprint:
  propext / Classical.choice / Quot.sound only.
-/

namespace SealV2

/-- A digit character is never whitespace (char codes 48..57 are disjoint from
    {9, 10, 13, 32}). This is the arithmetic bridge the search keeps whiffing. -/
theorem isWs_eq_false_of_isDigit (c : Char) (h : isDigit c = true) :
    isWs c = false := by
  unfold isDigit at h
  simp only [Bool.and_eq_true, decide_eq_true_eq] at h
  obtain ⟨h0, h9⟩ := h
  unfold isWs
  split <;> first
    | rfl
    | (revert h0 h9; decide)

/-- `skipWs` on a non-whitespace head returns the list unchanged. The defining
    equation, exposed so callers do not unfold the recursion. -/
@[simp] theorem skipWs_cons_of_not_ws (c : Char) (rest : List Char)
    (h : isWs c = false) : skipWs (c :: rest) = c :: rest := by
  unfold skipWs
  rw [h]
  rfl

/-- The minus sign is not whitespace. -/
theorem isWs_minus_eq_false : isWs '-' = false := by decide

/-- The decimal point is not whitespace. -/
theorem isWs_dot_eq_false : isWs '.' = false := by decide

end SealV2
