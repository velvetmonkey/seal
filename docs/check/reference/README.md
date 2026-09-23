# Receipt checking reference

The full document validator chooses the receipt family before a family-specific verifier runs. Do not substitute a parsed object for original wire bytes when investigating duplicate fields, escaped discriminators, malformed JSON or canonicalization.

| Reference | Owner and role |
|---|---|
| [Protect v2](../../SEAL-RECEIPT-V2.md) | Seal's normative whole-receipt contract |
| [Decision receipt schema](https://github.com/velvetmonkey/seal-check/blob/a93003a1e4b2c536a52637f184e6a2cd26eb5bbf/docs/DECISION-RECEIPT-SCHEMA.md) | Decision-family schema; retain its version-specific and historical distinctions |
| [Document and family parser](https://github.com/velvetmonkey/seal-check/blob/a93003a1e4b2c536a52637f184e6a2cd26eb5bbf/receipt-format.js) | Actual intake and discriminator rules |
| [Protect verifier](https://github.com/velvetmonkey/seal-check/blob/a93003a1e4b2c536a52637f184e6a2cd26eb5bbf/protect-receipt.js) | Commitment, signature and local replay checks |
| [Spine verifier](https://github.com/velvetmonkey/seal-check/blob/a93003a1e4b2c536a52637f184e6a2cd26eb5bbf/spine-receipt.js) | Older signature/binding checks without replay |

For a refusal, retain the exact diagnostic, format, source revision and key provenance. A commitment mismatch suggests altered or inconsistently constructed contents; a signature mismatch can also mean the wrong public key. Neither should be repaired by editing the original receipt until the check passes.

[Results](../results.md) explains authority and occurrence limits. [Formats](../formats.md) records the decimal compatibility gap at these revisions.

Previous: [Run the checker locally](../run-locally.md).
Up: [Check receipts](../README.md).
Next: [Assurance CLI](../../assure/README.md).
