# `seal.receipt/v2` (Phase A)

This is the normative Phase A contract. It is written before the Phase B
producer. The verifier implements it independently and does not import a
producer canonicaliser.

## Envelope

The discriminator is exactly `"seal_receipt":"v2"`. Members occur in this
order; optional members are omitted rather than written as `null`:

```json
{
  "seal_receipt": "v2",
  "tool": "string",
  "action": "string (optional)",
  "arguments": "JSON object",
  "now": "non-negative safe integer",
  "kernel_config": "exact configuration given to the kernel",
  "granted_capabilities": "exact grants given to the kernel",
  "kernel_inputs": {"approvals": [], "votes": "", "grants": "", "forecasts": ""},
  "verdict": "ALLOW | BLOCK | ERROR",
  "reason": "string",
  "replay": {"args_sha256": "sha256", "config_sha256": "sha256"},
  "signature": {"algorithm": "ed25519", "key_id": "string", "value": "128 hex"}
}
```

`signature` may be absent for an unsigned receipt. `now` is the exact value
given to the kernel, not a timestamp derived from another field. The signature
preimage is the UTF-8 bytes of the envelope with `signature` omitted.

## Canonicalisation

Canonical JSON is compact JSON. Arrays retain element order. Objects retain
the member order in the received object; keys are never sorted. Member names
use JSON escaping, followed by `:`, and values use this same rule. Duplicate
members are malformed and are rejected before parsing can discard one copy.
Numbers must be finite, integral, and in the safe range
`[-9007199254740991,9007199254740991]`; fractions, non-integral exponents,
`NaN`, infinities, and unsafe integers are rejected. Strings are UTF-8 JSON
strings; lone surrogates are escaped. Whitespace outside strings is not
canonical bytes.

Insertion order is deliberate: the kernel's Object-B inputs are replayed by
`JSON.stringify`, which preserves stored order. Sorting would make the receipt
arguments commitment and kernel `args_hash` different claims. The rule is a
specification, not a shared implementation; vectors are the boundary.

## Verbs and trust result

`READ` parses received bytes with duplicate and truncation checks. `VALIDATE`
checks the v2 shape and commitments. `REPLAY` runs the recorded kernel inputs
and compares the verdict; it does not require a signature. `VERIFY` additionally
requires a caller-supplied public key and an occurrence witness. A receipt key
is never trusted, and a signature alone never establishes occurrence.

The verifier reports five independent rows:

```text
Document structure       VALID
Signature and bindings   VALID
Kernel decision          REPRODUCED
Authority key            UNPINNED / CALLER-SUPPLIED
Event occurrence         NOT ESTABLISHED
                         ------------------
READ      available
VALIDATE  available
REPLAY    available
VERIFY    UNVERIFIED
```

Positive `VERIFY` is unavailable until both an independently provisioned
authority root and an occurrence witness are supplied. No receipt bytes can
establish the latter.
