# Seal v0.2.1 release notes

## What Seal is

Seal puts an approval gate in front of a named set of tools on one MCP server. An approval is for one exact call. It prevents a second run of that approved call. It does not promise that the first run will happen. See `README.md` and `test/approval-contract.test.cjs`.

The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths. The state machine is TESTED. The Node product requires the pinned vendored WASM decision before forwarding. It refuses its BLOCK, failure, integrity mismatch, or disagreement with Node. Handle lifetime, retry protocol state, and durable one-use consumption remain tested Node logic. See `contract/contract.cjs`, `test/approval-contract.test.cjs`, and `docs/assurance/architecture.md`.

Current shipped assurance status: authorization rule — TESTED; product state/forwarding — TESTED; client and machine — TRUSTED.

Receipts use one `seal.receipt/v2` envelope across the demo, protected path, and sibling release verifier. The format fixes member order, canonical JSON, duplicate-member refusal, kernel inputs, verdict mapping, replay commitments, and Ed25519 signature preimage. See `docs/SEAL-RECEIPT-V2.md`, `spine/receipt-v2.cjs`, and `test/receipt-canonicalization-conformance.test.mjs`.

v0.2.0 was withdrawn before publication. It has no published release assets. This note records v0.2.1.

## What Seal does not cover

Seal is a gate, not a sandbox. It controls calls that pass through the protected MCP server path. Bash, direct file writes, network access, subprocesses, other MCP servers, and another route to the same effect remain outside that path. On the Claude Code path, Seal trusts Claude Code to present the request to a human and return the choice faithfully. See `README.md` and `test/demo-witness.test.cjs`.

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. Windows, Linux ARM, and other platforms are unsupported. The native macOS process-start witness helper is release-produced, not independently reproduced. The platform table, the helper test, and the release-matrix test establish the declared platform support and macOS helper readiness. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs`.

Both paths write signed receipt files. The demo generates a fresh key for its run. The protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. A signature shows that the supplied key signed the canonical receipt value. It does not establish that the key is authoritative or that the recorded event occurred. See `docs/reference/receipt-operations.md` and `test/receipt-v2-verifier.test.mjs`.

The sibling `seal-receipt-v2.mjs` verifier reports document structure, signature and bindings, kernel replay, authority, and occurrence separately. It refuses `authorityRoot` and `occurrenceWitness` inputs because it has no format or check for them. Positive VERIFY is unreachable in this release. The verifier returns `verify: false`, and its formatted result is `UNVERIFIED`. See `checker/seal-receipt-v2.mjs`, `docs/SEAL-RECEIPT-V2.md`, and `test/receipt-v2-verifier.test.mjs`.

## What changed since v0.2.0-rc.3

- `741e3df` routes test-created directories through a run-scoped lifecycle helper. The complete product suite no longer leaves temporary directories behind.

- `4631a6c` lets an operator select protected calls by argument value as well as tool name. Exact JSON-number equality treats signed zero and zero as one scalar. The `count=0` predicate matches `{"count":-0}`. The call is selected and needs approval.

- `b51a01d` adds rendered Claude Code transcripts to the evidence pack. The renderer redacts session identifiers at the source layer. This evidence does not observe a real Claude Code call. The Claude Code matrix row remains UNTESTED.

- `7aa4352` changes the reproduction guidance. It does not direct a reader to a withdrawn tag with no assets.

- `4c736b4` changes the guide to name the refusal situation. It does not enumerate code paths.

## Known holes

The release gate verifies draft bytes and exercises each platform artifact before publication. The post-publication documentation update is a follow-up pull request. A documentation failure cannot unpublish a release. It leaves a visible failing job or review branch for a human to resolve. See the `release-docs` job in `.github/workflows/release.yml`.

The fresh-source reproduction command covers the Linux x86-64 kernel. It does not reproduce the native macOS helper. Selecting a Darwin platform refuses rather than substituting a Linux result. The caller supplies the authority label for a reproduction result. The script does not infer who ran it. See `docs/reproduce.md`.

The product-suite roster completeness boundary is INJECTED, not enforced. An actor that controls the measured test process could also forge its executed-file record and verdict. See `scripts/run-complete-product-suite.sh`.

As of 2026-09-03 (PR 215 / `4259bfc`), the current in-tree `seal reproduce` command refuses the pre-import v0.2.1 tag instead of cloning the external recipe recorded above. See `docs/reproduce.md`.
