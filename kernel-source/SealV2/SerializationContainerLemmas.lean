/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Validation
import Aesop

/- Scaffolding lemmas for the container (array/object) serialize/parse roundtrip
   proofs. These are the mechanical supporting facts identified by the 2026-06-06
   proof-strategy council: whitespace head facts, canonicality characterisations,
   and structural size bounds. The hard mutual-induction helpers build on these. -/

namespace SealV2

/- ---- skipWs: a non-whitespace head is a no-op ---- -/

theorem skipWs_cons_of_not_ws (c : Char) (rest : List Char) (h : isWs c = false) :
    skipWs (c :: rest) = c :: rest := by
  unfold skipWs; simp [h]

/- Delimiter / structural characters are never whitespace. -/
theorem isWs_lbracket : isWs '[' = false := by decide
theorem isWs_rbracket : isWs ']' = false := by decide
theorem isWs_lbrace : isWs '{' = false := by decide
theorem isWs_rbrace : isWs '}' = false := by decide
theorem isWs_comma : isWs ',' = false := by decide
theorem isWs_colon : isWs ':' = false := by decide
theorem isWs_quote : isWs '"' = false := by decide

/- ---- isCanonicalArray is order-independent (all elements canonical) ---- -/

theorem isCanonicalArray_eq_all (l : List AST) :
    isCanonicalArray l = l.all (fun a => isCanonicalAst a) := by
  induction l with
  | nil => rfl
  | cons x xs ih => simp [isCanonicalArray, ih]

theorem isCanonicalArray_append (xs ys : List AST) :
    isCanonicalArray (xs ++ ys) = (isCanonicalArray xs && isCanonicalArray ys) := by
  simp [isCanonicalArray_eq_all, List.all_append]

theorem isCanonicalArray_reverse (xs : List AST) :
    isCanonicalArray xs.reverse = isCanonicalArray xs := by
  simp [isCanonicalArray_eq_all]

theorem isCanonicalArray_cons (x : AST) (xs : List AST) :
    isCanonicalArray (x :: xs) = (isCanonicalAst x && isCanonicalArray xs) := by
  simp [isCanonicalArray_eq_all]

/- Membership extraction: an element of a canonical array is canonical. -/
theorem isCanonicalAst_of_mem_array {x : AST} {xs : List AST}
    (hx : x ∈ xs) (h : isCanonicalArray xs = true) : isCanonicalAst x = true := by
  rw [isCanonicalArray_eq_all] at h
  exact List.all_eq_true.mp h x hx

/- ---- isCanonicalObject: structural unfolding ---- -/

theorem isCanonicalObject_cons (key : String) (value : AST) (rest : List (String × AST)) :
    isCanonicalObject ((key, value) :: rest)
      = (isCanonicalString key && isCanonicalAst value
          && !hasDuplicateKey key rest && isCanonicalObject rest) := by
  rfl

/- The head value of a canonical object is canonical. -/
theorem isCanonicalObject_head_value {key : String} {value : AST}
    {rest : List (String × AST)} (h : isCanonicalObject ((key, value) :: rest) = true) :
    isCanonicalAst value = true := by
  rw [isCanonicalObject_cons] at h
  simp only [Bool.and_eq_true] at h
  exact h.1.1.2

/- The head key of a canonical object is canonical. -/
theorem isCanonicalObject_head_key {key : String} {value : AST}
    {rest : List (String × AST)} (h : isCanonicalObject ((key, value) :: rest) = true) :
    isCanonicalString key = true := by
  rw [isCanonicalObject_cons] at h
  simp only [Bool.and_eq_true] at h
  exact h.1.1.1

/- The tail of a canonical object is canonical. -/
theorem isCanonicalObject_tail {key : String} {value : AST}
    {rest : List (String × AST)} (h : isCanonicalObject ((key, value) :: rest) = true) :
    isCanonicalObject rest = true := by
  rw [isCanonicalObject_cons] at h
  simp only [Bool.and_eq_true] at h
  exact h.2

/- The head key is not duplicated in the tail. -/
theorem isCanonicalObject_head_nodup {key : String} {value : AST}
    {rest : List (String × AST)} (h : isCanonicalObject ((key, value) :: rest) = true) :
    hasDuplicateKey key rest = false := by
  rw [isCanonicalObject_cons] at h
  simp only [Bool.and_eq_true, Bool.not_eq_true'] at h
  exact h.1.2

/- ---- sizeOf membership bounds for the value-level strong induction ---- -/

theorem sizeOf_lt_array {x : AST} {items : List AST} (hx : x ∈ items) :
    sizeOf x < sizeOf (AST.array items) := by
  have h := List.sizeOf_lt_of_mem hx
  simp only [AST.array.sizeOf_spec]
  omega

theorem sizeOf_lt_object {key : String} {value : AST} {fields : List (String × AST)}
    (hx : (key, value) ∈ fields) :
    sizeOf value < sizeOf (AST.object fields) := by
  have h := List.sizeOf_lt_of_mem hx
  simp only [AST.object.sizeOf_spec]
  have hpair : sizeOf value < sizeOf (key, value) := by
    simp only [Prod.mk.sizeOf_spec]; omega
  omega

end SealV2
