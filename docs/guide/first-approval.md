# Your first approval

Run a disposable exact-call example before configuring a real MCP server. Use the [published installation](../start/install.md) for normal operation. This captured example used the source checkout, Node on Linux and a dedicated scratch directory, with no real client configuration.

Seal · Linux Bash · working directory: the Seal checkout:

```bash
node bin/seal demo --dir /home/monkey/scratch/sealdocspass2/demo
```

The demo prints the selected tool, arguments and approval scope, then asks Approve? Answer y interactively. The run used for these guides observed one child call, then a BLOCK receipt when the identical approval response was replayed. The directory remains after completion so you can inspect its receipts and receipt-signer.pub.

The demo also writes directly outside the protected path. That write changes the file without increasing the protected-server call count or creating another decision receipt. This is an intentional demonstration of the gate boundary, not another approved tool execution.

Open the printed BLOCK receipt and matching public key in [the browser](../check/from-seal.md), then read [the kit's interpretation](../assure/verify.md). Keep the directory until those checks are complete; afterwards remove only your disposable demo files. At-most-once is not a promise that every approved operation succeeds, and this scripted server is not a real Claude Code acceptance walk.

Previous: [GitHub Actions provenance](github-actions-provenance.md).
Up: [Guide](README.md).
Next: [Change, recover and remove protection](lifecycle.md).
