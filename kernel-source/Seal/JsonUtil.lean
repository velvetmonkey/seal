/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json

namespace Seal.JsonUtil

open Lean

def getObjValOpt (json : Json) (key : String) : Except String (Option Json) := do
  let obj ← json.getObj?
  pure (obj.get? key)

def getObjString (json : Json) (key : String) : Except String String := do
  (← json.getObjVal? key).getStr?

def getObjNatD (json : Json) (key : String) (default : Nat) : Except String Nat := do
  match ← getObjValOpt json key with
  | some v => v.getNat?
  | none => pure default

partial def atPath (json : Json) (path : List String) : Option Json :=
  match path with
  | [] => some json
  | key :: rest =>
      match json with
      | .obj obj =>
          match obj.get? key with
          | some child => atPath child rest
          | none => none
      | _ => none

def jsonScalarToString : Json → Option String
  | .str s => some s
  | .num n => some (toString n)
  | .bool b => some (if b then "true" else "false")
  | .null => some "null"
  | _ => none

/-- Longest decimal-exponent digit run a wire number may carry before it is
    treated as pathological. Legitimate JSON numbers never approach this — the
    f64 range is ~`1e±308` (3 exponent digits), and arbitrary-precision decimal
    arguments carry no larger exponent in practice. A longer run means
    `Json.parse` would evaluate `10^exponent` and abort with
    "Nat.pow exponent is too big" (native + Lean interpreter) or diverge in the
    emscripten build — the Lane C native-vs-wasm divergence the three-way
    differential found. Six is comfortably above every legitimate value and
    below the whole abort/timeout region. -/
def maxExponentDigits : Nat := 6

/-- One character of the exponent-length scan (`wireNumbersSafe`). Pure, total,
    allocation-bounded — NO parse, NO `Nat.pow`. Tracks whether we are inside a
    JSON string (whose content is inert: a string value `"1e9999999999"` is
    harmless — only an UNQUOTED numeric literal drives the parser's
    `10^exponent`) and, when outside a string, the length of the current
    exponent digit run and the longest seen so far.

    `e`/`E` outside a string only begins a number exponent (JSON has no other
    unquoted `e`; the letters in `true`/`false` are followed by no digits, so
    they contribute a zero-length run and never trip the bound). -/
structure NumberScan where
  inString : Bool := false
  escaped  : Bool := false
  inExp    : Bool := false
  expLen   : Nat  := 0
  worst    : Nat  := 0
  deriving Repr

def numberScanStep (st : NumberScan) (c : Char) : NumberScan :=
  if st.inString then
    if st.escaped then { st with escaped := false }
    else if c == '\\' then { st with escaped := true }
    else if c == '"' then { st with inString := false }
    else st
  else if c == '"' then
    { st with inString := true, inExp := false, expLen := 0 }
  else if st.inExp then
    if c.isDigit then
      let l := st.expLen + 1
      { st with expLen := l, worst := Nat.max st.worst l }
    else if c == '+' || c == '-' then
      st            -- optional sign immediately after `e`; still in the exponent
    else
      { st with inExp := false, expLen := 0 }
  else if c == 'e' || c == 'E' then
    { st with inExp := true, expLen := 0 }
  else
    st

/-- `false` iff the raw wire line carries an unquoted JSON number whose decimal
    exponent is longer than `maxExponentDigits` digits — a pathological value
    the kernel must refuse to parse (fail closed) rather than abort on. Pure and
    total: a `List.foldl` state machine over the characters, never `Json.parse`,
    never `Nat.pow`. Used by `Host.classifyLine` (seal-host) and the standalone
    `Seal` host to gate the parse. -/
def wireNumbersSafe (s : String) : Bool :=
  (s.toList.foldl numberScanStep {}).worst ≤ maxExponentDigits

/-! ## Raw-wire IEEE-754 agreement scan

`wireNumbersSafe` above is deliberately only a parse-cost bound.  This second
scan asks a different question: would a mainstream binary64 JSON reader choose
the same decimal value that the exact `Lean.Json` reader sees?

The implementation does not call `Json.parse`, `Float.ofScientific`, or a
platform float printer.  It parses one raw numeric token into a normalized
decimal, rounds that exact rational to binary64 with `Nat` arithmetic, and
searches the at-most-17 significant digits needed for binary64's shortest
round-trip decimal.  That keeps the gate deterministic and kernel-reducible.
-/

structure ParsedWireDecimal where
  negative : Bool
  /-- Significant coefficient digits, with leading and trailing zeroes removed. -/
  digits : List Char
  /-- `digits * 10^exp10`. -/
  exp10 : Int
  /-- No decimal point or exponent marker occurred in the literal. -/
  integerSyntax : Bool
  deriving Repr

