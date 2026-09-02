/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures

open SealV2
open Test.V2ValidationFixtures

/-! M6 lifecycle acceptance corpus, run over the real store state-machine
    (`validateAndConsumeWithStore` against `listReplayStore`). The fresh-token ACCEPT path
    clears the real M5 Ed25519 `verifySignature` via the re-vectored `validApproval`/`baseState`
    test vector — not a stub. -/

/-- An over-cap approval (lifetime 400 > the 300s cap), signed over its own message (M_B). -/
def approvalTtlExceedsCap : Approval :=
  approvalWithSig { unsignedApproval with issuedAt := 0, expiresAt := 400, nonce := nonceB }
    sigOverTtlMessage

structure Case where
  name : String
  outcome : String   -- "Allow" | "Block"

def runCorpus : Except String (List Case) := do
  let some ast := parse validRaw
    | .error "validRaw failed to parse"
  -- 1. FRESH: legitimate token consumes once (real Ed25519 signature verifies).
  let some (store1, _) := validateAndConsumeWithStore listReplayStore [] ast baseState
    | .error "fresh token: expected Allow (real signature must verify)"
  -- 2. REPLAY: same nonce re-presented to the post-state is denied.
  let none := validateAndConsumeWithStore listReplayStore store1 ast baseState
    | .error "replay: expected Block"
  -- 3. MONOTONICITY: the consumed nonce is still recorded in the post-state.
  let .ok true := listReplayStore.contains? store1
      (replayNamespace baseState target) validApproval.nonce
    | .error "monotonicity: consumed nonce not recorded in post-state"
  -- 4. EXPIRED (valid signature, now > expiry): denied — origin ≠ authorization.
  let none := validateAndConsumeWithStore listReplayStore [] ast { baseState with now := 200 }
    | .error "expired valid-sig: expected Block"
  -- 5. TTL OVER CAP: lifetime beyond the cap is rejected at validate.
  let none := validateAndConsumeWithStore listReplayStore []
      ast { baseState with approvals := [approvalTtlExceedsCap] }
    | .error "ttl over cap: expected reject"
  .ok [ { name := "fresh token (real sig)",        outcome := "Allow" },
        { name := "replay same nonce",             outcome := "Block" },
        { name := "consumed nonce recorded",       outcome := "Allow" },
        { name := "expired (valid sig, now>expiry)", outcome := "Block" },
        { name := "ttl over cap",                  outcome := "Block" } ]

def main (args : List String) : IO UInt32 := do
  match runCorpus with
  | .error e => IO.eprintln s!"M6 lifecycle corpus FAILED: {e}"; pure 1
  | .ok cases =>
      if "--dump" ∈ args then
        IO.println "OUTCOME CASE"
        for c in cases do IO.println s!"{c.outcome}  {c.name}"
      else
        let allows := (cases.filter (fun c => c.outcome == "Allow")).length
        let blocks := (cases.filter (fun c => c.outcome == "Block")).length
        IO.println s!"M6 lifecycle corpus passed: {allows} allowed, {blocks} blocked (real store machine)"
      pure 0
