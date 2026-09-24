# First assurance check

You will verify a bundled BLOCK decision and then observe a deliberately failing bypass sample. Prerequisites: Node.js (captured here on Linux with Node 24), a complete seal-assurance-kit checkout at the [listed revision](../evidence/sources.md), and its bundled kernel and fixtures. These examples need no Lean build and do not contact a running MCP server.

From that checkout:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal verify fixtures/receipt-block.json
```

Captured output excerpt (exit 0):
```text
  PASS  kernel-attested request binding (audit sha256 of the judged bytes equals the request identity)   (460d746ba064)
  PASS  emitted decision bytes byte-identical modulo the kernel request commitment
  PASS  VERIFIED (bundled self-check; not independent verification)
```

The BLOCK decision passed the applicable checks. The final qualification matters: this is a bundled self-check, not independent verification of your deployment.

Now use the deliberately failing bypass fixture:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal verify fixtures/receipt-bypass.json
```

Captured output excerpt (exit 1):
```text
  PASS  schema valid (v1)
  FAIL  mediated (a kernel verdict exists)   (bypass receipt — NOT MEDIATED; nothing to verify, and its ALLOW is not a kernel verdict)
  FAIL  NOT MEDIATED (bypass receipt)
```

Exit 1 is the expected finding for this sample. Do not treat every nonzero exit as equivalent: usage, internal errors and reduced scope have different meanings. Proceed to [verify your own receipt](verify.md).

Previous: [Assurance CLI](README.md).
Up: [Assurance CLI](README.md).
Next: [Verify a receipt in the kit](verify.md).
