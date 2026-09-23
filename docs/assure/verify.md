# Verify a receipt in the kit

The kit dispatches by receipt family. For decision receipts, it checks schema, pinned local kernel identity, canonical request bindings and replay where available. Principal-bearing receipts require an independently provisioned config-signer pin to reach the top verification result. The kit's P-REF profile deliberately differs from a production enforcement profile.

For Protect and Spine, supply the separately obtained receipt-signer public key, not a private key or the config-signer pin. Protect adds verifier-local replay; Spine does not. The exact option names appear in [captured CLI help](reference/README.md).

A fresh BLOCK receipt from the [Seal demo](../guide/first-approval.md) was passed to this kit with that same run's public key. The captured invocation below uses the receipt path printed by that run; your timestamped filename will differ. Working directory: seal-assurance-kit; the sibling demo directory comes from [your first approval](../guide/first-approval.md).

```bash
node bin/seal verify ../demo/receipts/receipt-1789756901036-395490-0003-BLOCK.json --receipt-pubkey "$(cat ../demo/receipt-signer.pub)"
```

Its final output was:
```text
  PASS  kernel binary matches supplied pin
  PASS  kernel verdict re-derives   (re-derived BLOCK / claimed BLOCK)
  PASS  kernel reason re-derives
  PASS  worker approval targets
  PASS  worker policy shape
  PASS  VERIFIED (bundled self-check; not independent verification)
```

That example establishes consistency against its supplied key, not trusted operator identity or actual occurrence. The same receipt's product checker ended with:
```text
                         ------------------
READ      available
VALIDATE  available
REPLAY    available
VERIFY    UNVERIFIED
```

These outputs can coexist: the tools report different scopes. Keep the original result language when recording evidence. For a portable first run with no user data, use [the bundled sample](start.md). See [format support](../check/formats.md), especially the pinned revisions' decimal gap, before interpreting a refusal.

Previous: [First assurance check](start.md).
Up: [Assurance CLI](README.md).
Next: [Scan policy coverage](scan.md).
