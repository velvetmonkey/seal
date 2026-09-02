/- SPDX-License-Identifier: Apache-2.0 -/
import SealV2.McpVersionGate

open SealV2.Effect

private def currentRevision := "2026-07-28"
private def legacyRevision := "2025-06-18"

private def requestWithParams (id : Nat) (params : String) : String :=
  "{\"jsonrpc\":\"2.0\",\"id\":" ++ toString id ++
    ",\"method\":\"tools/call\",\"params\":" ++ params ++ "}"

private def modernParams (revision : String) : String :=
  "{\"_meta\":{" ++
    "\"io.modelcontextprotocol/protocolVersion\":\"" ++ revision ++ "\"," ++
    "\"io.modelcontextprotocol/clientCapabilities\":{}}}"

private def modernRequest (id : Nat) (revision : String) : String :=
  requestWithParams id (modernParams revision)

private def invalidParamsResponse (id : Nat) (reason : String) : McpVersionGateDecision :=
  .reject <| "{\"error\":{\"code\":-32602,\"message\":\"Invalid params: " ++ reason ++
    "\"},\"id\":" ++ toString id ++ ",\"jsonrpc\":\"2.0\"}\n"

private def unsupportedVersionResponse (id : Nat) (revision : String) :
    McpVersionGateDecision :=
  .reject <| "{\"error\":{\"code\":-32022," ++
    "\"data\":{\"supportedVersions\":[\"2025-06-18\",\"2026-07-28\"]}," ++
    "\"message\":\"Unsupported protocol version: " ++ revision ++ "\"}," ++
    "\"id\":" ++ toString id ++ ",\"jsonrpc\":\"2.0\"}\n"

private structure GateCase where
  name : String
  actual : McpVersionGateDecision
  expected : McpVersionGateDecision
  greenDetail : String

private def cases : List GateCase := [
  {
    name := "POSITIVE"
    actual := mcpVersionGate (modernRequest 1 currentRevision) currentRevision
    expected := .continue
    greenDetail := "modern-request=continue"
  },
  {
    name := "MISSING-PARAMS"
    actual := mcpVersionGate
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\"}" currentRevision
    expected := invalidParamsResponse 2 "tools/call params object is missing"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "PARAMS-NOT-OBJECT"
    actual := mcpVersionGate (requestWithParams 3 "[]") currentRevision
    expected := invalidParamsResponse 3 "required _meta object is missing"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "MISSING-META"
    actual := mcpVersionGate (requestWithParams 4 "{}") currentRevision
    expected := invalidParamsResponse 4 "required _meta object is missing"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "META-NOT-OBJECT"
    actual := mcpVersionGate (requestWithParams 5 "{\"_meta\":[]}") currentRevision
    expected := invalidParamsResponse 5 "required _meta must be an object"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "MISSING-VERSION"
    actual := mcpVersionGate (requestWithParams 6
      "{\"_meta\":{\"io.modelcontextprotocol/clientCapabilities\":{}}}") currentRevision
    expected := invalidParamsResponse 6
      "required io.modelcontextprotocol/protocolVersion is missing"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "VERSION-NOT-STRING"
    actual := mcpVersionGate (requestWithParams 7
      "{\"_meta\":{\"io.modelcontextprotocol/protocolVersion\":7,\
        \"io.modelcontextprotocol/clientCapabilities\":{}}}") currentRevision
    expected := invalidParamsResponse 7
      "required io.modelcontextprotocol/protocolVersion must be a string"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "MISSING-CAPABILITIES"
    actual := mcpVersionGate (requestWithParams 8
      "{\"_meta\":{\"io.modelcontextprotocol/protocolVersion\":\"2026-07-28\"}}")
      currentRevision
    expected := invalidParamsResponse 8
      "required io.modelcontextprotocol/clientCapabilities is missing"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "CAPABILITIES-NOT-OBJECT"
    actual := mcpVersionGate (requestWithParams 9
      "{\"_meta\":{\"io.modelcontextprotocol/protocolVersion\":\"2026-07-28\",\
        \"io.modelcontextprotocol/clientCapabilities\":[]}}") currentRevision
    expected := invalidParamsResponse 9
      "required io.modelcontextprotocol/clientCapabilities must be an object"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "UNSUPPORTED-REVISION"
    actual := mcpVersionGate (modernRequest 10 "2099-01-01") currentRevision
    expected := unsupportedVersionResponse 10 "2099-01-01"
    greenDetail := "code=-32022 supportedVersions=[2025-06-18,2026-07-28]"
  },
  {
    name := "CURRENT-ENTRY-LEGACY-REQUEST"
    actual := mcpVersionGate (modernRequest 11 legacyRevision) currentRevision
    expected := invalidParamsResponse 11
      "request protocol version 2025-06-18 is inconsistent with selected session version 2026-07-28"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "LEGACY-ENTRY-CURRENT-REQUEST"
    actual := mcpVersionGate (modernRequest 12 currentRevision) legacyRevision
    expected := invalidParamsResponse 12
      "request protocol version 2026-07-28 is inconsistent with selected session version 2025-06-18"
    greenDetail := "code=-32602 exact-response=yes"
  },
  {
    name := "AMBIGUOUS-ERA"
    actual := mcpVersionGate (modernRequest 13 currentRevision) "ambiguous-era"
    expected := invalidParamsResponse 13 "session MCP era is ambiguous"
    greenDetail := "code=-32602 exact-response=yes"
  }
]

private def runCase (test : GateCase) : IO Bool := do
  if test.actual == test.expected then
    IO.println s!"M7 LEAN {test.name} GREEN {test.greenDetail}"
    pure true
  else
    IO.println s!"M7 LEAN {test.name} RED expected={repr test.expected} actual={repr test.actual}"
    pure false

def main : IO UInt32 := do
  let results ← cases.mapM runCase
  return if results.all id then 0 else 1
