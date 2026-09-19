# Assurance CLI

Use seal-assurance-kit to review receipts, inspect policy coverage, compare receipts and test finite evidence from a terminal. It runs separately from Seal's approval gate and does not need a running gate for its bundled fixture checks.

Start with [a passing and a failing sample](start.md), then choose a task:

- [Verify a receipt](verify.md) and interpret its profile.
- [Scan tool coverage](scan.md) or [compare two receipts](receipt-diff.md).
- [Check monitor adequacy](adequacy.md) over supplied labels.
- [Run the conformance corpus](conformance.md) or [use exits in CI](ci.md).
- [Prepare a host policy](configure.md), with explicit write effects.
- [Read the CLI reference](reference/README.md).

The kit and product both have an executable named seal. Every command in these pages uses Node from the kit checkout to avoid that ambiguity. No published npm installation is assumed. Keep configuration for the kit's host integrations distinct from the Node gate's project protection.

Previous: [Receipt checking reference](../check/reference/README.md).
Up: [Documentation map](../README.md).
Next: [First assurance check](start.md).
