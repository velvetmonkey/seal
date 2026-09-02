/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.GoldenPath
import SealV2.EffectEnvelope

/-!
# M.1 stage-2 `_meta` identity controls

The same raw request is parsed independently by the live stage-1 and V2
paths. Each accepted metadata value must:

* change the V2 typed target when one key changes;
* produce the same answer at stage 1 and V2 to "did identity change?";
* reach the envelope-derived effect with the same complete metadata value.
-/

open Lean Seal SealV2 SealV2.Effect

namespace Test.V2MetaIdentityControls

private structure Identity where
  stage1Target : String
  v2Target : Target
  envelopeMetadata : MetaValue
  deriving BEq

private structure KeyCase where
  name : String
  leftValue : String
  rightValue : String

private def v2State : ApprovalState :=
  { session := "meta-control"
    now := 0
    publicKey := ""
    manifestDigest := "meta-control-manifest"
    tools := [{ tool := "shell_exec", version := "v1", actions := ["run"] }]
    approvals := []
    policyVersion := "meta-control-policy" }

private def request (metaObject : Option String) : String :=
  "{\"method\":\"tools/call\",\"params\":{" ++
    "\"name\":\"shell_exec\",\"action\":\"run\"," ++
    "\"arguments\":{\"command\":\"echo controlled\"}" ++
    match metaObject with
    | none => "}}"
    | some rawMeta => ",\"_meta\":" ++ rawMeta ++ "}}"

private def oneKeyObject (key value : String) : String :=
  "{\"" ++ key ++ "\":" ++ value ++ "}"

private def identityFromRequest (raw : String) : Except String Identity := do
  if !Seal.JsonUtil.wireKeysSafe raw then
    throw "duplicate or escaped object key"

  let json ← Json.parse raw
  let some (tool, arguments, stage1Metadata) ← toolsCallWithMeta? json
    | throw "stage-1 fixture did not parse as tools/call"
  let stage1Event :=
    classifyToolCallWithMeta shellPolicy tool arguments stage1Metadata

  let some ast := SealV2.parse raw
    | throw "V2 fixture did not parse"
  let some v2Request := requestFromAst ast
    | throw "V2 fixture did not parse as tools/call"
  let some spec := findToolSpec v2State v2Request
    | throw "V2 fixture had no tool spec"
  let target := targetFor v2State v2Request spec

  unless MetaValue.ofStage1 stage1Metadata == v2Request.metadata do
    throw "CROSS-LAYER RED: stage-1 and V2 parsed different metadata values"

  let some claim := deriveEffect raw
    | throw "V2 envelope effect derivation failed"
  unless claim.metadata == target.metadata do
    throw "ENVELOPE RED: derived effect metadata differs from typed target"

  pure {
    stage1Target := stage1Event.targetText
    v2Target := target
    envelopeMetadata := claim.metadata
  }

private def keyCases : List KeyCase := [
  { name := "progressToken", leftValue := "1", rightValue := "2" },
  { name := "io.modelcontextprotocol/protocolVersion",
    leftValue := "\"2026-07-28\"", rightValue := "\"2025-06-18\"" },
  { name := "io.modelcontextprotocol/clientInfo",
    leftValue := "{\"name\":\"client\",\"version\":\"1\"}",
    rightValue := "{\"name\":\"client\",\"version\":\"2\"}" },
  { name := "io.modelcontextprotocol/clientCapabilities",
    leftValue := "{\"elicitation\":{}}", rightValue := "{\"sampling\":{}}" },
  { name := "io.modelcontextprotocol/logLevel",
    leftValue := "\"info\"", rightValue := "\"debug\"" },
  { name := "io.modelcontextprotocol/subscriptionId",
    leftValue := "\"subscription-a\"", rightValue := "\"subscription-b\"" },
  { name := "traceparent",
    leftValue :=
      "\"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01\"",
    rightValue :=
      "\"00-4bf92f3577b34da6a3ce929d0e0e4736-b7ad6b7169203331-01\"" },
  { name := "tracestate",
    leftValue := "\"vendor=value-a\"", rightValue := "\"vendor=value-b\"" },
  { name := "baggage",
    leftValue := "\"user=alice\"", rightValue := "\"user=bob\"" },
  { name := "io.modelcontextprotocol/serverInfo",
    leftValue := "{\"name\":\"server\",\"version\":\"1\"}",
    rightValue := "{\"name\":\"server\",\"version\":\"2\"}" },
  { name := "example.com/invocation",
    leftValue := "\"extension-a\"", rightValue := "\"extension-b\"" }
]

private def getIdentity (label raw : String) : IO Identity :=
  match identityFromRequest raw with
  | .ok identity => pure identity
  | .error reason => throw <| IO.userError s!"{label}: {reason}"

