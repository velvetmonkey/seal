# Compare receipt authorization surfaces

Receipt diff answers what changed between supported decision receipts. It is not a replacement for signature verification, and support is narrower than the kit's general receipt verifier: do not assume Protect or Spine inputs work because verify accepts them.

Use the two complete shipped decision fixtures:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal receipt-diff fixtures/receipt-allow.json fixtures/receipt-block.json
```

Captured output excerpt (exit 1):
```text
  reason: "every gating kernel allows" -> "safety kernel: 85545fe075783b72f2703c8b4769da0b5ef1962bc2e8ecf62e3c9bf366a65aca"
  certs: [{"kernel":"safety","verdict":"allow","reason":"a1fb55c62c23d6ceb4a4df45e9d33f0e051f8985aab3364f…(373 chars) -> [{"kernel":"safety","verdict":"deny","reason":"85545fe075783b72f2703c8b4769da0b5ef1962bc2e8ecf62…(253 chars)
  emitted_bytes: "{\"audit\":\"{\\\"certs\\\":[{\\\"certHash\\\":\\\"8801008679152932153\\\",\\\"kernel\\\":\\\"s…(749 chars) -> "{\"audit\":\"{\\\"certs\\\":[{\\\"certHash\\\":\\\"15905329309224772208\\\",\\\"kernel\\\":\\\"…(828 chars)
RESULT: AUTHORIZATION DRIFT — these receipts do not authorize the same thing
scope: reports what changed, not whether either receipt verifies (`seal verify`) or whether the field set is sufficient to authorize the effect
```

Exit 1 means authorization-surface drift. Minor metadata differences are grouped separately. The command checks the supported document shape and integrity bindings it requires, but does not re-verify a seal or judge whether the field set is sufficient for your policy.

For machine-readable output, this invocation was also exercised:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal receipt-diff fixtures/receipt-allow.json fixtures/receipt-block.json --json
```

Captured output excerpt (exit 1):
```text
    }
  ],
  "result": "AUTHORIZATION DRIFT",
  "exit": 1
}
```

Keep both source receipts with the result. Exit 0 means no authorization drift, 1 means drift, and 2 means malformed, legacy or tampered input. This command-specific contract differs from verify. Never turn an input error into “no change.”

Previous: [Scan policy coverage](scan.md).
Up: [Assurance CLI](README.md).
Next: [Check finite monitor adequacy](adequacy.md).
