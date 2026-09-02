/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Escape

namespace SealV2

abbrev RawBytes := String
abbrev CanonicalBytes := String

structure Decimal where
  negative : Bool
  intDigits : String
  fracDigits : Option String := none
  deriving Repr, BEq, DecidableEq

inductive AST where
  | null
  | bool (value : Bool)
  | number (value : Decimal)
  | string (value : String)
  | array (items : List AST)
  | object (fields : List (String × AST))
  deriving Repr, BEq

def isPrintableAsciiStringChar (c : Char) : Bool :=
  0x20 ≤ c.toNat && c.toNat ≤ 0x7e && c != '"' && c != '\\'

/-- Every abstract string is admissible: the canonical escape form
    (`SealV2/Escape.lean`) encodes ALL Unicode strings with exactly one byte
    representation, so canonicality is a property of BYTES, enforced
    structurally by the escape-aware string parser — not a filter on values.
    (Previously this restricted values to printable ASCII; the predicate is
    kept so the guard plumbing and canonical-AST structure are unchanged.) -/
def isCanonicalString (_ : String) : Bool :=
  true

def isDigitChar (c : Char) : Bool :=
  '0'.toNat ≤ c.toNat && c.toNat ≤ '9'.toNat

def isNonZeroDigitChar (c : Char) : Bool :=
  '1'.toNat ≤ c.toNat && c.toNat ≤ '9'.toNat

def isCanonicalIntDigits (digits : String) : Bool :=
  match digits.toList with
  | ['0'] => true
  | c :: rest => isNonZeroDigitChar c && rest.all isDigitChar
  | [] => false

def isCanonicalFracDigits (digits : String) : Bool :=
  match digits.toList.reverse with
  | last :: _ => isNonZeroDigitChar last && digits.toList.all isDigitChar
  | [] => false

def isCanonicalDecimal (decimal : Decimal) : Bool :=
  isCanonicalIntDigits decimal.intDigits &&
    (match decimal.fracDigits with
     | none => true
     | some digits => isCanonicalFracDigits digits) &&
    !(decimal.negative && decimal.intDigits == "0" && decimal.fracDigits.isNone)

def hasDuplicateKey (key : String) (fields : List (String × AST)) : Bool :=
  fields.any fun field => field.fst == key

mutual

def isCanonicalAst : AST → Bool
  | .null => true
  | .bool _ => true
  | .number value => isCanonicalDecimal value
  | .string value => isCanonicalString value
  | .array items => isCanonicalArray items
  | .object fields => isCanonicalObject fields

def isCanonicalArray : List AST → Bool
  | [] => true
  | item :: rest => isCanonicalAst item && isCanonicalArray rest

def isCanonicalObject : List (String × AST) → Bool
  | [] => true
  | (key, value) :: rest =>
      isCanonicalString key &&
        isCanonicalAst value &&
        !hasDuplicateKey key rest &&
        isCanonicalObject rest

end

def IsCanonical (ast : AST) : Prop :=
  isCanonicalAst ast = true

instance (ast : AST) : Decidable (IsCanonical ast) :=
  inferInstanceAs (Decidable (isCanonicalAst ast = true))

def guardCanonicalResult (result : Option (AST × List Char)) : Option (AST × List Char) :=
  match result with
  | some (ast, rest) =>
      if IsCanonical ast then
        some (ast, rest)
      else
        none
  | none => none

def guardCanonicalStringResult (result : Option (String × List Char)) : Option (String × List Char) :=
  match result with
  | some (value, rest) =>
      if isCanonicalString value then
        some (value, rest)
      else
        none
  | none => none

def isWs : Char → Bool
  | ' ' | '\n' | '\r' | '\t' => true
  | _ => false

def isDigit (c : Char) : Bool :=
  '0'.toNat ≤ c.toNat && c.toNat ≤ '9'.toNat

def isNonZeroDigit (c : Char) : Bool :=
  '1'.toNat ≤ c.toNat && c.toNat ≤ '9'.toNat

def isAsciiStringChar (c : Char) : Bool :=
  0x20 ≤ c.toNat && c.toNat ≤ 0x7e && c != '"' && c != '\\'

def skipWs : List Char → List Char
  | c :: rest => if isWs c then skipWs rest else c :: rest
  | [] => []

def takeDigits (chars : List Char) : String × List Char :=
  match chars with
  | c :: rest =>
      if isDigit c then
        let (digits, tail) := takeDigits rest
        (String.singleton c ++ digits, tail)
      else
        ("", chars)
  | [] => ("", [])

