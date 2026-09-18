# From a Seal demo to the browser

First complete [your first approval](../guide/first-approval.md). Keep the printed demo directory: it contains the receipt files and the separate receipt-signer.pub file. Choose the BLOCK receipt printed after the replay, and retain its exact bytes.

Open the [checker](https://velvetmonkey.github.io/seal-check/), select that receipt file, then select receipt-signer.pub from the **same run**. The signer control appears after a Protect or Spine receipt is selected. No command needs to run in the browser.

This walkthrough was exercised on Linux with Seal v0.4.0 and the checker revision listed in [sources](../evidence/sources.md). A freshly emitted demo receipt passed signature, argument/config commitment and local replay checks. Changing its argument produced a commitment refusal. This establishes the observed example's compatibility, not every number or optional field allowed by the contract.

The demo key establishes self-consistency only: it came from the producer that made the receipt. For operator authority, obtain the applicable trust material separately. Protect receipts do not carry producer kernel identity; verifier-local replay cannot identify the producer's binary. Event occurrence is not established.

Use [terminal verification](../assure/verify.md) for the same bytes, and [format support](formats.md) before checking older or decimal-bearing receipts.

Previous: [Your first receipt](your-first-receipt.md).
Up: [Check receipts](README.md).
Next: [Read receipt results](results.md).
