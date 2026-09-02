/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.EffectCommitment
import Batteries.Data.Nat.Digits

/-!
# K5: byte-level injectivity of the netstring part framing

`Seal.encodeParts` frames each part `s` as `<decimal CHAR count>:<s>` and
concatenates; `Seal.stableHashParts` then hashes the UTF-8 BYTES of that
string. The K5 question: can two distinct part-lists produce identical hashed
bytes because the length prefix counts characters while the hash consumes
bytes?

## Answer

* WITHIN this implementation: NO. The framing is uniquely decodable at the
  character level (`encodeParts_injective`), and in this toolchain a `String`
  IS its UTF-8 bytes (`String.toByteArray_inj`), so the map
  `parts ↦ (encodeParts parts).toUTF8` is injective end to end
  (`encodeParts_toUTF8_injective`) — that theorem binds the exact object
  SHA-256 consumes.
* ACROSS implementations: the hazard is REAL. The netstring standard
  (D. J. Bernstein, "Netstrings", 1997, https://cr.yp.to/proto/netstrings.txt;
  same byte-counted framing in djb's qmail/ucspi tools and in SPKI S-expression
  canonical form, RFC-draft Rivest 1997) counts BYTES. `Seal.encodeParts`
  counts CHARACTERS — a divergence from the named prior art. Any reimplementer
  who reads "netstring" and reaches for `s.len()` (Rust), `len(b)` (Go),
  `strlen` (C) builds a scheme whose output BYTES collide with ours on
  DISTINCT part-lists: `cross_scheme_collision` below pins a constructed
  witness, and the `#eval` pins show the two SHA-256 digests agreeing at the
  hex surface the system consumes.

So the character count is safe only because BOTH the framer and the (implicit)
unframer live on this side of the hash. The divergence from byte-counted
netstrings is hereby DOCUMENTED and adversarially witnessed rather than
silent; the emitted vector file (`Test/EffectVectors.lean`) already states
`charCount` in its `encoding` note, and this module is the proof-side pin.

## Provenance

The character-level unique-decode proof (`digitsVal` … `chain_inj` …
`encodeParts_injective`) is ported verbatim from seal-host
`Host/Encoding.lean` (same author, same license, same toolchain and Batteries
rev). Porting it here discharges `Seal.AssumptionEncInjective` INSIDE this
repo — the kernel no longer takes A-ENC on faith from a sibling repo
(`assumptionEncInjective_holds`), and the Stage-A commitment theorems can be
consumed with one hypothesis fewer
(`effect_commitment_injective_of_cr_compress`).

Kernel proofs only: no `sorry`, no `native_decide`, no `ofReduceBool`; the
axiom pins below hold the gate at `propext`/`Classical.choice`/`Quot.sound`.
-/

namespace Seal.Encoding

/-! ## Decimal digits: value fold, injectivity, and the no-colon fact -/

/-- Fold a digit string back to its value — a left inverse of
    `Nat.toDigits 10` (proved below), which is all injectivity needs. -/
def digitsVal (cs : List Char) : Nat :=
  cs.foldl (fun a c => a * 10 + (c.toNat - 48)) 0

theorem digitChar_val (d : Nat) (h : d < 10) : (Nat.digitChar d).toNat - 48 = d := by
  match d, h with
  | 0, _ => decide
  | 1, _ => decide
  | 2, _ => decide
  | 3, _ => decide
  | 4, _ => decide
  | 5, _ => decide
  | 6, _ => decide
  | 7, _ => decide
  | 8, _ => decide
  | 9, _ => decide

/-- `digitsVal` is a left inverse of decimal rendering. -/
theorem digitsVal_toDigits (n : Nat) : digitsVal (Nat.toDigits 10 n) = n := by
  induction n using Nat.strongRecOn with
  | _ n ih =>
    by_cases h : n < 10
    · rw [Nat.toDigits_of_lt_base h]
      show 0 * 10 + ((Nat.digitChar n).toNat - 48) = n
      rw [digitChar_val n h]
      omega
    · have h10 : 10 ≤ n := Nat.le_of_not_lt h
      have hq : 0 < n / 10 := Nat.div_pos h10 (by decide)
      have hd : n % 10 < 10 := Nat.mod_lt _ (by decide)
      have hstep := Nat.toDigits_append_toDigits (b := 10) (n := n / 10)
        (d := n % 10) (by decide) hq hd
      rw [Nat.toDigits_of_lt_base hd, Nat.div_add_mod n 10] at hstep
      rw [← hstep]
      show digitsVal (Nat.toDigits 10 (n / 10) ++ [Nat.digitChar (n % 10)]) = n
      unfold digitsVal
      rw [List.foldl_append]
      show (Nat.toDigits 10 (n / 10)).foldl _ 0 * 10
          + ((Nat.digitChar (n % 10)).toNat - 48) = n
      have hihq : digitsVal (Nat.toDigits 10 (n / 10)) = n / 10 :=
        ih (n / 10) (Nat.div_lt_self (by omega) (by decide))
      unfold digitsVal at hihq
      rw [hihq, digitChar_val (n % 10) hd]
      have := Nat.div_add_mod n 10
      omega

