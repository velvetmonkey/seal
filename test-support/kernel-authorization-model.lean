/- SPDX-License-Identifier: Apache-2.0 -/
import Ffi

/-!
Interpreted-Lean lane for the product authorization seam differential.

The Node harness supplies one trusted config payload and an ordered corpus of
the exact step envelopes sent to the shipped kernel. `#REINIT` gives each
authorization question a fresh session without compiling or linking Lean.
-/

open Ffi

namespace AuthorizationCorrespondence

open Lean

private def requireOk (value : Except String α) : IO α :=
  match value with
  | .ok result => pure result
  | .error message => throw (IO.userError s!"logical authorization corpus: {message}")

private def effect (value : Json) : IO (String × Json) := do
  let tool ← requireOk ((value.getObjVal? "tool") >>= Json.getStr?)
  if tool.isEmpty then throw (IO.userError "empty tool is outside the correspondence profile")
  let args := (value.getObjVal? "args").toOption.getD (Json.mkObj [])
  pure (tool, args)

private def policy (tool : String) : Seal.Policy := {
  approvalTtlMs := 120000, approvalFile := "product-adapter",
  tools := [{ name := tool, mode := .guarded, matcher := .always, target := [.fullArguments] }]
}

private def classifiedTarget (tool : String) (args : Json) : IO SealCore.TargetHash := do
  match (Seal.classifyToolCall (policy tool) tool args).toEvent with
  | .guarded target => pure target
  | _ => throw (IO.userError "intended guarded effect did not classify as guarded")

private def config (tool : String) : Json := Json.mkObj [
  ("epoch", toJson (1 : Nat)),
  ("safety", Json.mkObj [
    ("approval", Json.mkObj [("control_file", toJson "product-adapter"),
      ("ttl_seconds", toJson (120 : Nat))]),
    ("tools", toJson [Json.mkObj [("name", toJson tool), ("mode", toJson "guarded"),
      ("match", Json.mkObj [("type", toJson "always")]),
      ("target", toJson [Json.mkObj [("full_arguments", toJson true)]])]])]),
  ("temporal", Json.mkObj [("policies", toJson ([] : List Json))])]

