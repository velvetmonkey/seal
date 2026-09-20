# Use kit results in CI

Run the kit from a checkout pinned to the [reviewed source commit](../evidence/sources.md), with Node and the checked-in kernel. Preserve stdout, stderr, exit status and the input receipt bytes as distinct artifacts. Do not download mutable verifier code during a decision without an explicit trust/update policy.

This minimal verification invocation was exercised locally:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal verify fixtures/receipt-block.json
```

Captured output excerpt (exit 0):
```text
  PASS  VERIFIED (bundled self-check; not independent verification)
```

For a real pipeline, replace the public fixture with the intended input and independently provision required public-key pins. Never derive the operator trust anchor from the very receipt being checked.

| Verify exit | Pipeline interpretation |
|---|---|
| 0 | Applicable P-REF checks passed; retain the bundled-self-check scope |
| 1 | A check failed or the input was not mediated |
| 2 | Invocation/option error; fix the job |
| 3 | Internal failure; no verdict |
| 4 | Reduced scope; do not silently count it as verified |

Receipt diff and adequacy have their own semantics, including no-drift and vacuous outcomes. Evaluate the command-specific result, not a family-wide green label.

The separate seal-verify-action uses a stricter production profile. Do not substitute it blindly for the kit or assume identical receipt-family support. A complete hosted workflow was not executed for this guide; the local command and its exit were captured.

Previous: [Run the boundary conformance corpus](conformance.md).
Up: [Assurance CLI](README.md).
Next: [Prepare a reviewable host policy](configure.md).
