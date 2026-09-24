# Assurance CLI reference

Use this command inventory for **seal-assurance-kit**, not the installed Node gate. Captured on Linux from the kit revision in [sources](../../evidence/sources.md):

```bash
node bin/seal --help
```

```text
seal assurance kit

  seal verify <receipt.json> [--expected-config-pubkey <64-hex>] [--receipt-pubkey <64-hex>]
                                verify a decision receipt; principal-bearing
                                receipts require this out-of-band operator pin
  seal init <manifest.tools.json> [--out <policy.json>] [--force]
  seal init --recipe <prod-db|deploy|token-governor|mesh> <manifest.tools.json> [--out <policy.json>] [--force]
                                scaffold an exact-name reviewable policy
                                --force permits replacing an existing output
  seal add-kernel <S|T|C|V|L|B> <manifest.tools.json> [--policy <policy.json>]
                                add one non-vacuous kernel to an existing policy
  seal add-kernel K <manifest.tools.json> [--policy <policy.json>] --experimental
                                EXPERIMENTAL Calibration; never emitted by recipes
  seal test   [--profile L0]    MCP boundary conformance oracle
  seal scan   <tools> <policy>  MCP policy coverage auditor
                                (FAIL + exit 1 = uncovered mutating tools found;
                                 that is scan doing its job, not the kit breaking)
  seal scan diff <old> <new> <policy>   what changed since last scan
  seal adequacy check <labels>          finite monitor-resolution adequacy
  seal adequacy find-collision <labels> find a semantic monitor collision
  seal receipt-diff <A.json> <B.json> [--json]
                                authorization-surface diff between two receipts:
                                what changed, grouped AUTHORIZATION vs MINOR.
                                (reports change only — does not re-verify a seal,
                                 and does not judge field-set sufficiency)
                                exit: 0 no auth drift · 1 drift · 2 malformed/
                                legacy/tampered
  seal policy sign <policy.json> --key <seed-file> [--out <trusted.json>] [--yes] [--force]
                                validate and Ed25519-sign a policy envelope
                                --force permits replacing an existing output
                                (accepts the full 7-kernel bundle: safety +
                                 temporal/consensus/convergence/calibration/
                                 linear/budget sections, per-section `enabled`;
                                 unknown section/entry keys are refused exactly
                                 where the verified kernel parser refuses them)
  seal connect --client claude [--desktop] [--profile <profile.json>]
  seal disconnect --client claude [--desktop]

  --help, -h      this help
  --version, -V   print the kit version

  input formats: docs/SCHEMAS.md
  exit codes: 0 pass · 1 failed · 2 usage · 3 internal · 4 reduced scope
```

| Operation | Effect | Result interpretation |
|---|---|---|
| verify | Reads a receipt, key input and local kernel | 0/1/2/3/4; [profiles](verify-profiles.md) |
| scan and scan diff | Read catalogue/policy files | Coverage or newly uncovered-tool findings; not live route coverage |
| receipt-diff | Reads two supported decision receipts | 0 no authorization drift; 1 drift; 2 invalid input |
| adequacy | Reads labelled finite states | Collision fails; vacuous result can exit 0 |
| test | Runs the finite L0 corpus | Conformance only over the supplied cases |
| init and recipes | Create a policy | Review exact-name rules and placeholders |
| add-kernel | Updates a policy | Review effective participation and placeholders |
| policy sign | Reads a private seed and writes a signed policy envelope | Review participation before acknowledgement |
| connect / disconnect | Change client configuration and rollback records | Host integration; not Node-gate protection |

General usage errors exit 2 and unexpected exceptions exit 3. Some command-local failures have more specific handling; keep their exact diagnostic. [Schemas](schemas.md) separates the inputs. [Configure](../configure.md) names the operations actually exercised for this guide.

Previous: [Prepare a reviewable host policy](../configure.md).
Up: [Assurance CLI](../README.md).
Next: [Policy, tools and labels](schemas.md).
