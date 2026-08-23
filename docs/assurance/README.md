# Seal docs — where to start, by what you came for

You do not need this assurance index to use Seal. If you only want to use Seal,
start with the repository README and skip this page.

The product's front door is the [repository README](../../README.md):
requirements, a short install, `seal demo`, protect / status / unprotect,
and a five-bullet boundary list. This `docs/assurance/README.md` page maps everything
else in `docs/`, grouped by reader.
Every refusal code in this reference is checked against the product source.
Files in the last two groups describe the Seal *family* of research repositories
or a past design state — they are kept for the record and are not claims about
the Node CLI this repository ships.

## I want to use this

1. [The README](../../README.md) — requirements, short install, demo, protect,
   status, unprotect. Start here; everything below is secondary.
2. [install.md](../start/install.md) — the SHA256SUMS verification wall moved off the
   front page: digest, byte count, and named refusals before the installer runs.
3. [evaluator-walk.md](../start/evaluator-walk.md) — the forensic receipt check for a
   source build after `seal demo`, using the checkout checker, with no captured
   transcript.
4. [assurance/RELEASE-NOTES-v0.2.0-rc.2.md](RELEASE-NOTES-v0.2.0-rc.2.md) — what v0.2.0-rc.2 contains and
   what it deliberately does not, with each claim citing the test or commit
   that holds it.
5. [assurance/distribution.md](distribution.md) — what the one installable artifact is,
   how the SHA-256 pin works, and the named refusals the installer and
   launcher give you instead of silent failure.
6. [assurance/version-identity.md](version-identity.md) — why a build off a release tag
   names itself `-dev.g<commit>`, which check refuses which lie, and what the
   pinned digest can and cannot say about an untagged build.
7. [assurance/architecture.md](architecture.md) — the shipped Node product path first,
   followed by the wider family assurance lineage.

## I want to know what it does not do

1. [“What Seal covers, and what it does not”](../../README.md) — the boundary
   list at the end of the README is the current, tested statement. Gate, not
   sandbox; one tool of one server; receipt-key custody limits; Linux x86-64
   only.
2. [“What Seal does not cover” in the release notes](RELEASE-NOTES-v0.2.0-rc.2.md) —
   the same boundary with citations.

## I want to check the evidence myself

