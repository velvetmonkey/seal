# Seal v0.5.0 release notes

## What changed since v0.4.0

These notes describe candidate source `70985bb8de5232bb914e3049b7712937044520ca`, not a published artifact; each change below cites its source commit.

- The standalone receipt checker now exits 1 when the signature is absent or cannot be verified with the supplied key, including when no key is supplied (`79939a3`).
- `seal verify PATH --json` adds structured results and failure codes, with exit 0 for successful structure, signature and replay checks, 1 for verification/runtime failures, and 2 for invalid input; text-mode missing PATH retains exit 1, and callers that expected exactly 1 for schema errors must now accept 2 (`bf95358`; `docs/reference/cli.md:85-105`).
- `seal seal_block --pubkey HEX` reads receipt bytes from stdin and emits a `seal_block: "v1"` JSON result, with exit 3 for kernel integrity failure and 5 for a missing or malformed key; successful checks exit 0 and other failures exit 1 (`195b53c`; `docs/reference/cli.md:135`).
- `seal coverage` inventories configured MCP servers and known routes, qualifying mediation as inference from this installation's owned wrapper and live lease, with incomplete enumeration and unknown client selection explicitly reported (`ba64b56`, `0470327`, `4c5ec69`).
- `seal history` adds bounded receipt-claim queries by tool and time, with a documented seconds/milliseconds compatibility rule and signature, occurrence and current route context left UNKNOWN (`1b31ffa`, `c8f0118`).
- Approval and receipt replay accept decimal arguments within the safe canonical magnitude range; omitted MCP arguments become an empty object, while explicit non-object arguments and malformed guarded request envelopes are refused (`6e398b2`, `7e4fe8a`, `6933aea`, `2072746`).
- Guarded proxy calls preserve large numeric request identities without rounding the wire ID (`34c56ff`).
- Approval messages reserve space for the configured, unauthenticated route and other mandatory fields, bound total characters, and preserve Unicode shaping controls (`0f78aa7`, `1d65df3`).
- Cancelling a pending tool request cancels its approval, malformed approval responses cannot authorize it, and child responses are routed by exact elicitation ownership with bounded retired-ID retention (`50b32d3`, `d8a0355`, `fa5190c`).
- Protection commands resolve the Git project root, activation checks relative commands against the saved project root, and status keeps protection state consistent across project directories (`01013b8`, `fcebcb7`, `907c310`).
- Protect expands supported environment placeholders, permits retry after a failed discovery when no local override was installed, and reports project configuration before and after unprotect (`0c4723b`).
- Activation validates route identity before side effects and passes project/server identity into approval state; recovery unregisters owned routes before deleting state (`c9b626f`, `8f96a1b`).
- Project-lock owner publication is atomic, approval-journal writes reject incomplete data, and journal checkpoints retain terminal handle records (`1ee9d97`, `c0da5ee`, `957de78`).
- Receipt publication writes and syncs a temporary file, renames it into place, and syncs the directory; failed demo writes remove incomplete replacements or roll back appends (`049fcff`, `51c99b6`, `dd4c14a`).
- Discovery and proxy shutdown bound their wait even when descendants hold pipes open, and the wrapper ends its transport when the protected child exits (`3d94c23`, `94e9b5d`, `9dc3f44`, `443044b`).
- Bootstrap installer tooling selects a platform artifact and checks its byte length and SHA-256 before execution; missing-Node refusals go to stderr (`84fe0b1`, `4b95072`).
- Packaging gains a product-suite and payload-content gate, release tooling gains draft-download access and recovery coverage, and published-asset checks retry transient fetch failures (`7003ece`, `fb16bce`, `6921532`, `7dc06b9`).
- Documentation adds receipt-checking guides, clearer route-boundary and argument-sharing limits, and a homepage illustration based on a recorded approve-once/replay-refused demo (`fc06a5e`, `819cf26`, `413403b`, `461c616`, `4597740`).
- Evidence-checking tooling accepts committed log tails from open child sessions, test temporary roots are cleaned on termination signals, and candidate metadata identifies v0.5.0 (`e7a4d93`, `862bc6a`, `70985bb`).

## What this release does not claim

**The Desktop client can auto-decline an approval with no dialog.** The recorded measurement on 2026-09-21 was Claude Code Desktop 2.1.275 (app 2.2553.1, native Windows Local): two requests declined in 6 and 7 ms without a dialog, in two folders, including Manual mode in the second run. This is a dated client observation, not a new acceptance run on this candidate.

**The real-client acceptance pack has not passed for any client.** The branch's Claude Code acceptance row remains **UNTESTED — real Claude Code call not observed** (`docs/assurance/claude-code-evidence.md:33-42`); scripted protocol tests and a historical dialog do not establish a complete real-client acceptance result.

**The strict proved-property count for the shipped product is zero.** The theorem artifact does not yet ship and run in the released build graph, and model theorems do not establish correspondence to the shipped authorization path (`docs/assurance/current-scope.md:18-20`). The documented authorization and forwarding status is TESTED; client and machine behavior remains a trusted assumption, not a proved property (`docs/assurance/current-scope.md:32-43`).

Seal controls selected calls through its MCP route; shell access, direct writes, network access, subprocesses, other servers and other routes to the same effect remain outside it (`docs/assurance/current-scope.md:52`). An approval can be spent without a forwarded call, and receipts do not establish that an effect occurred (`docs/assurance/current-scope.md:44-55`).

Receipts retain one `seal.receipt/v2` envelope (`docs/SEAL-RECEIPT-V2.md`). The verifier refuses `authorityRoot` and `occurrenceWitness` inputs; Positive VERIFY is unreachable in this release, and its formatted result is `UNVERIFIED` (`checker/seal-receipt-v2.mjs:107-130`). Exit 0 from either new JSON interface establishes only the checked structure, supplied-key signature and replay, not authority, human presence, event occurrence or permission to execute an effect (`docs/reference/cli.md:85-105,135-164`).

The branch documents Seal as follows: Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. The native macOS process-start witness helper is release-produced, not independently reproduced. macOS Protect execution is not exercised in CI. See `spine/platform.cjs`, `test/darwin-readiness.test.cjs`, and `test/release-matrix.test.mjs`; this is the declared platform boundary, not a new platform acceptance measurement.

The sibling browser and assurance-kit checkers have a documented decimal-receipt compatibility gap (`docs/SEAL-RECEIPT-V2.md`, cross-repo compatibility note). History reports unverified claims rather than complete event history (`docs/reference/cli.md:108-133`), and bounded shutdown does not contain descendants that detach before they can be observed (`spine/protection.cjs`, discovery cleanup comments).
