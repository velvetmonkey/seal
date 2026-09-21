# Seal v0.4.1 release notes

## What changed since v0.4.0

These notes describe the v0.4.1 candidate based on v0.4.0, with the checker fix from `79939a3` backported in `e331575`; they do not record a published artifact.

- The v0.4.0 standalone checker could exit 0 with the signature deleted. The backported fix makes CLI success require a checked signature: a deleted signature or no supplied verification key now exits 1 (`79939a3`; `checker/seal-receipt-v2.mjs`, `test/receipt-checker.test.cjs`). In a physical check of the same receipt and caller-supplied key, v0.4.0 exited 0 for both the valid receipt and the receipt with its signature deleted; this candidate exited 0 and 1 respectively. An invalid signature exited 1 in both versions.
- The candidate version changes from 0.4.0 to 0.4.1 (`e331575`; `VERSION`, `package.json`).

## What this release does not claim

**The strict proved-property count for the shipped product is zero.** A passing checker test is a measurement, not a proof of the shipped authorization path. The v0.4.0 assurance record labels the authorization rule and product state/forwarding TESTED, and client and machine behavior TRUSTED (`docs/assurance/RELEASE-NOTES-v0.4.0.md`, `docs/assurance/architecture.md`). This checker patch does not establish a stronger assurance status.

Receipts retain one `seal.receipt/v2` envelope. The verifier refuses `authorityRoot` and `occurrenceWitness` inputs. Positive VERIFY is unreachable in this release, and the formatted result is `UNVERIFIED` (`checker/seal-receipt-v2.mjs`, `docs/SEAL-RECEIPT-V2.md`). The valid-receipt measurement reported a VALID signature with an UNPINNED / CALLER-SUPPLIED authority key and event occurrence NOT ESTABLISHED. Exit 0 does not establish authoritative identity, human presence or that an effect occurred.

The branch's Claude Code acceptance row remains **UNTESTED — real Claude Code call not observed** (`docs/assurance/claude-code-evidence.md`). This patch's receipt checks do not constitute a real-client acceptance run. The v0.5.0 reference notes at `14f5b2a` record a 2026-09-21 Desktop observation of approvals auto-declined without a dialog; that is a dated client observation, not a new measurement on this candidate.

Seal controls calls through the protected MCP server path. Shell access, direct writes, network access, subprocesses, other servers and other routes to the same effect remain outside that path (`docs/assurance/RELEASE-NOTES-v0.4.0.md`).

The inherited platform declaration is: Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs`. This patch's local checker measurement is not a new platform acceptance measurement.