structure DecimalValue where
  coeff : Nat
  exp10 : Int
  deriving BEq, Repr

/-- The exact positive value of a finite binary64 number is
    `significand * 2^exp2`.  Zero is represented canonically as `(0, 0)`. -/
structure Binary64Value where
  significand : Nat
  exp2 : Int
  deriving BEq, Repr

private def charIsDigit (c : Char) : Bool :=
  '0' ≤ c && c ≤ '9'

private def allDigits (cs : List Char) : Bool :=
  !cs.isEmpty && cs.all charIsDigit

private def validIntegerPart : List Char → Bool
  | ['0'] => true
  | c :: cs => c != '0' && charIsDigit c && cs.all charIsDigit
  | [] => false

private def stripLeadingZeroes (cs : List Char) : List Char :=
  cs.dropWhile (· == '0')

private def normalizeDigits (cs : List Char) : List Char × Nat :=
  let noLeading := stripLeadingZeroes cs
  let trailing := noLeading.reverse.takeWhile (· == '0') |>.length
  (noLeading.take (noLeading.length - trailing), trailing)

/-- Parse exactly one JSON numeric token, preserving the syntactic distinction
    between an integer token and a token carrying `.`/`e`/`E`.  The surrounding
    scanner supplies maximal numeric-looking runs; `none` means that run was
    not a JSON number and will be left to `Json.parse` to reject. -/
private def parseWireDecimal? (literal : String) : Option ParsedWireDecimal := do
  let chars := literal.toList
  let (negative, body) :=
    match chars with
    | '-' :: rest => (true, rest)
    | _ => (false, chars)
  let (mantissa, exponentPart) := body.span (fun c => c != 'e' && c != 'E')
  let hasExponent := !exponentPart.isEmpty
  let exponent ←
    match exponentPart with
    | [] => some (0 : Int)
    | _marker :: rest =>
        let (expNegative, expDigits) :=
          match rest with
          | '+' :: ds => (false, ds)
          | '-' :: ds => (true, ds)
          | _ => (false, rest)
        if !allDigits expDigits then none
        else
          let significantExpDigits := stripLeadingZeroes expDigits
          let magnitude ←
            if significantExpDigits.length > maxExponentDigits then
              -- The parse-cost guard runs first in every mediation path.  Keep
              -- this predicate total when called alone: any non-zero exponent
              -- this wide is far outside the ±400 range used below.
              some 1000000
            else if significantExpDigits.isEmpty then some 0
            else String.ofList significantExpDigits |>.toNat?
          some (if expNegative then -(magnitude : Int) else (magnitude : Int))
  let (integerPart, fractionPart) := mantissa.span (· != '.')
  let hasFraction := !fractionPart.isEmpty
  if !validIntegerPart integerPart then none
  else
    let fractionDigits :=
      match fractionPart with
      | [] => []
      | _dot :: ds => ds
    if hasFraction && !allDigits fractionDigits then none
    else
      let rawDigits := integerPart ++ fractionDigits
      let (digits, trailing) := normalizeDigits rawDigits
      let exp10 := exponent - (fractionDigits.length : Int) + (trailing : Int)
      some {
        negative
        digits
        exp10 := if digits.isEmpty then 0 else exp10
        integerSyntax := !hasFraction && !hasExponent
      }

private def parsedValue? (p : ParsedWireDecimal) : Option DecimalValue := do
  if p.digits.length > 17 then none
  else
    let coeff ←
      if p.digits.isEmpty then some 0
      else String.ofList p.digits |>.toNat?
    some { coeff, exp10 := if coeff == 0 then 0 else p.exp10 }

private def roundDivEven (numerator denominator : Nat) : Nat :=
  let q := numerator / denominator
  let twiceRemainder := 2 * (numerator % denominator)
  if twiceRemainder < denominator then q
  else if denominator < twiceRemainder then q + 1
  else if q % 2 == 0 then q
  else q + 1

private def compareRatioPow2 (numerator denominator : Nat) (exponent : Int) : Ordering :=
  if exponent ≥ 0 then
    compare numerator (denominator * 2 ^ exponent.toNat)
  else
    compare (numerator * 2 ^ (-exponent).toNat) denominator

private def roundRatioScale2
    (numerator denominator : Nat) (shift : Int) : Nat :=
  if shift ≥ 0 then
    roundDivEven (numerator * 2 ^ shift.toNat) denominator
  else
    roundDivEven numerator (denominator * 2 ^ (-shift).toNat)

