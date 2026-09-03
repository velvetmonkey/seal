/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import SealCore.Event
import SealCore.Sha256
import Seal.JsonUtil

namespace Seal

open Lean
open SealCore
open Seal.JsonUtil

private def jsonToNat? (j : Json) : Option Nat :=
  match j with
  | .num n => (toString n).toNat?
  | .str s => s.toNat?
  | _ => none

private def jsonToTargetHash? (j : Json) : Option SealCore.TargetHash :=
  match j with
  | .str s => Sha256.Digest256.parseHex? s
  | _ => none

/-- Parse one approval record and resolve its absolute expiry deadline (epoch ms).

    A record is `{"target": <hash>}` and may optionally carry `"issuedAt": <epoch ms>`,
    the wall-clock time the human minted it. The deadline is `base + ttlMs` where
    `base = min(issuedAt, now)`: an `issuedAt` in the past shortens the approval's
    remaining life (mint-time semantics), while a future or absent `issuedAt`
    falls back to ingest time. This is fail-safe: a record can only ever make a
    approval expire SOONER than `now + ttlMs`, never later. -/
private def parseApprovalRecord (now ttlMs : Nat) (line : String) : Option Event :=
  let trimmed := line.trimAscii.toString
  if trimmed.isEmpty then none else
  -- Fail closed on a pathological numeric literal (e.g. `issuedAt` with a
  -- monster exponent) before `Json.parse` aborts on it: reject the record, so
  -- no approval is granted. Ignoring an approval only ever DENIES — fail-safe.
  if !wireNumbersSafe trimmed then none else
    match Json.parse trimmed with
    | .ok json =>
        match (json.getObjVal? "target").toOption.bind jsonToTargetHash? with
        | some target =>
            let issuedAt := (json.getObjVal? "issuedAt").toOption.bind jsonToNat?
            let base := min (issuedAt.getD now) now
            some (.approval target (base + ttlMs))
        | none => none
    | .error _ => none

def readApprovals (path : System.FilePath) (now ttlMs : Nat) : IO (List Event) := do
  if (← path.pathExists) then
    let fileMeta ← System.FilePath.symlinkMetadata path
    if fileMeta.type == .symlink then
      throw <| IO.userError s!"approval control file must not be a symlink: {path}"
    let text ← IO.FS.readFile path
    pure <| text.splitOn "\n" |>.filterMap (parseApprovalRecord now ttlMs)
  else
    pure []

def readApprovalsFrom (path : System.FilePath) (seenRecords : Nat) (now ttlMs : Nat) :
    IO (Nat × List Event) := do
  if (← path.pathExists) then
    let fileMeta ← System.FilePath.symlinkMetadata path
    if fileMeta.type == .symlink then
      throw <| IO.userError s!"approval control file must not be a symlink: {path}"
    let text ← IO.FS.readFile path
    let records := text.splitOn "\n" |>.filter (fun line => !(line.trimAscii.toString).isEmpty)
    let fresh := records.drop seenRecords
    pure (records.length, fresh.filterMap (parseApprovalRecord now ttlMs))
  else
    pure (seenRecords, [])

def ensureApprovalFile (path : System.FilePath) : IO Unit := do
  unless (← path.pathExists) do
    IO.FS.writeFile path ""
  discard <| IO.Process.output {
    cmd := "chmod",
    args := #["600", path.toString],
    stdin := .null,
    stdout := .null,
    stderr := .null
  }

end Seal
