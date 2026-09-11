# Seal v0.4.0 release notes

## What Seal is

Seal puts an approval gate in front of a named set of tools on one MCP server. An approval is for one exact call. It prevents a second run of that approved call. It does not promise that the first run will happen. See `README.md` and `test/approval-contract.test.cjs`.

The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths. The state machine is TESTED. The Node product requires the pinned vendored WASM decision before forwarding. It refuses its BLOCK, failure, integrity mismatch, or disagreement with Node. Handle lifetime, retry protocol state, and durable one-use consumption remain tested Node logic. See `contract/contract.cjs`, `test/approval-contract.test.cjs`, and `docs/assurance/architecture.md`.

Current shipped assurance status: authorization rule — TESTED; product state/forwarding — TESTED; client and machine — TRUSTED.

Receipts use one `seal.receipt/v2` envelope across the demo, protected path, and sibling release verifier. The format fixes member order, canonical JSON, duplicate-member refusal, kernel inputs, verdict mapping, replay commitments, and Ed25519 signature preimage. See `docs/SEAL-RECEIPT-V2.md`, `spine/receipt-v2.cjs`, and `test/receipt-canonicalization-conformance.test.mjs`.

Receipt sealing and proxy construction refuse an absent signer. See `test/spine-retry.test.cjs` and `test/receipt-canonicalization-conformance.test.mjs`.

## What Seal does not cover

Seal is a gate, not a sandbox. It controls calls that pass through the protected MCP server path. Bash, direct file writes, network access, subprocesses, other MCP servers, and another route to the same effect remain outside that path. On the Claude Code path, Seal trusts Claude Code to present the request to a human and return the choice faithfully. See `README.md` and `test/demo-witness.test.cjs`.

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. Windows, Linux ARM, and other platforms are unsupported. The native macOS process-start witness helper is release-produced, not independently reproduced. The platform table, the helper test, and the release-matrix test establish the declared platform support and macOS helper readiness. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs`.

Both paths write signed receipt files. The demo generates a fresh key for its run. The protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. A signature shows that the supplied key signed the canonical receipt value. It does not establish that the key is authoritative or that the recorded event occurred. See `docs/reference/receipt-operations.md` and `test/receipt-v2-verifier.test.mjs`.

The sibling `seal-receipt-v2.mjs` verifier reports document structure, signature and bindings, kernel replay, authority, and occurrence separately. It refuses `authorityRoot` and `occurrenceWitness` inputs because it has no format or check for them. Positive VERIFY is unreachable in this release. The verifier returns `verify: false`, and its formatted result is `UNVERIFIED`. See `checker/seal-receipt-v2.mjs`, `docs/SEAL-RECEIPT-V2.md`, and `test/receipt-v2-verifier.test.mjs`.

## What changed since v0.3.0

- Ownership-aware `seal uninstall` removes the installation it owns. See [PR #306](https://github.com/velvetmonkey/seal/pull/306), “Add ownership-aware seal uninstall”.
- Multiple servers can be protected, and activation outside the project lock allows simultaneous servers to start. See [PR #304](https://github.com/velvetmonkey/seal/pull/304), “Protect multiple servers and admit the recovery help line”, and [PR #312](https://github.com/velvetmonkey/seal/pull/312), “Activate outside the project lock so simultaneous servers both start (F4)”.
- Mixed selections retain whole-tool protection. Approval types are preserved, elicitation capacity is released, and negative approvals receive truthful classifications. See [PR #308](https://github.com/velvetmonkey/seal/pull/308), “Preserve whole-tool protection in mixed selections”; [PR #317](https://github.com/velvetmonkey/seal/pull/317), “Preserve approval types and measure final predicate text”; and [PR #311](https://github.com/velvetmonkey/seal/pull/311), “Release elicitation capacity and classify negative approvals truthfully”.
- Protected authorization judges the installed runtime tree. See [PR #324](https://github.com/velvetmonkey/seal/pull/324), “Judge the installed runtime tree before protected authorization”.
- Status and demo use one validated receipt population, expose filename sequence gaps with bounded reporting, and status reports bounded reachability observations. See [PR #326](https://github.com/velvetmonkey/seal/pull/326), “Use one validated receipt population for status and demo”; [PR #305](https://github.com/velvetmonkey/seal/pull/305), “Expose receipt filename sequence gaps”; [PR #310](https://github.com/velvetmonkey/seal/pull/310), “Bound receipt population gap reporting”; and [PR #325](https://github.com/velvetmonkey/seal/pull/325), “Report bounded reachability observations in status”.
- Receipt parsing accepts whitespace before object members. See [PR #319](https://github.com/velvetmonkey/seal/pull/319), “fix: accept whitespace before receipt object members”.
- CLI help is completed with a reference and contract tests; the documentation site follows declared navigation. See [PR #328](https://github.com/velvetmonkey/seal/pull/328), “Complete CLI help and freeze its reference and contract tests”, and [PR #307](https://github.com/velvetmonkey/seal/pull/307), “docs: publish Seal site from declared navigation”.
- Builds no longer synchronize the candidate version into published release documentation. See [PR #315](https://github.com/velvetmonkey/seal/pull/315), “fix: keep version sync out of builds”.

The Claude Code acceptance row remains **UNTESTED — real Claude Code call not observed**. Scripted protocol tests and rendered transcripts do not establish that the real client path is proven. See `docs/assurance/claude-code-evidence.md`. The real-client release-BLOCKING gate remains absent.

## Known holes

The release gate verifies draft bytes and exercises each platform artifact before publication. The post-publication documentation update is a follow-up pull request. A documentation failure cannot unpublish a release. It leaves a visible failing job or review branch for a human to resolve. See the `release-docs` job in `.github/workflows/release.yml`.

The fresh-source reproduction command covers the Linux x86-64 kernel. It does not reproduce the native macOS helper. Selecting a Darwin platform refuses rather than substituting a Linux result. The caller supplies the authority label for a reproduction result. The script does not infer who ran it. See `docs/reproduce.md`.

The product-suite roster completeness boundary is INJECTED, not enforced. An actor that controls the measured test process could also forge its executed-file record and verdict. See `scripts/run-complete-product-suite.sh`.