def parseLiteral (literal : List Char) (value : AST) (chars : List Char) :
    Option (AST × List Char) :=
  if chars.take literal.length == literal then
    some (value, chars.drop literal.length)
  else
    none

/-- Escape-aware canonical string content parser. Accepts EXACTLY the output
    of `escapeList` (`SealV2/Escape.lean`) up to the closing quote:

    * literal printable ASCII (minus `"` `\`) — unchanged from the ASCII-only
      grammar; literal non-ASCII bytes REJECT (they must be `\u`-escaped);
    * `\u` + exactly four LOWERCASE hex digits — accepted only for scalars
      whose canonical form is the long form (`uEscapeScalarOk`); a high
      surrogate additionally requires an immediately following low-surrogate
      escape (astral pair), anything else (lone/misordered surrogate,
      uppercase hex, long form where a literal/short form is required)
      REJECTS;
    * `\` + one short-escape letter (`" \ n t r b f`) — the five controls and
      the two specials; every other `\x` (including `\/` and truncated `\u`)
      REJECTS.

    Structural recursion on the character list (no fuel): every recursive
    call is on a strict pattern suffix. -/
def parseStringCharsUnchecked (acc : String) (chars : List Char) :
    Option (String × List Char) :=
  match chars with
  | '"' :: rest => some (acc, rest)
  | '\\' :: 'u' :: h1 :: h2 :: h3 :: h4 :: rest =>
      match fromHex4? h1 h2 h3 h4 with
      | none => none
      | some n =>
          if uEscapeScalarOk n then
            parseStringCharsUnchecked (acc ++ String.singleton (Char.ofNat n)) rest
          else if 0xd800 ≤ n ∧ n ≤ 0xdbff then
            match rest with
            | '\\' :: 'u' :: k1 :: k2 :: k3 :: k4 :: rest2 =>
                match fromHex4? k1 k2 k3 k4 with
                | none => none
                | some m =>
                    if 0xdc00 ≤ m ∧ m ≤ 0xdfff then
                      parseStringCharsUnchecked
                        (acc ++ String.singleton
                          (Char.ofNat (0x10000 + (n - 0xd800) * 1024 + (m - 0xdc00))))
                        rest2
                    else none
            | _ => none
          else none
  | '\\' :: c :: rest =>
      match unescapeShort? c with
      | some d => parseStringCharsUnchecked (acc ++ String.singleton d) rest
      | none => none
  | c :: rest =>
      if isAsciiStringChar c then
        parseStringCharsUnchecked (acc ++ String.singleton c) rest
      else
        none
  | [] => none

def parseStringChars (acc : String) (chars : List Char) :
    Option (String × List Char) :=
  guardCanonicalStringResult (parseStringCharsUnchecked acc chars)

def parseString (chars : List Char) : Option (String × List Char) :=
  match chars with
  | '"' :: rest => parseStringChars "" rest
  | _ => none

def parseIntegerDigits (chars : List Char) : Option (String × List Char) :=
  match chars with
  | '0' :: rest =>
      match rest with
      | c :: _ => if isDigit c then none else some ("0", rest)
      | [] => some ("0", [])
  | c :: rest =>
      if isNonZeroDigit c then
        let (digits, tail) := takeDigits rest
        some (String.singleton c ++ digits, tail)
      else
        none
  | [] => none

def parseFraction (chars : List Char) : Option (Option String × List Char) :=
  match chars with
  | '.' :: rest =>
      let (digits, tail) := takeDigits rest
      match digits.toList.reverse with
      | last :: _ =>
          if last == '0' then none else some (some digits, tail)
      | [] => none
  | _ => some (none, chars)

def startsExponent : List Char → Bool
  | 'e' :: _ | 'E' :: _ => true
  | _ => false

def parseNumberUnchecked (chars : List Char) : Option (AST × List Char) :=
  let (negative, rest) :=
    match chars with
    | '-' :: rest => (true, rest)
    | _ => (false, chars)
  match parseIntegerDigits rest with
  | none => none
  | some (intDigits, afterInt) =>
      match parseFraction afterInt with
      | none => none
      | some (fracDigits, tail) =>
          if startsExponent tail then
            none
          else
            let ast : AST := .number { negative, intDigits, fracDigits }
            some (ast, tail)

def parseNumber (chars : List Char) : Option (AST × List Char) :=
  guardCanonicalResult (parseNumberUnchecked chars)

def duplicateKey (key : String) (fields : List (String × AST)) : Bool :=
  fields.any (fun field => field.fst == key)

mutual

def parseValueFuelUnchecked (fuel : Nat) (chars : List Char) : Option (AST × List Char) :=
  match fuel with
  | 0 => none
  | Nat.succ fuel' =>
      match skipWs chars with
      | [] => none
      | 'n' :: _ => parseLiteral ['n', 'u', 'l', 'l'] .null (skipWs chars)
      | 't' :: _ => parseLiteral ['t', 'r', 'u', 'e'] (.bool true) (skipWs chars)
      | 'f' :: _ => parseLiteral ['f', 'a', 'l', 's', 'e'] (.bool false) (skipWs chars)
      | '"' :: _ =>
          match parseString (skipWs chars) with
          | some (s, rest) => some (.string s, rest)
          | none => none
      | '[' :: rest => parseArrayFuelUnchecked fuel' [] (skipWs rest)
      | '{' :: rest => parseObjectFuelUnchecked fuel' [] (skipWs rest)
      | '-' :: _ => parseNumber (skipWs chars)
      | c :: _ => if isDigit c then parseNumber (skipWs chars) else none

def parseArrayFuelUnchecked (fuel : Nat) (acc : List AST) (chars : List Char) :
    Option (AST × List Char) :=
  match fuel with
  | 0 => none
  | Nat.succ fuel' =>
      match skipWs chars with
      | ']' :: rest =>
          let ast : AST := .array acc.reverse
          if IsCanonical ast then
            some (ast, rest)
          else
            none
      | rest =>
          match parseValueFuelUnchecked fuel' rest with
          | none => none
          | some (value, afterValue) =>
              match skipWs afterValue with
              | ',' :: afterComma =>
                  match skipWs afterComma with
                  | ']' :: _ => none
                  | checkedAfterComma =>
                      if isCanonicalArray (value :: acc) then
                        parseArrayFuelUnchecked fuel' (value :: acc) checkedAfterComma
                      else
                        none
              | ']' :: afterClose =>
                  let ast : AST := .array (value :: acc).reverse
                  if IsCanonical ast then
                    some (ast, afterClose)
                  else
                    none
              | _ => none

def parseObjectFuelUnchecked (fuel : Nat) (acc : List (String × AST)) (chars : List Char) :
    Option (AST × List Char) :=
  match fuel with
  | 0 => none
  | Nat.succ fuel' =>
      match skipWs chars with
      | '}' :: rest =>
          let ast : AST := .object acc.reverse
          if IsCanonical ast then
            some (ast, rest)
          else
            none
      | rest =>
          match parseString rest with
          | none => none
          | some (key, afterKey) =>
              if duplicateKey key acc then
                none
              else
                match skipWs afterKey with
                | ':' :: afterColon =>
                    match parseValueFuelUnchecked fuel' afterColon with
                    | none => none
                    | some (value, afterValue) =>
                        match skipWs afterValue with
                        | ',' :: afterComma =>
                            match skipWs afterComma with
                            | '}' :: _ => none
                            | checkedAfterComma =>
                                if isCanonicalObject ((key, value) :: acc) then
                                  parseObjectFuelUnchecked fuel' ((key, value) :: acc) checkedAfterComma
                                else
                                  none
                        | '}' :: afterClose =>
                            let ast : AST := .object ((key, value) :: acc).reverse
                            if IsCanonical ast then
                              some (ast, afterClose)
                            else
                              none
                        | _ => none
                | _ => none

end

def parseValueFuel (fuel : Nat) (chars : List Char) : Option (AST × List Char) :=
  guardCanonicalResult (parseValueFuelUnchecked fuel chars)

def parseArrayFuel (fuel : Nat) (acc : List AST) (chars : List Char) :
    Option (AST × List Char) :=
  guardCanonicalResult (parseArrayFuelUnchecked fuel acc chars)

def parseObjectFuel (fuel : Nat) (acc : List (String × AST)) (chars : List Char) :
    Option (AST × List Char) :=
  guardCanonicalResult (parseObjectFuelUnchecked fuel acc chars)

def parse (raw : RawBytes) : Option AST :=
  let chars := raw.toList
  match parseValueFuel (chars.length + 1) chars with
  | some (ast, rest) =>
      match skipWs rest with
      | [] =>
          if IsCanonical ast then
            some ast
          else
            none
      | _ => none
  | none => none

end SealV2
