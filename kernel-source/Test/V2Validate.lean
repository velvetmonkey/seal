/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures

open SealV2
open Test.V2ValidationFixtures

def expectSomeValidate (name raw : String) (state : ApprovalState) : IO Unit := do
  match parse raw with
  | none => throw <| IO.userError s!"{name}: expected parse success"
  | some ast =>
      match validate ast state with
      | some _ => pure ()
      | none => throw <| IO.userError s!"{name}: expected validation witness"

def expectNoneValidate (name raw : String) (state : ApprovalState) : IO Unit := do
  match parse raw with
  | none => throw <| IO.userError s!"{name}: expected parse success before validation rejection"
  | some ast =>
      match validate ast state with
      | none => pure ()
      | some _ => throw <| IO.userError s!"{name}: expected validation failure"

def approvalSignedOverRaw (raw : RawBytes) : Approval :=
  -- These cases drive non-canonical `raw` through the signed path, which is rejected
  -- at `signedParse` BEFORE the signature check, so the signature value is irrelevant.
  { unsignedApproval with
    signedMessageRaw := raw,
    signature := ""
  }

-- An approval whose claimed lifetime (issuedAt..expiresAt) exceeds the 300s default cap.
def approvalTtlExceedsCap : Approval :=
  approvalWithSig { unsignedApproval with issuedAt := 0, expiresAt := 400, nonce := nonceB } sigOverTtlMessage

-- The replay namespace the valid request lands in under baseState.
def baseNamespace : ReplayNamespace :=
  replayNamespace baseState target

