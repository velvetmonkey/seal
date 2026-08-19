# Seal v0.2.0-rc.2 release notes

## What Seal is

Seal puts an approval gate in front of one selected tool of one MCP server. An approval is for one exact call: it prevents a second run of that approved call, but it does not promise that the first run will happen. ([README.md](../README.md); [at-most-once claim test](../test/at-most-once-claim.test.cjs); merged [abf6f5a](https://github.com/velvetmonkey/seal/commit/abf6f5a6a46eb15310b0cd10769504ac6ed05f62))

The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths. ([approval-contract test](../test/approval-contract.test.cjs); [retry-continuation test](../test/spine-retry.test.cjs); merged [00176cd](https://github.com/velvetmonkey/seal/commit/00176cd88e8a20e50239342c05f2eafa3830520f) and [4228744](https://github.com/velvetmonkey/seal/commit/42287448e51f75f43250782faec59bcb23f1d7b8))

The authorization rule is PROVED. The state machine is TESTED. The Node
product now calls the pinned vendored WASM for the exact-call authorization
sub-question and refuses its BLOCK, failure, integrity mismatch, or
disagreement with Node. Handle lifetime, retry protocol state, and durable
one-use consumption remain tested Node logic. The config accepted by
`seal_init` is signed using an Ed25519 key generated inside the same worker;
that is demo-grade self-authorization, not an externally trusted production
config key. ([adapter implementation](../contract/contract.cjs);
[architecture split](ARCHITECTURE.md))

## What Seal does not cover

Seal is a gate, not a sandbox. It controls the path through it, and only that path; a direct local write, Bash, network access, subprocesses, other tools, and other servers are outside Seal. ([README boundary list](../README.md); [scope-witness test](../test/demo-witness.test.cjs); merged [09967fc](https://github.com/velvetmonkey/seal/commit/09967fcf911ca30824e6e4fb3c51f15f7de7d138) and [e4d5ba1](https://github.com/velvetmonkey/seal/commit/e4d5ba1173ccb864d3450bfda6d9d1ce686ce652))

Protect mediates a stdio MCP server entry. Other transport shapes are outside the protected path, and Protect relies on Claude Code for its local override. ([README boundary list](../README.md); [Protect test](../test/protect3b.test.cjs); merged [37fefe4](https://github.com/velvetmonkey/seal/commit/37fefe440af778f03b416798583a3a3e64f69094))

Seal v0.2.0-rc.2 supports Linux x86-64 only. macOS, Windows, Linux ARM, and other platforms are not supported in this release. ([README.md](../README.md); [platform implementation](../spine/platform.cjs); [distribution test](../test/dist3d.test.cjs))

Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. The checker accepts a receipt only against the public key you supply and only when the recorded decision, tool, arguments and signature match the sealed commitments. ([README.md](../README.md); [distribution notes](DISTRIBUTION.md); [truth gate](../scripts/launch-truth-gate.mjs); [checker implementation](../checker/seal-receipt-check.mjs))

The checker is published beside the install artifact, with its own digest in the release `SHA256SUMS`; that digest is not covered by the artifact's digest. It does not import Seal at check time, but its canonicalisation is a copy of the product-side implementation. ([artifact payload](../scripts/build-dist.cjs); [release workflow](../.github/workflows/release.yml); [checker limits](../checker/seal-receipt-check.mjs); [checker test](../test/receipt-checker.test.cjs); merged [18bba8e](https://github.com/velvetmonkey/seal/commit/18bba8ea230ead9fb605cd61d352a0e894c256d5))

These notes make no stranger-verification claim. They also do not use the Lean or family-assurance material as evidence for this Node artifact. ([artifact inheritance boundary](ARTIFACT-INHERITANCE.md); [distribution test](../test/dist3d.test.cjs))

## What changed

- The guarded retry path now uses the proved WASM authorization kernel through
  a named fail-closed adapter. There is no JavaScript authorization fallback.
  ([adapter implementation](../contract/contract.cjs))

- The approval contract now binds the displayed call to a retry and records a consumed approval across a restart; altered, expired, malformed, declined, and replayed continuations have named refusals. ([approval-contract test](../test/approval-contract.test.cjs); [retry-continuation test](../test/spine-retry.test.cjs); merged [00176cd](https://github.com/velvetmonkey/seal/commit/00176cd88e8a20e50239342c05f2eafa3830520f) and [4228744](https://github.com/velvetmonkey/seal/commit/42287448e51f75f43250782faec59bcb23f1d7b8))

- The demo now exposes the scope witness: its guarded call crosses the proxy, while a direct write is shown outside it. ([demo-witness test](../test/demo-witness.test.cjs); merged [09967fc](https://github.com/velvetmonkey/seal/commit/09967fcf911ca30824e6e4fb3c51f15f7de7d138))

- Protect adds a Claude Code local MCP override, reports the live activation state, and removes only that override. ([Protect test](../test/protect3b.test.cjs); merged [37fefe4](https://github.com/velvetmonkey/seal/commit/37fefe440af778f03b416798583a3a3e64f69094))

- The release includes the receipt checker and a pinned Linux x86-64 install artifact; the artifact tests exercise installation, the demo, Protect, and removal. ([receipt-checker test](../test/receipt-checker.test.cjs); [distribution test](../test/dist3d.test.cjs); [four-beats test](../test/four-beats.test.cjs); merged [18bba8e](https://github.com/velvetmonkey/seal/commit/18bba8ea230ead9fb605cd61d352a0e894c256d5) and [b57ed0a](https://github.com/velvetmonkey/seal/commit/b57ed0a8e721ee9b55dbf3c9ead2cbd5b3b85d5c))
