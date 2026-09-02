/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Lean.Data.Json

/-!
# FFI surface — the verified v2 core, exported to the Rust host (M7)

The Rust host owns transport (raw bytes in/out), approver-key custody, and the
wall clock; it serialises every call (single mediation thread + a Mutex) — that
serialisation IS assumption A4. Lean owns everything decision-bearing: the
verified `parse`/`validate`/`decide`/`serialize`, the M5 Ed25519 verify leaf, and
the M6 lifecycle consume over `listReplayStore`. The seam is string-in/string-out
JSON — no structs cross the boundary.

The consumed-nonce store lives in `stateRef.consumedNonces` below as the literal
`listReplayStore` — mutated ONLY via `validateAndConsumeWithStore listReplayStore`.
So the M6 invariants apply to the DEPLOYED store: **A5 discharged for the live
process** (no separate store to refine). Residual A4 (the host Mutex, which makes
read→consume→write atomic) and A6 (cross-restart durability — `stateRef` is
in-memory). TCB (A3) grows to cover the Rust transport + C ABI + JSON marshalling
+ approver-key custody (see v2/milestones/07-host/NOTES.md).

Threading: these exports are NOT thread-safe; the Rust host serialises calls (A4).
-/

namespace Ffi

open SealV2
open Lean

/-- The session: the v2 `ApprovalState`, including the consumed-nonce store. -/
initialize stateRef : IO.Ref (Option ApprovalState) ← IO.mkRef none

private def errJson (msg : String) : String :=
  (Json.mkObj [("ok", Json.bool false), ("error", Json.str msg)]).compress

private def okJson : String :=
  (Json.mkObj [("ok", Json.bool true)]).compress

private def decisionJson (decision : String) (out : Option String) : String :=
  let base := [("ok", Json.bool true), ("decision", Json.str decision)]
  let fields := match out with
    | some o => base ++ [("out", Json.str o)]
    | none => base
  (Json.mkObj fields).compress

/-! ## Config / tool-spec marshalling (host CONTROL only — A3 glue, not the security parser) -/

private def parseToolSpec (j : Json) : Except String ToolSpec := do
  let tool ← (← j.getObjVal? "tool").getStr?
  let version ← (← j.getObjVal? "version").getStr?
  let actionsArr ← (← j.getObjVal? "actions").getArr?
  let actions ← actionsArr.toList.mapM (fun a => a.getStr?)
  pure { tool, version, actions }

private def parseConfig (j : Json) : Except String ApprovalState := do
  let session ← (← j.getObjVal? "session").getStr?
  let publicKey ← (← j.getObjVal? "publicKey").getStr?
  let manifestDigest ← (← j.getObjVal? "manifestDigest").getStr?
  let policyVersion ← (← j.getObjVal? "policyVersion").getStr?
  let maxTtl ← (← j.getObjVal? "maxApprovalTtl").getNat?
  let toolsArr ← (← j.getObjVal? "tools").getArr?
  let tools ← toolsArr.toList.mapM parseToolSpec
  pure {
    session, now := 0, publicKey, manifestDigest, tools,
    approvals := [], policyVersion, maxApprovalTtl := maxTtl, consumedNonces := []
  }

/-! ## Exports -/

/-- Initialise the session from a config JSON envelope. Fail-closed: no session on
    any parse failure. -/
private def initImpl (configText : String) : IO String := do
  match Json.parse configText with
  | .error e => pure (errJson s!"config json: {e}")
  | .ok j =>
      match parseConfig j with
      | .error e => pure (errJson s!"config: {e}")
      | .ok st => stateRef.set (some st); pure okJson

/-- Inject an approval token the host received off-band, given its canonical
    signed-message bytes + hex signature. The `Approval` is reconstructed via the
    VERIFIED `signedParse` + `signedMessageFromAst?` (no hand-rolled AST parsing);
    the signature is checked later by `decide` through the M5 ed25519 leaf. -/
private def addApprovalImpl (rawSigned sigHex : String) : IO String := do
  match ← stateRef.get with
  | none => pure (errJson "not initialized")
  | some st =>
      match signedParse rawSigned with
      | none => pure (errJson "signed message not canonical")
      | some ast =>
          match signedMessageFromAst? ast.val with
          | none => pure (errJson "signed message shape invalid")
          | some sm =>
              let approval : Approval := {
                target := sm.target, session := sm.session,
                issuedAt := sm.issuedAt, expiresAt := sm.expiry, consumed := false,
                signedMessageRaw := rawSigned, signature := sigHex, nonce := sm.nonce
              }
              stateRef.set (some { st with approvals := st.approvals ++ [approval] })
              pure okJson

