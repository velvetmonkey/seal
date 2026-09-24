# From a Seal demo to the browser

First complete [your first approval](../guide/first-approval.md). Keep the printed demo directory: it contains the receipt files and the separate receipt-signer.pub file. Choose the BLOCK receipt printed after the replay, and retain its exact bytes.

Open the [checker](https://velvetmonkey.github.io/seal-check/), select that receipt file, then select receipt-signer.pub from the **same run**. The signer control appears after a Protect or Spine receipt is selected. No command needs to run in the browser.

The [dated walkthrough capture](../archive/pass2-captures.md) records the exact tested version and observed checks. Use [sources](../evidence/sources.md) to identify the companion revisions.

The demo key establishes self-consistency only: it came from the producer that made the receipt. For operator authority, obtain the applicable trust material separately. Protect receipts do not carry producer kernel identity; verifier-local replay cannot identify the producer's binary. Event occurrence is not established.

Use [terminal verification](../assure/verify.md) for the same bytes, and [format support](formats.md) before checking older or decimal-bearing receipts.

Previous: [Your first receipt](your-first-receipt.md).
Up: [Check receipts](README.md).
Next: [Read receipt results](results.md).
