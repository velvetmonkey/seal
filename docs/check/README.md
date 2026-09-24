# Check receipts

Inspect a decision receipt without installing the approval gate. Open the [hosted seal-check application](https://velvetmonkey.github.io/seal-check/) and start with a public example before handling private arguments.

1. [Check your first receipt](your-first-receipt.md): load a complete file and read its individual checks.
2. [Bring a receipt from Seal](from-seal.md): use the receipt and signer key from one demo run.
3. [Understand results](results.md): distinguish a blocked decision from a refused receipt.
4. [Identify the format](formats.md): choose the right key and know whether replay is available.
5. [Share safely](keys-and-sharing.md) or [run locally](run-locally.md).

The application checks supported receipt contents in your browser. Initial delivery still depends on the site and its bundled code. A successful signature or replay does not establish operator identity or prove an effect occurred. See [verification dependencies](../evidence/dependencies.md).

The browser and terminal are separate entry points. Use the [assurance CLI](../assure/README.md) when you need explicit process exit codes; do not interpret its top-level label as the browser's authority result.

Previous: [CLI assurance checks](../verify/cli.md).
Up: [Documentation map](../README.md).
Next: [Your first receipt](your-first-receipt.md).