/-- Mediate one raw request at clock `nowText`. Runs the verified
    `parse → validateAndConsumeWithStore listReplayStore → serialize` over the
    session store; on Allow the consumed store is written back (single-use). The
    raw request goes through the verified M1 parser — the JSON seam is host
    control only, never the security parser. -/
private def decideImpl (rawRequest nowText : String) : IO String := do
  match ← stateRef.get with
  | none => pure (errJson "not initialized")
  | some st0 =>
      let st := { st0 with now := (nowText.toNat?).getD st0.now }
      match parse rawRequest with
      | none => pure (decisionJson "Block" none)
      | some ast =>
          match validateAndConsumeWithStore listReplayStore st.consumedNonces ast st with
          | none => pure (decisionJson "Block" none)
          | some (store', checked) =>
              stateRef.set (some { st with consumedNonces := store' })
              pure (decisionJson "Allow" (some (serialize checked)))

/-- Mint the canonical signed-message bytes for a pending approval challenge, via the
    VERIFIED serializer. Given a raw request + chosen issuedAt/expiry/nonce, build the
    bound `Target` (verified `parse → requestFromAst → findToolSpec → targetFor`) and
    return `signedMessageRawFor` (= `serializeAst (signedMessageAst …)`). STATELESS — does
    not touch the store. This is the ONLY sanctioned source of the canonical bytes the
    off-box signer signs (rule 3: those bytes are never re-encoded in glue). -/
private def challengeImpl (rawRequest issuedAtText expiryText nonceHex : String) : IO String := do
  match ← stateRef.get with
  | none => pure (errJson "not initialized")
  | some st =>
      match parse rawRequest with
      | none => pure (errJson "parse failed")
      | some ast =>
          match requestFromAst ast with
          | none => pure (errJson "not a tools/call request")
          | some req =>
              match findToolSpec st req with
              | none => pure (errJson "no matching tool/action")
              | some spec =>
                  if h : isCanonicalNonceString nonceHex = true then
                    let msg : SignedMessage := {
                      target := targetFor st req spec, session := st.session,
                      issuedAt := (issuedAtText.toNat?).getD 0,
                      expiry := (expiryText.toNat?).getD 0,
                      nonce := { value := nonceHex, canonical := h }
                    }
                    pure (Json.mkObj [("ok", Json.bool true),
                      ("signed_bytes", Json.str (signedMessageRawFor msg))]).compress
                  else
                    pure (errJson "nonce must be 64 lowercase hex chars")

/-- Bring-up echo (kept for the FFI self-test). -/
private def echoImpl (s : String) : IO String := pure s

/-- Bring-up crypto probe (kept for the FFI self-test): proves the ed25519 leaf
    resolves through the `-shared` link, via the M5 verify. -/
private def cryptoProbeImpl (pkHex msg sigHex : String) : IO String := do
  let ok := match hexDecode? pkHex, hexDecode? sigHex with
    | some pk, some sig => ed25519Verify pk msg.toUTF8 sig
    | _, _ => false
  pure (Json.mkObj [("ok", Json.bool true), ("verified", Json.bool ok)]).compress

@[export seal_v2_init]
unsafe def sealV2Init (configText : String) : String :=
  unsafeBaseIO <| (initImpl configText).catchExceptions (fun e => pure (errJson (toString e)))

@[export seal_v2_add_approval]
unsafe def sealV2AddApproval (rawSigned sigHex : String) : String :=
  unsafeBaseIO <| (addApprovalImpl rawSigned sigHex).catchExceptions (fun e => pure (errJson (toString e)))

@[export seal_v2_decide]
unsafe def sealV2Decide (rawRequest nowText : String) : String :=
  unsafeBaseIO <| (decideImpl rawRequest nowText).catchExceptions (fun e => pure (errJson (toString e)))

@[export seal_v2_challenge]
unsafe def sealV2Challenge (rawRequest issuedAt expiry nonceHex : String) : String :=
  unsafeBaseIO <| (challengeImpl rawRequest issuedAt expiry nonceHex).catchExceptions (fun e => pure (errJson (toString e)))

@[export seal_v2_echo]
unsafe def sealV2Echo (s : String) : String :=
  unsafeBaseIO <| (echoImpl s).catchExceptions (fun e => pure (errJson (toString e)))

@[export seal_v2_crypto_probe]
unsafe def sealV2CryptoProbe (pkHex msg sigHex : String) : String :=
  unsafeBaseIO <| (cryptoProbeImpl pkHex msg sigHex).catchExceptions (fun e => pure (errJson (toString e)))

end Ffi

/-- Unused: present so the Ffi lib elaborates as a runnable module if needed. -/
def main : IO Unit := pure ()
