<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![CI](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

Seal is the agent authorization gate whose decision rule is machine-checked, whose effect commitment is tested for sufficiency, and whose deployed decisions can be independently re-derived against pinned kernel bytes.

Seal protects effects. The current production adapter mediates MCP `tools/call`: it blocks a guarded call unless a live, one-use approval matches that exact effect, then emits a receipt you can verify independently. It enforces authorization at the effect boundary; it does not claim to read intent.

## See it work

Run one command. Watch the call get blocked. Approve the exact effect. Watch it flow. Verify the receipt.

```bash
git clone https://github.com/velvetmonkey/seal-live-demo && cd seal-live-demo
bash scripts/run_local.sh
```

This is an **attack replay**, not a live-agent attack: it deterministically blocks a scripted destructive tool call, records the receipt, then shows the identical request succeed only when Seal is bypassed. It needs Docker and Node and ends with `ASSERT OK: 19/19`. [Demo detail](https://github.com/velvetmonkey/seal-live-demo) · [verify a fixture with no Docker](https://github.com/velvetmonkey/seal-assurance-kit).

## What the evidence says

- **Proven:** the Lean kernel is default-deny and permits a guarded effect only with a matching live approval; its distributed results identify which fleet shapes preserve one-use authorization. [Claims matrix](docs/CLAIMS-MATRIX.md) · [fleet boundary](docs/AUTHORIZATION-MESH.md).
- **Tested:** Rust, wasm, and JavaScript agree with the kernel over the conformance corpus. Receipt-field sufficiency is tested, not proven: pre-v2 fields collided for two different effects, so v2 commits `args_hash`. `witness-check`, the proprietary sufficiency analyzer, checks that question. [Evidence and status](docs/CLAIMS-MATRIX.md).
- **Not claimed:** an approved malicious-but-valid request is still authorized; Seal does not read intent, prove the deployed system end-to-end, or secure approvers, hosts, keys, browsers, build systems, or downstream tools. [Limits and trust boundaries](docs/LIMITATIONS.md) · [runtime boundary](docs/TRUTH-BOX.md).

## Start where you are

- Deploy the MCP gate: [seal-host deployment guide](https://github.com/velvetmonkey/seal-host/blob/main/docs/DEPLOY.md).
- Inspect the decision, receipt, and pinned-kernel relationship: [architecture](docs/ARCHITECTURE.md) and [authorization record](docs/AUTHORIZATION-RECORD.md).
- Audit every claim and its check: [claims matrix](docs/CLAIMS-MATRIX-TAMPER.md) and [evaluator start](EVALUATOR-START.md).

The current release ships the gate. Seal proves which fleet deployment shapes preserve single-use authorization; coordinated mesh deployment is a separate architecture, not a shipped promise. [Read the boundary](docs/AUTHORIZATION-MESH.md).

## Go deeper

The [family map](docs/ARCHITECTURE.md) links the kernel, host, receipt verifier, assurance kit, and proprietary `witness-check`. [Why a proof, not a prompt](docs/WHY-DIFFERENT.md) explains the decision rule; [limitations](docs/LIMITATIONS.md) and the [claims matrix](docs/CLAIMS-MATRIX.md) are the canonical honesty surface.

Interested in contributing? Useful lanes are adapters (MCP clients, approval channels, identity and audit integrations), evidence (conformance vectors and adversarial cases), and proof review (assumptions, theorem statements, and missing bridge obligations). [Repository topology](docs/REPO-TOPOLOGY.md) explains the project boundary.

## License

Apache-2.0. See [LICENSE](LICENSE).
