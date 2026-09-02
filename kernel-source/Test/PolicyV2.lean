/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.PolicyV2Theorems

open Lean

private def args (operation path : String) : Json :=
  Json.mkObj [("operation", Json.str operation), ("path", Json.str path)]

private def policy : Seal.Policy := {
  approvalTtlMs := 120000
  approvalFile := "unused"
  serverIdentity := "filesystem-main"
  tools := [
    { name := "filesystem", mode := .allow,
      matcher := .all [.equals ["operation"] "read", .startsWith ["path"] "/safe/"] },
    { name := "filesystem", mode := .guarded,
      matcher := .equals ["operation"] "write",
      target := [.fullArguments] },
    { name := "filesystem", mode := .deny,
      matcher := .startsWith ["path"] "/secrets/" }
  ]
}

def main : IO Unit := do
  let read := Seal.classifyToolCall policy "filesystem" (args "read" "/safe/a")
  unless read.toEvent == .benign do throw <| IO.userError s!"explicit read allow failed: {repr read}"

  let write := Seal.classifyToolCall policy "filesystem" (args "write" "/safe/a")
  match write.toEvent with
  | .guarded _ => pure ()
  | other => throw <| IO.userError s!"write was not guarded: {repr other}"

  let denied := Seal.classifyToolCall policy "filesystem" (args "read" "/secrets/key")
  unless denied.toEvent == .defaultDeny do
    throw <| IO.userError s!"deny did not dominate allow: {repr denied}"

  let unmatched := Seal.classifyToolCall policy "filesystem" (args "read" "/other/a")
  unless unmatched.toEvent == .defaultDeny do
    throw <| IO.userError s!"unmatched call did not block: {repr unmatched}"

  let write2 := Seal.classifyToolCall policy "filesystem" (args "write" "/safe/b")
  unless write.targetText != write2.targetText do
    throw <| IO.userError "full_arguments did not change the target commitment"

  IO.println "POLICY-V2 TESTS PASS"
