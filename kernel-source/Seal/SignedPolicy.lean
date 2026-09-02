/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Classify
import SealCore.Automaton
import SealV2.Crypto

/-!
# Tamper ⇒ fail-closed, policy side

The reference gate for signed policies: verify the Ed25519 signature over
the exact policy bytes FIRST, parse second, and classify only under a
policy that verified. A policy whose signature does not verify yields a
fail-closed default-deny for every tool call — never a pass.

This is the anti-theater guarantee the demo asserts at runtime: the policy
the demo blocks against is cryptographically the policy that was signed.
`classifyUnderSignedPolicy` is the REFERENCE semantics the runtime must
implement; that the deployed host calls it faithfully is an engineering
claim (TCB, assumption A3), not a theorem — same posture as `Ffi.lean`.
Crypto correctness of `ed25519Verify` is likewise A3.
-/

namespace Seal

open Lean

/-- Ed25519 over the exact policy text bytes. Fail-closed: malformed hex in
    either the key or the signature verifies as `false`. -/
def verifyPolicySignature (publicKeyHex policyText signatureHex : String) : Bool :=
  match SealV2.hexDecode? publicKeyHex, SealV2.hexDecode? signatureHex with
  | some publicKey, some signature =>
      SealV2.ed25519Verify publicKey policyText.toUTF8 signature
  | _, _ => false

/-- Verify first, parse second. A policy that does not verify never parses. -/
def loadVerifiedPolicy (publicKeyHex policyText signatureHex : String) :
    Except String Policy :=
  if verifyPolicySignature publicKeyHex policyText signatureHex then
    Json.parse policyText >>= parsePolicyJson
  else
    .error "policy signature verification failed"

/-- The signed-policy gate: classify only under a verified policy; anything
    else is default-deny. -/
def classifyUnderSignedPolicy (publicKeyHex policyText signatureHex : String)
    (toolName : String) (args : Json) : HostEvent :=
  match loadVerifiedPolicy publicKeyHex policyText signatureHex with
  | .error reason => .event .defaultDeny s!"fail-closed policy: {reason}"
  | .ok policy => classifyToolCall policy toolName args

/-- **Tamper ⇒ fail-closed (policy).** A policy whose signature does not
    verify classifies EVERY call default-deny. -/
theorem tampered_policy_fail_closed (publicKeyHex policyText signatureHex : String)
    (hsig : verifyPolicySignature publicKeyHex policyText signatureHex = false)
    (toolName : String) (args : Json) :
    (classifyUnderSignedPolicy publicKeyHex policyText signatureHex
      toolName args).toEvent = .defaultDeny := by
  unfold classifyUnderSignedPolicy loadVerifiedPolicy
  rw [hsig]
  rfl

/-- The gate then blocks at the wire: a tampered policy can never produce a
    forwarded call. -/
theorem tampered_policy_blocks (publicKeyHex policyText signatureHex : String)
    (hsig : verifyPolicySignature publicKeyHex policyText signatureHex = false)
    (toolName : String) (args : Json) (now : Nat) (s : SealCore.State) :
    (SealCore.step now s (classifyUnderSignedPolicy publicKeyHex policyText
      signatureHex toolName args).toEvent).1 = SealCore.Decision.block := by
  have hdeny := tampered_policy_fail_closed publicKeyHex policyText signatureHex
    hsig toolName args
  rw [hdeny]
  rfl

/-- Malformed key or signature hex is already a verification failure — the
    fail-closed path needs no well-formed attacker input. -/
theorem malformed_signature_hex_fails (publicKeyHex policyText signatureHex : String)
    (h : SealV2.hexDecode? signatureHex = none) :
    verifyPolicySignature publicKeyHex policyText signatureHex = false := by
  unfold verifyPolicySignature
  rw [h]
  cases SealV2.hexDecode? publicKeyHex <;> rfl

end Seal
