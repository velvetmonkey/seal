/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.V2ValidationFixtures

open SealV2
open Test.V2ValidationFixtures

/-- Print the AUTHORITATIVE canonical signed-message bytes so an off-box signer
    (the Python M5 fixture) signs exactly what `verifySignature` checks, never a
    reimplementation of the serialiser. Default = the base fixture message;
    `ttl` = the over-cap message (expiry 400, nonce B) used by the TTL reject test. -/
def main (args : List String) : IO Unit :=
  match args with
  | ["ttl"] =>
      IO.println (signedMessageRawFor
        (signedMessage { unsignedApproval with issuedAt := 0, expiresAt := 400, nonce := nonceB }))
  | ["orders"] =>
      IO.println (signedMessageRawFor (signedMessage unsignedOrdersApproval))
  | _ =>
      IO.println (signedMessageRawFor (signedMessage validApproval))
