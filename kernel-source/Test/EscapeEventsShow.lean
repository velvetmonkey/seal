/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.ClassifyTransport
import Test.V2ValidationFixtures

/-!
# SHOW: escape events cannot create, alter, or reorder Allows

Runtime witness for `SealV2.ClassifyTransport.escape_events_no_influence`
(and its insertion corollary), run over the REAL kernel composition — real
Ed25519 signature verification (linked C object), real parse/validate/
serialize — not a stub. The trace interleaves THREE escape-class events
(BOM-prefixed call, case-variant call, plain `tools/list`) among TWO
mediated requests that both reach Allow with DISTINGUISHABLE canonical
outputs (`table:"users"` vs `table:"orders"`), so the check is sensitive to
content AND order of the Allow stream, not merely to its length.

Non-vacuity discipline (STEP 0):
* the hypothesis is satisfiable — the full trace really contains escape
  events, and the run really forwards them (`.forwarded` observed 3×);
* the conclusion is not trivially true — the Allow stream is non-empty
  (2 Allows) and its two entries differ, so equality-with-order is a real
  constraint;
* `--tamper` demonstrates RED: a purge that deletes too much, and a
  reordering of the mediated requests, must both be caught by the same
  checks (exit 1). If a sabotage is NOT caught, the harness itself is
  defective and the run exits 2.
-/

open SealV2 SealV2.ClassifyTransport Test.V2ValidationFixtures
open SealV2.ResponseTransport (HostState HostEvent)

def now0 : Nat := 10

/-- Start state: transport live, BOTH fixture approvals unconsumed. -/
def s0 : HostState := ⟨some twoApprovalState, false⟩

def usersReq : HostEvent := .request validRaw now0
def ordersReq : HostEvent := .request validOrdersRaw now0

/-- The full trace: three escape-class events interleaved among the two
    mediated requests — head, middle, and tail positions. -/
def tFull : List HostEvent :=
  [.request bomWitness now0, usersReq, .request caseWitness now0,
   ordersReq, .request listWitness now0]

/-- The escape-purged twin, written out by hand so the runtime check
    compares against an INDEPENDENT spelling, not against `purgeEscapes`'s
    own output. -/
def tPurged : List HostEvent := [usersReq, ordersReq]

/-- Request-event equality (sufficient for these traces; non-request events
    compare false so any drift is caught). -/
def reqEq : HostEvent → HostEvent → Bool
  | .request r₁ n₁, .request r₂ n₂ => r₁ == r₂ && n₁ == n₂
  | _, _ => false

def traceEq (a b : List HostEvent) : Bool :=
  a.length == b.length && (a.zip b).all fun (x, y) => reqEq x y

def countForwarded : List SealV2.ClassifyTransport.Obs → Nat
  | [] => 0
  | .forwarded _ :: t => countForwarded t + 1
  | _ :: t => countForwarded t

/-- Substring probe via `splitOn` (core-only). -/
def hasSub (s sub : String) : Bool := (s.splitOn sub).length > 1

/-! ### Compile-time pins (crypto-free: class membership and purge shape;
the Allow-producing checks need the linked Ed25519 and run in `main`). -/

#guard mediatedClass validRaw = true
#guard mediatedClass validOrdersRaw = true
#guard (tFull.filter isEscapeEvent).length == 3
#guard traceEq (purgeEscapes tFull) tPurged
#guard traceEq (purgeEscapes tPurged) tPurged

def check (label : String) (ok : Bool) : IO Bool := do
  if ok then
    IO.println s!"  ok   {label}"
    pure true
  else
    IO.eprintln s!"  RED  {label}"
    pure false

def main (args : List String) : IO UInt32 := do
  let aFull := allowsOf (runTrace s0 tFull)
  let aPurged := allowsOf (runTrace s0 tPurged)
  if args.contains "--tamper" then
    -- Sabotage 1: an over-eager purge that also deletes mediated requests.
    let overPurged := tFull.filter fun ev => !(isEscapeEvent ev) && !(reqEq ev usersReq)
    let aOver := allowsOf (runTrace s0 overPurged)
    -- Sabotage 2: reorder the mediated requests in the purged twin.
    let aSwapped := allowsOf (runTrace s0 [ordersReq, usersReq])
    let caught1 := aFull != aOver
    let caught2 := aFull != aSwapped
    if caught1 && caught2 then
      IO.eprintln "RED (as intended): over-purge and reorder both change the Allow stream — tamper detected"
      pure 1
    else
      IO.eprintln s!"TAMPER NOT DETECTED — harness defect (over-purge caught: {caught1}, reorder caught: {caught2})"
      pure 2
  else
    let mut ok := true
    IO.println "escape_events_no_influence SHOW"
    -- Hypothesis satisfiable: escape events present AND actually forwarded.
    ok := (← check "full trace holds 3 escape events"
      ((tFull.filter isEscapeEvent).length == 3)) && ok
    ok := (← check "run forwards all 3 escape events undecided"
      (countForwarded (runTrace s0 tFull) == 3)) && ok
    ok := (← check "purged run forwards none"
      (countForwarded (runTrace s0 tPurged) == 0)) && ok
    -- Conclusion non-trivial: two real Allows, distinguishable outputs.
    ok := (← check "full run produces exactly 2 Allows (real Ed25519 path)"
      (aFull.length == 2)) && ok
    ok := (← check "the two Allow outputs differ (order is a real constraint)"
      (aFull[0]! != aFull[1]!)) && ok
    ok := (← check "Allow order matches event order (users first, orders second)"
      (hasSub aFull[0]! "users" && hasSub aFull[1]! "orders")) && ok
    -- The theorem instance itself, on the independent hand-written twin.
    ok := (← check "Allow stream of full run == Allow stream of purged twin"
      (aFull == aPurged)) && ok
    -- Insertion form: one escape event at EVERY position of the purged twin.
    for esc in [HostEvent.request bomWitness now0,
                .request caseWitness now0, .request listWitness now0] do
      for i in [0, 1, 2] do
        let t := tPurged.take i ++ esc :: tPurged.drop i
        ok := (← check s!"insertion at position {i} leaves Allows unchanged"
          (allowsOf (runTrace s0 t) == aPurged)) && ok
    if ok then
      IO.println "SHOW: escape events created, altered, reordered NOTHING in the Allow stream — GREEN"
      pure 0
    else
      IO.eprintln "SHOW: RED"
      pure 1