1. The [`SHA256SUMS` release asset](https://github.com/velvetmonkey/seal/releases)
   and [scripts/build-dist.cjs](../../scripts/build-dist.cjs) — download a binary
   and the `SHA256SUMS` asset attached to the same release, then compare the
   digest and byte count yourself.
2. [test/four-beats.test.cjs](../../test/four-beats.test.cjs) — the acceptance
   walk: install, demo, check, protect, unprotect, from the installed
   artifact, on a PATH that cannot see Docker, Lean or Python.
3. [test/demo-witness.test.cjs](../../test/demo-witness.test.cjs) — the scope
   witness proved from files on disk (the child's count file, the receipts
   directory, the outside write), not from stdout.
4. [assurance/claude-code-evidence.md](claude-code-evidence.md) — the client matrix, why
   the Claude Code row is still untested, and the human-assisted acceptance
   harness and checker that would close it.
5. [checker/seal-receipt-check.mjs](../../checker/seal-receipt-check.mjs) — the
   receipt checker included in the published release payload. It is not an
   independent check of that payload.
   It imports no Seal module at check time, but copies the producer's
   canonicalisation rule and uses the same Node crypto platform; read what
   that does and does not establish.
6. [guide/github-actions-provenance.md](../guide/github-actions-provenance.md) —
   download and verify the GitHub-hosted runner's attested demo-receipt
   evidence, and read the boundary of that provenance claim.
7. `assurance/installed-tree-pin-control.md` — the
   INJECTED human-control boundary for the hand-maintained installed-tree pin
   site manifest.
8. `assurance/linkcheck-population-control.md` — what the link-check population
   cross-check measures, and its shared blind spots.

## I want to operate Seal day to day

- [guide/README.md](../guide/README.md) — the operating-guide entry point,
  including prerequisites and a recommended route through the guide.
- [guide/choosing-what-to-protect.md](../guide/choosing-what-to-protect.md) — how
  to choose the one tool that needs a gate and understand what protection
  changes or leaves alone.
- [guide/what-is-protected-right-now.md](../guide/what-is-protected-right-now.md)
  — how to read every `seal status` protection state and use `seal doctor`.
- [guide/knowing-it-worked.md](../guide/knowing-it-worked.md) — how to interpret
  approval prompts, refusals, demo evidence, and receipt checks.
- [guide/when-something-looks-wrong.md](../guide/when-something-looks-wrong.md) —
  what each refusal token means, what caused it, and what to do next.
- [reference/multi-tool-semantics.md](../reference/multi-tool-semantics.md) — the
  shipped named-set behavior, its code and command evidence, and the measured
  multi-tool state-coverage gap.

## I want the design history

Dated records of how v0.2.0-rc.2 got its shape. Several describe designs that were
ruled on and explicitly never built; each says so in its opening lines.

- [ROADMAP-KERNEL-OUTWARD.md](../archive/ROADMAP-KERNEL-OUTWARD.md) — the working order
  that sequenced this release (July 2026).
- [NORTH-STAR-V3.md](../archive/NORTH-STAR-V3.md) — the 2026-07-28 north star; supersedes
  [NORTH-STAR-ADJUSTED.md](../archive/NORTH-STAR-ADJUSTED.md) (2026-07-25) for priority
  and scope.
- [COMPREHENSION-CHECK.md](../archive/COMPREHENSION-CHECK.md) — the comprehension-check
  product pivot; design only, nothing implemented.
- [AUTHORIZATION-RECORD.md](../archive/AUTHORIZATION-RECORD.md) — the four-leg
  authorization record; specified, not implemented.
- [ARTIFACT-INHERITANCE.md](../archive/ARTIFACT-INHERITANCE.md) — the declared successor
  to the Decision Bundle; declared, not built.
- [BROKER-HA.md](../archive/BROKER-HA.md) — credential-broker availability design implied
  by the topology-C ruling; not built.
- [META-PARTITION-SPEC.md](../archive/META-PARTITION-SPEC.md) — the MCP `_meta` partition
  ruling; ruled, not started.
- [assurance/POLICY-LANGUAGE.md](POLICY-LANGUAGE.md) — draft `boxpol` policy-language
  specification for a future build.
- [SECURITY.md](../../SECURITY.md) — GitHub security policy and private advisory intake.
- [NUMERIC-AGREEMENT.md](../archive/NUMERIC-AGREEMENT.md) — accepted remediation spec for
  a cross-parser numeric disagreement in a kernel/host pair that is not in
  this repository.
- [REPO-TOPOLOGY.md](../archive/REPO-TOPOLOGY.md) — the 2026-07-25 repository-topology
  decision, retained as rationale.
- [CONSISTENCY-REPORT.md](../archive/CONSISTENCY-REPORT.md) — a dated 2026-07-09 family
  documentation sweep.
- [OPEN-FINDINGS.md](../archive/OPEN-FINDINGS.md) — the July open-findings ledger for the
  family programme.
- [PUBLIC-FLIP-CHECKLIST.md](../archive/PUBLIC-FLIP-CHECKLIST.md) — the completed
  checklist used before the family repositories became public.

## Family material — not claims about this CLI

These files describe the wider Seal family (a Rust host, Lean proof kernels,
a verifier fleet) rather than the Node CLI in this repository, whose gate is a
JavaScript approval contract. Do not read them as claims about this product.
Their disposition is an open ruling.

- [AUTHORIZATION-MESH.md](../archive/AUTHORIZATION-MESH.md) — fleet coordination
  theorems; no fleet exists in this repository.
- [CLAIMS-MATRIX.md](../archive/CLAIMS-MATRIX.md) — the family's proven/tested/assumed
  claims ladder.
- [WHAT-SEAL-IS.md](../archive/WHAT-SEAL-IS.md) — the object-capability account, built
  around a signed approval token this CLI does not use.
- [WHY-DIFFERENT.md](../archive/WHY-DIFFERENT.md) — the proof-vs-heuristic comparison,
  resting on the family's Lean theorem.
- [LIMITATIONS.md](../archive/LIMITATIONS.md) — the canonical claims block mirrored by
  `index.html`; its wording is family-level.
- [TRUTH-BOX.md](../archive/TRUTH-BOX.md) — the canonical three-line truth box; its
  current claim names Lean-kernel gating.
- [archive/README.md](../archive/README.md) — navigation for the preserved archive.
- [findings.md](../archive/findings.md) — the preserved NEEDS BEN items.

The evaluator-facing family truth surface is
[docs/assurance/evaluator-start.md](../assurance/evaluator-start.md), at the repository root; it audits
the family's artifacts and proofs, not this CLI.
