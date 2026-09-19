# Run the boundary conformance corpus

The kit's L0 command runs a finite boundary conformance oracle using its shipped corpus and dependencies. This is a review task after the [first receipt check](start.md), not an installation prerequisite.

Kit · Linux Bash · kit checkout with its bundled corpus:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal test --profile L0
```

Captured output excerpt (exit 0):
```text
seal test  reference-kernel conformance  profile=L0  cases=5
  (self-conformance vs the vendored reference kernel; not a live-endpoint boundary test)
  PASS  safety                 destructive-sql      blocked by safety
  PASS  safety (deny-rule)     self-approve         blocked by safety
  PASS  consensus              pay-quorum-missing   blocked by consensus
  PASS  convergence            store-subtle         blocked by convergence
  PASS  temporal (stateful)    temporal-stale-cap   blocked by temporal
  PASS  CONFORMANT (reference kernel)  (5/5 traces, all four gates + deny-rule)
```

The passing result concerns the cases exercised by this command. It is not a universal proof that a client, host or Node runtime corresponds to a Lean model. Cross-copy profile tests and kernel differentials answer separate questions and have separately pinned populations.

Keep the kit revision, corpus revision and complete output with a report. For contributor regression work use the owning repository's CI instructions; a fixture pass does not substitute for a real Claude Code integration walk. See [finite conformance evidence](../evidence/conformance.md).

Previous: [Check finite monitor adequacy](adequacy.md).
Up: [Assurance CLI](README.md).
Next: [Use kit results in CI](ci.md).
