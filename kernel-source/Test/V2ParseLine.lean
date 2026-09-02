/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2

open SealV2

def main (args : List String) : IO UInt32 := do
  match args with
  | [raw] =>
      match parse raw with
      | some _ => IO.println "some"; pure 0
      | none => IO.println "none"; pure 0
  | ["--", raw] =>
      match parse raw with
      | some _ => IO.println "some"; pure 0
      | none => IO.println "none"; pure 0
  | _ =>
      IO.eprintln "usage: v2_parse_line <raw-json>"
      pure 2