private def requireIdentityAndConsistency (case : KeyCase) : IO Unit := do
  let leftRaw := request (some (oneKeyObject case.name case.leftValue))
  let rightRaw := request (some (oneKeyObject case.name case.rightValue))
  let left ← getIdentity s!"{case.name} left" leftRaw
  let right ← getIdentity s!"{case.name} right" rightRaw
  let stage1Changed := left.stage1Target != right.stage1Target
  let v2Changed := left.v2Target != right.v2Target
  unless v2Changed do
    throw <| IO.userError
      s!"V2-IDENTITY-CHANGE RED key={case.name}: typed target ignored _meta mutation"
  unless stage1Changed == v2Changed do
    throw <| IO.userError
      s!"CROSS-LAYER RED key={case.name}: stage1.changed={stage1Changed} v2.changed={v2Changed}"
  IO.println s!"V2-IDENTITY-CHANGE GREEN key={case.name} typed-target=different"
  IO.println s!"CROSS-LAYER GREEN key={case.name} stage1.changed=true v2.changed=true"

private def requirePositiveTwin : IO Unit := do
  let raw := request (some (oneKeyObject "traceparent"
    "\"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01\""))
  let first ← getIdentity "positive twin first" raw
  let second ← getIdentity "positive twin second" raw
  unless first == second do
    throw <| IO.userError
      "V2-POSITIVE-TWIN RED: byte-identical requests produced different identities"
  IO.println "V2-POSITIVE-TWIN GREEN byte-identical typed-target=same envelope-meta=same"

private def requireAbsentVsEmpty : IO Unit := do
  let absent ← getIdentity "absent" (request none)
  let empty ← getIdentity "present empty" (request (some "{}"))
  let stage1Changed := absent.stage1Target != empty.stage1Target
  let v2Changed := absent.v2Target != empty.v2Target
  unless stage1Changed && v2Changed && stage1Changed == v2Changed do
    throw <| IO.userError
      "CROSS-LAYER RED key=absent-vs-empty: identities collapsed or disagreed"
  IO.println "V2-ABSENT-VS-EMPTY GREEN typed-target=different"
  IO.println "CROSS-LAYER GREEN key=absent-vs-empty stage1.changed=true v2.changed=true"

private def requireOrderNormalization : IO Unit := do
  let za ← getIdentity "metadata order z,a"
    (request (some "{\"z\":1,\"a\":{\"y\":2,\"b\":3}}"))
  let az ← getIdentity "metadata order a,z"
    (request (some "{\"a\":{\"b\":3,\"y\":2},\"z\":1}"))
  unless za.stage1Target == az.stage1Target && za.v2Target == az.v2Target do
    throw <| IO.userError
      "CROSS-LAYER RED key=member-order: stage-1/V2 normalization drift"
  IO.println "CROSS-LAYER GREEN key=member-order stage1.changed=false v2.changed=false"

private def stage1Accepts (raw : String) : Bool :=
  if !Seal.JsonUtil.wireKeysSafe raw then false
  else
    match Json.parse raw with
    | .error _ => false
    | .ok json =>
        match toolsCallWithMeta? json with
        | .ok (some _) => true
        | _ => false

private def v2Accepts (raw : String) : Bool :=
  match SealV2.parse raw with
  | some ast => (requestFromAst ast).isSome
  | none => false

private def requireSharedRejection : IO Unit := do
  for bad in ["null", "[]", "\"text\"", "false"] do
    let raw := request (some bad)
    if stage1Accepts raw || v2Accepts raw then
      throw <| IO.userError
        s!"CROSS-LAYER RED key=shape-{bad}: stage1.accepts={stage1Accepts raw} v2.accepts={v2Accepts raw}"
  let duplicate :=
    "{\"method\":\"tools/call\",\"params\":{" ++
      "\"name\":\"shell_exec\",\"action\":\"run\"," ++
      "\"arguments\":{\"command\":\"echo controlled\"}," ++
      "\"_meta\":{\"traceparent\":\"a\",\"traceparent\":\"b\"}}}"
  if stage1Accepts duplicate || v2Accepts duplicate then
    throw <| IO.userError
      s!"CROSS-LAYER RED key=duplicate: stage1.accepts={stage1Accepts duplicate} v2.accepts={v2Accepts duplicate}"
  IO.println "CROSS-LAYER SHAPE GREEN null/array/string/bool/duplicate rejected-by-both"

private def measureReplayNamespaces : IO Unit := do
  let count := 256
  let base : Target :=
    { tool := "shell_exec"
      action := "run"
      toolVersion := "v1"
      manifestDigest := "meta-control-manifest"
      arguments := .object [("command", .string "echo controlled")]
      metadata := .absent }
  let keys := (List.range count).map fun i =>
    (replayNamespace v2State {
      base with metadata := .present ("{\"sample\":" ++ toString i ++ "}") }).targetKey
  let distinct := keys.eraseDups.length
  unless distinct == count do
    throw <| IO.userError
      s!"REPLAY-NAMESPACE RED values={count} distinct={distinct}"
  IO.println s!"REPLAY-NAMESPACE MEASURED metadata-values={count} distinct-namespaces={distinct} multiplier=1"
  IO.println "REPLAY-NAMESPACE CLASSIFICATION conservative=reuse-isolated growth=linear authority-gated=true intrinsic-bound=false"

def run : IO Unit := do
  for case in keyCases do
    requireIdentityAndConsistency case
  requirePositiveTwin
  requireAbsentVsEmpty
  requireOrderNormalization
  requireSharedRejection
  measureReplayNamespaces

end Test.V2MetaIdentityControls

def main : IO Unit :=
  Test.V2MetaIdentityControls.run
