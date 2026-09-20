# Receipt formats and compatibility

Choose by the full document shape and producer, not its version string alone. Both Protect and decision receipts can carry seal_receipt v2. Ambiguous, duplicate or malformed discriminators must not be normalized by copying fields into another schema.

| Family | Producer and identifying shape | Key and replay | Limit |
|---|---|---|---|
| Protect v2 | Seal Node gate; whole-receipt seal, commitments and recorded kernel inputs | Separate receipt-signer public key; verifier-local decision replay | No producer kernel identity; authority and occurrence not established |
| Spine v1 | Older Node gate; receipt field seal.spine/v1 | Separate receipt-signer public key; signature and bindings | No kernel replay |
| Decision receipts | Kernel/host family; signed configuration and request/decision bindings | Config-signer trust anchor depends on profile; replay where the request can be reconstructed | Unparseable input can yield reduced scope; unsigned/legacy shapes have their own refusal paths |

The Protect [normative contract](../SEAL-RECEIPT-V2.md) accepts finite decimals in its supported range. At the pinned companion revisions in [sources](../evidence/sources.md), the browser and kit still reject decimal arguments that the product contract permits. That is a checker compatibility gap, not an invalid producer receipt. String/integer examples passing do not close it. A separate canonicalization change is required before broader support can be claimed.

For exact structural validation, use [format references](reference/README.md). Preserve receipt bytes: duplicate keys, lossy JSON parsing and reserialization can erase evidence that the document validator needs.

Previous: [Read receipt results](results.md).
Up: [Check receipts](README.md).
Next: [Keys and safe sharing](keys-and-sharing.md).
