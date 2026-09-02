/- SPDX-License-Identifier: Apache-2.0 -/

import SealCore.Event
import Std.Data.HashMap

namespace SealCore

/-- `approved` maps a target hash to an absolute expiry deadline (monotonic
    milliseconds). A target is live while the current time is strictly before
    its deadline. The deadline is stamped by the runtime when the approval is
    ingested (`now + ttlMs`); the engine never trusts a caller-supplied time. -/
structure State where
  approved : Std.HashMap TargetHash Nat := ∅
  deriving Repr

def State.empty : State := {}

/-- A target is live iff it has an approval whose deadline has not yet passed
    at time `now`. -/
def live (s : State) (target : TargetHash) (now : Nat) : Bool :=
  match s.approved[target]? with
  | some deadline => now < deadline
  | none => false

/-- Drop every approval whose deadline is at or before `now`. Memory hygiene
    only: lazy `live` already refuses expired entries, so pruning changes no
    decision. -/
def prune (now : Nat) (approved : Std.HashMap TargetHash Nat) : Std.HashMap TargetHash Nat :=
  approved.fold (init := ∅) fun acc target deadline =>
    if now < deadline then acc.insert target deadline else acc

/-- The runtime computes each approval's absolute deadline (from the record's
    `issuedAt` if present, else ingest time, plus the policy TTL) and passes it
    in the event; the engine just records it. The engine never derives the
    deadline from a clock itself, keeping the core clock-agnostic and the proofs
    free of real-time reasoning. -/
def step (now : Nat) (s : State) (e : Event) : Decision × State :=
  match e with
  | .approval target deadline => (.allow, { approved := s.approved.insert target deadline })
  | .guarded target =>
      if live s target now then
        (.allow, { approved := s.approved.erase target })
      else
        (.block, s)
  | .benign => (.allow, s)
  | .defaultDeny => (.block, s)

def run (now : Nat) (s : State) (events : List Event) : State :=
  events.foldl (fun st e => (step now st e).2) s

end SealCore
