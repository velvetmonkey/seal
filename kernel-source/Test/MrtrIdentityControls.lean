/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.GoldenPath

/-!
# M.4 stage-1 MRTR identity controls

These controls watch both kernel identities and the fail-closed mediation
floor. Every discrimination has a byte-identical positive twin.
-/

open Lean Seal SealCore

private structure Identity where
  effect : String
  target : String
  event : Event
  deriving BEq

private def request (id : Nat) (requestState inputResponses : Option String) :
    String :=
  "{\"jsonrpc\":\"2.0\",\"id\":" ++ toString id ++
    ",\"method\":\"tools/call\",\"params\":{" ++
    "\"name\":\"shell_exec\",\"arguments\":{\"command\":\"echo controlled\"}" ++
    (requestState.map (fun raw => ",\"requestState\":" ++ raw)).getD "" ++
    (inputResponses.map (fun raw => ",\"inputResponses\":" ++ raw)).getD "" ++
    "}}"

private def identityFromRequest (raw : String) : Except String Identity := do
  if !Seal.JsonUtil.wireKeysSafe raw then
    throw "duplicate or escaped object key"
  let json ← Json.parse raw
  let some (tool, arguments, metadata, requestState, inputResponses) ←
      toolsCallWithContext? json
    | throw "fixture did not parse as tools/call"
  let effect : Effect :=
    { server := shellPolicy.serverIdentity, tool, arguments, metadata,
      requestState, inputResponses }
  let event :=
    classifyToolCallWithContext shellPolicy tool arguments metadata requestState
      inputResponses
  pure
    { effect := effect.commitment, target := event.targetText,
      event := event.toEvent }

private def checkedIdentity (label raw : String) : IO Identity := do
  match identityFromRequest raw with
  | .ok identity => pure identity
  | .error reason => throw <| IO.userError s!"{label}: {reason}"

private def requireTwin (label raw : String) : IO Identity := do
  let first ← checkedIdentity s!"{label} twin-left" raw
  let second ← checkedIdentity s!"{label} twin-right" raw
  unless first == second do
    throw <| IO.userError
      s!"MRTR-POSITIVE-TWIN RED field={label}: byte-identical requests differed"
  IO.println
    s!"MRTR-POSITIVE-TWIN GREEN field={label} byte-identical commitment=same target=same"
  pure first

private def requireFieldChange
    (field leftRaw rightRaw : String) : IO Unit := do
  let left ← requireTwin s!"{field}.left" leftRaw
  let right ← requireTwin s!"{field}.right" rightRaw
  if left.effect == right.effect then
    throw <| IO.userError
      s!"MRTR-DISCRIMINATION RED field={field}: effect commitment ignored {field}"
  if left.target == right.target then
    throw <| IO.userError
      s!"MRTR-DISCRIMINATION RED field={field}: guard target ignored {field}"
  IO.println
    s!"MRTR-DISCRIMINATION GREEN field={field} commitment=different target=different"

private def allPairwiseDifferent (values : List String) : Bool :=
  match values with
  | [] => true
  | head :: tail =>
      tail.all (· != head) && allPairwiseDifferent tail

private def requireAbsenceEmptyNull (field : String)
    (raws : List (String × String)) : IO Unit := do
  let identities ← raws.mapM fun (shape, raw) =>
    requireTwin s!"{field}.{shape}" raw
  unless allPairwiseDifferent (identities.map (·.effect)) do
    throw <| IO.userError
      s!"MRTR-ABSENCE RED field={field}: absent/present-empty/present-null effect commitments collided"
  unless allPairwiseDifferent (identities.map (·.target)) do
    throw <| IO.userError
      s!"MRTR-ABSENCE RED field={field}: absent/present-empty/present-null guard targets collided"
  IO.println
    s!"MRTR-ABSENCE GREEN field={field} absent/present-empty/present-null=three-distinct-targets"

private def guardedTarget (label : String) (identity : Identity) : IO TargetHash := do
  match identity.event with
  | .guarded target => pure target
  | _ =>
      throw <| IO.userError
        s!"MRTR-MEDIATION RED round={label}: tools/call did not enter guarded mediation"

private def requireFailClosedFloor : IO Unit := do
  let initialRaw := request 1 none none
  let retryRaw :=
    request 2 (some "\"opaque-state-a\"")
      (some "{\"confirm\":{\"action\":\"accept\",\"content\":true}}")
  let initial ← requireTwin "mediation.initial" initialRaw
  let retry ← requireTwin "mediation.resubmission" retryRaw
  let initialTarget ← guardedTarget "initial" initial
  let retryTarget ← guardedTarget "resubmission" retry
  if initialTarget == retryTarget then
    throw <| IO.userError
      "MRTR-MEDIATION RED: resubmission target collided with initial target"
  let now := 10
  let deadline := 100
  let oldApprovalState := (step now State.empty (.approval initialTarget deadline)).2
  unless (step now oldApprovalState (.guarded retryTarget)).1 == .block do
    throw <| IO.userError
      "MRTR-MEDIATION RED: initial-round approval authorized the resubmission"
  let consumedState := (step now oldApprovalState (.guarded initialTarget)).2
  unless (step now consumedState (.guarded retryTarget)).1 == .block do
    throw <| IO.userError
      "MRTR-MEDIATION RED: resubmission skipped fresh approval after initial consumption"
  let freshState := (step now State.empty (.approval retryTarget deadline)).2
  unless (step now freshState (.guarded retryTarget)).1 == .allow do
    throw <| IO.userError
      "MRTR-MEDIATION RED: fresh resubmission approval did not authorize its exact target"
  IO.println
    "MRTR-MEDIATION GREEN initial=guarded resubmission=guarded old-approval=block consumed-approval=block fresh-approval=allow"

def main : IO Unit := do
  requireFieldChange "requestState"
    (request 2 (some "\"opaque-state-a\"") none)
    (request 2 (some "\"opaque-state-b\"") none)
  requireFieldChange "inputResponses"
    (request 2 none
      (some "{\"confirm\":{\"action\":\"accept\",\"content\":true}}"))
    (request 2 none
      (some "{\"confirm\":{\"action\":\"decline\"}}"))
  requireAbsenceEmptyNull "requestState"
    [("absent", request 2 none none),
     ("present-empty", request 2 (some "{}") none),
     ("present-null", request 2 (some "null") none)]
  requireAbsenceEmptyNull "inputResponses"
    [("absent", request 2 none none),
     ("present-empty", request 2 none (some "{}")),
     ("present-null", request 2 none (some "null"))]
  requireFailClosedFloor
