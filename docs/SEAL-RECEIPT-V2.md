# `seal.receipt/v2`

This is the normative receipt contract. The verifier implements this contract
independently and does not import the producer canonicaliser.

## Envelope

The discriminator is exactly `"seal_receipt":"v2"`. Top-level members occur
in the order below; optional members are omitted rather than written as `null`.
The verifier always runs its local kernel decision. There is intentionally no
receipt-only verification path: `VERIFY` calls `REPLAY` so a signed producer
answer cannot substitute for the kernel decision. REPLAY obtains only the
decision from a decision-only kernel runner; it does not load the producer's
receipt assembler.

The host route uses `passthrough`, `forward`, `block`, or `error`. The receipt
`verdict` uses `ALLOW`, `BLOCK`, or `ERROR`. The kernel decision type is
`Allow`/`Block`; the host maps one to the other. The `seal` checkout includes
the `Authorization seam differential` workflow. The workflow tests the
correspondence between interpreted Lean and shipped WASM.

The `seal.receipt/v2` checker cannot verify receipts made by v0.2.0-rc.3 or earlier.
It refuses an authentic v0.2.0-rc.3 receipt with `REFUSE read_failed: expected string`.
Keep the v0.2.0-rc.3 `seal-receipt-check.mjs` release asset and the original trusted public key to check old receipts.
Verify that checker asset against the v0.2.0-rc.3 `SHA256SUMS` release asset before use.
Seal has no converter from `seal.spine/v1` receipts to `seal.receipt/v2` receipts.
The v0.2.0-rc.3 checker cannot verify `seal.receipt/v2` receipts.
It refuses an authentic `seal.receipt/v2` receipt with `REFUSE unknown_format: unknown receipt format: undefined`.

```json
{
  "seal_receipt": "v2",
  "tool": "string",
  "action": "string (optional)",
  "arguments": "JSON object",
  "now": "non-negative safe integer",
  "kernel_config": "exact configuration given to the kernel",
  "granted_capabilities": "exact grants given to the kernel",
  "kernel_inputs": {"approvals": [], "votes": "", "grants": "", "forecasts": "", "approval_handle_sha256": "64 lowercase hex (optional)"},
  "verdict": "ALLOW | BLOCK | ERROR",
  "reason": "string",
  "replay": {"args_sha256": "sha256", "config_sha256": "sha256"},
  "signature": {"algorithm": "ed25519", "value": "128 hex"}
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
than silently ignored. `approval_handle_sha256`, when present, is the SHA-256
identity of the opaque approval handle associated with this decision. It is
signed as part of `kernel_inputs` but is not a decision input. Its omission is
accepted for receipts produced before per-grant identity was added.

## Canonicalisation

Canonical JSON is compact JSON. Arrays retain element order. Objects use
ECMAScript own-property enumeration order after parsing. Member names
use JSON escaping, followed by `:`, and values use this same rule. Duplicate
members at every object at every depth are malformed. Duplicate comparison is
after JSON unescaping of the member name, so `"a"` and `"\\u0061"` collide.
Numbers are checked by parsed value, not by the wire token: `1000.0` and
`1e3` parse as `1000`, while `1.5000` parses as the number `1.5`. Decimals,
negative fractions, and scientific notation are accepted, including in nested
objects and arrays. Numeric output uses `JSON.stringify` on the parsed
IEEE-754 binary64 value, with no additional rounding or conversion to a string;
`-0` emits as `0`. Values must be finite and in
`[-9007199254740991,9007199254740991]`; `NaN`, infinities, and values outside
that range are rejected. Field-specific integer rules still apply, including
the non-negative safe integer `now` field. Strings are UTF-8 JSON strings. On emission, JSON.stringify's
lowercase `\\ud800` form is used for a lone surrogate; this is an emission
rule, not a permission to receive ill-formed Unicode. A byte input with
ill-formed UTF-8 is refused before JSON parsing. Whitespace outside strings
is accepted on READ but is not canonical bytes.

Object members are canonicalised in ECMAScript own-property enumeration order
after parsing: integer-index keys in ascending numeric order, followed by other
string keys in insertion order. Sorting would make the receipt arguments
commitment and kernel `args_hash` different claims. The rule is a specification,
not a shared implementation; vectors are the boundary.
Seal uses this rule for the receipt arguments commitment.

Receipts containing decimals require the checker from the same updated release.
Previously accepted integer-only receipts retain their canonical bytes and
remain readable by the updated checker. The kernel wire encoding may spell a
fraction in scientific notation to satisfy its digit bound; this preserves the
parsed value and does not change the arguments in the receipt or downstream call.

## Verbs and trust result

`READ` parses received bytes with duplicate and truncation checks. `VALIDATE`
checks the v2 shape and commitments. `REPLAY` runs the recorded inputs through
the verifier's local kernel and compares its verdict with the recorded verdict;
it does not require a signature. `VERIFY` accepts a
caller-supplied public key, but refuses `authorityRoot` and `occurrenceWitness`
because the v2 verifier cannot check those inputs. A receipt key is never
trusted, and a signature alone never establishes occurrence.

The verifier reports five independent rows:

```text
Document structure       VALID
Signature and bindings   VALID
Verifier-local verdict   REPRODUCED
Authority key            UNPINNED / CALLER-SUPPLIED
Event occurrence         NOT ESTABLISHED
                         ------------------
READ      available
VALIDATE  available
REPLAY    available
VERIFY    UNVERIFIED
```

Positive `VERIFY` is unreachable in the v2 verifier: `verify` is always false,
and no receipt bytes can establish authority or occurrence.