/-- Correctly round a positive rational to nearest-ties-to-even binary64.
    `none` denotes overflow to infinity. -/
private def rationalToBinary64?
    (numerator denominator : Nat) : Option Binary64Value :=
  if numerator == 0 then
    some { significand := 0, exp2 := 0 }
  else
    let guess : Int := (numerator.log2 : Int) - (denominator.log2 : Int)
    let exponent :=
      if compareRatioPow2 numerator denominator guess == .lt then guess - 1 else guess
    if exponent > 1023 then none
    else if exponent ≥ -1022 then
      let significand := roundRatioScale2 numerator denominator (52 - exponent)
      if significand == 2 ^ 53 then
        let carriedExponent := exponent + 1
        if carriedExponent > 1023 then none
        else some { significand := 2 ^ 52, exp2 := carriedExponent - 52 }
      else
        some { significand, exp2 := exponent - 52 }
    else
      let significand := roundRatioScale2 numerator denominator 1074
      if significand == 0 then
        some { significand := 0, exp2 := 0 }
      else
        some { significand, exp2 := -1074 }

private def decimalToBinary64? (d : DecimalValue) : Option Binary64Value :=
  if d.coeff == 0 then
    some { significand := 0, exp2 := 0 }
  else if d.exp10 > 400 then
    none
  else if d.exp10 < -400 then
    some { significand := 0, exp2 := 0 }
  else if d.exp10 ≥ 0 then
    rationalToBinary64? (d.coeff * 10 ^ d.exp10.toNat) 1
  else
    rationalToBinary64? d.coeff (10 ^ (-d.exp10).toNat)

private def normalizeDecimalValue (coeff : Nat) (exp10 : Int) : DecimalValue :=
  if coeff == 0 then { coeff := 0, exp10 := 0 }
  else
    let rec strip (n : Nat) (e : Int) (fuel : Nat) : Nat × Int :=
      match fuel with
      | 0 => (n, e)
      | fuel + 1 =>
          if n % 10 == 0 then strip (n / 10) (e + 1) fuel else (n, e)
    let (n, e) := strip coeff exp10 (Nat.repr coeff).length
    { coeff := n, exp10 := e }

private def binaryRatio (b : Binary64Value) : Nat × Nat :=
  if b.exp2 ≥ 0 then
    (b.significand * 2 ^ b.exp2.toNat, 1)
  else
    (b.significand, 2 ^ (-b.exp2).toNat)

/-- Whether a normalized decimal and a binary64 value denote the same exact
    rational number. -/
private def decimalEqualsBinary64 (d : DecimalValue) (b : Binary64Value) : Bool :=
  let (binaryNumerator, binaryDenominator) := binaryRatio b
  if d.exp10 ≥ 0 then
    d.coeff * 10 ^ d.exp10.toNat * binaryDenominator == binaryNumerator
  else
    d.coeff * binaryDenominator ==
      binaryNumerator * 10 ^ (-d.exp10).toNat

private def negativeDecimalExponent? (numerator denominator : Nat) : Option Int :=
  (List.range 401).drop 1 |>.findSome? fun (k : Nat) =>
    if numerator * 10 ^ k ≥ denominator then some (-(k : Int)) else none

/-- `floor(log10 b)` for a positive finite binary64 value. -/
private def binaryDecimalExponent? (b : Binary64Value) : Option Int :=
  let (numerator, denominator) := binaryRatio b
  if numerator ≥ denominator then
    let integerPart := numerator / denominator
    some ((Nat.repr integerPart).length - 1 : Nat)
  else
    negativeDecimalExponent? numerator denominator

private def nearestDecimalCoeff (b : Binary64Value) (exp10 : Int) : Nat :=
  let (n0, d0) := binaryRatio b
  if exp10 ≥ 0 then
    roundDivEven n0 (d0 * 10 ^ exp10.toNat)
  else
    roundDivEven (n0 * 10 ^ (-exp10).toNat) d0

private def shortestDecimalAux
    (b : Binary64Value) (decimalExponent : Int) :
    Nat → Nat → Option DecimalValue
  | 0, _ => none
  | fuel + 1, digits =>
      let candidateExponent := decimalExponent - (digits - 1 : Nat)
      let candidate :=
        normalizeDecimalValue (nearestDecimalCoeff b candidateExponent) candidateExponent
      if decimalToBinary64? candidate == some b then some candidate
      else shortestDecimalAux b decimalExponent fuel (digits + 1)

private def shortestDecimal? (b : Binary64Value) : Option DecimalValue :=
  if b.significand == 0 then some { coeff := 0, exp10 := 0 }
  else do
    let decimalExponent ← binaryDecimalExponent? b
    shortestDecimalAux b decimalExponent 17 1

