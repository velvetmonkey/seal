/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import Std.Sync.Mutex
import Std.Time
import SealCore
import Seal.Policy
import Seal.Classify
import Seal.Channel
import Seal.Block

namespace Seal

open Lean
open SealCore

structure Args where
  policy : System.FilePath
  cmd : String
  cmdArgs : Array String

def parseArgs (args : List String) : Except String Args :=
  match args with
  | "--policy" :: policy :: "--" :: cmd :: rest =>
      .ok { policy := System.FilePath.mk policy, cmd, cmdArgs := rest.toArray }
  | _ => .error "usage: seal --policy <policy.json> -- <server-cmd> <args...>"

def writeLocked (lock : Std.Mutex Unit) (out : IO.FS.Stream) (line : String) : IO Unit := do
  lock.atomically do
    out.putStr line
    out.flush

partial def relayChildStdout (lock : Std.Mutex Unit) (childOut : IO.FS.Handle) (hostOut : IO.FS.Stream) : IO Unit := do
  let line ← childOut.getLine
  if line.isEmpty then
    pure ()
  else
    writeLocked lock hostOut line
    relayChildStdout lock childOut hostOut

private def jsonId (json : Json) : Json :=
  (json.getObjVal? "id").toOption.getD Json.null

private def processHostLine
    (policy : Policy)
    (stateRef : IO.Ref State)
    (approvalSeenRef : IO.Ref Nat)
    (hostLine : String)
    (childIn : IO.FS.Handle)
    (hostOut : IO.FS.Stream)
    (stdoutLock : Std.Mutex Unit) : IO Unit := do
  let trimmed := hostLine.trimAscii.toString
  -- Fail closed on a pathological numeric literal BEFORE `Json.parse` sees it:
  -- a wire number with a monster decimal exponent makes `Json.parse` evaluate
  -- `10^exponent` and abort (native + interpreter) — a one-line DoS. Do NOT
  -- forward it to the child (a forward would be the fail-OPEN bypass) and do
  -- NOT parse it; block the request. (See Seal.JsonUtil.wireNumbersSafe.)
  if !JsonUtil.wireNumbersSafe trimmed then
    writeLocked stdoutLock hostOut (blockResponseLine Json.null "unsafe numeric literal")
    return
  -- Independent parser-agreement gate.  Unlike `wireNumbersSafe`, this does
  -- not bound parse cost: it refuses a literal whose exact Lean value is not
  -- preserved by the shortest decimal round-trip of an IEEE-754 binary64
  -- reader.  Keep the raw token so the hard refusal names the cause.
  match JsonUtil.firstAgreementUnsafeNumber? trimmed with
  | some literal =>
      writeLocked stdoutLock hostOut
        (errorResponseLine Json.null
          s!"numeric literal is not IEEE-754 agreement-safe: {literal}")
      return
  | none => pure ()
  -- Duplicate-key mediation gate. THIS MUST RUN BEFORE `Json.parse`.
  --
  -- It previously ran inside the `some (toolName, toolArgs)` branch below, i.e.
  -- only after the PARSED view had already been recognised as a tools/call.
  -- That was a mediation bypass, and it is the same defect class already closed
  -- in the Rust-backed host (`seal-host` `Host/Canonical.lean:50-65`):
  --
  --   {"method":"tools/call","method":"initialize","params":{...}}
  --
  -- `Json.parse` collapses duplicate keys last-wins, so `toolsCall?` sees
  -- `initialize`, returns `none`, and the ORIGINAL bytes are forwarded to the
  -- child. A first-wins downstream parser sees `tools/call` and executes it
  -- unmediated. The guard that would have caught it never ran, because
  -- reaching it required the parse to agree it was a tool call.
  --
  -- A raw line carrying a duplicate or escaped object key is ambiguous about
  -- WHICH request it even is, so it cannot be classified before it is refused.
  -- Hence: refuse at the wire, before the parse destroys the evidence.
  --
  -- COST, accepted deliberately and identically to the Rust host: a
  -- non-tools/call line carrying a duplicate key is now BLOCKED rather than
  -- forwarded. Ambiguous wire input fails closed regardless of what it claims
  -- to be. The id is `Json.null` because we have no trustworthy parsed id yet.
  if !JsonUtil.wireKeysSafe trimmed then
    writeLocked stdoutLock hostOut
      (blockResponseLine Json.null "duplicate or escaped object key")
    return
  -- Stage-A pinned integer bound, hoisted for the same reason: a >18 significant
  -- digit mantissa would diverge from the Stage-C i64 byte twin, and deciding
  -- that after the parse means deciding it on a value the parse already chose.
  if !JsonUtil.wireDigitsSafe trimmed then
    writeLocked stdoutLock hostOut
      (blockResponseLine Json.null "number exceeds significant-digit bound")
    return
  let parsed := Json.parse trimmed
  match parsed with
  | .error _ =>
      childIn.putStr hostLine
      childIn.flush
  | .ok json =>
      match toolsCallWithContext? json with
      | .error reason =>
          writeLocked stdoutLock hostOut
            (blockResponseLine (jsonId json) s!"invalid tools/call metadata: {reason}")
      | .ok none =>
          childIn.putStr hostLine
          childIn.flush
      | .ok (some
          (toolName, toolArgs, metadata, requestState, inputResponses)) =>
          -- `wireKeysSafe` and `wireDigitsSafe` USED TO RUN HERE. They now run
          -- pre-parse, at the top of this function; see the reasoning there.
          -- Deliberately not re-run: reaching this point already proves the raw
          -- line passed both, and a second post-parse check would suggest the
          -- pre-parse one is optional. It is not, it is the mediation gate.
          -- One wall-clock epoch reading (ms) per tools/call. Wall-clock (not
          -- monotonic) so a record-supplied `issuedAt` is comparable: the deadline
          -- is computed in Channel as min(issuedAt, now) + ttlMs. The same `now`
          -- decides liveness for this call, and each record is ingested exactly
          -- once (the seen counter), so deadlines are never re-stamped later.
          let nowTs ← Std.Time.Timestamp.now
          let now := nowTs.toMillisecondsSinceUnixEpoch.toInt.toNat
          let seen ← approvalSeenRef.get
          let (newSeen, approvals) ← readApprovalsFrom policy.approvalFile seen now policy.approvalTtlMs
          approvalSeenRef.set newSeen
          let st0 ← stateRef.get
          let st1 := approvals.foldl (fun st e => (step now st e).2) st0
          let hostEvent :=
            classifyToolCallWithContext policy toolName toolArgs metadata
              requestState inputResponses
          let (decision, st2) := step now st1 hostEvent.toEvent
          stateRef.set { approved := prune now st2.approved }
          match decision with
          | .allow =>
              childIn.putStr hostLine
              childIn.flush
          | .block =>
              writeLocked stdoutLock hostOut (blockResponseLine (jsonId json) hostEvent.targetText)

