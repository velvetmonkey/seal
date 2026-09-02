/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures

open SealV2
open Test.V2ValidationFixtures

def expectParsedRoundtrip (name raw : String) : IO Unit := do
  match parse raw with
  | none => throw <| IO.userError s!"{name}: expected parse success"
  | some ast =>
      if h : IsCanonical ast then
        let bytes := serializeAst ⟨ast, h⟩
        match parse bytes with
        | some reparsed =>
            if reparsed == ast then
              pure ()
            else
              throw <| IO.userError s!"{name}: roundtrip changed AST: {bytes}"
        | none => throw <| IO.userError s!"{name}: serialized bytes did not parse: {bytes}"
      else
        throw <| IO.userError s!"{name}: parsed AST was not canonical"

def expectValidateSerializeRoundtrip : IO Unit := do
  match parse validRaw with
  | none => throw <| IO.userError "validRaw did not parse"
  | some ast =>
      match validate ast baseState with
      | none => throw <| IO.userError "validRaw did not validate"
      | some ⟨checked, witness⟩ =>
          let bytes := serialize ⟨checked, witness⟩
          match parse bytes with
          | some reparsed =>
              if reparsed == checked then
                pure ()
              else
                throw <| IO.userError s!"validated serialize changed AST: {bytes}"
          | none => throw <| IO.userError s!"validated serialize did not parse: {bytes}"

def expectSignatureUsesCanonicalBytes : IO Unit := do
  let expectedPayload :=
    "{\"target\":{\"tool\":\"db.execute\",\"action\":\"write\",\"toolVersion\":\"v1\",\"manifestDigest\":\"manifest-001\",\"arguments\":{\"database\":\"prod\",\"table\":\"users\",\"amount\":12.34},\"metadata\":{\"presence\":\"absent\"}},\"session\":\"session-1\",\"issuedAt\":0,\"expiry\":120,\"nonce\":\"" ++ hex64a ++ "\"}"
  -- The approval's signed bytes ARE the M3 canonical serialisation, and the real
  -- Ed25519 signature verifies over exactly those bytes under the test public key.
  if validApproval.signedMessageRaw == expectedPayload && verifySignature baseState.publicKey validApproval then
    pure ()
  else
    throw <| IO.userError s!"signature did not use canonical bytes / did not verify: {validApproval.signedMessageRaw}"

def main : IO UInt32 := do
  expectParsedRoundtrip "null" "null"
  expectParsedRoundtrip "bool" "false"
  expectParsedRoundtrip "number" "-12.34"
  expectParsedRoundtrip "string" "\"prod.users\""
  expectParsedRoundtrip "array" "[null,true,\"x\",-12.34]"
  expectParsedRoundtrip "object" "{\"tool\":\"db.execute\",\"amount\":12.34}"
  expectValidateSerializeRoundtrip
  expectSignatureUsesCanonicalBytes
  IO.println "M3 serialization corpus passed"
  pure 0
