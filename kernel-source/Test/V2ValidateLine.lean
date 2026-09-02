/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures

open SealV2
open Test.V2ValidationFixtures

def run (raw : String) : IO UInt32 := do
  match parse raw with
  | none => IO.println "parse-none"; pure 0
  | some ast =>
      match validate ast baseState with
      | some _ => IO.println "some"; pure 0
      | none => IO.println "none"; pure 0

def main (args : List String) : IO UInt32 := do
  match args with
  | [raw] => run raw
  | ["--", raw] => run raw
  | _ =>
      IO.eprintln "usage: v2_validate_line <raw-json>"
      pure 2
