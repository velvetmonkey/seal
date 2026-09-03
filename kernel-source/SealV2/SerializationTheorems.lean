/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Validation
import SealV2.SerializationContainerLemmas
import Aesop

namespace SealV2

/- GROUP A: parser canonicality, worker induction. -/

theorem guardCanonicalResult_returns_canonical
    (result : Option (AST × List Char)) (ast : AST) (rest : List Char) :
    guardCanonicalResult result = some (ast, rest) →
      IsCanonical ast := by
  intro hResult
  unfold guardCanonicalResult at hResult
  split at hResult
  · split at hResult
    · cases hResult; assumption
    · contradiction
  · contradiction

theorem guardCanonicalStringResult_returns_canonical
    (result : Option (String × List Char)) (value : String) (rest : List Char) :
    guardCanonicalStringResult result = some (value, rest) →
      isCanonicalString value = true := by
  intro hResult
  unfold guardCanonicalStringResult at hResult
  split at hResult
  · split at hResult
    · cases hResult; assumption
    · contradiction
  · contradiction

theorem parseStringChars_preserves_canonical
    (acc value : String) (chars rest : List Char) :
    isCanonicalString acc = true →
      parseStringChars acc chars = some (value, rest) →
        isCanonicalString value = true := by
  intro _ hParse
  exact guardCanonicalStringResult_returns_canonical (parseStringCharsUnchecked acc chars) value rest hParse

theorem parseNumber_returns_canonical
    (chars rest : List Char) (ast : AST) :
    parseNumber chars = some (ast, rest) →
      IsCanonical ast := by
  exact guardCanonicalResult_returns_canonical (parseNumberUnchecked chars) ast rest

theorem parseArrayFuel_returns_canonical
    (fuel : Nat) (acc : List AST) (chars rest : List Char) (ast : AST) :
    isCanonicalArray acc = true →
      parseArrayFuel fuel acc chars = some (ast, rest) →
        IsCanonical ast := by
  intro _ hParse
  exact guardCanonicalResult_returns_canonical (parseArrayFuelUnchecked fuel acc chars) ast rest hParse

theorem parseObjectFuel_returns_canonical
    (fuel : Nat) (acc : List (String × AST)) (chars rest : List Char) (ast : AST) :
    isCanonicalObject acc = true →
      parseObjectFuel fuel acc chars = some (ast, rest) →
        IsCanonical ast := by
  intro _ hParse
  exact guardCanonicalResult_returns_canonical (parseObjectFuelUnchecked fuel acc chars) ast rest hParse

theorem parse_returns_canonical (raw : RawBytes) (ast : AST) :
    parse raw = some ast →
      IsCanonical ast := by
  intro hParse
  unfold parse at hParse
  dsimp at hParse
  split at hParse
  · split at hParse
    · split at hParse
      · cases hParse; assumption
      · contradiction
    · contradiction
  · contradiction

/- ============================================================
   HELPER LEMMAS for roundtrip proofs
   ============================================================ -/

theorem string_singleton_append_ofList (c : Char) (cs : List Char) :
    String.singleton c ++ String.ofList cs = String.ofList (c :: cs) := by
  apply String.ext
  simp [String.toList_append, String.toList_singleton, String.toList_ofList]

private theorem ofList_toList_eq (s : String) (cs : List Char) (h : s.toList = cs) :
    String.ofList cs = s := by rw [← h, String.ofList_toList]

private theorem push_eq_append_singleton (acc : String) (c : Char) :
    acc.push c = acc ++ String.singleton c := by
  rw [← String.toList_inj]; simp [String.toList_push]