/-- Decide one syntactically valid JSON numeric literal.

Integer syntax is subject to a significant-coefficient length resource bound
before `Nat` conversion and is accepted only when the exponent-applied value is
exactly representable in binary64.  Decimal/exponent syntax is accepted exactly
when its normalized mathematical value is the shortest decimal that round-trips
through binary64.
-/
def numberLiteralAgreementSafe? (literal : String) : Option Bool := do
  let parsed ← parseWireDecimal? literal
  if parsed.integerSyntax then
    -- Keep this significant-coefficient length gate as a resource bound so an
    -- arbitrarily long integer is refused before conversion to `Nat`.
    if parsed.digits.length > 16 then some false
    else
      let coefficient ←
        if parsed.digits.isEmpty then some 0
        else String.ofList parsed.digits |>.toNat?
      let value : DecimalValue := { coeff := coefficient, exp10 := parsed.exp10 }
      match decimalToBinary64? value with
      | none => some false
      | some binary => some (decimalEqualsBinary64 value binary)
  else
    match parsedValue? parsed with
    | none => some false
    | some value =>
        match decimalToBinary64? value with
        | none => some false
        | some binary =>
            match shortestDecimal? binary with
            | none => some false
            | some shortest => some (shortest == value)

private def numericTokenChar (c : Char) : Bool :=
  charIsDigit c || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E'

structure AgreementScan where
  inString : Bool := false
  escaped : Bool := false
  inNumber : Bool := false
  /-- Current numeric-looking run, reversed. -/
  buf : List Char := []
  offending : Option String := none
  deriving Repr

private def finishAgreementNumber (st : AgreementScan) : AgreementScan :=
  if !st.inNumber then st
  else
    let literal := String.ofList st.buf.reverse
    match numberLiteralAgreementSafe? literal with
    | some false =>
        { st with inNumber := false, buf := [], offending := some literal }
    | _ =>
        { st with inNumber := false, buf := [] }

private def agreementScanOutside (st : AgreementScan) (c : Char) : AgreementScan :=
  if c == '"' then { st with inString := true }
  else if c == '-' || charIsDigit c then
    { st with inNumber := true, buf := [c] }
  else st

def agreementScanStep (st : AgreementScan) (c : Char) : AgreementScan :=
  if st.offending.isSome then st
  else if st.inString then
    if st.escaped then { st with escaped := false }
    else if c == '\\' then { st with escaped := true }
    else if c == '"' then { st with inString := false }
    else st
  else if st.inNumber then
    if numericTokenChar c then { st with buf := c :: st.buf }
    else agreementScanOutside (finishAgreementNumber st) c
  else
    agreementScanOutside st c

/-- The first unquoted JSON number whose exact Lean reading disagrees with a
    mainstream IEEE-754 reader, preserving the offending raw literal for the
    hard refusal message. -/
def firstAgreementUnsafeNumber? (s : String) : Option String :=
  finishAgreementNumber (s.toList.foldl agreementScanStep {}) |>.offending

/-- Independent cross-parser agreement predicate over the raw wire text. -/
def wireNumbersAgreementSafe (s : String) : Bool :=
  (firstAgreementUnsafeNumber? s).isNone

/-! ## Raw-wire object-key scan (duplicate-key mediation gate)

`Lean.Json.parse` collapses duplicate object keys last-wins. A tool's own
parser may take first-wins (or reject), so a duplicate key in a guarded
call's arguments is a kernel-versus-tool parser divergence — a full
mediation bypass invisible to any check on the post-parse value. The gate
therefore runs on the RAW wire text, before the information is destroyed.

Scope and posture:
* A duplicate key (raw-identical text) in ANY object of the line ⇒ unsafe.
* An ESCAPE SEQUENCE inside an object key ⇒ unsafe. Rationale: `"a"`
  and `"a"` are different raw bytes but the same post-parse key, so raw
  comparison alone would miss that duplicate. Rather than re-implement the
  parser's escape decoding (surrogate pairs included) in the gate, any
  escaped key fails closed. Escapes in string VALUES are unaffected.
* Structural anomalies (stray closers, key position confusion) ⇒ unsafe.
  The gate runs alongside `Json.parse`; malformed lines are already handled
  there, so over-blocking malformed text costs nothing.

Total: a single `List.foldl` over the characters with an explicit frame
stack — no `partial`, no parse. -/

/-- One container frame of the key scan: an object frame carries the raw
    keys seen so far and whether the next string in this frame is a key. -/
inductive KeyFrame where
  | obj (seen : List String) (expectKey : Bool)
  | arr
  deriving Repr

