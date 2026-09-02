/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.NonceLedger
import Test.FieldWarrantCorpus

/-!
# SHOW: the nonce ledger — fail-closed generation pin, one-shot consume,
and the HONEST LIMITS demonstrated live

Runtime witness for the `SealV2/NonceLedger.lean` package, run over the
REAL kernel composition — real Ed25519 verification (linked C object),
real parse/validate/serialize via the six-gate `effectStep` — not a stub.
This discharges, with real crypto, the conditional hypotheses of
`rollback_replay_conditional` and `fresh_store_ignores_history` (the K2
pattern: witness conditional on the crypto seam, discharged at runtime).

STEP 0 discipline — the suite demonstrates BOTH halves of the honesty
gate:
* a generation MISMATCH is detectable (Block), and the discriminator leg
  shows the block is attributable to the LEDGER gate: the bare six-gate
  step under the same state still Allows;
* a matching generation over a ROLLED-BACK content set is NOT detectable
  (the replay Allows again) — printed as HONEST LIMIT, exactly as
  documented. If a future change made rollback detectable (or broke
  detection of mismatch), this suite goes RED: the claims and the code
  are pinned to each other in both directions.

`--tamper` shows RED for the asserted reasons: a consume that never
denies, a gate that ignores the generation, and an executor that ignores
the fence must each flip the corresponding verdict (exit 1). A sabotage
that is NOT caught is a harness defect (exit 2).
-/

open SealV2 SealV2.Effect SealV2.Effect.Ledger
open Test.FieldWarrant (authority registry mediator baseEnvelope sigBase)
open Test.V2ValidationFixtures (baseState)

namespace Test.NonceLedgerShow

/-- Config states: generation 1 (live), generation 2 (post-rotation),
    generation 0 (unconfigured). -/
def st1 : ApprovalState := { baseState with ledgerGeneration := 1 }
def st2 : ApprovalState := { baseState with ledgerGeneration := 2 }
def st0 : ApprovalState := baseState  -- ledgerGeneration defaults to 0

def att1 : LedgerAttestation := { storeId := "store-a", generation := 1, createdAt := 5 }
def att2 : LedgerAttestation := { storeId := "store-a", generation := 2, createdAt := 7 }

/-- Fresh generation-1 store. -/
def v1 : LedgerView := { att := att1, entries := [] }
/-- Fresh generation-2 store (post-rotation). -/
def v2 : LedgerView := { att := att2, entries := [] }

def isAllow : Decision → Bool
  | .Allow _ => true
  | .Block => false

def runLedgered (st : ApprovalState) (ledger? : Option LedgerView) :
    FencedDecision × Option LedgerView :=
  effectStepLedgered authority registry mediator baseEnvelope sigBase st ledger?

/-- **Strong negative control: generation changes authorization, not only
    the fence value.** The two states are literally record updates of the
    same `baseState`, differing only in `ledgerGeneration` (`1` versus `2`).
    Against the same fresh generation-1 ledger, a genuine base-step Allow is
    released and consumed under the matching state, while the differing
    state Blocks before the base step because `generationGate` fails.

    The sole hypothesis is the repository's explicit crypto seam: the SHOW
    executable below discharges it with the checked-in `sigBase` envelope
    signature, the independently signed approval in `baseState`, and the
    linked real Ed25519 verifier. -/