/-- Decimal rendering is injective. -/
theorem toDigits_ten_inj {m n : Nat}
    (h : Nat.toDigits 10 m = Nat.toDigits 10 n) : m = n := by
  have hm := digitsVal_toDigits m
  rw [h, digitsVal_toDigits n] at hm
  exact hm.symm

/-- No decimal digit character is the frame separator `':'`. -/
theorem toDigits_ne_colon {n : Nat} {c : Char}
    (hc : c ∈ Nat.toDigits 10 n) : c ≠ ':' := by
  have hd := Nat.isDigit_of_mem_toDigits (by decide) (by decide) hc
  intro h
  rw [h] at hd
  exact absurd hd (by decide)

/-! ## The separator split: the first `':'` is unambiguous -/

/-- If neither prefix contains the separator, `as ++ ':' :: r₁ = bs ++ ':' :: r₂`
    splits componentwise: the FIRST separator occurrence pins the boundary. -/
theorem append_sep_inj {as bs r₁ r₂ : List Char}
    (ha : ∀ c ∈ as, c ≠ ':') (hb : ∀ c ∈ bs, c ≠ ':')
    (h : as ++ ':' :: r₁ = bs ++ ':' :: r₂) : as = bs ∧ r₁ = r₂ := by
  induction as generalizing bs with
  | nil =>
    cases bs with
    | nil =>
      simp only [List.nil_append] at h
      exact ⟨rfl, (List.cons.inj h).2⟩
    | cons b bt =>
      simp only [List.nil_append, List.cons_append] at h
      exact absurd (List.cons.inj h).1.symm (hb b (List.mem_cons_self ..))
  | cons a at' ih =>
    cases bs with
    | nil =>
      simp only [List.nil_append, List.cons_append] at h
      exact absurd (List.cons.inj h).1 (ha a (List.mem_cons_self ..))
    | cons b bt =>
      simp only [List.cons_append] at h
      obtain ⟨hab, ht⟩ := List.cons.inj h
      obtain ⟨h1, h2⟩ := ih
        (fun c hc => ha c (List.mem_cons_of_mem _ hc))
        (fun c hc => hb c (List.mem_cons_of_mem _ hc)) ht
      exact ⟨by rw [hab, h1], h2⟩

/-! ## The frame chain over `List Char` -/

/-- One netstring frame, at the character level. -/
def frameChars (s : String) : List Char :=
  Nat.toDigits 10 s.length ++ ':' :: s.toList

/-- The whole encoding, at the character level. -/
def chain : List String → List Char
  | [] => []
  | s :: t => frameChars s ++ chain t

theorem chain_cons (s : String) (t : List String) :
    chain (s :: t) = Nat.toDigits 10 s.length ++ ':' :: (s.toList ++ chain t) := by
  simp [chain, frameChars, List.append_assoc]

