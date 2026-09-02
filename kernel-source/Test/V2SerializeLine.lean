/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures

open SealV2
open Test.V2ValidationFixtures

def printSerialized (name raw : String) : IO Unit := do
  match parse raw with
  | none => throw <| IO.userError s!"{name}: parse failed"
  | some ast =>
      if h : IsCanonical ast then
        IO.println s!"{name}\t{serializeAst ⟨ast, h⟩}"
      else
        throw <| IO.userError s!"{name}: parsed AST was not canonical"

def main : IO UInt32 := do
  printSerialized "object" "{\"tool\":\"db.execute\",\"amount\":12.34}"
  printSerialized "array" "[null,true,\"x\",-12.34]"
  match parse validRaw with
  | none => throw <| IO.userError "validated: parse failed"
  | some ast =>
      match validate ast baseState with
      | none => throw <| IO.userError "validated: validate failed"
      | some ⟨checked, witness⟩ => IO.println s!"validated\t{serialize ⟨checked, witness⟩}"
  pure 0
