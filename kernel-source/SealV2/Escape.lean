/- SPDX-License-Identifier: Apache-2.0 -/

namespace SealV2

/-!
# Canonical string escaping (the one-representation rule)

Total, deterministic escape form admitting EVERY Unicode string with exactly
one byte representation:

* printable ASCII `0x20`–`0x7e` except `"` and `\`: emitted literal;
* `"` → `\"`, `\` → `\\`; the five JSON short escapes `\n \t \r \b \f` in
  short form ONLY (the four-digit long form of those five is non-canonical);
* remaining controls `0x00`–`0x1f` and `0x7f`: `\u00xx`, lowercase hex,
  exactly four digits;
* non-ASCII BMP `0x80`–`0xffff`: `\uxxxx` lowercase (Lean `Char` cannot hold
  surrogates, so the surrogate gap is unreachable from the emitter);
* astral `≥ 0x10000`: UTF-16 surrogate pair `\ud8xx\udcxx`, lowercase.

Canonical is DEFINED as the output of `escapeChar`/`escapeString`. Any other
encoding of the same abstract string (uppercase hex, `\u` where a literal or
short form is required, lone or misordered surrogates, literal non-ASCII
bytes) is non-canonical and parse-rejects — see the escape-aware
`parseStringCharsUnchecked` in `SealV2/Parser.lean`.
-/

/-- Lowercase hex nibble: `0`–`9`, `a`–`f`. -/
def hexDigitChar (n : Nat) : Char :=
  if n < 10 then Char.ofNat (48 + n) else Char.ofNat (87 + n)

/-- Exactly four lowercase hex digits, big-endian nibbles. -/
def toHex4 (n : Nat) : List Char :=
  [hexDigitChar (n / 4096 % 16), hexDigitChar (n / 256 % 16),
   hexDigitChar (n / 16 % 16), hexDigitChar (n % 16)]

/-- Hex nibble value — LOWERCASE only. Uppercase `A`–`F` is rejected, which
    is exactly how the parser refuses uppercase `\u` escapes. -/
def hexVal? (c : Char) : Option Nat :=
  if 48 ≤ c.toNat ∧ c.toNat ≤ 57 then some (c.toNat - 48)
  else if 97 ≤ c.toNat ∧ c.toNat ≤ 102 then some (c.toNat - 87)
  else none

/-- Four-nibble decode. -/
def fromHex4? (h1 h2 h3 h4 : Char) : Option Nat :=
  match hexVal? h1, hexVal? h2, hexVal? h3, hexVal? h4 with
  | some a, some b, some c, some d => some (a * 4096 + b * 256 + c * 16 + d)
  | _, _, _, _ => none

/-- The five short-escape letters, by scalar value. -/
def shortEscapeLetter? (n : Nat) : Option Char :=
  if n = 0xa then some 'n'
  else if n = 0x9 then some 't'
  else if n = 0xd then some 'r'
  else if n = 0x8 then some 'b'
  else if n = 0xc then some 'f'
  else none

/-- Decode a short-escape letter (parser side). `u` is deliberately absent —
    hex escapes are handled by the four-digit parser arm, so a `\u` with
    fewer than four hex digits falls through to rejection here. -/
def unescapeShort? (c : Char) : Option Char :=
  if c = '"' then some '"'
  else if c = '\\' then some '\\'
  else if c = 'n' then some (Char.ofNat 0xa)
  else if c = 't' then some (Char.ofNat 0x9)
  else if c = 'r' then some (Char.ofNat 0xd)
  else if c = 'b' then some (Char.ofNat 0x8)
  else if c = 'f' then some (Char.ofNat 0xc)
  else none

/-- Which scalars a single `\uxxxx` may CANONICALLY denote: exactly the
    controls with no shorter form, `0x7f`, and non-ASCII BMP non-surrogates.
    Everything else (printable ASCII, the five short-escape controls,
    surrogate halves standing alone) must use its required form instead. -/
def uEscapeScalarOk (n : Nat) : Bool :=
  if n < 0x20 then (shortEscapeLetter? n).isNone
  else if n = 0x7f then true
  else if 0x80 ≤ n ∧ n < 0xd800 then true
  else if 0xe000 ≤ n ∧ n ≤ 0xffff then true
  else false

/-- **The canonical escape of one character.** Total on `Char` (all Unicode
    scalar values); canonical bytes are DEFINED as this function's output. -/
def escapeChar (c : Char) : List Char :=
  let n := c.toNat
  if c = '"' then ['\\', '"']
  else if c = '\\' then ['\\', '\\']
  else if 0x20 ≤ n ∧ n ≤ 0x7e then [c]
  else if n = 0xa then ['\\', 'n']
  else if n = 0x9 then ['\\', 't']
  else if n = 0xd then ['\\', 'r']
  else if n = 0x8 then ['\\', 'b']
  else if n = 0xc then ['\\', 'f']
  else if n < 0x10000 then '\\' :: 'u' :: toHex4 n
  else
    ('\\' :: 'u' :: toHex4 (0xd800 + (n - 0x10000) / 1024)) ++
      ('\\' :: 'u' :: toHex4 (0xdc00 + (n - 0x10000) % 1024))

/-- Canonical escape of a character list. -/
def escapeList (cs : List Char) : List Char :=
  cs.flatMap escapeChar

/-- Canonical escape of an abstract string: the unique canonical byte form
    of its content (without the surrounding quotes). -/
def escapeString (s : String) : String :=
  String.ofList (escapeList s.toList)

/-! ## Hex roundtrip (pure arithmetic) -/

theorem hexVal?_hexDigitChar (d : Nat) (h : d < 16) :
    hexVal? (hexDigitChar d) = some d := by
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
  | 10, _ => decide
  | 11, _ => decide
  | 12, _ => decide
  | 13, _ => decide
  | 14, _ => decide
  | 15, _ => decide
  | d + 16, h => exact absurd h (by omega)

theorem fromHex4?_toHex4 (n : Nat) (h : n < 0x10000) :
    fromHex4? (hexDigitChar (n / 4096 % 16)) (hexDigitChar (n / 256 % 16))
      (hexDigitChar (n / 16 % 16)) (hexDigitChar (n % 16)) = some n := by
  simp only [fromHex4?,
    hexVal?_hexDigitChar (n / 4096 % 16) (Nat.mod_lt _ (by decide)),
    hexVal?_hexDigitChar (n / 256 % 16) (Nat.mod_lt _ (by decide)),
    hexVal?_hexDigitChar (n / 16 % 16) (Nat.mod_lt _ (by decide)),
    hexVal?_hexDigitChar (n % 16) (Nat.mod_lt _ (by decide)),
    Option.some.injEq]
  omega

end SealV2