partial def hostLoop
    (policy : Policy)
    (stateRef : IO.Ref State)
    (approvalSeenRef : IO.Ref Nat)
    (hostIn hostOut : IO.FS.Stream)
    (childIn : IO.FS.Handle)
    (stdoutLock : Std.Mutex Unit) : IO Unit := do
  let line ← hostIn.getLine
  if line.isEmpty then
    pure ()
  else
    processHostLine policy stateRef approvalSeenRef line childIn hostOut stdoutLock
    hostLoop policy stateRef approvalSeenRef hostIn hostOut childIn stdoutLock

def main (rawArgs : List String) : IO UInt32 := do
  let parsed ←
    match parseArgs rawArgs with
    | .ok parsed => pure parsed
    | .error msg =>
        IO.eprintln msg
        return 2
  let policy ← loadPolicy parsed.policy
  ensureApprovalFile policy.approvalFile
  let child ← IO.Process.spawn {
    cmd := parsed.cmd,
    args := parsed.cmdArgs,
    stdin := .piped,
    stdout := .piped,
    stderr := .inherit
  }
  let hostIn ← IO.getStdin
  let hostOut ← IO.getStdout
  let stateRef ← IO.mkRef State.empty
  let approvalSeenRef ← IO.mkRef 0
  let stdoutLock ← Std.Mutex.new ()
  let relayTask ← IO.asTask (relayChildStdout stdoutLock child.stdout hostOut) Task.Priority.dedicated
  hostLoop policy stateRef approvalSeenRef hostIn hostOut child.stdin stdoutLock
  child.kill
  let exitCode ← child.wait
  match relayTask.get with
  | .ok _ => pure ()
  | .error err => throw err
  pure exitCode

end Seal

def main (args : List String) : IO UInt32 :=
  Seal.main args
