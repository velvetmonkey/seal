# Choose a checking tool

Checking evidence is a different task from inspecting one receipt. Pick the
route that matches what you are doing right now.

| I want to… | Use | Runs where |
| --- | --- | --- |
| Inspect one receipt by hand | [Browser receipt checks](browser.md) — [seal-check](https://github.com/velvetmonkey/seal-check) | Your browser, no install |
| Run a repeatable receipt, coverage or conformance review | [CLI assurance checks](cli.md) — [seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit) | Your terminal, Node.js |
| Verify a receipt from the product you already installed | `seal verify PATH [--pubkey HEX]`, documented in [CLI reference](../reference/cli.md) | Your terminal, the `seal` binary you installed |

**These are three separate executables.** seal-check is a static browser page.
seal-assurance-kit ships its own `seal` command with subcommands such as
`verify`, `scan`, `test` and `adequacy` — a different program from the `seal`
CLI this repository ships, even though both are invoked as `seal`. This
repository's own `seal verify` is documented alongside its other commands in
[CLI reference](../reference/cli.md), not in this section. Naming a command
`seal` does not mean it is the same executable; check which repository you
installed it from.

## v0.4.0 standalone checker exit status

The standalone `checker/seal-receipt-v2.mjs` packaged in the published
`seal-v0.4.0-linux-x64` asset can exit 0 when its printed
`Signature and bindings` line says `UNVERIFIED`. Measured with the same valid
signed receipt:

| Input | v0.4.0 exit | Signature and bindings | main exit |
| --- | --- | --- | --- |
| Signed receipt with the correct `--pubkey` | 0 | VALID | 0 |
| Same receipt with `signature` deleted, correct `--pubkey` supplied | 0 | UNVERIFIED | 1 |
| Same signed receipt without `--pubkey` | 0 | UNVERIFIED | 1 |

For scripts using v0.4.0 today, supply the separately obtained public key and
require both exit 0 and a `Signature and bindings` line whose value is exactly
`VALID`. Treat `UNVERIFIED` or a missing line as failure; exit 0 alone does not
require a verified signature. This notice concerns the packaged standalone
checker, distinct from the browser and assurance-kit tools above.

This exit-status behavior is **fixed on main, not in v0.4.0**: main exits 1
in the deleted-signature and no-key cases. Even exit 0 on main establishes only
the checked document structure, signature and bindings against the supplied key,
and verifier-local replay. It establishes neither operator authority nor event
occurrence: the successful signed test still prints `VERIFY    UNVERIFIED`,
with authority `UNPINNED / CALLER-SUPPLIED` and occurrence `NOT ESTABLISHED`.

## One receipt, or a broader review

![Diagram: one signed receipt splits into two separate paths. The left path, seal-check (browser), reports signature, replay and authority-pin results. The right path, seal-assurance-kit (CLI), reports verify, scan, receipt-diff and adequacy results. A caption below the two boxes reads "same bytes, two separate tools".](../public/images/verify/receipt-two-ways.svg)

Opening seal-check and pasting a receipt answers "is this one receipt valid,
replay-consistent, and whose authority is or is not pinned?" It says nothing
about any other receipt, and nothing about policy coverage across your
configuration.

Running seal-assurance-kit's checks answers a wider question: across a corpus
of receipts, tool definitions or policy, what is verified, what fails, and
what could not be evaluated at all? That is a repeatable, scriptable review —
suited to CI, not to a single pasted receipt.

Both tools share the same kernel and receipt-format dependencies as the
product. Agreement between them can also reflect a shared defect in that
common code, not independent confirmation. See
[Current guarantees and limits](../assurance/current-scope.md).

Previous: [Current guarantees and limits](../assurance/current-scope.md).
Up: [Documentation map](../README.md).
Next: [Browser receipt checks](browser.md).
