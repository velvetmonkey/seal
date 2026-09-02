/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.GoldenPath
import SealV2.EffectEnvelope

/-!
# M.4 stage-2 MRTR identity controls

Each comparison first runs both byte-identical positive twins. The observer
then checks Stage-A commitment/V2-target agreement, target keys, signed
approval equality, replay namespaces, canonical approval messages, and signed
effect-envelope messages.
-/

open Lean Seal

namespace Test.V2MrtrIdentityControls

private structure Identity where
  stage1Commitment : String
  v2Target : SealV2.Target
  targetKey : String
  approval : SealV2.Approval
  replay : SealV2.ReplayNamespace
  signedApprovalMessage : String
  envelopeClaim : SealV2.Effect.EffectClaim
  signedEnvelopeMessage : ByteArray
  deriving BEq

private def v2State : SealV2.ApprovalState :=
  { session := "mrtr-control"
    now := 10
    publicKey := "mrtr-control-key"
    manifestDigest := "mrtr-control-manifest"
    tools := [{
      tool := "shell_exec", version := "v1", actions := ["run"]
    }]
    approvals := []
    policyVersion := "mrtr-control-policy" }

private def nonce : SealV2.Nonce :=
  { value := String.ofList (List.replicate 64 'a'), canonical := by decide }

private def request (requestState inputResponses : Option String) : String :=
  "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{" ++
    "\"name\":\"shell_exec\",\"action\":\"run\"," ++
    "\"arguments\":{\"command\":\"echo controlled\"}" ++
    (requestState.map (fun raw => ",\"requestState\":" ++ raw)).getD "" ++
    (inputResponses.map (fun raw => ",\"inputResponses\":" ++ raw)).getD "" ++
    "}}"

private def approvalFor (target : SealV2.Target) : SealV2.Approval :=
  let message : SealV2.SignedMessage := {
    target, session := v2State.session, issuedAt := 0, expiry := 120, nonce
  }
  {
    target
    session := v2State.session
    issuedAt := 0
    expiresAt := 120
    consumed := false
    signedMessageRaw := SealV2.signedMessageRawFor message
    signature := ""
    nonce
  }

private def envelopeFor
    (claim : SealV2.Effect.EffectClaim) : SealV2.Effect.EffectEnvelope :=
  {
    keyId := "mrtr-control"
    nonce := ByteArray.mk (Array.range 32 |>.map UInt8.ofNat)
    issuedAt := 10
    expiresAt := 120
    line := "{}"
    adapterType := "mcp"
    adapterVersion := "2026-07-28"
    session := v2State.session
    policyVersion := v2State.policyVersion
    effect := some claim
  }

private def authority : ByteArray :=
  ByteArray.mk (Array.range 32 |>.map fun i => UInt8.ofNat (160 + i))

private def identityFromRequest (raw : String) : Except String Identity := do
  if !Seal.JsonUtil.wireKeysSafe raw then
    throw "duplicate or escaped object key"

  let json ← Json.parse raw
  let some (tool, arguments, metadata, requestState, inputResponses) ←
      toolsCallWithContext? json
    | throw "Stage A did not parse fixture as tools/call"
  let effect : Seal.Effect :=
    { server := shellPolicy.serverIdentity, tool, arguments, metadata,
      requestState, inputResponses }

  let some ast := SealV2.parse raw
    | throw "V2 parser rejected fixture"
  let some req := SealV2.requestFromAst ast
    | throw "V2 did not parse fixture as tools/call"
  let some spec := SealV2.findToolSpec v2State req
    | throw "V2 tool lookup rejected fixture"
  let target := SealV2.targetFor v2State req spec
  let approval := approvalFor target
  let some claim := SealV2.Effect.deriveEffect raw
    | throw "signed effect derivation rejected fixture"

  pure {
    stage1Commitment := effect.commitment
    v2Target := target
    targetKey := SealV2.serializeTargetKey target
    approval
    replay := SealV2.replayNamespace v2State target
    signedApprovalMessage := approval.signedMessageRaw
    envelopeClaim := claim
    signedEnvelopeMessage :=
      SealV2.Effect.effectMessage authority (envelopeFor claim)
  }

private def checkedIdentity (label raw : String) : IO Identity := do
  match identityFromRequest raw with
  | .ok identity => pure identity
  | .error reason => throw <| IO.userError s!"{label}: {reason}"

private def requireTwin (label raw : String) : IO Identity := do
  let first ← checkedIdentity s!"{label}.twin-left" raw
  let second ← checkedIdentity s!"{label}.twin-right" raw
  unless first == second do
    throw <| IO.userError
      s!"V2-MRTR-POSITIVE-TWIN RED field={label}: byte-identical requests differed"
  IO.println
    s!"V2-MRTR-POSITIVE-TWIN GREEN field={label} byte-identical commitment=target=key=approval=replay=signature-messages=same"
  pure first

