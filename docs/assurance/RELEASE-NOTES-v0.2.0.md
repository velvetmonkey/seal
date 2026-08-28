# Seal v0.2.0 release notes

## What Seal is

Seal puts an approval gate in front of a named set of tools on one MCP server. An approval is for one exact call: it prevents a second run of that approved call, but it does not promise that the first run will happen. See `README.md` and `test/approval-contract.test.cjs` (the `refusal 3` and `refusal 4` cases).

The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths. The state machine is TESTED. The Node product requires the pinned vendored WASM decision before forwarding and refuses its BLOCK, failure, integrity mismatch, or disagreement with Node. Handle lifetime, retry protocol state, and durable one-use consumption remain tested Node logic. See `contract/contract.cjs`, `test/approval-contract.test.cjs`, and `docs/assurance/architecture.md`.

Receipts use one `seal.receipt/v2` envelope across the demo, protected path, and sibling release verifier. The format fixes member order, canonical JSON, duplicate-member refusal, kernel inputs, verdict mapping, replay commitments, and Ed25519 signature preimage. See `docs/SEAL-RECEIPT-V2.md`, `spine/receipt-v2.cjs`, and `test/receipt-canonicalization-conformance.test.mjs`.

## What Seal does not cover

Seal is a gate, not a sandbox. It controls calls that pass through the protected MCP server path. Bash, direct file writes, network access, subprocesses, other MCP servers, and another route to the same effect remain outside that path. On the Claude Code path, Seal trusts Claude Code to present the request to a human and return the choice faithfully. See `README.md` and `test/demo-witness.test.cjs`.

Seal v0.2.0 supports install, demo, receipt checking, and Protect on Linux x86-64 and macOS x64/arm64. Windows, Linux ARM, and other platforms are unsupported. The native macOS process-start witness helper is release-produced, not independently reproduced. See `.github/workflows/macos.yml`, `.github/workflows/release.yml`, and `test/release-matrix.test.mjs`.

Both paths write signed receipt files. The demo generates a fresh key for its run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. A signature shows that the supplied key signed the canonical receipt value; it does not establish that the key is authoritative or that the recorded event occurred. See `docs/reference/receipt-operations.md` and `test/receipt-v2-verifier.test.mjs`.

The sibling `seal-receipt-v2.mjs` verifier reports document structure, signature and bindings, kernel replay, authority, and occurrence separately. It refuses `authorityRoot` and `occurrenceWitness` inputs because it has no format or check for them. Positive VERIFY is unreachable in this release: the verifier returns `verify: false`, and its formatted result is `UNVERIFIED`. See `checker/seal-receipt-v2.mjs`, `docs/SEAL-RECEIPT-V2.md`, and `test/receipt-v2-verifier.test.mjs`.

## What changed since v0.2.0-rc.3

- The producer and verifier now share one specified receipt format, `seal.receipt/v2`, with conformance checks comparing their canonicalization rules and route decisions. The v2 verifier landed before the producer it judges. See `docs/SEAL-RECEIPT-V2.md`, `test/receipt-canonicalization-conformance.test.mjs`, and `test/receipt-verdict-agreement.test.mjs`.

- Verification no longer turns caller-supplied trust assertions into a positive verdict. Unchecked authority roots and occurrence witnesses refuse, while the report keeps signature, replay, authority, and occurrence as separate rows. See `docs/reference/receipt-operations.md` and `test/receipt-v2-verifier.test.mjs`.

- macOS x64 and arm64 are supported for install, demo, receipt checking, and Protect. Release-built native process-start helpers are exercised on matching macOS runners, and the published support text names their provenance limit. See `.github/workflows/macos.yml`, `.github/workflows/release.yml`, and `test/darwin-readiness.test.cjs`.

- The release workflow creates a draft, downloads the draft artifacts a reader would receive, checks their declared bytes and kernel on matching Linux and macOS runners, and publishes only after every draft-verification matrix leg succeeds. See the `release`, `verify-draft`, and `publish` jobs in `.github/workflows/release.yml`.

- `node scripts/seal-reproduce.cjs "v$(cat VERSION)" --platform linux-x64` can rebuild from the release's pinned source outside the maintainer's machine. It provisions the pinned toolchains, accepts an explicit executable launcher when a builder must serialize Lean work, and reports a named refusal when that launcher is unavailable. See `docs/reproduce.md` and `test/seal-reproduce.test.cjs`.

- `docs/reference/receipt-operations.md` is now the canonical page for READ, VALIDATE, REPLAY, and VERIFY. Its checked output and versioned vectors state the trust ceiling without collapsing replay into authority or occurrence. See `test/receipt-operations-doc.test.mjs` and `docs/reference/receipt-operations-v1/README.md`.

## Known holes

The release gate verifies the draft bytes and exercises each platform artifact before publication, but the post-publication documentation update is a follow-up pull request. A documentation failure cannot unpublish a release; it leaves a visible failing job or review branch for a human to resolve. See the `release-docs` job in `.github/workflows/release.yml`.

The fresh-source reproduction command covers the Linux x86-64 kernel. It does not reproduce the native macOS helper, and selecting a Darwin platform refuses rather than substituting a Linux result. The caller supplies the authority label for a reproduction result; the script does not infer who ran it. See `docs/reproduce.md`.

The product-suite roster completeness boundary is INJECTED, not enforced: an actor that controls the measured test process could also forge its executed-file record and verdict. See `scripts/run-complete-product-suite.sh`.
