# Receipt operations

Seal is the canonical reference for the four operations of the shipped v2
receipt verifier, `checker/seal-receipt-v2.mjs`. It describes TESTED behaviour
of that checker, not a claim that a receipt makes an outside event true.

## The four verbs

- **READ** parses and displays the receipt. It makes no authenticity claim,
  executes nothing, and asserts no validity.
- **VALIDATE** performs non-executing integrity checks: syntax, duplicate-member
  refusal, schema, canonical-value rules, field commitments, and a signature
  against the SUPPLIED key. It establishes that the receipt has the canonical
  parsed value signed by that key, not that the key is trusted.
- **REPLAY** loads the receipt's recorded inputs, recomputes with the verifier's
  local kernel, and compares its verdict with the recorded verdict. It
  establishes that those verdicts agree under those inputs, not that the
  verifier used the original kernel, nor authority or occurrence.
- **VERIFY** applies a NAMED profile to the available evidence and trust inputs,
  then emits a row-by-row report. It is never a synonym for “everything here is
  true”. No receipt-only profile may claim that the downstream effect occurred.

The verifier currently returns `verify: false` for every receipt. A positive
VERIFY is therefore unreachable. Supplying `authorityRoot` refuses with
`authority roots cannot be checked by the v2 verifier`; supplying
`occurrenceWitness` refuses with `occurrence witnesses cannot be checked by the
v2 verifier`. The refusal is honest: the Phase A verifier has no format or
check for either input, so accepting either would turn an unchecked assertion
into supposed evidence. Presence is tested, including empty, null, zero, and
false values.

## Shipped output

The following block is rendered from the versioned [v1 vector set](receipt-operations-v1/README.md)
by the shipped verifier. It is checked in CI against `format()`.

<!-- receipt-operations-format -->
```output
Document structure       VALID
Signature and bindings   UNVERIFIED
Verifier-local verdict   REPRODUCED
Authority key            NOT ESTABLISHED
Event occurrence         NOT ESTABLISHED
                         ------------------
READ      available
VALIDATE  available
REPLAY    available
VERIFY    UNVERIFIED
```

The five rows are independent: structure, signature and bindings, Verifier-local
verdict, authority key, and event occurrence. In particular, `REPLAY` does not
establish authority, and no row establishes occurrence.

## Run it

From the checkout root, run the linked v1 vector with Node 20 or newer:

```bash
node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json
```

The normative envelope and canonicalisation rules remain in
[SEAL-RECEIPT-V2.md](../SEAL-RECEIPT-V2.md). This page owns the meaning of the
four operational verbs and the trust ceiling of the shipped verifier.

Previous: [Reference](README.md).
Up: [Reference](README.md).
Next: [Multi-tool semantics](multi-tool-semantics.md).
