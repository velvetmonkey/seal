/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Channel

open Seal

private def approvalContent : String :=
  "{\"target\":\"0000000000000000000000000000000000000000000000000000000000000000\"}\n"

private def makeSymlink (target link : System.FilePath) : IO Unit := do
  discard <| IO.Process.run {
    cmd := "ln"
    args := #["-s", target.toString, link.toString]
  }

private def expectSymlinkUserError (label : String) (path : System.FilePath)
    (action : IO α) : IO Unit := do
  let expected := s!"approval control file must not be a symlink: {path}"
  try
    discard action
    throw <| IO.userError s!"{label}: expected symlink refusal"
  catch
    | .userError message =>
        unless message == expected do
          throw <| IO.userError
            s!"{label}: wrong userError; expected '{expected}', got '{message}'"
    | err =>
        throw <| IO.userError s!"{label}: expected IO.userError, got '{err}'"

private def readApprovalsSymlinkPair : IO Unit :=
  IO.FS.withTempDir fun dir => do
    let path := dir / "approvals.jsonl"
    let target := dir / "target.jsonl"

    -- Positive twin: the same path and content are readable as a regular file.
    IO.FS.writeFile path approvalContent
    let events ← readApprovals path 1000 500
    unless events.length == 1 do
      throw <| IO.userError
        s!"readApprovals regular-file twin: expected one approval, got {events.length}"

    IO.FS.removeFile path
    IO.FS.writeFile target approvalContent
    makeSymlink target path
    expectSymlinkUserError "readApprovals symlink" path
      (readApprovals path 1000 500)

private def readApprovalsFromSymlinkPair : IO Unit :=
  IO.FS.withTempDir fun dir => do
    let path := dir / "approvals.jsonl"
    let target := dir / "target.jsonl"

    -- Positive twin: the same path and content are readable as a regular file.
    IO.FS.writeFile path approvalContent
    let (seen, events) ← readApprovalsFrom path 0 1000 500
    unless seen == 1 && events.length == 1 do
      throw <| IO.userError
        s!"readApprovalsFrom regular-file twin: expected (1, one approval), got ({seen}, {events.length})"

    IO.FS.removeFile path
    IO.FS.writeFile target approvalContent
    makeSymlink target path
    expectSymlinkUserError "readApprovalsFrom symlink" path
      (readApprovalsFrom path 0 1000 500)

def main : IO Unit := do
  readApprovalsSymlinkPair
  IO.println "readApprovals: regular-file twin accepted; symlink refused with path"
  readApprovalsFromSymlinkPair
  IO.println "readApprovalsFrom: regular-file twin accepted; symlink refused with path"