/-- **Unique decode.** The frame chain is injective. -/
theorem chain_inj : ∀ l₁ l₂ : List String, chain l₁ = chain l₂ → l₁ = l₂ := by
  intro l₁
  induction l₁ with
  | nil =>
    intro l₂ h
    cases l₂ with
    | nil => rfl
    | cons s t =>
      rw [chain_cons] at h
      cases hds : Nat.toDigits 10 s.length with
      | nil => rw [hds] at h; exact absurd h (by simp [chain])
      | cons c cs => rw [hds] at h; exact absurd h (by simp [chain])
  | cons s₁ t₁ ih =>
    intro l₂ h
    cases l₂ with
    | nil =>
      rw [chain_cons] at h
      cases hds : Nat.toDigits 10 s₁.length with
      | nil => rw [hds] at h; exact absurd h (by simp [chain])
      | cons c cs => rw [hds] at h; exact absurd h (by simp [chain])
    | cons s₂ t₂ =>
      rw [chain_cons, chain_cons] at h
      obtain ⟨hdig, hrest⟩ := append_sep_inj
        (fun c hc => toDigits_ne_colon hc) (fun c hc => toDigits_ne_colon hc) h
      have hlen : s₁.length = s₂.length := toDigits_ten_inj hdig
      have hlen' : s₁.toList.length = s₂.toList.length := by
        rw [String.length_toList, String.length_toList, hlen]
      obtain ⟨hs, ht⟩ := List.append_inj hrest hlen'
      rw [String.toList_inj.mp hs, ih t₂ ht]

/-! ## Transfer to `Seal.encodeParts` -/

theorem foldl_append_toList (L : List String) (acc : String) :
    (L.foldl (· ++ ·) acc).toList = acc.toList ++ (L.map String.toList).flatten := by
  induction L generalizing acc with
  | nil => simp
  | cons s t ih =>
    show (t.foldl (· ++ ·) (acc ++ s)).toList = _
    rw [ih (acc ++ s), String.toList_append]
    simp [List.append_assoc]

theorem empty_toList : ("" : String).toList = [] := by decide

theorem join_toList (L : List String) :
    (String.join L).toList = (L.map String.toList).flatten := by
  show (L.foldl (· ++ ·) "").toList = _
  rw [foldl_append_toList, empty_toList, List.nil_append]

/-- One frame's characters are exactly `frameChars`. -/
theorem frame_toList (s : String) :
    (toString s.length ++ ":" ++ s).toList = frameChars s := by
  rw [String.toList_append, String.toList_append]
  show (Nat.repr s.length).toList ++ (":" : String).toList ++ s.toList = _
  show (String.ofList (Nat.toDigits 10 s.length)).toList
      ++ (":" : String).toList ++ s.toList = _
  rw [String.toList_ofList]
  have hcolon : (":" : String).toList = [':'] := by decide
  rw [hcolon, frameChars, List.append_assoc]
  rfl

theorem map_frame_flatten (l : List String) :
    (l.map (String.toList ∘ fun s => toString s.length ++ ":" ++ s)).flatten
      = chain l := by
  induction l with
  | nil => rfl
  | cons s t ih =>
    rw [List.map_cons, List.flatten_cons, ih]
    show (toString s.length ++ ":" ++ s).toList ++ chain t = chain (s :: t)
    rw [frame_toList]
    rfl

theorem encodeParts_toList (l : List String) :
    (Seal.encodeParts l).toList = chain l := by
  show (String.join (l.map fun s => toString s.length ++ ":" ++ s)).toList = chain l
  rw [join_toList, List.map_map, map_frame_flatten]

/-- **The encoding is injective** at the `String` level (netstring framing,
    unique decode). Ported from seal-host `Host/Encoding.lean`. -/
theorem encodeParts_injective : Function.Injective Seal.encodeParts := by
  intro l₁ l₂ h
  apply chain_inj
  rw [← encodeParts_toList, ← encodeParts_toList, h]

/-! ## K5 headline: injectivity of the BYTES the hash consumes -/

/-- **K5.** `stableHashParts` hashes `(encodeParts parts).toUTF8` — not the
    `String`. This theorem binds that exact object: distinct part-lists never
    produce identical hashed bytes, character-counted length prefix
    notwithstanding. (In this toolchain a `String` is a validated UTF-8
    `ByteArray`, so `toUTF8` is injective by `String.toByteArray_inj`; the
    character-level unique decode does the rest.) -/
theorem encodeParts_toUTF8_injective :
    Function.Injective (fun parts : List String => (Seal.encodeParts parts).toUTF8) := by
  intro l₁ l₂ h
  exact encodeParts_injective (String.toByteArray_inj.mp h)

/-- A-ENC is now a theorem of THIS repo, not an assumption serviced by
    seal-host. -/
theorem assumptionEncInjective_holds : Seal.AssumptionEncInjective :=
  fun _ _ h => encodeParts_injective h

/-- Stage-A commitment injectivity with A-ENC discharged: only A-CR (the
    idealised perfect-injectivity hash assumption — strictly stronger than
    collision resistance, not satisfied by real SHA-256; see
    `Seal/EffectCommitment.lean`) and A-COMPRESS remain as hypotheses. -/
