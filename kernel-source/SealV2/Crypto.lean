/- SPDX-License-Identifier: Apache-2.0 -/

namespace SealV2

/--
TCB(A3) boundary — real Ed25519 verification.

The actual signature check is performed by vendored TweetNaCl (pure Ed25519 /
RFC 8032) behind the FFI symbol `lean_seal_ed25519_verify` (see `c/seal_ed25519.c`).

`opaque` keeps the proof core honest in two ways:
* it adds NO axiom (an opaque constant is not an axiom; `#print axioms` stays
  `[propext, Classical.choice, Quot.sound]`), and
* the kernel cannot reduce it, so no proof can accidentally "compute" a crypto
  result — `verifySignature` is consumed only as a runtime `Bool` hypothesis.

Origin authentication therefore rests on the TRUSTED ASSUMPTION
**A3 = "the vendored ed25519 verify is correct"**, NOT on any Lean theorem.
`true` iff `signature` (64 bytes) is a valid Ed25519 signature of `message`
under `publicKey` (32 bytes).
-/
@[extern "lean_seal_ed25519_verify"]
opaque ed25519Verify (publicKey message signature : ByteArray) : Bool

/-- Value of a single hex digit, or `none` if `c` is not `[0-9a-fA-F]`. -/
def hexDigit? (c : Char) : Option UInt8 :=
  if '0' ≤ c ∧ c ≤ '9' then some (UInt8.ofNat (c.toNat - '0'.toNat))
  else if 'a' ≤ c ∧ c ≤ 'f' then some (UInt8.ofNat (c.toNat - 'a'.toNat + 10))
  else if 'A' ≤ c ∧ c ≤ 'F' then some (UInt8.ofNat (c.toNat - 'A'.toNat + 10))
  else none

/-- Decode a list of hex chars (pairs, high nibble first) into bytes. Structural
    recursion, consuming two chars per step. -/
def hexBytes? : List Char → Option (List UInt8)
  | [] => some []
  | [_] => none
  | hi :: lo :: rest => do
      let h ← hexDigit? hi
      let l ← hexDigit? lo
      let tail ← hexBytes? rest
      some ((h * 16 + l) :: tail)

/-- Decode a hex string into a `ByteArray`. `none` on odd length or any non-hex
    character. Pure Lean — axiom-clean. -/
def hexDecode? (s : String) : Option ByteArray :=
  (hexBytes? s.toList).map (fun bytes => ⟨bytes.toArray⟩)

end SealV2
