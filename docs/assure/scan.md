# Scan policy coverage

A coverage scan compares a finite tools catalogue to a current TrustedConfig. It is not live discovery of every route, and the catalogue's annotations are trusted input. A read-only annotation describes mutation, not sensitivity.

Start with the intentionally incomplete shipped policy:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal scan fixtures/tools.json fixtures/policy-v2.json
```

Captured output excerpt (exit 1):
```text
  file.write
  http.post
  jira.deleteIssue

  FAIL  3 uncovered, 0 ungated, 3 guarded, 1 denied, 3 read-only
  warrant: JS scan agrees with the pinned Lean scan_oracle verdicts (scan_pass_sound; mcp-seal-dev @28491ccddbdd, 2026-07-15) over corpus C — JS↔pin checked on every kit test run, Lean↔pin checked in mcp-seal-dev CI; differential evidence, not universal verification; annotations + manifest completeness remain assumptions.
```

This fails because three mutating tools have no covering rule. An explicitly allowed but ungated mutating tool also fails, even when printed under WARN. Orphan ALLOW rules and server mismatches can fail the scan too. Review all categories rather than counting only uncovered tools.

For a passing setup, use the server-bearing manifest in [configure](configure.md) and review the generated policy before scanning. The captured initial policy scan returned exit 0 with no uncovered or ungated tools. Passing depends on that catalogue and its annotations; it does not establish actual enforcement.

The policy requires epoch and safety, an approval control-file path, and exact-name safety.tools rules. Guard rules require targets. A bare legacy rules map fails TrustedConfig validation before scanning. [Input schemas](reference/schemas.md) explains the distinction.

To compare catalogues against one policy:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal scan diff fixtures/tools-prev.json fixtures/tools.json fixtures/policy-v2.json
```

Captured output excerpt (exit 1):
```text
  file.write  ->  uncovered
  http.post  ->  uncovered
  jira.deleteIssue  ->  uncovered

  FAIL  3 new, 0 removed, 3 new-and-uncovered
```

Scan diff reports newly uncovered tools in this comparison. It does not certify unchanged tools or replace a full current scan.

Previous: [Verify a receipt in the kit](verify.md).
Up: [Assurance CLI](README.md).
Next: [Compare receipt authorization surfaces](receipt-diff.md).