theorem effect_commitment_injective_of_cr_compress
    (hcr : Seal.AssumptionCR) (hcompress : Seal.AssumptionCompressInjective)
    (e₁ e₂ : Seal.Effect) (h : e₁.commitment = e₂.commitment) : e₁ = e₂ :=
  Seal.effect_commitment_injective hcr assumptionEncInjective_holds hcompress e₁ e₂ h

/-! ## The cross-scheme hazard, witnessed

Byte-counted framing is what the netstring PRIOR ART specifies and what a
reimplementer naturally writes (`s.len()` in Rust counts bytes). It is NOT
what `Seal.encodeParts` does. The two schemes agree on ASCII and collide on
multi-byte input: below, two DISTINCT part-lists whose encodings are
byte-identical across the two schemes — so a byte-counting host and this
kernel would compute the SAME commitment for DIFFERENT effects. -/

/-- The byte-counting reading of the frame spec (djb netstrings). Exists ONLY
    as the adversarial twin for the collision witness — never use it for a
    real commitment. -/
def encodePartsByteCount (parts : List String) : String :=
  String.join (parts.map fun s => toString s.toUTF8.size ++ ":" ++ s)

/-- Char-scheme side of the witness: `["é1", "", "aaaaaaaa"]`. -/
def witnessCharSide : List String := ["é1", "", "aaaaaaaa"]

/-- Byte-scheme side of the witness: `["é", "8:aaaaaaaa"]`. -/
def witnessByteSide : List String := ["é", "8:aaaaaaaa"]

/-- **The collision.** Distinct part-lists, byte-identical encodings across
    the two schemes: `é` is 1 char / 2 bytes, so the char-scheme datum `é1`
    swallows the digit `1` that the byte scheme reads as the head of its next
    frame length `10`, and both land on `"2:é10:8:aaaaaaaa"`. Kernel-checked
    by `decide` — no evaluation escape hatch. -/
theorem cross_scheme_collision :
    Seal.encodeParts witnessCharSide = encodePartsByteCount witnessByteSide
      ∧ witnessCharSide ≠ witnessByteSide := by
  decide

/-- Same-scheme control: under `encodeParts` itself the two witness lists do
    NOT collide — the collision above is strictly a cross-scheme artifact. -/
theorem witness_no_collision_within_scheme :
    Seal.encodeParts witnessCharSide ≠ Seal.encodeParts witnessByteSide := by
  decide

/-! ## Pins (compiled evaluation, real SHA-256) -/

-- The shared encoding both schemes land on.
/-- info: "2:é10:8:aaaaaaaa" -/
#guard_msgs in #eval Seal.encodeParts witnessCharSide

-- Cross-scheme SHA-256 agreement at the hex surface the system consumes: a
-- byte-counting host commits `["é","8:aaaaaaaa"]` to the same digest this
-- kernel gives `["é1","","aaaaaaaa"]`. Hex value cross-checked against
-- Python `hashlib.sha256` (Step-0 script).
/-- info: "a235d1f9ce20896fa3f00143b4d35d23a921dbc3977a8f8abee8f29a04e4a809" -/
#guard_msgs in #eval (Seal.stableHashParts witnessCharSide).toHex

/-- info: true -/
#guard_msgs in #eval
  (Seal.stableHashParts witnessCharSide).toHex
    == (Seal.stableHashString (encodePartsByteCount witnessByteSide)).toHex

-- Within-scheme control at the hash surface.
/-- info: true -/
#guard_msgs in #eval
  (Seal.stableHashParts witnessCharSide).toHex
    != (Seal.stableHashParts witnessByteSide).toHex

/-! ## Axiom pins -/

/-- info: 'Seal.Encoding.encodeParts_injective' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms encodeParts_injective

/-- info: 'Seal.Encoding.encodeParts_toUTF8_injective' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms encodeParts_toUTF8_injective

/-- info: 'Seal.Encoding.assumptionEncInjective_holds' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms assumptionEncInjective_holds

/-- info: 'Seal.Encoding.effect_commitment_injective_of_cr_compress' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms effect_commitment_injective_of_cr_compress

/-- info: 'Seal.Encoding.cross_scheme_collision' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms cross_scheme_collision

end Seal.Encoding
