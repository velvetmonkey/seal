/- SPDX-License-Identifier: Apache-2.0 -/
import Ffi

/-!
Interpreted-Lean lane for the product authorization seam differential.

The Node harness supplies one trusted config payload and an ordered corpus of
the exact step envelopes sent to the shipped kernel. `#REINIT` gives each
authorization question a fresh session without compiling or linking Lean.
-/

open Ffi

#eval show IO Unit from do
  let payloadPath := (← IO.getEnv "SEAL_SEAMDIFF_PAYLOAD").getD ""
  let corpusPath := (← IO.getEnv "SEAL_SEAMDIFF_CORPUS").getD ""
  let outputPath := (← IO.getEnv "SEAL_SEAMDIFF_OUTPUT").getD ""
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
    output.putStr ("{\"verdict\":\"DENY\"}" ++ "\n")
  output.flush
