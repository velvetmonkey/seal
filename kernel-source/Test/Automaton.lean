/- SPDX-License-Identifier: Apache-2.0 -/

import SealCore

open SealCore

def assertEq [BEq α] [ToString α] (name : String) (actual expected : α) : IO Unit := do
  unless actual == expected do
    throw <| IO.userError s!"{name}: expected {expected}, got {actual}"

instance : ToString Decision where
  toString
  | .allow => "allow"
  | .block => "block"

def targetA : SealCore.TargetHash :=
  (Sha256.Digest256.parseHex? "0000000000000000000000000000000000000000000000000000000000000001").get!

def targetB : SealCore.TargetHash :=
  (Sha256.Digest256.parseHex? "0000000000000000000000000000000000000000000000000000000000000002").get!

def main : IO UInt32 := do
  let now := 0
  let deadline := 1000     -- approval valid until epoch ms 1000
  let empty := State.empty
  assertEq "default deny" (step now empty .defaultDeny).1 .block
  assertEq "guarded before approval" (step now empty (.guarded targetA)).1 .block
  let approved := (step now empty (.approval targetA deadline)).2
  assertEq "approved target allowed" (step now approved (.guarded targetA)).1 .allow
  assertEq "approval not transferable across targets" (step now approved (.guarded targetB)).1 .block
  let consumed := (step now approved (.guarded targetA)).2
  assertEq "replay blocked" (step now consumed (.guarded targetA)).1 .block
  -- Time-based expiry: the same approval, evaluated at different clock readings.
  assertEq "not-yet-expired allowed" (step 999 approved (.guarded targetA)).1 .allow
  assertEq "expired approval blocked" (step 1000 approved (.guarded targetA)).1 .block
  assertEq "long-expired approval blocked" (step 5000 approved (.guarded targetA)).1 .block
  assertEq "benign allowed" (step now empty .benign).1 .allow
  pure 0