theorem ledgered_generation_decision_flip {out : CanonicalBytes}
    (hallow :
      effectStep authority registry mediator baseEnvelope sigBase st1 =
        .Allow out) :
    ({ baseState with ledgerGeneration := 1 } : ApprovalState) ≠
        { baseState with ledgerGeneration := 2 } ∧
    runLedgered st1 (some v1) =
        (⟨.Allow out, 1⟩,
          some { v1 with
            entries := [mintedEntry authority baseEnvelope] }) ∧
    runLedgered st2 (some v1) = (⟨.Block, 0⟩, some v1) ∧
    (runLedgered st1 (some v1)).1.decision ≠
      (runLedgered st2 (some v1)).1.decision := by
  have hgate1 : generationGate st1 v1 = true := by decide
  have hgate2 : generationGate st2 v1 = false := by decide
  have hconsume :
      consumeNonce v1 authority baseEnvelope =
        some { v1 with
          entries := [mintedEntry authority baseEnvelope] } := by
    simp [consumeNonce, v1]
  have hrun1 :
      runLedgered st1 (some v1) =
        (⟨.Allow out, 1⟩,
          some { v1 with
            entries := [mintedEntry authority baseEnvelope] }) := by
    unfold runLedgered effectStepLedgered
    simp only [hgate1, hallow, hconsume]
    rfl
  have hrun2 :
      runLedgered st2 (some v1) = (⟨.Block, 0⟩, some v1) := by
    unfold runLedgered effectStepLedgered
    simp only [hgate2, Bool.false_eq_true, ↓reduceIte]
  refine ⟨?_, hrun1, hrun2, ?_⟩
  · intro h
    exact absurd (congrArg ApprovalState.ledgerGeneration h) (by decide)
  · simp [hrun1, hrun2]

def check (label : String) (ok : Bool) : IO Bool := do
  if ok then
    IO.println s!"  ok   {label}"
    pure true
  else
    IO.eprintln s!"  RED  {label}"
    pure false

/-! ### Tamper mutants (only reachable via --tamper; each breaks ONE
named control, so a flipped verdict is attributable) -/

/-- Sabotage 1: a consume that never denies — the replay check deleted. -/
def consumeNoCheck (v : LedgerView) (auth : ByteArray) (e : EffectEnvelope) :
    Option LedgerView :=
  some { v with entries := mintedEntry auth e :: v.entries }

/-- Sabotage 2: a gate that ignores the generation entirely. -/
def gateAlwaysTrue (_ : ApprovalState) (_ : LedgerView) : Bool := true

/-- Sabotage 3: an executor that ignores the fence. -/
def executorNoFence (_ : ApprovalState) (_ : FencedDecision) : Bool := true

/-- The ledgered step with pluggable gate/consume, for the tamper legs.
    With the honest `generationGate`/`consumeNonce` this is
    `effectStepLedgered` verbatim. -/
def mutantStep (gate : ApprovalState → LedgerView → Bool)
    (consume : LedgerView → ByteArray → EffectEnvelope → Option LedgerView)
    (st : ApprovalState) (ledger? : Option LedgerView) :
    FencedDecision × Option LedgerView :=
  match ledger? with
  | none => (⟨.Block, 0⟩, none)
  | some v =>
      if gate st v then
        match effectStep authority registry mediator baseEnvelope sigBase st with
        | .Block => (⟨.Block, st.ledgerGeneration⟩, some v)
        | .Allow out =>
            match consume v authority baseEnvelope with
            | none => (⟨.Block, st.ledgerGeneration⟩, some v)
            | some v' => (⟨.Allow out, st.ledgerGeneration⟩, some v')
      else (⟨.Block, 0⟩, some v)