theorem takeDigits_all_digits_nil (cs : List Char) (h : cs.all isDigit = true) :
    takeDigits cs = (String.ofList cs, []) := by
  induction cs with
  | nil => simp [takeDigits]
  | cons c cs' ih =>
    have hc := List.all_eq_true.mp h c (List.mem_cons_self ..)
    have hcs' := List.all_eq_true.mpr (fun x hx => List.all_eq_true.mp h x (List.mem_cons_of_mem c hx))
    simp [takeDigits, hc, ih hcs']
    apply String.ext; simp [String.toList_append, String.toList_singleton, String.toList_ofList]

theorem takeDigits_all_digits_append (cs : List Char) (c : Char) (rest : List Char)
    (hcs : cs.all isDigit = true) (hc : isDigit c = false) :
    takeDigits (cs ++ c :: rest) = (String.ofList cs, c :: rest) := by
  induction cs with
  | nil => simp [takeDigits, hc]
  | cons d cs' ih =>
    have hd := List.all_eq_true.mp hcs d (List.mem_cons_self ..)
    have hcs' := List.all_eq_true.mpr (fun x hx => List.all_eq_true.mp hcs x (List.mem_cons_of_mem d hx))
    simp [List.cons_append, takeDigits, hd, ih hcs']
    apply String.ext; simp [String.toList_append, String.toList_singleton, String.toList_ofList]

theorem digit_not_ws (c : Char) (h : isDigit c = true) : isWs c = false := by
  unfold isDigit at h; simp +decide at h; unfold isWs
  split <;> simp_all

theorem nonZeroDigit_isDigit (c : Char) (h : isNonZeroDigit c = true) : isDigit c = true := by
  unfold isDigit isNonZeroDigit at *; grind

theorem parseIntegerDigits_canonical (intDigits : String) (rest : List Char)
    (hcan : isCanonicalIntDigits intDigits = true)
    (hrest : rest = [] ∨ ∃ c rest', rest = c :: rest' ∧ isDigit c = false) :
    parseIntegerDigits (intDigits.toList ++ rest) = some (intDigits, rest) := by
  unfold isCanonicalIntDigits at hcan
  cases hlist : intDigits.toList with
  | nil => rw [hlist] at hcan; simp at hcan
  | cons c cs =>
    rw [hlist] at hcan
    by_cases hc0 : c = '0' ∧ cs = []
    · obtain ⟨rfl, rfl⟩ := hc0
      have hid : intDigits = "0" := by rw [← String.toList_inj]; simp [hlist]; decide
      rcases hrest with rfl | ⟨d, rest', rfl, hd⟩ <;> simp [parseIntegerDigits, *]
    · have hNZC : isNonZeroDigitChar c = true ∧ cs.all isDigitChar = true := by
        split at hcan
        · exact absurd (List.cons_eq_cons.mp ‹_›) hc0
        · rename_i hne; obtain ⟨rfl, rfl⟩ := List.cons_eq_cons.mp hne
          simp +decide at hcan; exact ⟨hcan.1, List.all_eq_true.mpr hcan.2⟩
        · simp at hcan
      have hcNe0 : c ≠ '0' := by
        intro heq; subst heq; unfold isNonZeroDigitChar at hNZC; simp +decide at hNZC
      have hIntEq : String.singleton c ++ String.ofList cs = intDigits :=
        by rw [string_singleton_append_ofList, ofList_toList_eq intDigits (c :: cs) hlist]
      show parseIntegerDigits ((c :: cs) ++ rest) = some (intDigits, rest)
      simp only [List.cons_append]
      simp [parseIntegerDigits]
      refine ⟨hNZC.1, ?_⟩
      rcases hrest with rfl | ⟨d, rest', rfl, hd⟩
      · rw [List.append_nil, takeDigits_all_digits_nil cs hNZC.2]
        exact ⟨hIntEq, rfl⟩
      · rw [takeDigits_all_digits_append cs d rest' hNZC.2 hd]
        exact ⟨hIntEq, rfl⟩

theorem parseFraction_nonDot (c : Char) (rest : List Char) (hc : c ≠ '.') :
    parseFraction (c :: rest) = some (none, c :: rest) := by
  unfold parseFraction
  split
  · rename_i h; simp at h; exact absurd h.1 hc
  · rfl

theorem parseFraction_canonical (fracDigits : String) (rest : List Char)
    (hcan : isCanonicalFracDigits fracDigits = true)
    (hrest : rest = [] ∨ ∃ c rest', rest = c :: rest' ∧ isDigit c = false) :
    parseFraction ('.' :: fracDigits.toList ++ rest) = some (some fracDigits, rest) := by
  unfold isCanonicalFracDigits at hcan
  cases hrev : fracDigits.toList.reverse with
  | nil => rw [hrev] at hcan; simp at hcan
  | cons last revtail =>
    rw [hrev] at hcan; simp +decide at hcan
    have h_digits : fracDigits.toList.all isDigitChar = true := List.all_eq_true.mpr hcan.2
    have h_takeDigits : takeDigits (fracDigits.toList ++ rest) = (fracDigits, rest) := by
      rcases hrest with rfl | ⟨c, rest', rfl, hc⟩
      · rw [List.append_nil, takeDigits_all_digits_nil _ h_digits, String.ofList_toList]
      · rw [takeDigits_all_digits_append _ _ _ h_digits hc, String.ofList_toList]
    unfold parseFraction
    simp [h_takeDigits, hrev]
    have : last ≠ '0' := by intro heq; subst heq; simp +decide at hcan
    simp [this]

theorem startsExponent_nonExp (c : Char) (rest : List Char) (hc : c ≠ 'e') (hc2 : c ≠ 'E') :
    startsExponent (c :: rest) = false := by
  unfold startsExponent; grind

theorem parseNumberUnchecked_serializeDecimal (value : Decimal) (rest : List Char)
    (hcan : isCanonicalDecimal value = true)
    (hrest : rest = [] ∨ ∃ c rest', rest = c :: rest' ∧ isDigit c = false ∧ c ≠ '.' ∧ c ≠ 'e' ∧ c ≠ 'E') :
    parseNumberUnchecked ((serializeDecimal value).toList ++ rest) = some (.number value, rest) := by
  obtain ⟨neg, intDigits, fracDigits⟩ := value
  have hcanInt : isCanonicalIntDigits intDigits = true := by
    unfold isCanonicalDecimal at hcan; simp only [Bool.and_eq_true] at hcan; exact hcan.1.1
  obtain ⟨ic, ics, hic, hicd⟩ : ∃ c cs, intDigits.toList = c :: cs ∧ isDigit c = true := by
    unfold isCanonicalIntDigits at hcanInt
    cases h : intDigits.toList with
    | nil => rw [h] at hcanInt; simp at hcanInt
    | cons c cs =>
      refine ⟨c, cs, rfl, ?_⟩
      rw [h] at hcanInt
      by_cases h0 : c = '0' ∧ cs = []
      · obtain ⟨rfl, rfl⟩ := h0; decide
      · revert hcanInt; unfold isDigit
        split
        · intro hh; exact absurd (List.cons_eq_cons.mp ‹_›) h0
        · rename_i hne; obtain ⟨rfl, _⟩ := List.cons_eq_cons.mp hne
          intro hh; simp +decide at hh; unfold isNonZeroDigitChar at hh
          simp +decide at hh ⊢; omega
        · intro hh; simp at hh
  obtain ⟨ftail, hftail⟩ : ∃ t : List Char,
      t = (match fracDigits with | none => ([] : List Char) | some d => '.' :: d.toList) :=
    ⟨_, rfl⟩
  have hpInt : parseIntegerDigits (intDigits.toList ++ (ftail ++ rest))
      = some (intDigits, ftail ++ rest) := by
    apply parseIntegerDigits_canonical intDigits (ftail ++ rest) hcanInt
    cases fracDigits with
    | none =>
      rw [hftail]; simp only [List.nil_append]
      rcases hrest with rfl | ⟨c, r, rfl, hd, _, _, _⟩
      · exact Or.inl rfl
      · exact Or.inr ⟨c, r, rfl, hd⟩
    | some d => rw [hftail]; exact Or.inr ⟨'.', d.toList ++ rest, rfl, by decide⟩
  have hpFrac : parseFraction (ftail ++ rest) = some (fracDigits, rest) := by
    cases fracDigits with
    | none =>
      rw [hftail]; simp only [List.nil_append]
      rcases hrest with rfl | ⟨c, r, rfl, _, hdot, _, _⟩
      · rfl
      · exact parseFraction_nonDot c r hdot
    | some d =>
      rw [hftail]
      have hcanFrac : isCanonicalFracDigits d = true := by
        unfold isCanonicalDecimal at hcan; simp only [Bool.and_eq_true] at hcan; exact hcan.1.2
      simp only [List.cons_append]
      apply parseFraction_canonical d rest hcanFrac
      rcases hrest with rfl | ⟨c, r, rfl, hd, _, _, _⟩
      · exact Or.inl rfl
      · exact Or.inr ⟨c, r, rfl, hd⟩
  have hpExp : startsExponent rest = false := by
    rcases hrest with rfl | ⟨c, r, rfl, _, _, he, hE⟩
    · rfl
    · exact startsExponent_nonExp c r he hE
  have hicNotDash : ic ≠ '-' := by intro h; subst h; revert hicd; decide
  have hdash : ("-" : String).toList = ['-'] := by decide
  have hdot : ("." : String).toList = ['.'] := by decide
  rw [hic] at hpInt
  simp only [List.cons_append] at hpInt
  cases neg with
  | true =>
    have hser : (serializeDecimal ⟨true, intDigits, fracDigits⟩).toList
        = '-' :: ((ic :: ics) ++ ftail) := by
      rw [hftail]; cases fracDigits <;>
        simp [serializeDecimal, String.toList_append, hdash, hdot, hic, List.append_nil]
    rw [hser]
    unfold parseNumberUnchecked
    simp [List.cons_append, List.append_assoc, hpInt, hpFrac, hpExp]
  | false =>
    have hser : (serializeDecimal ⟨false, intDigits, fracDigits⟩).toList
        = (ic :: ics) ++ ftail := by
      rw [hftail]; cases fracDigits <;>
        simp [serializeDecimal, String.toList_append, hdot, hic, List.append_nil]
    rw [hser, List.cons_append]
    unfold parseNumberUnchecked
    simp [hicNotDash, List.cons.injEq, false_and, List.cons_append,
      List.append_assoc, hpInt, hpFrac, hpExp]

theorem serializeDecimal_firstChar_neg (value : Decimal)
    (_hcan : isCanonicalDecimal value = true) (hneg : value.negative = true) :
    ∃ rest, (serializeDecimal value).toList = '-' :: rest := by
  unfold serializeDecimal; simp [hneg]; exact ⟨_, rfl⟩

theorem serializeDecimal_firstChar_pos (value : Decimal)
    (hcan : isCanonicalDecimal value = true) (hneg : value.negative = false) :
    ∃ c rest, (serializeDecimal value).toList = c :: rest ∧ isDigit c = true := by
  obtain ⟨c, rest, h_int⟩ : ∃ c rest, value.intDigits.toList = c :: rest ∧ isDigit c = true := by
    unfold isCanonicalDecimal at hcan
    unfold isCanonicalIntDigits at hcan
    unfold isNonZeroDigitChar at hcan; unfold isDigit at *
    grind
  unfold serializeDecimal; aesop

theorem escapeString_toList (s : String) :
    (escapeString s).toList = escapeList s.toList := by
  simp [escapeString, String.toList_ofList]

/-- Valid scalars in the long-form `\u` classes satisfy the canonicality
    check. The five short-escape controls, printable ASCII, and (by `Char`
    validity) the surrogate gap are excluded by hypothesis. -/
private theorem uEscapeScalarOk_of_class (n : Nat)
    (hval : n < 0xd800 ∨ (0xdfff < n ∧ n < 0x110000))
    (hnp : ¬(0x20 ≤ n ∧ n ≤ 0x7e))
    (ha : n ≠ 0xa) (ht : n ≠ 0x9) (hr : n ≠ 0xd) (hb : n ≠ 0x8) (hf : n ≠ 0xc)
    (hlt : n < 0x10000) :
    uEscapeScalarOk n = true := by
  unfold uEscapeScalarOk
  by_cases h1 : n < 0x20
  · rw [if_pos h1]; unfold shortEscapeLetter?
    rw [if_neg ha, if_neg ht, if_neg hr, if_neg hb, if_neg hf]; rfl
  · rw [if_neg h1]
    by_cases h2 : n = 0x7f
    · rw [if_pos h2]
    · rw [if_neg h2]
      by_cases h3 : 0x80 ≤ n ∧ n < 0xd800
      · rw [if_pos h3]
      · rw [if_neg h3, if_pos (show 0xe000 ≤ n ∧ n ≤ 0xffff from ⟨by omega, by omega⟩)]

/-- The parser consumes one literal (non-quote, non-backslash, printable
    ASCII) character and appends it. The three coverage obligations left by the
    match compiler (the quote and the two backslash arms) close against the
    class hypotheses. -/
private theorem parse_lit_step (c : Char) (acc : String) (tail : List Char)
    (hq : c ≠ '"') (hbk : c ≠ '\\') (hascii : isAsciiStringChar c = true) :
    parseStringCharsUnchecked acc (c :: tail)
      = parseStringCharsUnchecked (acc ++ String.singleton c) tail := by
  rw [parseStringCharsUnchecked]
  simp only [hq, hbk, hascii]
  all_goals first
    | rfl
    | simp only [if_true]
    | exact hq
    | (intro h; exact absurd h hq)
    | (intro _ _ _ _ _ h _; exact absurd h hbk)
    | (intro _ _ h _; exact absurd h hbk)
    | simp_all

/-- **The per-character decode step.** The parser consumes exactly
    `escapeChar c` and appends `c` — for EVERY `Char`, with any tail. -/
private theorem parseStringCharsUnchecked_escapeChar (c : Char) (acc : String)
    (tail : List Char) :
    parseStringCharsUnchecked acc (escapeChar c ++ tail)
      = parseStringCharsUnchecked (acc ++ String.singleton c) tail := by
  have hval : c.toNat < 0xd800 ∨ (0xdfff < c.toNat ∧ c.toNat < 0x110000) := c.valid
  by_cases hq : c = '"'
  · rw [hq]; rfl
  by_cases hbk : c = '\\'
  · rw [hbk]; rfl
  by_cases hpr : 0x20 ≤ c.toNat ∧ c.toNat ≤ 0x7e
  · have hesc : escapeChar c = [c] := by simp [escapeChar, hq, hbk, hpr]
    have hascii : isAsciiStringChar c = true := by
      simp [isAsciiStringChar, hpr.1, hpr.2, hq, hbk]
    rw [hesc]; exact parse_lit_step c acc tail hq hbk hascii
  · by_cases hna : c.toNat = 0xa
    · have hesc : escapeChar c = ['\\', 'n'] := by simp [escapeChar, hq, hbk, hpr, hna]
      have hc : c = Char.ofNat 0xa := by rw [← hna, Char.ofNat_toNat]
      rw [hesc, hc]
      show parseStringCharsUnchecked acc ('\\' :: 'n' :: tail) = _
      rw [parseStringCharsUnchecked]
      all_goals first | rfl | (intro _ _ _ _ _ h _; exact absurd h (by decide))
    by_cases hnt : c.toNat = 0x9
    · have hesc : escapeChar c = ['\\', 't'] := by simp [escapeChar, hq, hbk, hpr, hna, hnt]
      have hc : c = Char.ofNat 0x9 := by rw [← hnt, Char.ofNat_toNat]
      rw [hesc, hc]
      show parseStringCharsUnchecked acc ('\\' :: 't' :: tail) = _
      rw [parseStringCharsUnchecked]
      all_goals first | rfl | (intro _ _ _ _ _ h _; exact absurd h (by decide))
    by_cases hnr : c.toNat = 0xd
    · have hesc : escapeChar c = ['\\', 'r'] := by
        simp [escapeChar, hq, hbk, hpr, hna, hnt, hnr]
      have hc : c = Char.ofNat 0xd := by rw [← hnr, Char.ofNat_toNat]
      rw [hesc, hc]
      show parseStringCharsUnchecked acc ('\\' :: 'r' :: tail) = _
      rw [parseStringCharsUnchecked]
      all_goals first | rfl | (intro _ _ _ _ _ h _; exact absurd h (by decide))
    by_cases hnb : c.toNat = 0x8
    · have hesc : escapeChar c = ['\\', 'b'] := by
        simp [escapeChar, hq, hbk, hpr, hna, hnt, hnr, hnb]
      have hc : c = Char.ofNat 0x8 := by rw [← hnb, Char.ofNat_toNat]
      rw [hesc, hc]
      show parseStringCharsUnchecked acc ('\\' :: 'b' :: tail) = _
      rw [parseStringCharsUnchecked]
      all_goals first | rfl | (intro _ _ _ _ _ h _; exact absurd h (by decide))
    by_cases hnf : c.toNat = 0xc
    · have hesc : escapeChar c = ['\\', 'f'] := by
        simp [escapeChar, hq, hbk, hpr, hna, hnt, hnr, hnb, hnf]
      have hc : c = Char.ofNat 0xc := by rw [← hnf, Char.ofNat_toNat]
      rw [hesc, hc]
      show parseStringCharsUnchecked acc ('\\' :: 'f' :: tail) = _
      rw [parseStringCharsUnchecked]
      all_goals first | rfl | (intro _ _ _ _ _ h _; exact absurd h (by decide))
    by_cases hbmp : c.toNat < 0x10000
    · have hesc : escapeChar c = '\\' :: 'u' :: toHex4 c.toNat := by
        simp [escapeChar, hq, hbk, hpr, hna, hnt, hnr, hnb, hnf, hbmp]
      have hok : uEscapeScalarOk c.toNat = true :=
        uEscapeScalarOk_of_class c.toNat hval hpr hna hnt hnr hnb hnf hbmp
      rw [hesc]
      show parseStringCharsUnchecked acc
        ('\\' :: 'u' :: hexDigitChar (c.toNat / 4096 % 16) :: hexDigitChar (c.toNat / 256 % 16)
          :: hexDigitChar (c.toNat / 16 % 16) :: hexDigitChar (c.toNat % 16) :: tail) = _
      rw [parseStringCharsUnchecked, fromHex4?_toHex4 c.toNat hbmp]
      simp only [hok, if_true, Char.ofNat_toNat]
    · have hn : 0x10000 ≤ c.toNat := Nat.le_of_not_lt hbmp
      have hcap : c.toNat < 0x110000 := by omega
      have hmlt : (c.toNat - 0x10000) % 1024 < 1024 := Nat.mod_lt _ (by decide)
      have hhi_lt : 0xd800 + (c.toNat - 0x10000) / 1024 < 0x10000 := by omega
      have hlo_lt : 0xdc00 + (c.toNat - 0x10000) % 1024 < 0x10000 := by omega
      have hesc : escapeChar c
          = ('\\' :: 'u' :: toHex4 (0xd800 + (c.toNat - 0x10000) / 1024))
            ++ ('\\' :: 'u' :: toHex4 (0xdc00 + (c.toNat - 0x10000) % 1024)) := by
        simp [escapeChar, hq, hbk, hpr, hna, hnt, hnr, hnb, hnf, hbmp]
      have hok_hi : uEscapeScalarOk (0xd800 + (c.toNat - 0x10000) / 1024) = false := by
        unfold uEscapeScalarOk
        rw [if_neg (by omega), if_neg (by omega), if_neg (by omega), if_neg (by omega)]
      rw [hesc]
      show parseStringCharsUnchecked acc
        ('\\' :: 'u' :: hexDigitChar ((0xd800 + (c.toNat - 0x10000) / 1024) / 4096 % 16)
          :: hexDigitChar ((0xd800 + (c.toNat - 0x10000) / 1024) / 256 % 16)
          :: hexDigitChar ((0xd800 + (c.toNat - 0x10000) / 1024) / 16 % 16)
          :: hexDigitChar ((0xd800 + (c.toNat - 0x10000) / 1024) % 16)
          :: ('\\' :: 'u' :: hexDigitChar ((0xdc00 + (c.toNat - 0x10000) % 1024) / 4096 % 16)
            :: hexDigitChar ((0xdc00 + (c.toNat - 0x10000) % 1024) / 256 % 16)
            :: hexDigitChar ((0xdc00 + (c.toNat - 0x10000) % 1024) / 16 % 16)
            :: hexDigitChar ((0xdc00 + (c.toNat - 0x10000) % 1024) % 16) :: tail)) = _
      rw [parseStringCharsUnchecked, fromHex4?_toHex4 (0xd800 + (c.toNat - 0x10000) / 1024) hhi_lt]
      simp only [hok_hi, Bool.false_eq_true, if_false]
      rw [if_pos (show 0xd800 ≤ 0xd800 + (c.toNat - 0x10000) / 1024
        ∧ 0xd800 + (c.toNat - 0x10000) / 1024 ≤ 0xdbff from ⟨by omega, by omega⟩)]
      simp only [fromHex4?_toHex4 (0xdc00 + (c.toNat - 0x10000) % 1024) hlo_lt]
      rw [if_pos (show 0xdc00 ≤ 0xdc00 + (c.toNat - 0x10000) % 1024
        ∧ 0xdc00 + (c.toNat - 0x10000) % 1024 ≤ 0xdfff from ⟨by omega, by omega⟩)]
      have hscalar : 0x10000 + (0xd800 + (c.toNat - 0x10000) / 1024 - 0xd800) * 1024
          + (0xdc00 + (c.toNat - 0x10000) % 1024 - 0xdc00) = c.toNat := by
        have := Nat.div_add_mod (c.toNat - 0x10000) 1024
        omega
      rw [hscalar, Char.ofNat_toNat]
private theorem escapeList_cons (c : Char) (cs : List Char) :
    escapeList (c :: cs) = escapeChar c ++ escapeList cs := by
  simp [escapeList, List.flatMap_cons]

/-- The parser decodes a whole escaped character list up to the closing
    quote — for EVERY list, no canonicity hypothesis (the encoding is total). -/
theorem parseStringCharsUnchecked_escapeList (cs : List Char) (acc : String)
    (rest : List Char) :
    parseStringCharsUnchecked acc (escapeList cs ++ '"' :: rest)
      = some (acc ++ String.ofList cs, rest) := by
  induction cs generalizing acc with
  | nil =>
    show parseStringCharsUnchecked acc ('"' :: rest) = _
    rw [parseStringCharsUnchecked]
    congr 2
    rw [← String.toList_inj]
    simp
  | cons c cs' ih =>
    rw [escapeList_cons, List.append_assoc,
      parseStringCharsUnchecked_escapeChar c acc (escapeList cs' ++ '"' :: rest),
      ih (acc ++ String.singleton c)]
    congr 2
    rw [← String.toList_inj]
    simp [String.toList_append]

/-- **The decode of a serialized string body.** Escaped form in, abstract
    string out — total, no canonicity hypothesis. -/
theorem parseStringCharsUnchecked_acc (acc : String) (value : String) (rest : List Char) :
    parseStringCharsUnchecked acc (escapeList value.toList ++ '"' :: rest)
      = some (acc ++ value, rest) := by
  have h := parseStringCharsUnchecked_escapeList value.toList acc rest
  rwa [String.ofList_toList] at h

/- ============================================================
   Injectivity of the canonical escape (the one-representation rule).
   ============================================================ -/

/-- The canonical char-list escape is injective: distinct content lists
    escape to distinct byte lists. Proof is the parser left-inverse at
    `rest := []` — the decoder recovers the content, so equal escapes force
    equal content. -/
theorem escapeList_injective (a b : List Char) (h : escapeList a = escapeList b) :
    a = b := by
  have ha := parseStringCharsUnchecked_escapeList a "" []
  have hb := parseStringCharsUnchecked_escapeList b "" []
  rw [h, hb] at ha
  simp only [Option.some.injEq, Prod.mk.injEq] at ha
  have hof : String.ofList a = String.ofList b := by
    have := ha.1; simpa using this.symm
  have := congrArg String.toList hof
  rwa [String.toList_ofList, String.toList_ofList] at this

/-- The canonical string escape is injective. -/
theorem escapeString_injective (a b : String) (h : escapeString a = escapeString b) :
    a = b := by
  have hla : escapeList a.toList = escapeList b.toList := by
    have hc := congrArg String.toList h
    rwa [escapeString_toList, escapeString_toList] at hc
  have hll := escapeList_injective a.toList b.toList hla
  have h2 := congrArg String.ofList hll
  rwa [String.ofList_toList, String.ofList_toList] at h2

/-- The full quoted-string serialization `"\"" ++ escapeString s ++ "\""` is
    injective: a serialized string body pins down its abstract string. -/
theorem serializeString_injective (a b : String)
    (h : ("\"" ++ escapeString a ++ "\"") = ("\"" ++ escapeString b ++ "\"")) :
    a = b := by
  have hc := congrArg String.toList h
  simp only [String.toList_append] at hc
  have hq : ("\"" : String).toList = ['"'] := rfl
  rw [hq] at hc
  simp only [List.append_assoc, List.cons_append, List.nil_append,
    List.cons.injEq, List.append_cancel_right_eq] at hc
  have htl : (escapeString a).toList = (escapeString b).toList := hc.2
  have hes : escapeString a = escapeString b := by rw [← String.toList_inj]; exact htl
  exact escapeString_injective a b hes

/- ============================================================
   GROUP B: serializer/parser roundtrip, per type.
   ============================================================ -/

theorem serialize_roundtrip_null :
    parse (serializeAst ⟨.null, rfl⟩) = some .null := by rfl

theorem serialize_roundtrip_bool (value : Bool) :
    parse (serializeAst ⟨.bool value, rfl⟩) = some (.bool value) := by
  cases value <;> rfl

theorem serialize_roundtrip_number (value : Decimal)
    (h : IsCanonical (.number value)) :
    parse (serializeAst ⟨.number value, h⟩) = some (.number value) := by
  have hcan : isCanonicalDecimal value = true := h
  have hpnum : parseNumber (serializeDecimal value).toList = some (.number value, []) := by
    unfold parseNumber
    have hx := parseNumberUnchecked_serializeDecimal value [] hcan (Or.inl rfl)
    rw [List.append_nil] at hx
    rw [hx]; simp only [guardCanonicalResult]; rw [if_pos h]
  have hsw : skipWs (serializeDecimal value).toList = (serializeDecimal value).toList := by
    by_cases hneg : value.negative = true
    · obtain ⟨tl, ht⟩ := serializeDecimal_firstChar_neg value hcan hneg
      rw [ht]; simp [skipWs, isWs]
    · simp only [Bool.not_eq_true] at hneg
      obtain ⟨c, tl, ht, hcd⟩ := serializeDecimal_firstChar_pos value hcan hneg
      rw [ht]; simp [skipWs, digit_not_ws c hcd]
  have hpvu : parseValueFuelUnchecked ((serializeDecimal value).toList.length + 1)
      (serializeDecimal value).toList = some (.number value, []) := by
    simp only [parseValueFuelUnchecked]
    rw [hsw]
    by_cases hneg : value.negative = true
    · obtain ⟨tl, ht⟩ := serializeDecimal_firstChar_neg value hcan hneg
      rw [ht]
      show parseNumber ('-' :: tl) = some (.number value, [])
      rw [← ht]; exact hpnum
    · simp only [Bool.not_eq_true] at hneg
      obtain ⟨c, tl, ht, hcd⟩ := serializeDecimal_firstChar_pos value hcan hneg
      rw [ht]
      split <;>
        first
        | (rw [if_pos hcd, ← ht]; exact hpnum)
        | simp_all (config := { decide := true }) [isDigit]
  have hpvf : parseValueFuel ((serializeDecimal value).toList.length + 1)
      (serializeDecimal value).toList = some (.number value, []) := by
    unfold parseValueFuel
    rw [hpvu]; simp only [guardCanonicalResult]; rw [if_pos h]
  change parse (serializeDecimal value) = some (.number value)
  simp only [parse]
  rw [hpvf]
  simp only [skipWs]
  rw [if_pos h]

set_option maxRecDepth 8000 in
set_option maxHeartbeats 6400000 in
theorem serialize_roundtrip_string (value : String)
    (h : IsCanonical (.string value)) :
    parse (serializeAst ⟨.string value, h⟩) = some (.string value) := by
  change parse ("\"" ++ escapeString value ++ "\"") = some (.string value)
  have hq : ("\"" : String).toList = ['"'] := by decide
  simp only [parse, parseValueFuel, guardCanonicalResult, String.toList_append, hq,
    escapeString_toList, List.length_append, List.length_cons, List.length_nil,
    List.append_assoc]
  simp only [parseValueFuelUnchecked]
  simp only [List.cons_append, skipWs, isWs]
  simp +decide
  simp only [parseString, parseStringChars, guardCanonicalStringResult]
  rw [parseStringCharsUnchecked_acc "" value []]
  simp [isCanonicalString, IsCanonical, isCanonicalAst, skipWs]

/- ============================================================
   GROUP B2: Container roundtrip helpers
   ============================================================ -/

/-! ## GoodRest predicate -/

def GoodRest (rest : List Char) : Prop :=
  rest = [] ∨ ∃ c rest', rest = c :: rest' ∧
    isDigit c = false ∧ c ≠ '.' ∧ c ≠ 'e' ∧ c ≠ 'E'

theorem GoodRest_nil : GoodRest [] := Or.inl rfl
theorem GoodRest_cons_comma (tl : List Char) : GoodRest (',' :: tl) :=
  Or.inr ⟨',', tl, rfl, by decide, by decide, by decide, by decide⟩
theorem GoodRest_cons_rbracket (tl : List Char) : GoodRest (']' :: tl) :=
  Or.inr ⟨']', tl, rfl, by decide, by decide, by decide, by decide⟩
theorem GoodRest_cons_rbrace (tl : List Char) : GoodRest ('}' :: tl) :=
  Or.inr ⟨'}', tl, rfl, by decide, by decide, by decide, by decide⟩

/-! ## isCanonicalObject reverse -/

theorem hasDuplicateKey_reverse (k : String) (L : List (String × AST)) :
    hasDuplicateKey k L.reverse = hasDuplicateKey k L := by
  simp [hasDuplicateKey, List.any_reverse]

theorem isCanonicalObject_snoc (L : List (String × AST)) (k : String) (v : AST)
    (hL : isCanonicalObject L = true)
    (hnd : hasDuplicateKey k L = false)
    (hk : isCanonicalString k = true)
    (hv : isCanonicalAst v = true) :
    isCanonicalObject (L ++ [(k, v)]) = true := by
  induction L <;> simp_all +decide [ isCanonicalObject ];
  simp_all +decide [ hasDuplicateKey ];
  grind

theorem isCanonicalObject_of_reverse (L : List (String × AST))
    (h : isCanonicalObject L = true) :
    isCanonicalObject L.reverse = true := by
  induction L with
  | nil => exact h
  | cons hd tl ih =>
    obtain ⟨k, v⟩ := hd
    have htl := isCanonicalObject_tail h
    have hk := isCanonicalObject_head_key h
    have hv := isCanonicalObject_head_value h
    have hnd := isCanonicalObject_head_nodup h
    simp only [List.reverse_cons]
    exact isCanonicalObject_snoc tl.reverse k v (ih htl)
      (hasDuplicateKey_reverse k tl ▸ hnd) hk hv

/-! ## parseString roundtrip for keys -/

theorem parseString_roundtrip (key : String) (afterKey : List Char) :
    parseString ('"' :: escapeList key.toList ++ '"' :: afterKey)
      = some (key, afterKey) := by
  have h := parseStringCharsUnchecked_acc "" key afterKey
  simp only [parseString, List.cons_append, parseStringChars, guardCanonicalStringResult, h]
  simp [isCanonicalString]

/-! ## First-character properties -/

private theorem serializeDecimal_first_props (v : Decimal) (hcan : isCanonicalDecimal v = true) :
    ∀ c cs, (serializeDecimal v).toList = c :: cs → isWs c = false ∧ c ≠ ']' ∧ c ≠ '}' := by
  intro c cs hcs
  by_cases hneg : v.negative = true;
  · have := serializeDecimal_firstChar_neg v hcan hneg; obtain ⟨ rest, hrest ⟩ := this; aesop;
  · -- Since `v.negative` is false, `c` must be a digit.
    have h_digit : isDigit c = true := by
      have := serializeDecimal_firstChar_pos v hcan ( by simpa using hneg ) ; aesop;
    unfold isDigit at h_digit;
    unfold isWs; aesop

private theorem serializeAstValue_first_props (ast : AST) (hcan : isCanonicalAst ast = true) :
    ∀ c cs, (serializeAstValue ast).toList = c :: cs → isWs c = false ∧ c ≠ ']' ∧ c ≠ '}' := by
  intro c cs h
  match ast with
  | .null =>
    change "null".toList = _ at h
    have : ("null" : String).toList = ['n', 'u', 'l', 'l'] := by decide
    rw [this] at h; obtain ⟨rfl, _⟩ := h; exact ⟨by decide, by decide, by decide⟩
  | .bool true =>
    change "true".toList = _ at h
    have : ("true" : String).toList = ['t', 'r', 'u', 'e'] := by decide
    rw [this] at h; obtain ⟨rfl, _⟩ := h; exact ⟨by decide, by decide, by decide⟩
  | .bool false =>
    change "false".toList = _ at h
    have : ("false" : String).toList = ['f', 'a', 'l', 's', 'e'] := by decide
    rw [this] at h; obtain ⟨rfl, _⟩ := h; exact ⟨by decide, by decide, by decide⟩
  | .number v => exact serializeDecimal_first_props v hcan c cs h
  | .string _ =>
    simp only [serializeAstValue, String.toList_append] at h
    have : ("\"" : String).toList = ['"'] := by decide
    rw [this] at h; simp at h; obtain ⟨rfl, _⟩ := h; exact ⟨by decide, by decide, by decide⟩
  | .array _ =>
    simp only [serializeAstValue, String.toList_append] at h
    have : ("[" : String).toList = ['['] := by decide
    rw [this] at h; simp at h; obtain ⟨rfl, _⟩ := h; exact ⟨by decide, by decide, by decide⟩
  | .object _ =>
    simp only [serializeAstValue, String.toList_append] at h
    have : ("{" : String).toList = ['{'] := by decide
    rw [this] at h; simp at h; obtain ⟨rfl, _⟩ := h; exact ⟨by decide, by decide, by decide⟩

theorem serializeAstValue_head_not_ws (ast : AST) (hcan : isCanonicalAst ast = true) :
    ∀ c cs, (serializeAstValue ast).toList = c :: cs → isWs c = false :=
  fun c cs h => (serializeAstValue_first_props ast hcan c cs h).1

theorem serializeAstValue_first_ne_rbracket (ast : AST) (hcan : isCanonicalAst ast = true) :
    ∀ c cs, (serializeAstValue ast).toList = c :: cs → c ≠ ']' :=
  fun c cs h => (serializeAstValue_first_props ast hcan c cs h).2.1

theorem serializeAstValue_first_ne_rbrace (ast : AST) (hcan : isCanonicalAst ast = true) :
    ∀ c cs, (serializeAstValue ast).toList = c :: cs → c ≠ '}' :=
  fun c cs h => (serializeAstValue_first_props ast hcan c cs h).2.2

/-! ## Additional helper lemmas for container roundtrips -/

private theorem serializeAstValue_nonempty (ast : AST) (hcan : isCanonicalAst ast = true) :
    ∃ c cs, (serializeAstValue ast).toList = c :: cs := by
  match ast with
  | .null => exact ⟨'n', ['u', 'l', 'l'], by decide⟩
  | .bool true => exact ⟨'t', ['r', 'u', 'e'], by decide⟩
  | .bool false => exact ⟨'f', ['a', 'l', 's', 'e'], by decide⟩
  | .number v =>
    simp only [serializeAstValue]
    unfold serializeDecimal
    by_cases hneg : v.negative
    · simp [hneg, String.toList_append]
      exact ⟨'-', _, rfl⟩
    · simp only [Bool.not_eq_true] at hneg
      simp [hneg, String.toList_append]
      have hcan' : isCanonicalDecimal v = true := hcan
      have hcanInt : isCanonicalIntDigits v.intDigits = true := by
        unfold isCanonicalDecimal at hcan'; simp [Bool.and_eq_true] at hcan'; exact hcan'.1.1
      cases h : v.intDigits.toList with
      | nil =>
        unfold isCanonicalIntDigits at hcanInt; rw [h] at hcanInt; simp at hcanInt
      | cons c cs =>
        exact ⟨c, _, rfl⟩
  | .string s =>
    simp only [serializeAstValue, String.toList_append]
    exact ⟨'"', (escapeString s).toList ++ ['"'], by simp; rfl⟩
  | .array items =>
    simp only [serializeAstValue, String.toList_append]
    exact ⟨'[', (serializeArrayValue items).toList ++ [']'], by simp; rfl⟩
  | .object fields =>
    simp only [serializeAstValue, String.toList_append]
    exact ⟨'{', (serializeObjectValue fields).toList ++ ['}'], by simp; rfl⟩

private theorem skipWs_serializeAstValue_append (ast : AST) (hcan : isCanonicalAst ast = true)
    (tail : List Char) :
    skipWs ((serializeAstValue ast).toList ++ tail) = (serializeAstValue ast).toList ++ tail := by
  obtain ⟨c, cs, hcs⟩ := serializeAstValue_nonempty ast hcan
  have hws := serializeAstValue_head_not_ws ast hcan c cs hcs
  rw [hcs, List.cons_append]
  exact skipWs_cons_of_not_ws c (cs ++ tail) hws

private theorem serializeAstValue_first_ne_rbracket' (ast : AST) (hcan : isCanonicalAst ast = true)
    (tail : List Char) :
    ∀ c cs, (serializeAstValue ast).toList ++ tail = c :: cs → c ≠ ']' := by
  intro c cs h
  obtain ⟨c', cs', hcs'⟩ := serializeAstValue_nonempty ast hcan
  rw [hcs', List.cons_append] at h
  obtain ⟨rfl, _⟩ := List.cons.inj h
  exact serializeAstValue_first_ne_rbracket ast hcan c' cs' hcs'

private theorem serializeAstValue_first_ne_rbrace' (ast : AST) (hcan : isCanonicalAst ast = true)
    (tail : List Char) :
    ∀ c cs, (serializeAstValue ast).toList ++ tail = c :: cs → c ≠ '}' := by
  intro c cs h
  obtain ⟨c', cs', hcs'⟩ := serializeAstValue_nonempty ast hcan
  rw [hcs', List.cons_append] at h
  obtain ⟨rfl, _⟩ := List.cons.inj h
  exact serializeAstValue_first_ne_rbrace ast hcan c' cs' hcs'

-- duplicateKey and hasDuplicateKey are definitionally equal
private theorem duplicateKey_eq_hasDuplicateKey (k : String) (fields : List (String × AST)) :
    duplicateKey k fields = hasDuplicateKey k fields := by
  rfl

/-! ## Array accumulator helper -/

private theorem serializeArrayValue_cons_cons_toList (x y : AST) (ys : List AST) :
    (serializeArrayValue (x :: y :: ys)).toList =
      (serializeAstValue x).toList ++ [','] ++ (serializeArrayValue (y :: ys)).toList := by
  show (serializeAstValue x ++ "," ++ serializeArrayValue (y :: ys)).toList = _
  have hc : ("," : String).toList = [','] := by decide
  simp [String.toList_append, hc]

private theorem serializeArrayValue_head_eq (x : AST) (xs : List AST) :
    ∃ tail, (serializeArrayValue (x :: xs)).toList =
      (serializeAstValue x).toList ++ tail := by
  cases xs with
  | nil => exact ⟨[], by simp [serializeArrayValue]⟩
  | cons y ys =>
    exact ⟨[','] ++ (serializeArrayValue (y :: ys)).toList,
      by rw [serializeArrayValue_cons_cons_toList]; simp [List.append_assoc]⟩

set_option maxHeartbeats 1600000 in
theorem parseArrayFuelUnchecked_roundtrip
    (items : List AST) (acc : List AST) (rest : List Char) (fuel : Nat)
    (hcan_items : isCanonicalArray items = true)
    (hcan_acc : isCanonicalArray acc = true)
    (hfuel : fuel ≥ (serializeArrayValue items).toList.length + 2)
    (ih_value : ∀ (x : AST), x ∈ items → ∀ (tl : List Char) (fuel' : Nat),
      isCanonicalAst x = true →
      fuel' ≥ (serializeAstValue x).toList.length + 1 →
      GoodRest tl →
      parseValueFuelUnchecked fuel' ((serializeAstValue x).toList ++ tl) = some (x, tl)) :
    parseArrayFuelUnchecked fuel acc ((serializeArrayValue items).toList ++ ']' :: rest)
      = some (.array (acc.reverse ++ items), rest) := by
  induction items generalizing acc fuel rest with
  | nil =>
    -- serializeArrayValue [] = "", so input is ']' :: rest
    simp only [serializeArrayValue, String.toList, List.append_nil]
    obtain ⟨fuel', rfl⟩ : ∃ fuel', fuel = fuel' + 1 := ⟨fuel - 1, by omega⟩
    rw [parseArrayFuelUnchecked.eq_def]
    simp [skipWs, isWs]
    show isCanonicalAst (AST.array acc.reverse) = true
    show isCanonicalArray acc.reverse = true
    rw [isCanonicalArray_reverse]; exact hcan_acc
  | cons x xs ih =>
    have hcan_x : isCanonicalAst x = true := isCanonicalAst_of_mem_array List.mem_cons_self hcan_items
    have hcan_xs : isCanonicalArray xs = true := by
      rw [isCanonicalArray_cons] at hcan_items; simp [Bool.and_eq_true] at hcan_items; exact hcan_items.2
    obtain ⟨fuel', rfl⟩ : ∃ fuel', fuel = fuel' + 1 := ⟨fuel - 1, by omega⟩
    obtain ⟨c, cs, hcs⟩ := serializeAstValue_nonempty x hcan_x
    have hws_c : isWs c = false := serializeAstValue_head_not_ws x hcan_x c cs hcs
    have hne_c : c ≠ ']' := serializeAstValue_first_ne_rbracket x hcan_x c cs hcs
    cases xs with
    | nil =>
      -- Singleton [x]: serializeArrayValue [x] = serializeAstValue x
      simp only [serializeArrayValue]
      rw [parseArrayFuelUnchecked.eq_def]
      rw [skipWs_serializeAstValue_append x hcan_x (']' :: rest)]
      rw [hcs, List.cons_append]
      -- Match: c is not ']', so goes to rest branch
      -- After simp with char facts, the match resolves
      have hfuel' : fuel' ≥ (serializeAstValue x).toList.length + 1 := by
        have : (serializeArrayValue [x]).toList.length = (serializeAstValue x).toList.length := by rfl
        omega
      simp only [] -- reduce Nat match
      split -- match on c :: ... vs ']' :: ...
      · rename_i h; obtain ⟨rfl, _⟩ := List.cons.inj h; exact absurd rfl hne_c
      · rw [← List.cons_append, ← hcs]
        rw [ih_value x List.mem_cons_self (']' :: rest) fuel' hcan_x hfuel' (GoodRest_cons_rbracket rest)]
        simp only [] -- reduce Option match
        simp [skipWs, isWs]
        show isCanonicalArray (acc.reverse ++ [x]) = true
        rw [isCanonicalArray_append]
        simp [isCanonicalArray_reverse, hcan_acc, hcan_x, isCanonicalArray]
    | cons y ys =>
      -- cons-cons: serializeArrayValue (x :: y :: ys)
      rw [serializeArrayValue_cons_cons_toList]
      rw [List.append_assoc, List.append_assoc]
      rw [parseArrayFuelUnchecked.eq_def]
      -- skipWs is no-op on head c
      rw [show (serializeAstValue x).toList ++ ([','] ++ ((serializeArrayValue (y :: ys)).toList ++ (']' :: rest)))
        = c :: (cs ++ ([','] ++ ((serializeArrayValue (y :: ys)).toList ++ (']' :: rest)))) by rw [hcs, List.cons_append]]
      simp only [skipWs_cons_of_not_ws c _ hws_c]
      split -- match on c :: ... vs ']' :: ...
      · rename_i h; obtain ⟨rfl, _⟩ := List.cons.inj h; exact absurd rfl hne_c
      · have hfuel_x : fuel' ≥ (serializeAstValue x).toList.length + 1 := by
          have hser' := serializeArrayValue_cons_cons_toList x y ys
          rw [hser', List.length_append, List.length_append, List.length_cons, List.length_nil] at hfuel; omega
        rw [show c :: (cs ++ ([','] ++ ((serializeArrayValue (y :: ys)).toList ++ (']' :: rest))))
          = (serializeAstValue x).toList ++ (',' :: ((serializeArrayValue (y :: ys)).toList ++ (']' :: rest)))
          by rw [hcs]; simp [List.cons_append]]
        rw [ih_value x List.mem_cons_self _ fuel' hcan_x hfuel_x (GoodRest_cons_comma _)]
        simp only [] -- reduce Option.some match
        -- skipWs on ',' :: ...
        simp only [skipWs, isWs_comma]
        simp only [Bool.false_eq_true, ↓reduceIte]
        -- skipWs on afterComma = serializeArrayValue(y::ys) ++ ']' :: rest
        have hcan_y : isCanonicalAst y = true :=
          isCanonicalAst_of_mem_array List.mem_cons_self hcan_xs
        obtain ⟨d, ds, hds⟩ := serializeAstValue_nonempty y hcan_y
        have hws_d : isWs d = false := serializeAstValue_head_not_ws y hcan_y d ds hds
        have hne_d : d ≠ ']' := serializeAstValue_first_ne_rbracket y hcan_y d ds hds
        obtain ⟨ser_tail, hser_head⟩ := serializeArrayValue_head_eq y ys
        -- skipWs on serializeArrayValue(y::ys) ++ ']' :: rest is a no-op
        rw [hser_head, hds, List.cons_append, List.cons_append, skipWs_cons_of_not_ws d _ hws_d]
        -- match on d :: ... vs ']' :: ...
        split
        · rename_i h; obtain ⟨rfl, _⟩ := List.cons.inj h; exact absurd rfl hne_d
        · have hcan_xacc : isCanonicalArray (x :: acc) = true := by
            rw [isCanonicalArray_cons]; simp [hcan_x, hcan_acc]
          rw [if_pos hcan_xacc]
          have hfuel_rest : fuel' ≥ (serializeArrayValue (y :: ys)).toList.length + 2 := by
            have hser' := serializeArrayValue_cons_cons_toList x y ys
            rw [hser', List.length_append, List.length_append, List.length_cons, List.length_nil] at hfuel; omega
          -- Rewrite back to serializeArrayValue form for IH
          have hrewrite : d :: (ds ++ ser_tail ++ ']' :: rest) =
              (serializeArrayValue (y :: ys)).toList ++ ']' :: rest := by
            rw [hser_head, hds]; simp [List.cons_append, List.append_assoc]
          rw [hrewrite]
          have hrev : acc.reverse ++ x :: y :: ys = (x :: acc).reverse ++ (y :: ys) := by
            simp [List.reverse_cons, List.append_assoc]
          rw [hrev]
          exact ih (x :: acc) rest fuel' hcan_xs hcan_xacc hfuel_rest
            (fun x' hx' tl fuel'' hcan_x' hf' hgr' =>
              ih_value x' (List.mem_cons_of_mem x hx') tl fuel'' hcan_x' hf' hgr')

/-! ## Object accumulator helper lemmas -/

private theorem serializeObjectValue_singleton_toList (k : String) (v : AST) :
    (serializeObjectValue [(k, v)]).toList =
      ['"'] ++ escapeList k.toList ++ ['"', ':'] ++ (serializeAstValue v).toList := by
  show ("\"" ++ escapeString k ++ "\":" ++ serializeAstValue v).toList = _
  have h1 : ("\"" : String).toList = ['"'] := by decide
  have h2 : ("\":" : String).toList = ['"', ':'] := by decide
  simp [String.toList_append, h1, h2, escapeString_toList]

private theorem serializeObjectValue_cons_cons_toList' (k : String) (v : AST)
    (k2 : String) (v2 : AST) (rest : List (String × AST)) :
    (serializeObjectValue ((k, v) :: (k2, v2) :: rest)).toList =
      ['"'] ++ escapeList k.toList ++ ['"', ':'] ++ (serializeAstValue v).toList ++
      [','] ++ (serializeObjectValue ((k2, v2) :: rest)).toList := by
  show ("\"" ++ escapeString k ++ "\":" ++ serializeAstValue v ++ ","
    ++ serializeObjectValue ((k2, v2) :: rest)).toList = _
  have h1 : ("\"" : String).toList = ['"'] := by decide
  have h2 : ("\":" : String).toList = ['"', ':'] := by decide
  have h3 : ("," : String).toList = [','] := by decide
  simp [String.toList_append, h1, h2, h3, escapeString_toList]

private theorem serializeObjectValue_head_is_quote (kv : String × AST) (rest : List (String × AST)) :
    ∃ tail, (serializeObjectValue (kv :: rest)).toList = '"' :: tail := by
  obtain ⟨k, v⟩ := kv
  cases rest with
  | nil =>
    rw [serializeObjectValue_singleton_toList]
    exact ⟨escapeList k.toList ++ ['"', ':'] ++ (serializeAstValue v).toList,
      by simp [List.cons_append]⟩
  | cons hd tl =>
    obtain ⟨k2, v2⟩ := hd
    rw [serializeObjectValue_cons_cons_toList' k v k2 v2 tl]
    exact ⟨escapeList k.toList ++ ['"', ':'] ++ (serializeAstValue v).toList ++ [','] ++
      (serializeObjectValue ((k2, v2) :: tl)).toList, by simp [List.cons_append]⟩

-- duplicateKey shift: if (k == k') = false and duplicateKey k' acc = false, then duplicateKey k' ((k,v)::acc) = false
private theorem duplicateKey_cons_ne (k' k : String) (v : AST) (acc : List (String × AST))
    (hne : (k == k') = false) (hacc : duplicateKey k' acc = false) :
    duplicateKey k' ((k, v) :: acc) = false := by
  unfold duplicateKey at *
  simp only [List.any_cons, Bool.or_eq_false_iff]
  exact ⟨hne, hacc⟩

-- If hasDuplicateKey k fields = false and (k', v') ∈ fields, then (k' == k) = false
private theorem ne_of_hasDuplicateKey_false {k k' : String} {v' : AST}
    {fields : List (String × AST)} (hnd : hasDuplicateKey k fields = false)
    (hmem : (k', v') ∈ fields) : (k' == k) = false := by
  unfold hasDuplicateKey at hnd
  have h := List.any_eq_false.mp hnd (k', v') hmem
  simp at h
  simp [BEq.beq, h]

-- BEq symmetry for String
private theorem beq_comm_string (a b : String) : (a == b) = (b == a) := by
  simp [BEq.beq, decide_eq_decide]
  constructor <;> (intro h; exact h.symm)

/-! ## Object accumulator helper -/

set_option maxHeartbeats 3200000 in
theorem parseObjectFuelUnchecked_roundtrip
    (fields : List (String × AST)) (acc : List (String × AST)) (rest : List Char) (fuel : Nat)
    (hcan_fields : isCanonicalObject fields = true)
    (hcan_acc : isCanonicalObject acc = true)
    (hnodup : ∀ (k : String) (v : AST), (k, v) ∈ fields → duplicateKey k acc = false)
    (hfuel : fuel ≥ (serializeObjectValue fields).toList.length + 2)
    (ih_value : ∀ (k : String) (v : AST), (k, v) ∈ fields → ∀ (tl : List Char) (fuel' : Nat),
      isCanonicalAst v = true →
      fuel' ≥ (serializeAstValue v).toList.length + 1 →
      GoodRest tl →
      parseValueFuelUnchecked fuel' ((serializeAstValue v).toList ++ tl) = some (v, tl)) :
    parseObjectFuelUnchecked fuel acc ((serializeObjectValue fields).toList ++ '}' :: rest)
      = some (.object (acc.reverse ++ fields), rest) := by
  induction fields generalizing acc fuel rest with
  | nil =>
    simp only [serializeObjectValue, String.toList, List.append_nil]
    obtain ⟨fuel', rfl⟩ : ∃ fuel', fuel = fuel' + 1 := ⟨fuel - 1, by omega⟩
    rw [parseObjectFuelUnchecked.eq_def]
    simp [skipWs, isWs]
    show isCanonicalAst (AST.object acc.reverse) = true
    show isCanonicalObject acc.reverse = true
    exact isCanonicalObject_of_reverse acc hcan_acc
  | cons hd tl ih =>
    obtain ⟨k, v⟩ := hd
    have hcan_k : isCanonicalString k = true := isCanonicalObject_head_key hcan_fields
    have hcan_v : isCanonicalAst v = true := isCanonicalObject_head_value hcan_fields
    have hcan_tl : isCanonicalObject tl = true := isCanonicalObject_tail hcan_fields
    have hnodup_k : hasDuplicateKey k tl = false := isCanonicalObject_head_nodup hcan_fields
    obtain ⟨fuel', rfl⟩ : ∃ fuel', fuel = fuel' + 1 := ⟨fuel - 1, by omega⟩
    have hdup : duplicateKey k acc = false := hnodup k v List.mem_cons_self
    cases tl with
    | nil =>
      -- Singleton [(k,v)]
      rw [serializeObjectValue_singleton_toList]
      simp only [List.cons_append, List.append_assoc, List.nil_append]
      rw [parseObjectFuelUnchecked.eq_def, skipWs_cons_of_not_ws '"' _ isWs_quote]
      simp only [] -- reduce Nat match
      split
      · rename_i h; have := (List.cons.inj h).1; contradiction
      · have hps := parseString_roundtrip k (':' :: (String.toList (serializeAstValue v) ++ '}' :: rest))
        simp only [List.cons_append] at hps
        rw [hps]
        simp only []
        simp only [hdup, Bool.false_eq_true, ↓reduceIte]
        rw [skipWs_cons_of_not_ws ':' _ isWs_colon]
        have hfuel_v : fuel' ≥ (serializeAstValue v).toList.length + 1 := by
          rw [serializeObjectValue_singleton_toList] at hfuel
          rw [List.length_append, List.length_append, List.length_append,
              List.length_cons, List.length_nil, List.length_cons, List.length_cons, List.length_nil] at hfuel
          omega
        simp only [] -- reduce ':' match
        rw [ih_value k v List.mem_cons_self ('}' :: rest) fuel' hcan_v hfuel_v (GoodRest_cons_rbrace rest)]
        simp only []
        simp [skipWs, isWs]
        show isCanonicalObject (acc.reverse ++ [(k, v)]) = true
        exact isCanonicalObject_snoc acc.reverse k v (isCanonicalObject_of_reverse acc hcan_acc)
          (hasDuplicateKey_reverse k acc ▸ hdup) hcan_k hcan_v
    | cons hd2 tl2 =>
      obtain ⟨k2, v2⟩ := hd2
      rw [serializeObjectValue_cons_cons_toList' k v k2 v2 tl2]
      simp only [List.cons_append, List.append_assoc, List.nil_append]
      rw [parseObjectFuelUnchecked.eq_def, skipWs_cons_of_not_ws '"' _ isWs_quote]
      simp only [] -- reduce Nat match
      split
      · rename_i h; have := (List.cons.inj h).1; contradiction
      · have hps := parseString_roundtrip k (':' :: (String.toList (serializeAstValue v) ++ ',' :: ((serializeObjectValue ((k2, v2) :: tl2)).toList ++ '}' :: rest)))
        simp only [List.cons_append] at hps
        rw [hps]
        simp only []
        simp only [hdup, Bool.false_eq_true, ↓reduceIte]
        rw [skipWs_cons_of_not_ws ':' _ isWs_colon]
        simp only [] -- reduce ':' match
        have hfuel_v : fuel' ≥ (serializeAstValue v).toList.length + 1 := by
          rw [serializeObjectValue_cons_cons_toList' k v k2 v2 tl2] at hfuel
          repeat rw [List.length_append] at hfuel
          have : (['"'] : List Char).length = 1 := by rfl
          have : (['"', ':'] : List Char).length = 2 := by rfl
          have : ([','] : List Char).length = 1 := by rfl
          omega
        rw [ih_value k v List.mem_cons_self (',' :: ((serializeObjectValue ((k2, v2) :: tl2)).toList ++ '}' :: rest)) fuel' hcan_v hfuel_v (GoodRest_cons_comma _)]
        simp only []
        simp only [skipWs, isWs_comma]
        simp only [Bool.false_eq_true, ↓reduceIte]
        obtain ⟨qtail2, hqtail2⟩ := serializeObjectValue_head_is_quote (k2, v2) tl2
        rw [hqtail2, List.cons_append, skipWs_cons_of_not_ws '"' _ isWs_quote]
        split
        · rename_i h; have := (List.cons.inj h).1; contradiction
        · have hcan_kv_acc : isCanonicalObject ((k, v) :: acc) = true := by
            rw [isCanonicalObject_cons]; simp [hcan_k, hcan_v, hcan_acc]; exact hdup
          rw [if_pos hcan_kv_acc]
          have hfuel_rest : fuel' ≥ (serializeObjectValue ((k2, v2) :: tl2)).toList.length + 2 := by
            rw [serializeObjectValue_cons_cons_toList' k v k2 v2 tl2] at hfuel
            repeat rw [List.length_append] at hfuel
            have : (['"'] : List Char).length = 1 := by rfl
            have : (['"', ':'] : List Char).length = 2 := by rfl
            have : ([','] : List Char).length = 1 := by rfl
            omega
          rw [← List.cons_append, ← hqtail2]
          have hnodup' : ∀ (k' : String) (v' : AST), (k', v') ∈ ((k2, v2) :: tl2) →
              duplicateKey k' ((k, v) :: acc) = false := by
            intro k' v' hmem
            exact duplicateKey_cons_ne k' k v acc
              (beq_comm_string k k' ▸ ne_of_hasDuplicateKey_false hnodup_k hmem)
              (hnodup k' v' (List.mem_cons_of_mem _ hmem))
          have hrev : acc.reverse ++ (k, v) :: (k2, v2) :: tl2 = ((k, v) :: acc).reverse ++ ((k2, v2) :: tl2) := by
            simp [List.reverse_cons, List.append_assoc]
          rw [hrev]
          exact ih ((k, v) :: acc) rest fuel' hcan_tl hcan_kv_acc hnodup' hfuel_rest
            (fun k' v' hmem tl' fuel'' hcan' hf' hgr' =>
              ih_value k' v' (List.mem_cons_of_mem _ hmem) tl' fuel'' hcan' hf' hgr')

/-! ## Value-level roundtrip by strong induction -/

private theorem value_roundtrip_worker_null (rest : List Char) (fuel : Nat)
    (hfuel : fuel ≥ (serializeAstValue .null).toList.length + 1) (_hrest : GoodRest rest) :
    parseValueFuelUnchecked fuel ((serializeAstValue .null).toList ++ rest) = some (.null, rest) := by
  rcases fuel with ( _ | _ | fuel ) <;> simp_all +arith +decide [ parseValueFuelUnchecked ];
  rfl

private theorem value_roundtrip_worker_bool (b : Bool) (rest : List Char) (fuel : Nat)
    (hfuel : fuel ≥ (serializeAstValue (.bool b)).toList.length + 1) (hrest : GoodRest rest) :
    parseValueFuelUnchecked fuel ((serializeAstValue (.bool b)).toList ++ rest) = some (.bool b, rest) := by
  rcases b with ( _ | _ ) <;> simp +decide [ serializeAstValue ] at *;
  · unfold parseValueFuelUnchecked; aesop;
  · rcases fuel with ( _ | _ | _ | _ | fuel ) <;> simp_all +arith +decide;
    cases hrest <;> aesop

private theorem value_roundtrip_worker_number (v : Decimal) (rest : List Char) (fuel : Nat)
    (hcan : isCanonicalDecimal v = true)
    (hfuel : fuel ≥ (serializeAstValue (.number v)).toList.length + 1) (hrest : GoodRest rest) :
    parseValueFuelUnchecked fuel ((serializeAstValue (.number v)).toList ++ rest) = some (.number v, rest) := by
  rcases fuel with ( _ | fuel ) <;> first | exact absurd hfuel (by omega) | skip;
  obtain ⟨h, w⟩ : ∃ h, h = (String.toList (serializeAstValue (AST.number v)) ++ rest) ∧ skipWs h = h := by
    exact ⟨ _, rfl, skipWs_serializeAstValue_append _ ( by
      exact? ) _ ⟩;
  obtain ⟨c, cs, hc⟩ : ∃ c cs, h = c :: cs ∧ (c = '-' ∨ isDigit c = true) := by
    rw [w.1]
    have hser : serializeAstValue (AST.number v) = serializeDecimal v := rfl
    by_cases hneg : v.negative = true
    · obtain ⟨tl, ht⟩ := serializeDecimal_firstChar_neg v hcan hneg
      refine ⟨'-', tl ++ rest, ?_, Or.inl rfl⟩
      rw [hser, ht]; rfl
    · simp only [Bool.not_eq_true] at hneg
      obtain ⟨d, tl, ht, hcd⟩ := serializeDecimal_firstChar_pos v hcan hneg
      refine ⟨d, tl ++ rest, ?_, Or.inr hcd⟩
      rw [hser, ht]; rfl
  rcases hc with ⟨ rfl, hc | hc ⟩ <;> simp_all +decide [ parseValueFuelUnchecked ];
  · rw [ ← w.1, w.2 ];
    rw [ show parseNumber ( '-' :: cs ) = guardCanonicalResult ( parseNumberUnchecked ( '-' :: cs ) ) from rfl ];
    rw [ show parseNumberUnchecked ( '-' :: cs ) = some ( AST.number v, rest ) from ?_ ];
    · exact if_pos ( by aesop );
    · rw [ w.1 ]
      exact parseNumberUnchecked_serializeDecimal v rest hcan hrest
  · rw [ ← w.1, w.2 ];
    -- digit head: rule out every special-char arm so the opaque-head match collapses to the number arm
    have hn : c ≠ 'n' := fun he => absurd (he ▸ hc) (by decide)
    have ht : c ≠ 't' := fun he => absurd (he ▸ hc) (by decide)
    have hf : c ≠ 'f' := fun he => absurd (he ▸ hc) (by decide)
    have hq : c ≠ '"' := fun he => absurd (he ▸ hc) (by decide)
    have hlb : c ≠ '[' := fun he => absurd (he ▸ hc) (by decide)
    have hcb : c ≠ '{' := fun he => absurd (he ▸ hc) (by decide)
    have hdash : c ≠ '-' := fun he => absurd (he ▸ hc) (by decide)
    simp only [hc, if_true]
    rw [ show parseNumber ( c :: cs ) = guardCanonicalResult ( parseNumberUnchecked ( c :: cs ) ) from rfl ];
    rw [ show parseNumberUnchecked ( c :: cs ) = some ( AST.number v, rest ) from by
      rw [ w.1 ]; exact parseNumberUnchecked_serializeDecimal v rest hcan hrest ];
    have hcanAst : IsCanonical (AST.number v) := by unfold IsCanonical isCanonicalAst; exact hcan
    simp [guardCanonicalResult, hcanAst]

private theorem value_roundtrip_worker_string (s : String) (rest : List Char) (fuel : Nat)
    (_hcan : isCanonicalString s = true)
    (hfuel : fuel ≥ (serializeAstValue (.string s)).toList.length + 1) (_hrest : GoodRest rest) :
    parseValueFuelUnchecked fuel ((serializeAstValue (.string s)).toList ++ rest) = some (.string s, rest) := by
  have hquote : ("\"" : String).toList = ['"'] := rfl
  have hser : (serializeAstValue (AST.string s)).toList
      = '"' :: (escapeList s.toList ++ ['"']) := by
    show ("\"" ++ escapeString s ++ "\"").toList = _
    simp [String.toList_append, hquote, escapeString_toList]
  rcases fuel with _ | fuel
  · exact absurd hfuel (by simp)
  rw [hser]
  simp only [parseValueFuelUnchecked, List.cons_append, skipWs, isWs]
  simp +decide
  show (match parseString ('"' :: escapeList s.toList ++ '"' :: rest) with
    | some (v, r) => some (AST.string v, r)
    | none => none) = some (AST.string s, rest)
  rw [parseString_roundtrip s rest]

-- skipWs over a serialized container body + close delimiter is the identity: the
-- head is either the close delimiter (empty case) or the first char of a serialized
-- value (cons case), neither of which is whitespace.
private theorem skipWs_serializeArrayValue_rbracket_append
    (items : List AST) (hcan : isCanonicalArray items = true) (tl : List Char) :
    skipWs ((serializeArrayValue items).toList ++ ']' :: tl)
      = (serializeArrayValue items).toList ++ ']' :: tl := by
  cases items with
  | nil =>
    show skipWs (']' :: tl) = ']' :: tl
    exact skipWs_cons_of_not_ws ']' tl isWs_rbracket
  | cons x xs =>
    have hcan_x : isCanonicalAst x = true := isCanonicalAst_of_mem_array List.mem_cons_self hcan
    obtain ⟨c, cs, hcs⟩ := serializeAstValue_nonempty x hcan_x
    have hws : isWs c = false := serializeAstValue_head_not_ws x hcan_x c cs hcs
    obtain ⟨tail, htail⟩ := serializeArrayValue_head_eq x xs
    rw [htail, hcs]
    simp only [List.cons_append]
    exact skipWs_cons_of_not_ws c _ hws

private theorem skipWs_serializeObjectValue_rbrace_append
    (fields : List (String × AST)) (tl : List Char) :
    skipWs ((serializeObjectValue fields).toList ++ '}' :: tl)
      = (serializeObjectValue fields).toList ++ '}' :: tl := by
  cases fields with
  | nil =>
    show skipWs ('}' :: tl) = '}' :: tl
    exact skipWs_cons_of_not_ws '}' tl isWs_rbrace
  | cons kv rest =>
    obtain ⟨tail, htail⟩ := serializeObjectValue_head_is_quote kv rest
    rw [htail]
    simp only [List.cons_append]
    exact skipWs_cons_of_not_ws '"' _ isWs_quote

set_option maxHeartbeats 3200000 in
private theorem value_roundtrip_size (n : Nat) :
    ∀ (ast : AST) (rest : List Char) (fuel : Nat),
      sizeOf ast ≤ n →
      isCanonicalAst ast = true →
      fuel ≥ (serializeAstValue ast).toList.length + 1 →
      GoodRest rest →
      parseValueFuelUnchecked fuel ((serializeAstValue ast).toList ++ rest) = some (ast, rest) := by
  induction n using Nat.strongRecOn with
  | ind n IH =>
    intro ast rest fuel hsize hcan hfuel hrest
    cases ast with
    | null => exact value_roundtrip_worker_null rest fuel hfuel hrest
    | bool b => exact value_roundtrip_worker_bool b rest fuel hfuel hrest
    | number v => exact value_roundtrip_worker_number v rest fuel hcan hfuel hrest
    | string s => exact value_roundtrip_worker_string s rest fuel hcan hfuel hrest
    | array items =>
      have hcan_items : isCanonicalArray items = true := hcan
      have hbr : ("[" : String).toList = ['['] := by decide
      have hbr2 : ("]" : String).toList = [']'] := by decide
      have hlist : (serializeAstValue (AST.array items)).toList ++ rest
          = '[' :: ((serializeArrayValue items).toList ++ ']' :: rest) := by
        show ("[" ++ serializeArrayValue items ++ "]").toList ++ rest = _
        simp [String.toList_append, hbr, hbr2, List.append_assoc]
      have hlen : (serializeAstValue (AST.array items)).toList.length
          = (serializeArrayValue items).toList.length + 2 := by
        show ("[" ++ serializeArrayValue items ++ "]").toList.length = _
        simp [String.toList_append, hbr, hbr2, List.length_append]
      obtain ⟨fuel', rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by omega⟩
      have hfuel_c : fuel' ≥ (serializeArrayValue items).toList.length + 2 := by
        rw [hlen] at hfuel; omega
      have ihv : ∀ (x : AST), x ∈ items → ∀ (tl : List Char) (f'' : Nat),
          isCanonicalAst x = true → f'' ≥ (serializeAstValue x).toList.length + 1 →
          GoodRest tl →
          parseValueFuelUnchecked f'' ((serializeAstValue x).toList ++ tl) = some (x, tl) := by
        intro x hx tl f'' hcx hfx hgr
        have hsx : sizeOf x < n := Nat.lt_of_lt_of_le (sizeOf_lt_array hx) hsize
        exact IH (sizeOf x) hsx x tl f'' (Nat.le_refl _) hcx hfx hgr
      rw [hlist]
      show parseArrayFuelUnchecked fuel' []
        (skipWs ((serializeArrayValue items).toList ++ ']' :: rest)) = some (AST.array items, rest)
      rw [skipWs_serializeArrayValue_rbracket_append items hcan_items rest]
      rw [parseArrayFuelUnchecked_roundtrip items [] rest fuel' hcan_items (by decide) hfuel_c ihv]
      simp only [List.reverse_nil, List.nil_append]
    | object fields =>
      have hcan_fields : isCanonicalObject fields = true := hcan
      have hbr : ("{" : String).toList = ['{'] := by decide
      have hbr2 : ("}" : String).toList = ['}'] := by decide
      have hlist : (serializeAstValue (AST.object fields)).toList ++ rest
          = '{' :: ((serializeObjectValue fields).toList ++ '}' :: rest) := by
        show ("{" ++ serializeObjectValue fields ++ "}").toList ++ rest = _
        simp [String.toList_append, hbr, hbr2, List.append_assoc]
      have hlen : (serializeAstValue (AST.object fields)).toList.length
          = (serializeObjectValue fields).toList.length + 2 := by
        show ("{" ++ serializeObjectValue fields ++ "}").toList.length = _
        simp [String.toList_append, hbr, hbr2, List.length_append]
      obtain ⟨fuel', rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by omega⟩
      have hfuel_c : fuel' ≥ (serializeObjectValue fields).toList.length + 2 := by
        rw [hlen] at hfuel; omega
      have hnodup : ∀ (k : String) (v : AST), (k, v) ∈ fields → duplicateKey k [] = false :=
        fun _ _ _ => rfl
      have ihv : ∀ (k : String) (v : AST), (k, v) ∈ fields → ∀ (tl : List Char) (f'' : Nat),
          isCanonicalAst v = true → f'' ≥ (serializeAstValue v).toList.length + 1 →
          GoodRest tl →
          parseValueFuelUnchecked f'' ((serializeAstValue v).toList ++ tl) = some (v, tl) := by
        intro k v hmem tl f'' hcv hfv hgr
        have hsv : sizeOf v < n := Nat.lt_of_lt_of_le (sizeOf_lt_object hmem) hsize
        exact IH (sizeOf v) hsv v tl f'' (Nat.le_refl _) hcv hfv hgr
      rw [hlist]
      show parseObjectFuelUnchecked fuel' []
        (skipWs ((serializeObjectValue fields).toList ++ '}' :: rest)) = some (AST.object fields, rest)
      rw [skipWs_serializeObjectValue_rbrace_append fields rest]
      rw [parseObjectFuelUnchecked_roundtrip fields [] rest fuel' hcan_fields (by decide) hnodup hfuel_c ihv]
      simp only [List.reverse_nil, List.nil_append]

theorem serialize_roundtrip_value_unchecked (ast : AST) (rest : List Char) (fuel : Nat)
    (hcan : isCanonicalAst ast = true)
    (hfuel : fuel ≥ (serializeAstValue ast).toList.length + 1)
    (hrest : GoodRest rest) :
    parseValueFuelUnchecked fuel ((serializeAstValue ast).toList ++ rest) = some (ast, rest) :=
  value_roundtrip_size (sizeOf ast) ast rest fuel (Nat.le_refl _) hcan hfuel hrest

/-! ## Bridge to parse -/

theorem serialize_roundtrip_parse (ast : AST) (hcan : IsCanonical ast) :
    parse (serializeAstValue ast) = some ast := by
  have h : parseValueFuelUnchecked ((serializeAstValue ast).toList.length + 1)
      ((serializeAstValue ast).toList ++ []) = some (ast, []) :=
    serialize_roundtrip_value_unchecked ast [] _ hcan (by omega) GoodRest_nil
  simp only [List.append_nil] at h
  simp only [parse, parseValueFuel, guardCanonicalResult, h, hcan, ↓reduceIte, skipWs]

theorem serialize_roundtrip_array (items : List AST)
    (h : IsCanonical (.array items)) :
    parse (serializeAst ⟨.array items, h⟩) = some (.array items) :=
  serialize_roundtrip_parse (.array items) h

theorem serialize_roundtrip_object (fields : List (String × AST))
    (h : IsCanonical (.object fields)) :
    parse (serializeAst ⟨.object fields, h⟩) = some (.object fields) :=
  serialize_roundtrip_parse (.object fields) h

theorem canonical_roundtrip (ast : {ast // IsCanonical ast}) :
    parse (serializeAst ast) = some ast.val := by
  obtain ⟨astVal, hCanon⟩ := ast
  simp only
  cases astVal with
  | null =>
    have : serializeAst ⟨AST.null, hCanon⟩ = serializeAst ⟨AST.null, rfl⟩ := rfl
    rw [this]; rfl
  | bool value =>
    have : serializeAst ⟨AST.bool value, hCanon⟩ = serializeAst ⟨AST.bool value, rfl⟩ := rfl
    rw [this]; cases value <;> rfl
  | number value => exact serialize_roundtrip_number value hCanon
  | string value => exact serialize_roundtrip_string value hCanon
  | array items => exact serialize_roundtrip_array items hCanon
  | object fields => exact serialize_roundtrip_object fields hCanon

/- GROUP C: serializeAst determinism. -/

theorem serializeAst_deterministic (ast : AST)
    (left right : IsCanonical ast) :
    serializeAst ⟨ast, left⟩ = serializeAst ⟨ast, right⟩ := by rfl

/- GROUP D: ValidApproval-backed lift. -/

theorem serialize_validCapability_roundtrip {state : ApprovalState}
    (ast : AST) (witness : ValidApproval ast state) :
    parse (serialize ⟨ast, witness⟩) = some ast := by
  unfold serialize
  exact canonical_roundtrip ⟨ast, witness.ast_canonical⟩

/- ============================================================
   GROUP E: canonical-escape non-vacuity witnesses (kernel-checked,
   NOT `#guard`). Positive: `café ☕` is canonical, round-trips, and its
   escape distinguishes it from a near neighbour. Negative: the four
   non-canonical encodings of a scalar (uppercase hex, long form where a
   short escape is required, a literal non-ASCII byte, a lone high
   surrogate) all parse-reject.
   ============================================================ -/

/-- Witness string exercising literal ASCII, a non-ASCII BMP char (`é`), and a
    non-ASCII BMP symbol (`☕`). Built via `String.ofList` to avoid kernel
    UTF-8 literal evaluation. -/
def cafeWitness : String := String.ofList ['c','a','f','é',' ','☕']

theorem cafeWitness_isCanonical : IsCanonical (.string cafeWitness) := by
  simp [IsCanonical, isCanonicalAst, isCanonicalString]

theorem cafeWitness_roundtrips :
    parse (serializeAst ⟨.string cafeWitness, cafeWitness_isCanonical⟩)
      = some (.string cafeWitness) :=
  serialize_roundtrip_string cafeWitness cafeWitness_isCanonical

/-- Astral scalar `😀` (U+1F600) escapes to its UTF-16 surrogate pair. -/
theorem escapeChar_astral_witness :
    escapeChar '😀' = ['\\','u','d','8','3','d','\\','u','d','e','0','0'] := by decide

theorem escapeChar_bmp_witness_eacute : escapeChar 'é' = ['\\','u','0','0','e','9'] := by decide

theorem escapeChar_bmp_witness_coffee : escapeChar '☕' = ['\\','u','2','6','1','5'] := by decide

/-- The escape distinguishes `é` from its `e` neighbour (injectivity, concretely). -/
theorem escapeList_distinguishes_eacute_e :
    escapeList ['c','a','f','é',' ','☕'] ≠ escapeList ['c','a','f','e',' ','☕'] := by decide

/-- Uppercase hex in a `\u` escape parse-rejects (canonical form is lowercase). -/
theorem reject_uppercase_hex :
    parseString ('"' :: '\\' :: 'u' :: '0' :: '0' :: 'E' :: '9' :: '"' :: []) = none := by decide

/-- The four-digit long form of newline (0x0a), whose canonical form is the
    short escape, parse-rejects. -/
theorem reject_longform_control :
    parseString ('"' :: '\\' :: 'u' :: '0' :: '0' :: '0' :: 'a' :: '"' :: []) = none := by decide

/-- A literal non-ASCII byte parse-rejects (it must be `\u`-escaped). -/
theorem reject_literal_nonascii :
    parseString ('"' :: 'é' :: '"' :: []) = none := by decide

/-- A lone high surrogate escape (no following low surrogate) parse-rejects. -/
theorem reject_lone_high_surrogate :
    parseString ('"' :: '\\' :: 'u' :: 'd' :: '8' :: '3' :: 'd' :: '"' :: []) = none := by decide

end SealV2