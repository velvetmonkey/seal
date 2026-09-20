# Your first receipt

Start with the public [Protect BLOCK receipt](https://github.com/velvetmonkey/seal-check/blob/a93003a1e4b2c536a52637f184e6a2cd26eb5bbf/examples/protect-block.receipt.json) and its [example signer public key](https://github.com/velvetmonkey/seal-check/blob/a93003a1e4b2c536a52637f184e6a2cd26eb5bbf/examples/protect-signer.pub). Save the raw files, not GitHub's HTML page. These are public demonstration data, not a real operator trust anchor.

Open the [checker](https://velvetmonkey.github.io/seal-check/). Choose the receipt with **Or open a receipt file**, then choose the public key file or paste its 64 hexadecimal characters into the signer field. You can instead paste the complete receipt JSON. Checking runs on input; there is no separate Verify button.

Read signature, commitment and replay rows independently. BLOCK is the recorded decision, not a failed verification. Authority and occurrence remain unverified even when those checks pass.

For an intentionally invalid example, change the argument text in the paste box. The signed commitments no longer match; the checker refuses the edited receipt. Keep the original unchanged. If intake fails before checks appear, confirm that you saved JSON rather than a web page, used the complete document, and supplied the corresponding public key. Continue with [results](results.md).

Previous: [Check receipts](README.md).
Up: [Check receipts](README.md).
Next: [From a Seal demo to the browser](from-seal.md).
