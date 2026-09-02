/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import Seal.JsonUtil
import SealV2.EffectEnvelope
/-! The single authority for M.7 request admissibility and error rendering. -/
namespace SealV2.Effect
open Lean

private def protocolVersionKey := "io.modelcontextprotocol/protocolVersion"

private def clientCapabilitiesKey := "io.modelcontextprotocol/clientCapabilities"

inductive McpVersionGateDecision where
  | continue
  | reject (response : String)
  deriving Repr, BEq

private def requestId (request : Json) : Json := (request.getObjVal? "id").toOption.getD Json.null

private def errorResponse (id : Json) (code : Int) (message : String)
    (data : Option Json := none) : String :=
  let errorFields :=
    [("code", Json.num code), ("message", Json.str message)] ++
      (match data with | some value => [("data", value)] | none => [])
  (Json.mkObj [
    ("jsonrpc", Json.str "2.0"), ("id", id), ("error", Json.mkObj errorFields)
  ]).compress ++ "\n"

private def invalidParams (id : Json) (reason : String) : McpVersionGateDecision :=
  .reject (errorResponse id (-32602) s!"Invalid params: {reason}")

private def unsupportedVersion (id : Json) (requested : String) : McpVersionGateDecision :=
  .reject <| errorResponse id (-32022)
    s!"Unsupported protocol version: {requested}"
    (some <| Json.mkObj [
      ("supportedVersions", Json.arr (mcpDiscoverySupportedRevisionStrings.toArray.map Json.str))
    ])

private def objectField? (json : Json) (key : String) : Option Json :=
  (json.getObjVal? key).toOption

private def requireField (id parent : Json) (key reason : String) :
    Except McpVersionGateDecision Json :=
  match objectField? parent key with
  | some value => .ok value
  | none => .error (invalidParams id reason)

private def validateModernMetadata (id params : Json) :
    Except McpVersionGateDecision String := do
  let metadataJson ← requireField id params "_meta" "required _meta object is missing"
  let _ ← metadataJson.getObj?.mapError fun _ =>
    invalidParams id "required _meta must be an object"
  let revisionJson ← requireField id metadataJson protocolVersionKey
    s!"required {protocolVersionKey} is missing"
  let revision ← revisionJson.getStr?.mapError fun _ =>
    invalidParams id s!"required {protocolVersionKey} must be a string"
  let capabilities ← requireField id metadataJson clientCapabilitiesKey
    s!"required {clientCapabilitiesKey} is missing"
  let _ ← capabilities.getObj?.mapError fun _ =>
    invalidParams id s!"required {clientCapabilitiesKey} must be an object"
  pure revision

private def hasModernMarker (params : Json) : Bool :=
  match objectField? params "_meta" with
  | some metadataJson =>
      (objectField? metadataJson protocolVersionKey).isSome ||
        (objectField? metadataJson clientCapabilitiesKey).isSome
  | none => false

private def validateRevision (id : Json) (selectedRevision : String)
    (revision : String) : McpVersionGateDecision :=
  if !mcpDiscoverySupportedRevisionStrings.contains revision then
    unsupportedVersion id revision
  else if !selectedRevision.isEmpty && revision != selectedRevision then
    invalidParams id
      s!"request protocol version {revision} is inconsistent with selected session version {selectedRevision}"
  else
    .continue

/-- Empty selection invents no default: declared modern metadata is validated,
    while an undeclared request remains compatible with pre-entry legacy use. -/
def mcpVersionGate (line selectedRevision : String) : McpVersionGateDecision :=
  if !Seal.JsonUtil.wireKeysSafe line then
    -- The raw-key classifier refuses this before authority.
    .continue
  else
    match Json.parse line with
    | .error _ => .continue
    | .ok request =>
        if (objectField? request "method" >>= (·.getStr?.toOption)) != some "tools/call" then
          .continue
        else
          let id := requestId request
          match objectField? request "params" with
          | none => invalidParams id "tools/call params object is missing"
          | some params =>
              let legacy := McpAdapterRevision.legacy2025_06_18.version
              let current := McpAdapterRevision.current2026_07_28.version
              if !selectedRevision.isEmpty && selectedRevision != legacy &&
                  selectedRevision != current then
                invalidParams id "session MCP era is ambiguous"
              else if (selectedRevision.isEmpty || selectedRevision == legacy) &&
                  !hasModernMarker params then
                .continue
              else
                match validateModernMetadata id params with
                | .error decision => decision
                | .ok revision => validateRevision id selectedRevision revision

def McpVersionGateDecision.toJson : McpVersionGateDecision → Json
  | .continue => Json.mkObj [("route", Json.str "continue")]
  | .reject response =>
      Json.mkObj [("route", Json.str "reject"), ("response", Json.str response)]

end SealV2.Effect
