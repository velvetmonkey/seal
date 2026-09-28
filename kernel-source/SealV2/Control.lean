/- SPDX-License-Identifier: Apache-2.0 -/
import SealV2.Validation
import Lean.Data.Json

namespace SealV2.Control
open Lean

/-- Plain authenticated configuration; contains no request or approval witness. -/
structure Config where
  session : String
  publicKey : String
  manifestDigest : String
  policyVersion : String
  maxApprovalTtl : Nat
  tools : List ToolSpec
  deriving Repr

def Config.toState (config : Config) : ApprovalState := {
  session := config.session
  publicKey := config.publicKey
  manifestDigest := config.manifestDigest
  policyVersion := config.policyVersion
  maxApprovalTtl := config.maxApprovalTtl
  tools := config.tools
  now := 0
  approvals := []
}

/-- Decode host control input, never request-derived tool specifications. -/
def parseToolSpec (j : Json) : Except String ToolSpec := do
  let fields ← j.getObj?
  if fields.toList.any (fun (key, _) => !["tool", "version", "actions"].contains key) then
    throw "unknown ToolSpec field"
  let tool ← (← j.getObjVal? "tool").getStr?
  let version ← (← j.getObjVal? "version").getStr?
  let actions ← (← (← j.getObjVal? "actions").getArr?).toList.mapM (·.getStr?)
  pure { tool, version, actions }

/-- The signed host-control configuration carries exactly one tool list. -/
def parseConfig (j : Json) : Except String Config := do
  let fields ← j.getObj?
  if fields.toList.any (fun (key, _) =>
      !["session", "publicKey", "manifestDigest", "policyVersion", "maxApprovalTtl", "tools"].contains key) then
    throw "unknown authorization configuration field"
  let session ← (← j.getObjVal? "session").getStr?
  let publicKey ← (← j.getObjVal? "publicKey").getStr?
  let manifestDigest ← (← j.getObjVal? "manifestDigest").getStr?
  let policyVersion ← (← j.getObjVal? "policyVersion").getStr?
  let maxApprovalTtl ← (← j.getObjVal? "maxApprovalTtl").getNat?
  let tools ← (← (← j.getObjVal? "tools").getArr?).toList.mapM parseToolSpec
  pure {
    session := session
    publicKey := publicKey
    manifestDigest := manifestDigest
    policyVersion := policyVersion
    maxApprovalTtl := maxApprovalTtl
    tools := tools
  }

/-- Reconstruct the approval exclusively with the existing signed parser. -/
def parseApproval (j : Json) : Except String Approval := do
  let raw ← (← j.getObjVal? "signedMessage").getStr?
  let signature ← (← j.getObjVal? "signature").getStr?
  let some ast := signedParse raw | throw "signed message not canonical"
  let some sm := signedMessageFromAst? ast.val | throw "signed message shape invalid"
  pure {
    target := sm.target
    session := sm.session
    issuedAt := sm.issuedAt
    expiresAt := sm.expiry
    consumed := false
    signedMessageRaw := raw
    signature := signature
    nonce := sm.nonce
  }

/-- Canonical challenge bytes from one configured state and the shared resolver. -/
def challenge (state : ApprovalState) (raw : RawBytes)
    (issuedAt expiry : Nat) (nonceHex : String) : Option String := do
  let ast ← parse raw
  let request ← requestFromAst ast state.tools
  let spec ← findToolSpec state request
  if h : isCanonicalNonceString nonceHex = true then
    pure (signedMessageRawFor {
      target := targetFor state request spec, session := state.session,
      issuedAt, expiry, nonce := { value := nonceHex, canonical := h } })
  else none
end SealV2.Control
