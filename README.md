<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)
[![Golden Path - deterministic shell + Postgres + deploy + token governor + temporal freeze + filesystem](https://github.com/velvetmonkey/seal-host/actions/workflows/golden-path.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal-host/actions/workflows/golden-path.yml)

Seal is the agent authorization gate whose decision rule is machine-checked, whose effect commitment is tested for sufficiency, and whose deployed decisions can be independently re-derived against pinned kernel bytes.

Seal protects effects. The current production adapter mediates MCP `tools/call`: it blocks a guarded call unless a live, one-use approval matches that exact effect, then emits a receipt you can verify independently.

## Try it in one command

```sh
npx github:velvetmonkey/seal demo
```

Here is output captured by running that command and answering `y`:

```
Seal runtime verified: velvetmonkey/seal-assurance-kit@962823b22d17
BLOCKED  the kernel found no matching approval

Approval requested
  Tool          db.execute
  Exact effect  database: demo
                sql: DROP TABLE users
  Scope         these exact arguments

Approve? [y/N] ALLOWED  the kernel accepted the supplied approval
seal verify  /tmp/seal-demo-transcript-tljlOU/data/seal/receipts/receipt-1786720874670-1791991-839913de.json
  receipt verdict: ALLOW   kernel: 28bb3ae71985
  PASS  schema valid (v2)
  PASS  kernel binary matches receipt   (local 28bb3ae71985 / claimed 28bb3ae71985)
  PASS  kernel binary is the audited build   (pinned 28bb3ae71985)
  PASS  stored canonical_request equals derived line
  PASS  canonical request hash matches   (b9d57df415a0)
  PASS  grants resolve to approval targets   (1 target(s), 1 opaque)
  PASS  verdict re-derives identically   (re-derived ALLOW / claimed ALLOW)
  PASS  kernel-attested request binding (audit sha256 of the judged bytes equals the request identity)   (b9d57df415a0)
  PASS  emitted decision bytes byte-identical modulo the kernel request commitment
  PASS  VERIFIED
RECEIPT   /tmp/seal-demo-transcript-tljlOU/data/seal/receipts/receipt-1786720874670-1791991-839913de.json
PASS VERIFIED  the resulting decision receipt re-derived successfully
Verify later with: npx github:velvetmonkey/seal verify /tmp/seal-demo-transcript-tljlOU/data/seal/receipts/receipt-1786720874670-1791991-839913de.json
```

That receipt is yours to keep and re-check. In the no-install path above, run:

```sh
npx github:velvetmonkey/seal verify PATH
```

Then inspect the local state the demo left behind:

```sh
npx github:velvetmonkey/seal status
```

`seal status` reports whether the pinned runtime is present, how many receipts
are stored and where, and the most recent observed decision.

If you do not answer the prompt, the demo prints `No approval response received (EOF); no downstream tool was contacted.` and exits 1. No downstream tool is contacted.

The CLI owns the demo policy, approval state, and receipt paths. You do not author JSON, generate keys, initialise SQLite, install Cosign, or clone a second repository. It downloads and hash-verifies the pinned runtime. Node and `npx` are required. No Docker, Lean, Python, global install, or PATH edit is required for the command above.

To install the short name `seal` later, from a clone of this repository, run
`npm install -g --prefix ~/.local .` and put `~/.local/bin` on your PATH.
`@velvetmonkey/seal` is not on the npm registry. After that optional install,
use `seal verify PATH` and `seal status`.

Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal executes it.


## Attack replay

**Prerequisites:** Docker with Compose and Node.js; no Seal source build, key, or policy file. **Context:** start from any directory; this is a fresh clone, not a continuation of another example.

```bash
git clone https://github.com/velvetmonkey/seal-live-demo && cd seal-live-demo
bash scripts/run_local.sh
```

**Expected output:** `ASSERT OK: 19/19 invariants hold. Green check = evidence.` **What it proves:** this **attack replay**, not a live-agent attack, deterministically blocks a destructive tool call, then shows the identical request succeed only when Seal is bypassed. The replay does not exercise an interactive approval; that is the deployment path below. Its exact shell command is not run by CI; the equivalent scenario is exercised by `seal-live-demo`’s manually dispatched `seal · live agent threat demo` / `demo` job. [Demo detail](https://github.com/velvetmonkey/seal-live-demo) · [verify a fixture with no Docker](https://github.com/velvetmonkey/seal-assurance-kit).

## What the evidence says

- **Proven:** the Lean kernel is default-deny and permits a guarded effect only with a matching live approval; its distributed results identify which fleet shapes preserve one-use authorization. [Claims matrix](docs/CLAIMS-MATRIX.md) · [fleet boundary](docs/AUTHORIZATION-MESH.md).
- **Tested:** Rust, wasm, and JavaScript agree with the kernel over the conformance corpus. Receipt-field sufficiency is tested, not proven: pre-v2 fields collided for two different effects, so v2 commits `args_hash`. `witness-check`, the proprietary sufficiency analyzer, checks that question. [Evidence and status](docs/CLAIMS-MATRIX.md).
- **Not claimed:** an approved malicious-but-valid request is still authorized; Seal does not read intent, prove the deployed system end-to-end, or secure approvers, hosts, keys, browsers, build systems, or downstream tools. [Limits and trust boundaries](docs/LIMITATIONS.md) · [runtime boundary](docs/TRUTH-BOX.md).

## Start where you are

- Deploy the MCP gate: [seal-host deployment guide](https://github.com/velvetmonkey/seal-host/blob/main/docs/DEPLOY.md).
- Inspect the decision, receipt, and pinned-kernel relationship: [architecture](docs/ARCHITECTURE.md) and [authorization record](docs/AUTHORIZATION-RECORD.md).
- Audit every claim and its check: [claims matrix](docs/CLAIMS-MATRIX.md) and [evaluator start](EVALUATOR-START.md).

As of 2026-08-10, the published release shipped the gate, while coordinated mesh deployment remained a separate architecture rather than a shipped promise. Seal proves which fleet deployment shapes preserve single-use authorization. [Read the boundary](docs/AUTHORIZATION-MESH.md).

## Go deeper

The public Seal family is available to everyone; `witness-check` is the named proprietary exception.

| Repository | What it is | Start here when... |
|---|---|---|
| [mcp-seal-dev](https://github.com/velvetmonkey/mcp-seal-dev) | Lean kernel and core safety theorems. | You need the proved rulebook. |
| [seal-host](https://github.com/velvetmonkey/seal-host) | Deployable MCP gate and conformance bridge. | You are putting the gate in front of an MCP server. |
| [seal-check](https://github.com/velvetmonkey/seal-check) | Browser receipt verifier. | You want to replay a receipt without installing tooling. |
| [seal-live-demo](https://github.com/velvetmonkey/seal-live-demo) | Reproducible attack replay. | You want to watch the block and bypass control. |
| [seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit) | CLI evidence tools. | You need `seal verify`, `seal receipt-diff`, or `seal adequacy`. |
| [seal-verify-action](https://github.com/velvetmonkey/seal-verify-action) | GitHub Action receipt gate. | You want unverifiable receipts to fail CI. |
| [witness-check](https://github.com/velvetmonkey/witness-check) | Proprietary sufficiency analyzer. | You need to test whether an evidence field set is sufficient. |

For a receipt: `seal verify` checks well-formed, canonical, re-derived evidence; `seal receipt-diff` asks what changed on the authorization surface; `seal adequacy` checks finite-sample sufficiency; proprietary `witness-check` analyzes sufficiency itself. The distributed `crdt-lean` work is deliberately not linked here: it left v1 for Seal v3 and remains a deferred architecture, not a current developer route.

[Why a proof, not a prompt](docs/WHY-DIFFERENT.md) explains the decision rule; [limitations](docs/LIMITATIONS.md) and the [claims matrix](docs/CLAIMS-MATRIX.md) are the canonical honesty surface. [Seal’s effect boundary](docs/WHAT-SEAL-IS.md) explains why MCP is an adapter, not the product boundary.

Interested in contributing? Useful lanes are adapters (MCP clients, approval channels, identity and audit integrations), evidence (conformance vectors and adversarial cases), and proof review (assumptions, theorem statements, and missing bridge obligations). [Repository topology](docs/REPO-TOPOLOGY.md) explains the project boundary.

## License

Apache-2.0. See [LICENSE](LICENSE).
