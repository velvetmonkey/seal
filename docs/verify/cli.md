# CLI assurance checks

[seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit) is a
separate repository with its own `seal` command. Clone it and run its
commands from **its** working directory — these are not subcommands of the
`seal` CLI this repository ships; see [CLI reference](../reference/cli.md) for
that CLI's own `seal verify PATH [--pubkey HEX]`.

## Setup

Prerequisites, from the kit's own tested documentation: Node.js, and the kit's
checkout. No Lean toolchain, no Docker, no build step and no network access
are required for its shipped fixture checks.

```bash
git clone https://github.com/velvetmonkey/seal-assurance-kit
cd seal-assurance-kit
node bin/seal verify fixtures/receipt-block.json
```

Running that command against the kit's own shipped fixture prints this,
verbatim:

![A dark terminal window titled "seal-assurance-kit — seal verify" showing the exact output of node bin/seal verify fixtures/receipt-block.json: ten PASS lines covering schema, kernel-binary match, canonical request hash and verdict re-derivation, ending in "PASS  VERIFIED (bundled self-check; not independent verification)" and exit code 0.](../public/images/verify/cli-verify.png)

## What each check does

| Command | What it establishes | A practical outcome |
| --- | --- | --- |
| `seal verify RECEIPT` | Re-derives one receipt from its own bytes: schema, kernel-binary match, canonical request hash, verdict. | `PASS VERIFIED`, exit 0; a failing check, exit 1. |
| `seal scan TOOLS POLICY` | Finds every mutating tool no approval policy covers. | `FAIL` and exit 1 when coverage is incomplete; exit 0 only for a fully covered catalogue. |
| `seal receipt-diff A B` | Classifies changes between supported kit or host receipt pairs as authorization-surface or minor; unsupported pairs are refused. | Exit 1 on an authorization-surface change; exit 2 on unsupported input. |
| `seal adequacy check LABELS` | Checks whether the supplied evidence actually separates the labels it claims to, rather than merely looking like it does. | A named adequacy verdict, not a bare pass/fail. |

## Real terminal output, one command at a time

Each image below is the kit's own literal stdout from running the command
shown in its title bar against a fixture shipped in the kit's own repository —
nothing here is paraphrased or hand-typed.

`seal scan` finding a genuinely uncovered mutating tool, exit 1:

![A dark terminal window titled "seal-assurance-kit — seal scan" showing node bin/seal scan fixtures/tools.json fixtures/policy-v2.json. It prints the effective kernel participation (only the Safety kernel active), then GUARDED, DENIED and readonly tool lists, then in red "FAIL  UNCOVERED tools (3): file.write, http.post, jira.deleteIssue", "FAIL  3 uncovered, 0 ungated, 3 guarded, 1 denied, 3 read-only", and exit code 1.](../public/images/verify/cli-scan.png)

`seal receipt-diff` classifying a genuine authorization-surface change between
two shipped fixture receipts, exit 1:

![A dark terminal window titled "seal-assurance-kit — seal receipt-diff" showing node bin/seal receipt-diff fixtures/receipt-allow.json fixtures/receipt-block.json. In red, "AUTHORIZATION-SURFACE DRIFT (9)" lists field-by-field changes including tool, arguments, canonical_request_sha256, verdict ALLOW to BLOCK, and granted_capabilities; a separate "MINOR (3)" list follows; it ends with "RESULT: AUTHORIZATION DRIFT — these receipts do not authorize the same thing" and exit code 1.](../public/images/verify/cli-receipt-diff.png)

`seal adequacy check` on the kit's own shipped passing fixture, exit 0:

![A dark terminal window titled "seal-assurance-kit — seal adequacy check" showing node bin/seal adequacy check fixtures/adequacy-pass.json. It prints "states: 3   monitors: 2", the Lean warrant it agrees with, its finite-sample scope note, a green "PASS  ADEQUATE over observed finite sample: monitor evidence refines labels in this input", a certificate line, and exit code 0.](../public/images/verify/cli-adequacy.png)

## Reading an outcome

Distinguish three different things an outcome can mean:

- **A failed check** — the tool ran to completion and found a real problem
  (for example, `seal scan` finding an uncovered mutating tool). This is the
  check working as designed.
- **Insufficient evidence** — the tool could not evaluate a claim from what it
  was given (for example, a receipt format that does not carry a field a
  check needs). This is not the same as a failure of the thing being checked.
- **A tool error** — the command itself could not run (a missing fixture, a
  malformed argument, an unreadable file). This is a defect in the invocation,
  not a finding about your boundary.

Preserve the kit's own exit codes and names rather than forcing every outcome
into an invented universal PASS/FAIL vocabulary: `seal verify` and `seal scan`
use exit 0 for a clean result and exit 1 for a finding, and `seal adequacy`
reports a named verdict rather than a bare boolean. Read the
[kit's own command output](https://github.com/velvetmonkey/seal-assurance-kit#verify-in-five-minutes)
for the current, authoritative list.

Previous: [Browser receipt checks](browser.md).
Up: [Choose a checking tool](README.md).
Next: [Check receipts](../check/README.md).
