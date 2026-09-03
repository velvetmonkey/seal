/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Canonical

namespace SealV2

def serializeDecimal (decimal : Decimal) : String :=
  (if decimal.negative then "-" else "") ++
    decimal.intDigits ++
    match decimal.fracDigits with
    | none => ""
    | some digits => "." ++ digits

mutual

def serializeAstValue : AST → CanonicalBytes
  | .null => "null"
  | .bool true => "true"
  | .bool false => "false"
  | .number value => serializeDecimal value
  | .string value => "\"" ++ escapeString value ++ "\""
  | .array items => "[" ++ serializeArrayValue items ++ "]"
  | .object fields => "{" ++ serializeObjectValue fields ++ "}"

def serializeArrayValue : List AST → String
  | [] => ""
  | [item] => serializeAstValue item
  | item :: rest => serializeAstValue item ++ "," ++ serializeArrayValue rest

def serializeObjectValue : List (String × AST) → String
  | [] => ""
  | [(key, value)] => "\"" ++ escapeString key ++ "\":" ++ serializeAstValue value
  | (key, value) :: rest =>
      "\"" ++ escapeString key ++ "\":" ++ serializeAstValue value ++ ","
        ++ serializeObjectValue rest

end

def serializeAst (ast : {ast // IsCanonical ast}) : CanonicalBytes :=
  serializeAstValue ast.val

end SealV2
