/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.GoldenPath
import Seal.SignedPolicy

/-!
Runtime harness for the scaffolder + golden-path shell cell. The theorems
prove these outcomes symbolically; this executes the compiled classifier
(real SHA-256) end-to-end and fails loudly on any mismatch.
-/

open Lean SealCore

private def unknownTool : Seal.ManifestTool := { name := "mystery_op" }

private def conflictTool : Seal.ManifestTool :=
  { name := "confused_op", readOnlyHint := some true, destructiveHint := some true }

private def notReadonlyTool : Seal.ManifestTool :=
  { name := "explicit_writer", readOnlyHint := some false }

private def widerManifest : Seal.Manifest :=
  [Seal.shellExecTool, Seal.shellReadTool, unknownTool, conflictTool, notReadonlyTool]

private def widerPolicy : Seal.Policy :=
  Seal.scaffold "shell-cell" 120000 "seal-approvals.jsonl" widerManifest

private def expectGuarded (label : String) (event : Seal.HostEvent) : IO TargetHash := do
  match event.toEvent with
  | .guarded target => pure target
  | other => throw <| IO.userError s!"{label}: expected guarded, got {repr other}"

def main : IO Unit := do
  -- Golden path: destructive shell command classifies guarded.
  let rm := Seal.classifyToolCall Seal.shellPolicy "shell_exec" Seal.shellRmArgs
  let rmTarget ← expectGuarded "shell_exec rm -rf" rm

  -- Readonly leg flows benign.
  let read := Seal.classifyToolCall Seal.shellPolicy "read_file"
    (Json.mkObj [("path", Json.str "/etc/hostname")])
  unless read.toEvent == .benign do
    throw <| IO.userError s!"read_file: expected benign, got {repr read.toEvent}"

  -- Exact names only: unknown tool falls to default-deny.
  let unknown := Seal.classifyToolCall Seal.shellPolicy "shell_exec2" Seal.shellRmArgs
  unless unknown.toEvent == .defaultDeny do
    throw <| IO.userError s!"unknown tool: expected defaultDeny, got {repr unknown.toEvent}"

  -- Unknown / conflicting / explicitly-not-readonly annotations all guard.
  for name in ["mystery_op", "confused_op", "explicit_writer"] do
    let event := Seal.classifyToolCall widerPolicy name (Json.mkObj [("x", Json.str "y")])
    let _ ← expectGuarded s!"annotation case {name}" event

  -- Gate integration: blocked on fresh state, allowed only after approval,
  -- consumed after one use.
  let now := 1000
  let deadline := now + 60000
  let (fresh, s0) := step now State.empty (rm.toEvent)
  unless fresh == .block do throw <| IO.userError "fresh state must block"
  let (approved, s1) := step now s0 (.approval rmTarget deadline)
  unless approved == .allow do throw <| IO.userError "approval ingest must allow"
  let (once, s2) := step now s1 rm.toEvent
  unless once == .allow do throw <| IO.userError "approved call must flow"
  let (replay, _) := step now s2 rm.toEvent
  unless replay == .block do throw <| IO.userError "second use must block (consumed)"

  -- Target binding: different arguments, different target.
  let other := Seal.classifyToolCall Seal.shellPolicy "shell_exec"
    (Json.mkObj [("command", Json.str "ls")])
  let otherTarget ← expectGuarded "shell_exec ls" other
  if otherTarget == rmTarget then
    throw <| IO.userError "distinct arguments must bind distinct targets"

  -- Tamper ⇒ fail-closed (policy): malformed hex and wrong-key signatures
  -- both refuse; the signed-policy gate then default-denies everything.
  if Seal.verifyPolicySignature "zz-not-hex" "{}" (String.ofList (List.replicate 128 'a')) then
    throw <| IO.userError "malformed public key hex must fail verification"
  if Seal.verifyPolicySignature (String.ofList (List.replicate 64 'a')) "{}" "zz-not-hex" then
    throw <| IO.userError "malformed signature hex must fail verification"
  if Seal.verifyPolicySignature
      (String.ofList (List.replicate 64 'a')) "{\"tools\":[]}"
      (String.ofList (List.replicate 128 'b')) then
    throw <| IO.userError "wrong-key signature must fail verification"
  let sealed := Seal.classifyUnderSignedPolicy
    (String.ofList (List.replicate 64 'a')) "{\"tools\":[]}"
    (String.ofList (List.replicate 128 'b')) "shell_exec" Seal.shellRmArgs
  unless sealed.toEvent == .defaultDeny do
    throw <| IO.userError s!"tampered policy must default-deny, got {repr sealed.toEvent}"

  IO.println "SCAFFOLD TESTS PASS"
