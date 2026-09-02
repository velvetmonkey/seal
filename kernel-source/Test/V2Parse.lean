/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2

open SealV2

def assertSome (name raw : String) : IO Unit := do
  match parse raw with
  | some _ => pure ()
  | none => throw <| IO.userError s!"{name}: expected parse success for {raw}"

def assertNone (name raw : String) : IO Unit := do
  match parse raw with
  | none => pure ()
  | some ast => throw <| IO.userError s!"{name}: expected parse failure for {raw}, got {repr ast}"

def assertParseNumberNone (name raw : String) : IO Unit := do
  match parseNumber raw.toList with
  | none => pure ()
  | some parsed => throw <| IO.userError s!"{name}: expected parseNumber failure for {raw}, got {repr parsed}"

def assertParseNumberSome (name raw : String) : IO Unit := do
  match parseNumber raw.toList with
  | some _ => pure ()
  | none => throw <| IO.userError s!"{name}: expected parseNumber success for {raw}"

def accepted : List (String × String) := [
  ("null", "null"),
  ("true", "true"),
  ("false", "false"),
  ("string", "\"prod.users\""),
  ("zero", "0"),
  ("integer", "12"),
  ("negative integer", "-12"),
  ("fraction", "0.5"),
  ("negative fraction", "-0.5"),
  ("leading fractional zero", "0.05"),
  ("object", "{\"tool\":\"db.execute\",\"amount\":12.34}"),
  ("array", "[null,true,\"x\",-12.34]"),
  ("short escape", "\"prod\\nusers\"")
]

def rejected : List (String × String) := [
  ("empty", ""),
  ("partial object", "{\"a\":1"),
  ("trailing bytes", "{\"a\":1}x"),
  ("duplicate keys", "{\"a\":1,\"a\":2}"),
  ("non-ascii string", "\"prod.ü\""),
  ("unterminated string", "\"prod"),
  ("negative zero", "-0"),
  ("negative zero fraction", "-0.0"),
  ("negative leading zero fraction", "-00.0"),
  ("negative leading zero", "-00"),
  ("leading zero", "01"),
  ("double zero", "00"),
  ("empty fraction", "1."),
  ("trailing fractional zero", "1.0"),
  ("trailing fractional zero long", "1.20"),
  ("missing integer", ".5"),
  ("exponent lower", "1e3"),
  ("exponent upper", "1E3"),
  ("exponent scientific", "6.022e23"),
  ("overspecified negative exponent", "-1e-9"),
  ("array noncanonical number", "[1.0]"),
  ("object noncanonical number", "{\"amount\":1.20}"),
  ("object noncanonical key", "{\"ü\":1}"),
  ("nested duplicate keys", "{\"outer\":{\"a\":1,\"a\":2}}"),
  ("trailing comma array", "[1,]"),
  ("trailing comma object", "{\"a\":1,}")
]

def rejectedNumbers : List (String × String) := [
  ("negative zero", "-0"),
  ("negative zero fraction", "-0.0"),
  ("negative leading zero fraction", "-00.0"),
  ("double zero", "00"),
  ("leading zero", "01"),
  ("negative leading zero", "-00"),
  ("trailing fractional zero", "1.0"),
  ("trailing fractional zero long", "1.20"),
  ("empty fraction", "1."),
  ("missing integer", ".5"),
  ("exponent lower", "1e3"),
  ("exponent upper", "1E3"),
  ("exponent scientific", "6.022e23")
]

def acceptedNumbers : List (String × String) := [
  ("zero", "0"),
  ("integer", "12"),
  ("negative integer", "-12"),
  ("fraction", "0.5"),
  ("negative fraction", "-0.5"),
  ("leading fractional zero", "0.05"),
  ("decimal", "12.34")
]

def main : IO UInt32 := do
  for (name, raw) in accepted do
    assertSome name raw
  for (name, raw) in rejected do
    assertNone name raw
  for (name, raw) in acceptedNumbers do
    assertParseNumberSome name raw
  for (name, raw) in rejectedNumbers do
    assertParseNumberNone name raw
  IO.println s!"M1 parser corpus passed: {accepted.length} accepted, {rejected.length} rejected"
  pure 0