def answer (input : Json) : IO Json := do
  let id ← requireOk ((input.getObjVal? "id") >>= Json.getStr?)
  let (issueTool, issueArgs) ← effect (← requireOk (input.getObjVal? "issued"))
  let (retryTool, retryArgs) ← effect (← requireOk (input.getObjVal? "retry"))
  let accepted ← requireOk ((input.getObjVal? "accepted") >>= Json.getBool?)
  let now ← requireOk ((input.getObjVal? "now") >>= Json.getNat?)
  let issuedTarget ← classifiedTarget issueTool issueArgs
  let retryTarget ← classifiedTarget retryTool retryArgs
  -- The optional wire spelling is only a representation input. It must decode
  -- to the logical retry effect and the synthetic ID, independently of any
  -- JavaScript verdict, target or receipt. This permits exact raw comparison
  -- while preserving the worker's binary64 wire-number spelling.
  let defaultLine := (Json.mkObj [("jsonrpc", toJson "2.0"), ("id", toJson (1 : Nat)),
    ("method", toJson "tools/call"),
    ("params", Json.mkObj [("name", toJson retryTool), ("arguments", retryArgs)])]).compress
  let wire := ((input.getObjVal? "retry_wire") >>= Json.getStr?).toOption.getD defaultLine
  let act ← match Host.classifyLine wire with
    | .act action => pure action
    | _ => throw (IO.userError s!"{id}: retry wire is not an admitted mediated call")
  unless act.tool == retryTool && act.argsJson.compress == retryArgs.compress &&
      act.requestId.compress == "1" do
    throw (IO.userError s!"{id}: retry wire differs from logical effect or synthetic ID")
  let events := if accepted then [SealCore.Event.approval issuedTarget (now + 120000)] else []
  let before := SealCore.run now SealCore.State.empty events
  let liveBefore := SealCore.live before retryTarget now
  let expectedRoute := if liveBefore then "forward" else "block"
  let approvals := if accepted then [Json.mkObj [("target", toJson issuedTarget.toHex)]] else []
  let envelope := (Json.mkObj [("line", toJson wire), ("now", toJson now),
    ("approvals", toJson approvals), ("votes", toJson ""), ("grants", toJson ""),
    ("forecasts", toJson "")]).compress
  let initialized ← requireOk (Json.parse (← modelInitFromTrustedPayload (config retryTool).compress))
  unless ((initialized.getObjVal? "ok") >>= Json.getBool?).toOption == some true do
    throw (IO.userError s!"{id}: oracle init failed: {initialized.compress}")
  let modelRaw ← modelStep envelope
  let decision ← requireOk (Json.parse modelRaw)
  let route ← requireOk ((decision.getObjVal? "route") >>= Json.getStr?)
  unless route == expectedRoute do
    throw (IO.userError s!"{id}: model route disagrees with independent live predicate")
  let auditText ← requireOk ((decision.getObjVal? "audit") >>= Json.getStr?)
  let audit ← requireOk (Json.parse auditText)
  let certs ← requireOk ((audit.getObjVal? "certs") >>= Json.getArr?)
  unless certs.any (fun cert => ((cert.getObjVal? "kernel") >>= Json.getStr?).toOption == some "safety") do
    throw (IO.userError s!"{id}: model omitted Safety")
  pure (Json.mkObj [
    ("id", toJson id), ("profile_admitted", toJson true),
    ("classified_issue_effect", Json.mkObj [("tool", toJson issueTool), ("args", issueArgs)]),
    ("classified_retry_effect", Json.mkObj [("tool", toJson retryTool), ("args", retryArgs)]),
    ("issued_target", toJson issuedTarget.toHex), ("retry_target", toJson retryTarget.toHex),
    ("guarded", toJson true), ("live_before", toJson liveBefore),
    ("expected_route", toJson expectedRoute), ("model_raw", toJson modelRaw),
    ("theorem_profile", toJson "Safety/always-guarded/full-arguments/ttl-120s/fresh-state/empty-Temporal"),
    ("model_input", toJson envelope)])

def run (corpusPath outputPath : String) : IO Unit := do
  let corpus ← IO.FS.readFile corpusPath
  let output ← IO.FS.Handle.mk outputPath IO.FS.Mode.write
  for line in corpus.splitOn "\n" do
    if line.trimAscii.toString.isEmpty then continue
    let input ← requireOk (Json.parse line)
    output.putStr ((← answer input).compress ++ "\n")
  output.flush

end AuthorizationCorrespondence

#eval show IO Unit from do
  let payloadPath := (← IO.getEnv "SEAL_SEAMDIFF_PAYLOAD").getD ""
  let corpusPath := (← IO.getEnv "SEAL_SEAMDIFF_CORPUS").getD ""
  let outputPath := (← IO.getEnv "SEAL_SEAMDIFF_OUTPUT").getD ""
  if (← IO.getEnv "SEAL_CORRESPONDENCE_LOGICAL").getD "" == "1" then
    AuthorizationCorrespondence.run corpusPath outputPath
    return ()
  let payload ← IO.FS.readFile payloadPath
  let mut revision := McpRevisionSelection.undetermined
  let initialise : IO Bool := do
    let result ← modelInitFromTrustedPayload payload
    if (result.splitOn "\"ok\":true").length == 1 then
      IO.eprintln s!"kernel-authorization-model: init failed: {result}"
      pure false
    else
      pure true
  if !(← initialise) then
    return ()
  let corpus ← IO.FS.readFile corpusPath
  let output ← IO.FS.Handle.mk outputPath IO.FS.Mode.write
  for line in corpus.splitOn "\n" do
    let input := line.trimAscii.toString
    if input.isEmpty then
      continue
    if input == "#REINIT" then
      if !(← initialise) then
        return ()
      revision := .undetermined
      continue
    let (decision, next) := gatePlanFor revision input
    revision := next
    let result ← match decision with
      | .continue => modelStep input
      | .reject _ => pure decision.toJson.compress
    output.putStr (result ++ "\n")
  output.flush