def main (args : List String) : IO UInt32 := do
  -- the live run: consume under generation 1
  let run1 := runLedgered st1 (some v1)
  let ledger1 := run1.2
  if args.contains "--tamper" then
    -- Sabotage 1: replay must slip through a consume that never denies.
    let honestReplay := (ledger1.map fun v' =>
      isAllow (runLedgered st1 (some v')).1.decision).getD true
    let mutantReplay := (ledger1.map fun v' =>
      isAllow (mutantStep generationGate consumeNoCheck st1 (some v')).1.decision).getD false
    let caught1 := honestReplay == false && mutantReplay == true
    -- Sabotage 2: the mismatch Block must vanish under a generation-blind gate.
    let honestMismatch := isAllow (runLedgered st2 (some v1)).1.decision
    let mutantMismatch := isAllow (mutantStep gateAlwaysTrue consumeNonce st2 (some v1)).1.decision
    let caught2 := honestMismatch == false && mutantMismatch == true
    -- Sabotage 3: the stale fence must pass an executor that ignores it.
    let fd1 := run1.1
    let caught3 := executorAccepts st2 fd1 == false
      && executorNoFence st2 fd1 == true
    if caught1 && caught2 && caught3 then
      IO.eprintln "RED (as intended): deleted replay check re-admits the replay; generation-blind gate accepts the mismatched store; fenceless executor accepts the stale generation — every sabotage flips its own verdict"
      pure 1
    else
      IO.eprintln s!"TAMPER NOT DETECTED — harness defect (replay-check deletion caught: {caught1}, gate blinding caught: {caught2}, fence removal caught: {caught3})"
      pure 2
  else
    let mut ok := true
    IO.println "nonce_ledger SHOW (real Ed25519 path)"
    let mismatch := runLedgered st2 (some v1)
    IO.println s!"decision flip evaluated: {repr
      ((run1.1, ledger1.map (·.entries.length)),
       (mismatch.1, mismatch.2.map (·.entries.length)))}"
    -- Live path: Allow + atomic consume.
    ok := (← check "generation 1 store + generation 1 config: Allow (real crypto)"
      (isAllow run1.1.decision)) && ok
    ok := (← check "the Allow is fenced with the minting generation (1)"
      (run1.1.generation == 1)) && ok
    ok := (← check "consume recorded atomically with the Allow (1 entry)"
      ((ledger1.map fun v' => v'.entries.length == 1).getD false)) && ok
    -- One-shot within the lineage.
    ok := (← check "replay against the returned ledger: Block (one-shot consume)"
      ((ledger1.map fun v' =>
        !(isAllow (runLedgered st1 (some v')).1.decision)).getD false)) && ok
    -- STEP 0 positive: mismatch detectable, attributably.
    ok := (← check "generation MISMATCH (store 1, config 2): Block — detectable"
      (!(isAllow (runLedgered st2 (some v1)).1.decision))) && ok
    ok := (← check "DECISION FLIP: matching generation Allows while the otherwise-identical differing generation Blocks"
      (isAllow run1.1.decision && mismatch.1.decision == .Block
        && run1.1.decision != mismatch.1.decision)) && ok
    ok := (← check "discriminator: bare six-gate step under config 2 still Allows (so the Block above is the LEDGER gate's)"
      (isAllow (effectStep authority registry mediator baseEnvelope sigBase st2))) && ok
    -- Fail-closed legs.
    ok := (← check "store unavailable: Block (fail-closed)"
      (!(isAllow (runLedgered st1 none).1.decision))) && ok
    ok := (← check "unconfigured generation (0), even with a store attesting 0: Block"
      (!(isAllow (runLedgered st0
        (some { att := { att1 with generation := 0 }, entries := [] })).1.decision))) && ok
    -- STEP 0 negative: the honest limit, demonstrated.
    ok := (← check "HONEST LIMIT: rollback twin (same generation 1, entries erased) Allows the SAME envelope AGAIN — content rollback is NOT detectable, as documented"
      ((ledger1.map fun _ =>
        isAllow (runLedgered st1 (some v1)).1.decision).getD false)) && ok
    -- Honest limit #2: rotation window.
    ok := (← check "HONEST LIMIT: after rotation (config 2, fresh store 2) the still-unexpired envelope Allows AGAIN — bounded by the freshness window; rotate-then-drain is the deployment obligation"
      (isAllow (runLedgered st2 (some v2)).1.decision)) && ok
    -- Fencing.
    ok := (← check "executor fence: the generation-1 Allow is accepted at config 1"
      (executorAccepts st1 run1.1)) && ok
    ok := (← check "executor fence: the generation-1 Allow is REJECTED at config 2 (stale authority dies at rotation)"
      (!(executorAccepts st2 run1.1))) && ok
    -- Non-influence spot check: ledger gates presence, not value.
    ok := (← check "Allow bytes equal the bare six-gate step's Allow bytes (ledger gates presence, never value)"
      (run1.1.decision == effectStep authority registry mediator baseEnvelope sigBase st1)) && ok
    if ok then
      IO.println "SHOW: generation pin fail-closed, consume one-shot, fence live; honest limits demonstrated exactly as documented — GREEN"
      pure 0
    else
      IO.eprintln "SHOW: RED"
      pure 1

end Test.NonceLedgerShow

def main (args : List String) : IO UInt32 :=
  Test.NonceLedgerShow.main args
