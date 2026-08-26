# Seal v0.2.0-rc.3 release notes

## What Seal is

Seal puts an approval gate in front of a named set of tools on one MCP server. An approval is for one exact call: it prevents a second run of that approved call, but it does not promise that the first run will happen. See `README.md` and `test/approval-contract.test.cjs` (the `refusal 3` and `refusal 4` cases).

The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths. See `test/approval-contract.test.cjs` and `test/spine-retry.test.cjs`.

The state machine is TESTED. The Node product calls the pinned vendored WASM for the exact-call authorization sub-question and refuses its BLOCK, failure, integrity mismatch, or disagreement with Node. Handle lifetime, retry protocol state, and durable one-use consumption remain tested Node logic. The config accepted by `seal_init` is signed using an Ed25519 key generated inside the same worker; that is demo-grade self-authorization, not an externally trusted production config key. See `contract/contract.cjs` and `docs/assurance/architecture.md`.

## What Seal does not cover

Seal is a gate, not a sandbox. It controls the path through it, and only that path; a direct local write, Bash, network access, subprocesses, other tools, and other servers are outside Seal. See `README.md` and `test/demo-witness.test.cjs`.

Protect mediates a stdio MCP server entry. Other transport shapes are outside the protected path, and Protect relies on Claude Code for its local override. See `README.md` and `test/protect3b.test.cjs`.

macOS source portability is CI-exercised for install, demo and receipt checking. Protect is not supported on macOS yet. Linux x86-64 is the supported Protect path. See the [macOS workflow](../../.github/workflows/macos.yml), the [non-Linux witness test](../../test/proxy-lock-nonlinux.test.cjs), and `docs/assurance/distribution.md`.

Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. The checker accepts a receipt only against the public key you supply and only when the recorded decision, tool, arguments and signature match the sealed commitments. See `README.md`, `docs/assurance/distribution.md`, and `checker/seal-receipt-check.mjs`.

The v0.2.0-rc.3 install payload does not include the checker. Get `checker/seal-receipt-check.mjs` by cloning the [Seal source repository](https://github.com/velvetmonkey/seal), then run it from that checkout. At check time it imports no Seal module: it independently implements the same receipt canonicalisation rule while omitting the sealer's input-refusal branches. From the repository root, `node scripts/check-receipt-canonicalization.mjs` shows the compared statements and the deliberate omissions. See `scripts/build-dist.cjs`, `.github/workflows/release.yml`, and `test/receipt-checker.test.cjs`.

These notes make no stranger-verification claim. See `test/no-verification-claim.test.cjs`. They also do not use the Lean or family-assurance material as evidence for this Node artifact. See `docs/assurance/architecture.md`.

## What changed since v0.2.0-rc.2

- Source portability for macOS install, demo, and receipt checking is exercised in CI. Protect remains unsupported on macOS because the process-start witness needed for a live protection lease is unavailable there. See `.github/workflows/macos.yml` and `test/proxy-lock-nonlinux.test.cjs`.

- Protect accepts a named set of guarded tools and persists their order while retaining compatibility with earlier single-tool state. See `docs/reference/multi-tool-semantics.md` and `test/protect3b.test.cjs`.

- The current product restores honest version identity: the immutable v0.2.0-rc.2 notes remain tied to that tag, while these notes describe v0.2.0-rc.3.

- Installation and Protect/status output now give next-step or undo guidance, and protected multi-tool scope is displayed as `server.{tool, tool}`. The platform help now distinguishes macOS install/demo/checker support from the Linux x86-64 Protect path. See `printGuidance` in `bin/seal` and `unsupportedPlatformText` in `spine/platform.cjs`.

- Claude Code local overrides are now associated with the Git top-level, so running Protect from a subdirectory uses the same project override. Relative protected-server commands also run from the protected project directory. See `claudeProjectRoot` in `spine/protection.cjs` and `childCwd` in `spine/proxy-cli.cjs`.

- The bundled demo server now also offers `demo.erase`, which empties its demo data file and reports the total tool-call count. See `ERASE_TOOL` in `spine/demo-server.cjs`.

- A protected call can now refuse with `receipt_correlation_capacity_exceeded` when too many approvals are pending, or `receipt_correlation_missing` when its continuation has no recorded receipt correlation. See `createProxy` in `spine/proxy.cjs`.

- The receipt checker can now be invoked directly from a path that needs URL encoding. See the executable-main check in `checker/seal-receipt-check.mjs`.

- Installed artifacts now include `NOTICE`, use Linux/Darwin platform identifiers, and use the Apache-2.0 `LICENSE` and `NOTICE` legal materials. Protection state now records `guardTools` and the Claude project root while continuing to read earlier single-tool state. See `PAYLOAD_PATHS` in `scripts/build-dist.cjs`, `LICENSE`, `NOTICE`, and `readState` in `spine/protection.cjs`.

- The README and documentation navigation have been reorganized around reader routes, including install, evaluator, guide, reference, assurance, and archive entry points. See `README.md` and `docs/reference/multi-tool-semantics.md`.

## Known holes

Published-release bytes, digests, and installation remain unverified when the published-installer test times out: that test skips on network failure, and no other check covers those published assets.

The repository URL gate classifies extractor-emitted URL tokens that begin `http://`, `https://`, `git+https://`, `git://`, or `//` and end at whitespace, `<`, `>`, `(`, `)`, `[`, `]`, `{`, `}`, `"`, `'`, or a backtick, `git@github.com:` tokens on those same boundaries, and complete trimmed lines beginning any of those forms or `file:` (after reassembling a newline, with optional spaces or tabs, immediately following a path slash); anything outside that set is not classified rather than approved; within that set it accepts protocol-relative and default-port self URLs and literal `git@github.com:` self links, rejects non-default-port origins, HTTPS userinfo, and raw URL characters, and classifies percent-encoded and case-variant self paths as sibling references.

The product-suite roster merge gate is injected, not enforced: a principal that controls the measured test process can also publish the executed-file record and its verdict.
