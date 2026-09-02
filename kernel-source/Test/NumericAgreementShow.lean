/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.ClassifyTransport

/-!
# Numeric agreement gate — runnable boundary and routing witnesses

This executable exercises the pure raw-wire predicate and the transport mirror.
The standalone-host integration run separately checks the user-visible refusal
text and child forwarding.
-/

open Seal.JsonUtil
open SealV2.ClassifyTransport

private structure Case where
  label : String
  literal : String
  expected : Bool

private def cases : List Case :=
  [⟨"measured-vector", "-1e9999", false⟩,
   ⟨"negative-control", "1e308", true⟩,
   ⟨"integer-max-safe", "9007199254740991", true⟩,
   ⟨"integer-two-pow-53", "9007199254740992", true⟩,
   ⟨"integer-2^53-plus-1", "9007199254740993", false⟩,
   ⟨"ordinary-fraction", "0.1", true⟩,
   ⟨"non-shortest-fraction", "0.10000000000000001", false⟩,
   ⟨"minimum-subnormal", "5e-324", true⟩,
   ⟨"underflow-to-zero", "1e-324", false⟩]

private def callLine (literal : String) : String :=
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"t\",\"arguments\":{\"v\":" ++
    literal ++ "}}}"

private def className : WireClass → String
  | .passthrough => "passthrough"
  | .act _ _ => "act"
  | .refuse => "refuse"

private def runFixed : IO UInt32 := do
  let mut failed := false
  for c in cases do
    let actual := (numberLiteralAgreementSafe? c.literal).getD false
    IO.println s!"{c.label}: literal={c.literal} agreement-safe={actual}"
    if actual != c.expected then
      IO.eprintln s!"RED {c.label}: expected {c.expected}, got {actual}"
      failed := true
  for literal in ["-1e9999", "1e308", "9007199254740991", "9007199254740993"] do
    let line := callLine literal
    IO.println
      s!"route: literal={literal} offending={firstAgreementUnsafeNumber? line} class={className (classifyWire line)}"
  if failed then
    IO.eprintln "NUMERIC AGREEMENT SHOW: RED"
    pure 1
  else
    IO.println "NUMERIC AGREEMENT SHOW: GREEN"
    pure 0

def main (args : List String) : IO UInt32 := do
  if args.isEmpty then runFixed
  else
    for literal in args do
      IO.println s!"{literal}\t{numberLiteralAgreementSafe? literal}"
    pure 0
