# Evaluator walk

This is the forensic receipt walk for a source build of this checkout. It is
not the path for the published GitHub release `v0.2.0-rc.3`, which supplies the
receipt checker as a sibling release asset. It does not embed a captured transcript: three
attempts to keep a hand-maintained transcript honest on a moving branch already
failed. Run the commands; read what they print.

The checker is **not** in a source-built installed store.
`scripts/build-dist.cjs` excludes `checker/seal-receipt-check.mjs` from that
payload. Run the copy from the checkout that you built; do not look for it
under `~/.local/lib/seal/store/`.

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
$ node checker/seal-receipt-check.mjs "$SEAL_BLOCK_RECEIPT" --pubkey "$SEAL_DEMO_DIR/receipt-signer.pub"
```

A matching receipt prints `ACCEPT BLOCK demo.mutate` and then states the
limit of that result: this shows the receipt has the same canonical parsed
value that this key signed. It does not show the decision happened.

That key is the one this demo used to sign the receipt, so checking
against it proves only self-consistency — a hostile sealer could sign its
own. To prove anything, supply a key you obtained from a source you
already trust.

## Tamper the recorded decision

```bash
$ sed 's/"decision": "BLOCK"/"decision": "ALLOW"/' "$SEAL_BLOCK_RECEIPT" > "$SEAL_DEMO_DIR/tampered.json"
$ node checker/seal-receipt-check.mjs "$SEAL_DEMO_DIR/tampered.json" --pubkey "$SEAL_DEMO_DIR/receipt-signer.pub"
$ test "$?" -eq 1
```

The checker must refuse. The refusal names `decision_binding_mismatch`.

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

See [DISTRIBUTION.md](../assurance/distribution.md) for what the payload contains, and
[LIMITATIONS.md](../archive/LIMITATIONS.md) for the family-level claims block.