def expectStoreAccept (name raw : String) (state : ApprovalState)
    (store : List ConsumedNonce) : IO (List ConsumedNonce) := do
  match parse raw with
  | none => throw <| IO.userError s!"{name}: expected parse success"
  | some ast =>
      match validateAndConsumeWithStore listReplayStore store ast state with
      | some (store', _) => pure store'
      | none => throw <| IO.userError s!"{name}: expected store-path acceptance"

def expectStoreReject (name raw : String) (state : ApprovalState)
    (store : List ConsumedNonce) : IO Unit := do
  match parse raw with
  | none => throw <| IO.userError s!"{name}: expected parse success"
  | some ast =>
      match validateAndConsumeWithStore listReplayStore store ast state with
      | none => pure ()
      | some _ => throw <| IO.userError s!"{name}: expected store-path rejection"

inductive ReplayStoreErrorSeam where
  | pruneExpired
  | contains
  | insertConsumed
  deriving BEq

/-- A replay store mutant that can inject one targeted backend error. With
    `injectError = false`, the same store delegates every operation to the
    normal list store and is the positive control for the deny assertion. -/
def replayStoreErrorMutant (seam : ReplayStoreErrorSeam) (injectError : Bool) :
    ReplayStoreOps (List ConsumedNonce) where
  contains? entries ns nonce :=
    if injectError && seam == .contains then
      .error (.backend "injected contains? failure")
    else
      listReplayStore.contains? entries ns nonce
  insertConsumed entries entry :=
    if injectError && seam == .insertConsumed then
      .error (.backend "injected insertConsumed failure")
    else
      listReplayStore.insertConsumed entries entry
  pruneExpired entries now :=
    if injectError && seam == .pruneExpired then
      .error (.backend "injected pruneExpired failure")
    else
      listReplayStore.pruneExpired entries now

def expectStoreErrorDenyWithPositiveTwin (name : String) (seam : ReplayStoreErrorSeam)
    (raw : String) (state : ApprovalState) (store : List ConsumedNonce) : IO Unit := do
  match parse raw with
  | none => throw <| IO.userError s!"{name}: expected parse success"
  | some ast =>
      match validateAndConsumeWithStore (replayStoreErrorMutant seam true) store ast state with
      | some _ =>
          throw <| IO.userError s!"{name}: injected store error was not denied"
      | none => pure ()
      match validateAndConsumeWithStore (replayStoreErrorMutant seam false) store ast state with
      | none =>
          throw <| IO.userError s!"{name}: positive twin was not accepted"
      | some _ => pure ()

def expectSignedPathRejects (name raw : String) : IO Unit := do
  match signedParse raw with
  | none =>
    expectNoneValidate name validRaw { baseState with approvals := [approvalSignedOverRaw raw] }
    match decide validRaw { baseState with approvals := [approvalSignedOverRaw raw] } with
    | .Block => pure ()
    | .Allow out => throw <| IO.userError s!"{name}: expected mediated decision block, got {out}"
  | some _ =>
    throw <| IO.userError s!"{name}: expected signedParse rejection"

def main : IO UInt32 := do
  expectSomeValidate "valid witness" validRaw baseState
  expectNoneValidate "unknown tool" (requestRaw "db.query" "write" "{\"database\":\"prod\",\"table\":\"users\",\"amount\":12.34}") baseState
  expectNoneValidate "unknown action" (requestRaw "db.execute" "read" "{\"database\":\"prod\",\"table\":\"users\",\"amount\":12.34}") baseState
  expectNoneValidate "no approval" validRaw { baseState with approvals := [] }
  expectNoneValidate "target mismatch" (requestRaw "db.execute" "write" "{\"database\":\"prod\",\"table\":\"payments\",\"amount\":12.34}") baseState
  expectNoneValidate "session mismatch" validRaw { baseState with session := "session-2" }
  expectNoneValidate "consumed approval" validRaw { baseState with approvals := [approvalWithSig { unsignedApproval with consumed := true } sigOverBaseMessage] }
  expectNoneValidate "expired approval" validRaw { baseState with now := 121 }
  expectNoneValidate "bad stub signature" validRaw { baseState with approvals := [{ unsignedApproval with signature := "bad-signature" }] }
  expectSignedPathRejects "signed trailing whitespace" (validApproval.signedMessageRaw ++ " ")
  expectSignedPathRejects "signed leading whitespace" (" " ++ validApproval.signedMessageRaw)
  expectSignedPathRejects "signed interior whitespace"
    "{\"target\": {\"tool\":\"db.execute\",\"action\":\"write\",\"toolVersion\":\"v1\",\"manifestDigest\":\"manifest-001\",\"arguments\":{\"database\":\"prod\",\"table\":\"users\",\"amount\":12.34}},\"session\":\"session-1\",\"expiry\":120}"
  IO.println "M2 validation corpus passed: 1 accepted, 11 rejected"
  -- A3: TTL cap, replay rejection, namespace isolation, expiry-pruning.
  expectNoneValidate "ttl exceeds 300s cap" validRaw { baseState with approvals := [approvalTtlExceedsCap] }
  expectNoneValidate "nonce already consumed (validate path)" validRaw
    { baseState with consumedNonces := [{ ns := baseNamespace, nonce := nonceA, expiresAt := 100 }] }
  expectSomeValidate "expired consumed nonce pruned (validate path)" validRaw
    { baseState with consumedNonces := [{ ns := baseNamespace, nonce := nonceA, expiresAt := 5 }] }
  let storeAfterFirst ← expectStoreAccept "store first consume" validRaw baseState []
  expectStoreReject "store replay same namespace rejects" validRaw baseState storeAfterFirst
  let _ ← expectStoreAccept "store same nonce different namespace accepts" validRaw
    { baseState with policyVersion := "policy-2" } storeAfterFirst
  let _ ← expectStoreAccept "store expired consumed nonce pruned" validRaw baseState
    [{ ns := baseNamespace, nonce := nonceA, expiresAt := 5 }]
  IO.println "A3 replay/TTL corpus passed: 3 accepted, 3 rejected"
  expectStoreErrorDenyWithPositiveTwin "pruneExpired error denies / ok accepts"
    .pruneExpired validRaw baseState []
  expectStoreErrorDenyWithPositiveTwin "contains? error denies / ok accepts"
    .contains validRaw baseState []
  expectStoreErrorDenyWithPositiveTwin "insertConsumed error denies / ok accepts"
    .insertConsumed validRaw baseState []
  IO.println "Replay-store error arms passed: 3 denied, 3 positive twins accepted"
  pure 0