structure KeyScan where
  stack : List KeyFrame := []
  inString : Bool := false
  escaped : Bool := false
  /-- The string being read is an object key: capture it. -/
  isKey : Bool := false
  /-- Captured key characters, reversed. -/
  buf : List Char := []
  bad : Bool := false
  deriving Repr

def keyScanStep (st : KeyScan) (c : Char) : KeyScan :=
  if st.bad then st
  else if st.inString then
    if st.escaped then { st with escaped := false }
    else if c == '\\' then
      if st.isKey then { st with bad := true }
      else { st with escaped := true }
    else if c == '"' then
      if st.isKey then
        let key := String.ofList st.buf.reverse
        match st.stack with
        | .obj seen _ :: rest =>
            if seen.contains key then { st with bad := true }
            else { st with inString := false, isKey := false, buf := [],
                           stack := .obj (key :: seen) false :: rest }
        | _ => { st with bad := true }
      else { st with inString := false }
    else if st.isKey then { st with buf := c :: st.buf }
    else st
  else if c == '"' then
    let isKey := match st.stack with
      | .obj _ expectKey :: _ => expectKey
      | _ => false
    { st with inString := true, isKey, buf := [] }
  else if c == '{' then { st with stack := .obj [] true :: st.stack }
  else if c == '[' then { st with stack := .arr :: st.stack }
  else if c == '}' then
    match st.stack with
    | .obj _ _ :: rest => { st with stack := rest }
    | _ => { st with bad := true }
  else if c == ']' then
    match st.stack with
    | .arr :: rest => { st with stack := rest }
    | _ => { st with bad := true }
  else if c == ',' then
    match st.stack with
    | .obj seen _ :: rest => { st with stack := .obj seen true :: rest }
    | _ => st
  else
    st

/-- `true` iff the raw wire line contains no duplicate object key, no escape
    sequence inside an object key, and no structural anomaly the scan can
    see. `false` on a guarded call is a HARD block (fail closed), never a
    silent last-wins collapse. -/
def wireKeysSafe (s : String) : Bool :=
  !(s.toList.foldl keyScanStep {}).bad

/-! ## Raw-wire significant-digit bound (Stage-C twin comparability)

Pinned Stage-A integer bound for guarded-call arguments: an unquoted JSON
number may carry at most `maxSignificantDigits` mantissa digits (integer +
fraction digits of the literal, exponent digits excluded — those are bounded
separately by `maxExponentDigits`). `10^18 < 2^63`, so every in-bound
integer mantissa fits an `i64` in the Stage-C Rust byte twin; anything
longer fails closed here rather than diverging there. Leading zeros count
toward the bound (over-blocking a pathological `0.00…01` is acceptable). -/

def maxSignificantDigits : Nat := 18

structure DigitScan where
  inString : Bool := false
  escaped : Bool := false
  inExp : Bool := false
  run : Nat := 0
  worst : Nat := 0
  deriving Repr

def digitScanStep (st : DigitScan) (c : Char) : DigitScan :=
  if st.inString then
    if st.escaped then { st with escaped := false }
    else if c == '\\' then { st with escaped := true }
    else if c == '"' then { st with inString := false }
    else st
  else if c == '"' then
    { st with inString := true, inExp := false, run := 0 }
  else if c == 'e' || c == 'E' then
    { st with inExp := true }
  else if c == '+' || c == '-' then
    st            -- exponent sign keeps `inExp`; a value sign is inert
  else if c.isDigit then
    if st.inExp then st
    else
      let r := st.run + 1
      { st with run := r, worst := Nat.max st.worst r }
  else if c == '.' then
    st
  else
    { st with inExp := false, run := 0 }

/-- `true` iff no unquoted number literal on the line carries more than
    `maxSignificantDigits` mantissa digits. -/
def wireDigitsSafe (s : String) : Bool :=
  (s.toList.foldl digitScanStep {}).worst ≤ maxSignificantDigits

def splitPath (s : String) : List String :=
  s.splitOn "." |>.filter (fun part => part ≠ "")

/-- Parser-boundary discipline: every key of `json` (which must be an object)
    must be in `allowed`. A stray key is a hard error naming the key and the
    context — a typo such as `temporral` must not silently leave a kernel
    unconfigured. -/
def expectObjKeys (json : Json) (allowed : List String) (ctx : String) :
    Except String Unit := do
  let obj ← json.getObj?
  match obj.keys.filter (fun k => !allowed.contains k) with
  | [] => pure ()
  | k :: _ => throw s!"unknown key '{k}' in {ctx}"

end Seal.JsonUtil