private def requireDifferent (field : String) (left right : Identity) : IO Unit := do
  let stage1Changed := left.stage1Commitment != right.stage1Commitment
  let v2Changed := left.v2Target != right.v2Target
  unless stage1Changed == v2Changed do
    throw <| IO.userError
      s!"CROSS-LAYER RED field={field}: stage1.changed={stage1Changed} v2.changed={v2Changed}"
  unless v2Changed do
    throw <| IO.userError
      s!"V2-MRTR-DISCRIMINATION RED field={field}: typed target ignored mutation"
  unless left.envelopeClaim.requestState == left.v2Target.requestState &&
      right.envelopeClaim.requestState == right.v2Target.requestState do
    throw <| IO.userError
      "ENVELOPE RED field=requestState: claim differs from typed target"
  unless left.envelopeClaim.inputResponses == left.v2Target.inputResponses &&
      right.envelopeClaim.inputResponses == right.v2Target.inputResponses do
    throw <| IO.userError
      "ENVELOPE RED field=inputResponses: claim differs from typed target"
  unless left.targetKey != right.targetKey do
    throw <| IO.userError
      s!"V2-MRTR-TARGET-KEY RED field={field}: keys collided"
  unless left.approval != right.approval do
    throw <| IO.userError
      s!"V2-MRTR-APPROVAL-EQUALITY RED field={field}: approvals compared equal"
  unless left.replay != right.replay do
    throw <| IO.userError
      s!"V2-MRTR-REPLAY RED field={field}: namespaces collided"
  unless left.signedApprovalMessage != right.signedApprovalMessage do
    throw <| IO.userError
      s!"V2-MRTR-SIGNATURE-MESSAGE RED field={field}: approval bytes collided"
  unless left.envelopeClaim != right.envelopeClaim &&
      left.signedEnvelopeMessage != right.signedEnvelopeMessage do
    throw <| IO.userError
      s!"V2-MRTR-ENVELOPE RED field={field}: signed effect shape ignored mutation"
  IO.println
    s!"V2-MRTR-DISCRIMINATION GREEN field={field} typed-target=target-key=approval=replay=signature-messages=different"
  IO.println
    s!"CROSS-LAYER GREEN field={field} stage1.commitment.changed=true v2.target.changed=true"

private def requireFieldChange (field leftRaw rightRaw : String) : IO Unit := do
  let left ← requireTwin s!"{field}.left" leftRaw
  let right ← requireTwin s!"{field}.right" rightRaw
  requireDifferent field left right

private def allPairwiseDifferent [BEq α] : List α → Bool
  | [] => true
  | head :: tail => tail.all (· != head) && allPairwiseDifferent tail

private def requireAbsenceEmptyNull (field : String)
    (raws : List (String × String)) : IO Unit := do
  let identities ← raws.mapM fun (shape, raw) =>
    requireTwin s!"{field}.{shape}" raw
  unless identities.all (fun identity =>
      identity.envelopeClaim.requestState == identity.v2Target.requestState &&
      identity.envelopeClaim.inputResponses == identity.v2Target.inputResponses) do
    throw <| IO.userError
      s!"ENVELOPE RED field={field}: claim differs from typed target"
  unless allPairwiseDifferent (identities.map (·.stage1Commitment)) &&
      allPairwiseDifferent (identities.map (·.v2Target)) &&
      allPairwiseDifferent (identities.map (·.targetKey)) &&
      allPairwiseDifferent (identities.map (·.approval)) &&
      allPairwiseDifferent (identities.map (·.replay)) &&
      allPairwiseDifferent (identities.map (·.signedApprovalMessage)) &&
      allPairwiseDifferent (identities.map (·.signedEnvelopeMessage)) do
    throw <| IO.userError
      s!"V2-MRTR-ABSENCE RED field={field}: absent/present-empty/present-null collapsed"
  IO.println
    s!"V2-MRTR-ABSENCE GREEN field={field} absent/present-empty/present-null=three-distinct-typed-and-signed-identities"
  IO.println
    s!"CROSS-LAYER GREEN field={field}.absence stage1.commitment.changed=true v2.target.changed=true"

def run : IO Unit := do
  requireFieldChange "requestState"
    (request (some "\"opaque-state-a\"") none)
    (request (some "\"opaque-state-b\"") none)
  requireFieldChange "inputResponses"
    (request none (some "{\"confirm\":{\"action\":\"accept\",\"content\":true}}"))
    (request none (some "{\"confirm\":{\"action\":\"decline\"}}"))
  requireAbsenceEmptyNull "requestState" [
    ("absent", request none none),
    ("present-empty", request (some "{}") none),
    ("present-null", request (some "null") none)
  ]
  requireAbsenceEmptyNull "inputResponses" [
    ("absent", request none none),
    ("present-empty", request none (some "{}")),
    ("present-null", request none (some "null"))
  ]

end Test.V2MrtrIdentityControls

def main : IO Unit :=
  Test.V2MrtrIdentityControls.run
