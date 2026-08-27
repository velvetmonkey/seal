# `seal.receipt/v2` (Phase A)

This is the normative Phase A contract. It is written before the Phase B
producer. The verifier implements it independently and does not import a
producer canonicaliser.

## Envelope

The discriminator is exactly `"seal_receipt":"v2"`. Top-level members occur
in the order below; optional members are omitted rather than written as `null`.
The verifier always runs the kernel decision. There is intentionally no
receipt-only verification path: `VERIFY` calls `REPLAY` so a signed producer
answer cannot substitute for the kernel decision. REPLAY obtains only the
decision from a decision-only kernel runner; it does not load the producer's
receipt assembler.

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
preimage is exactly the UTF-8 bytes, with no BOM and no trailing newline, of
the compact canonical JSON envelope with the `signature` member omitted.
The omitted member is removed before canonicalization; it is not represented
by `null` or an empty value.

Replay passes `approvals`, `votes`, `grants`, `forecasts`, and
`granted_capabilities` to the decision input. `granted_capabilities` must
contain `{ "target": string }` entries in the same order and with the same
strings as `kernel_inputs.approvals`; a mismatch is refused. The current
kernel consumes `votes`; `grants` and `forecasts` are reserved inert channels
and must be the empty string, so any tampering with either is refused rather
than silently ignored.

## Canonicalisation

Canonical JSON is compact JSON. Arrays retain element order. Objects retain
the member order in the received object; keys are never sorted. Member names
use JSON escaping, followed by `:`, and values use this same rule. Duplicate
members at every object at every depth are malformed. Duplicate comparison is
after JSON unescaping of the member name, so `"a"` and `"\\u0061"` collide.
Numbers are checked by parsed value, not by the wire token: `1000.0` and
`1e3` READ and parse as the safe integer `1000`, while `1.5` READs and then
fails in `canonical()` with `number_not_canonical`. Canonical numeric output
is finite, integral, and in the safe range
`[-9007199254740991,9007199254740991]`; `NaN`, infinities, and unsafe values
are rejected. Strings are UTF-8 JSON strings. On emission, JSON.stringify's
lowercase `\\ud800` form is used for a lone surrogate; this is an emission
rule, not a permission to receive ill-formed Unicode. A byte input with
ill-formed UTF-8 is refused before JSON parsing. Whitespace outside strings
is accepted on READ but is not canonical bytes.

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
