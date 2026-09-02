/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.GoldenPath

/-!
# M.1 stage-1 `_meta` identity controls

This executable watches the ruled property at both kernel identities:

* changing exactly one accepted `_meta` key changes the effect commitment and
  the guarded target;
* parsing the same byte-identical request twice produces the same identities;
* absent `_meta` and present-empty `_meta` do not collide.

It deliberately covers every core/trace key that this stage can construct,
plus an unknown extension key. Semantic per-key MCP validation belongs to the
protocol-validation lane; this stage consumes the complete structurally
validated object without projecting any key away.
-/

open Lean Seal

private structure Identity where
  effect : String
  target : String
  deriving BEq

private structure KeyCase where
  name : String
  leftValue : String
  rightValue : String

private def request (metaObject : Option String) : String :=
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{" ++
    "\"name\":\"shell_exec\",\"arguments\":{\"command\":\"echo controlled\"}" ++
    match metaObject with
    | none => "}}"
    | some rawMeta => ",\"_meta\":" ++ rawMeta ++ "}}"

private def identityFromRequest (raw : String) : Except String Identity := do
  if !Seal.JsonUtil.wireKeysSafe raw then
    throw "duplicate or escaped object key"
  let json ← Json.parse raw
  let some (tool, arguments, metadata) ← toolsCallWithMeta? json
    | throw "fixture did not parse as tools/call"
  let effect : Effect :=
    { server := shellPolicy.serverIdentity, tool, arguments, metadata }
  let event := classifyToolCallWithMeta shellPolicy tool arguments metadata
  pure { effect := effect.commitment, target := event.targetText }

private def oneKeyObject (key value : String) : String :=
  "{\"" ++ key ++ "\":" ++ value ++ "}"

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

private def requireIdentityChange (case : KeyCase) : IO Unit := do
  let leftRaw := request (some (oneKeyObject case.name case.leftValue))
  let rightRaw := request (some (oneKeyObject case.name case.rightValue))
  let left ← match identityFromRequest leftRaw with
    | .ok identity => pure identity
    | .error reason => throw <| IO.userError s!"{case.name} left fixture: {reason}"
  let right ← match identityFromRequest rightRaw with
    | .ok identity => pure identity
    | .error reason => throw <| IO.userError s!"{case.name} right fixture: {reason}"
  if left.effect == right.effect then
    throw <| IO.userError
      s!"IDENTITY-CHANGE RED ({case.name}): effect commitment ignored _meta mutation"
  if left.target == right.target then
    throw <| IO.userError
      s!"IDENTITY-CHANGE RED ({case.name}): guard target ignored _meta mutation"
  IO.println s!"IDENTITY-CHANGE GREEN key={case.name} commitment=different target=different"

private def requirePositiveTwin : IO Unit := do
  let raw := request (some (oneKeyObject "traceparent"
    "\"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01\""))
  let first ← match identityFromRequest raw with
    | .ok identity => pure identity
    | .error reason => throw <| IO.userError reason
  let second ← match identityFromRequest raw with
    | .ok identity => pure identity
    | .error reason => throw <| IO.userError reason
  unless first == second do
    throw <| IO.userError
      "POSITIVE-TWIN RED: byte-identical requests produced different identities"
  IO.println "POSITIVE-TWIN GREEN byte-identical commitment=same target=same"

private def requireAbsentVsEmpty : IO Unit := do
  let absent ← match identityFromRequest (request none) with
    | .ok identity => pure identity
    | .error reason => throw <| IO.userError reason
  let empty ← match identityFromRequest (request (some "{}")) with
    | .ok identity => pure identity
    | .error reason => throw <| IO.userError reason
  if absent.effect == empty.effect then
    throw <| IO.userError
      "ABSENT-VS-EMPTY RED: effect commitment collapsed absent and present-empty"
  if absent.target == empty.target then
    throw <| IO.userError
      "ABSENT-VS-EMPTY RED: guard target collapsed absent and present-empty"
  IO.println "ABSENT-VS-EMPTY GREEN commitment=different target=different"

private def requireNonObjectRejected : IO Unit := do
  for bad in ["null", "[]", "\"text\"", "false"] do
    match identityFromRequest (request (some bad)) with
    | .error _ => pure ()
    | .ok _ =>
        throw <| IO.userError s!"META-SHAPE RED: accepted non-object _meta {bad}"
  IO.println "META-SHAPE GREEN null/array/string/bool=rejected"

private def requireDuplicateRejected : IO Unit := do
  let duplicateMember :=
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{" ++
      "\"name\":\"shell_exec\",\"arguments\":{\"command\":\"echo controlled\"}," ++
      "\"_meta\":{\"traceparent\":\"a\",\"traceparent\":\"b\"}}}"
  let duplicateMeta :=
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{" ++
      "\"name\":\"shell_exec\",\"arguments\":{\"command\":\"echo controlled\"}," ++
      "\"_meta\":{},\"_meta\":{}}}"
  for bad in [duplicateMember, duplicateMeta] do
    match identityFromRequest bad with
    | .error _ => pure ()
    | .ok _ =>
        throw <| IO.userError "META-DUPLICATE RED: duplicate metadata reached identity"
  IO.println "META-DUPLICATE GREEN duplicate-_meta/member=rejected-before-parse"

def main : IO Unit := do
  for case in keyCases do
    requireIdentityChange case
  requirePositiveTwin
  requireAbsentVsEmpty
  requireNonObjectRejected
  requireDuplicateRejected
