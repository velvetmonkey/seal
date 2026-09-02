/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures

open SealV2
open Test.V2ValidationFixtures

/-- Drive the public `decide` entrypoint over a single raw JSON-RPC line against the
    fixture `baseState`, printing only the public decision (`Allow`/`Block`). The
    emitted canonical bytes are intentionally not printed: `decide` exposes a decision,
    and the M4 acceptance corpus asserts on the decision alone. -/
def run (raw : String) : IO UInt32 := do
  match decide raw baseState with
  | .Allow _ => IO.println "Allow"; pure 0
  | .Block   => IO.println "Block"; pure 0

def main (args : List String) : IO UInt32 := do
  match args with
  | [raw] => run raw
  | ["--", raw] => run raw
  | _ =>
      IO.eprintln "usage: v2_decide_line <raw-json>"
      pure 2
