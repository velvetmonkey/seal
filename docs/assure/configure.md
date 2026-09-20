# Prepare a reviewable host policy

Configuration commands write files; receipt verification and scanning are review tasks. The kit configures its host-oriented policy/integration surfaces. It does not replace the Node gate's protection command.

For the commands below, create an empty directory named captures beside your kit checkout first; all generated files stay there. A scan catalogue is not necessarily a setup manifest. The setup manifest also needs server identity. This shipped database manifest was used successfully:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal init test/fixtures/manifests/dbhub-0.23.0.tools.json --out ../captures/policy.json
```

Captured output excerpt (exit 0):
```text
created policy  /home/monkey/scratch/sealdocspass2/captures/policy.json
WARNING  1 unverified suggestion(s) — server self-described readOnly:
  search_objects
review every rule before signing; annotations are trusted input, not verification
```

This creates a policy file in the sibling captures directory used by this walkthrough. Create/use a writable scratch directory and choose a new output path for your own work; the default refuses replacement unless explicitly forced. Review read-only suggestions and every exact tool name before treating the policy as suitable.

The initial generated policy was scanned before adding a kernel:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal scan test/fixtures/manifests/dbhub-0.23.0.tools.json ../captures/policy.json
```

Captured output excerpt (exit 0):
```text

  PASS  0 uncovered, 0 ungated, 1 guarded, 0 denied, 1 read-only
  warrant: JS scan agrees with the pinned Lean scan_oracle verdicts (scan_pass_sound; mcp-seal-dev @28491ccddbdd, 2026-07-15) over corpus C — JS↔pin checked on every kit test run, Lean↔pin checked in mcp-seal-dev CI; differential evidence, not universal verification; annotations + manifest completeness remain assumptions.
```

Recipe scaffolding was also exercised:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal init --recipe prod-db test/fixtures/manifests/dbhub-0.23.0.tools.json --out ../captures/recipe.json
```

Captured output excerpt (exit 0):
```text
recipe prod-db  ACTIVE {S,T,B}  PRESENT-BUT-INACTIVE {}
WARNING  1 unverified suggestion(s) — server self-described readOnly:
  search_objects
review every rule before signing; annotations are trusted input, not verification
```

Recipes are starting points, not deployment approvals. Review EDIT-ME fields, best-fit mappings and effective kernel participation. Calibration is experimental and is not emitted by recommended recipes.

Adding a kernel mutates the selected policy:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal add-kernel T test/fixtures/manifests/dbhub-0.23.0.tools.json --policy ../captures/policy.json
```

Captured output excerpt (exit 0):
```text
updated policy  /home/monkey/scratch/sealdocspass2/captures/policy.json
added kernel  temporal (T) — ACTIVE
review every EDIT-ME placeholder, then run seal policy sign and seal scan
```

Policy signing validates the bundle and signs with an Ed25519 seed file; it requires explicit acknowledgement and refuses accidental overwrite. Connect/disconnect change Claude client configuration and keep rollback information. These signing/client changes were not exercised in this guide, so no successful deployment is claimed. Their actual option syntax is in [captured help](reference/README.md); consult the owning integration instructions before using them with a real client.

Previous: [Use kit results in CI](ci.md).
Up: [Assurance CLI](README.md).
Next: [Assurance CLI reference](reference/README.md).
