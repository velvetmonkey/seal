# Evaluator walk

This is the forensic receipt walk for a source build of this checkout. It is
not the path for the published GitHub release `v0.2.0-rc.3`, which supplies the
receipt checker as a sibling release asset. It does not embed a captured transcript: three
attempts to keep a hand-maintained transcript honest on a moving branch already
failed. Run the commands; read what they print.

The source-built installed store includes `checker/seal-receipt-v2.mjs` because
`seal verify` uses that same v2 judge. The judge does not import the producer's
assembler or canonicaliser.

For the product's named-set capability, protect both bundled demo tools in one
declaration: `seal protect db demo.mutate demo.erase`. `seal status` reports
that one server protection as `db.{demo.mutate, demo.erase}`; use the operating
guide for the setup and state details.

## After `seal demo`

The demo prints `demo directory: <path> (remains after the demo
for the printed checker command)`. Keep that path. It holds the receipts
and the demo's public key.

```bash
$ read -r -p "Paste the demo directory: " SEAL_DEMO_DIR
```

Copy only the path after `demo directory:` from the demo output.

Name the blocked receipt from the demo directory, then check it against
the demo's key with the checkout checker in the current directory:

```bash
$ SEAL_BLOCK_RECEIPT="$(find "$SEAL_DEMO_DIR/receipts" -name '*-BLOCK.json' -print -quit)"
$ node checker/seal-receipt-v2.mjs "$SEAL_BLOCK_RECEIPT" --pubkey "$(cat "$SEAL_DEMO_DIR/receipt-signer.pub")"
```

A matching receipt prints the five rows described in [Receipt operations](../reference/receipt-operations.md),
including `Kernel decision REPRODUCED`, `Event occurrence NOT ESTABLISHED`,
and `VERIFY UNVERIFIED`.

That key is the one this demo used to sign the receipt, so checking
against it proves only self-consistency — a hostile sealer could sign its
own. To prove anything, supply a key you obtained from a source you
already trust.

## Tamper the recorded arguments

```bash
$ sed 's/seal demo wrote this line/altered line/' "$SEAL_BLOCK_RECEIPT" > "$SEAL_DEMO_DIR/tampered.json"
$ node checker/seal-receipt-v2.mjs "$SEAL_DEMO_DIR/tampered.json" --pubkey "$(cat "$SEAL_DEMO_DIR/receipt-signer.pub")"
$ test "$?" -eq 1
```

The checker must refuse. The refusal names `commitment_mismatch`.

## What this does not prove

The demo's key is generated fresh for that run. The protected path creates
or reuses a machine-local Ed25519 key. Both are demo-grade key custody:
the thing that can sign is the same machine that made the decision. A
production-grade check would verify against a key you obtained from a
source you already trust, not a file written next to the receipt.

The in-browser page at https://velvetmonkey.github.io/seal-check/ re-checks
a decision receipt you paste and reports its receipt checks. It has no
backend, accounts, or telemetry. It does not establish that your setup
routes calls through Seal, and it is not the checker command above.
The landing page has **zero `<button>` controls**.

See [DISTRIBUTION.md](../assurance/distribution.md) for what the payload contains, and
[LIMITATIONS.md](../archive/LIMITATIONS.md) for the family-level claims block.

Previous: [Install](install.md).
Up: [Start](README.md).
