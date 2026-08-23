> Scope: This document describes the Node CLI shipped by this repository first, then the Seal family assurance lineage.
> The state machine is TESTED.
> For the truth about what you installed, read [release evidence](RELEASE-NOTES-v0.2.0-rc.2.md) and the [README](../../README.md).

# Architecture

## Contents

- [Shipped Node product path](#shipped-node-product-path)
- [Assurance lineage — Seal family architecture](#assurance-lineage-seal-family-architecture)
- [What each box is (and what it is not)](#what-each-box-is-and-what-it-is-not)

The [documentation landing page](../README.md) carries the compact process
diagram; this page expands it into the shipped Node path and the separate
family-assurance lineage.

## Shipped Node product path

```mermaid
flowchart LR
    claude["Claude Code\n(MCP client)"]
    proxy["Node proxy\nspine/proxy.cjs"]
    state["TESTED state machine\nhandle · freshness · protocol · one-use"]
    wasm["pinned vendored WASM; load-bearing"]
    server["Selected MCP server\none selected tool"]

    claude --> proxy
    proxy --> state
    state --> wasm
    wasm --> server
```

The shipped Node CLI keeps continuation state in Node and sends only the
authorization sub-question through the vendored WASM. A guarded retry follows
`spine/proxy.cjs` → `contract/contract.cjs` →
`contract/kernel-authorization.cjs` →
`runtime/kernel/runner.cjs` → `seal_decide`. The WASM
answer is load-bearing: BLOCK, unreadable output, a hash mismatch, or a
Node/kernel disagreement all refuse, with no JavaScript authorization fallback.

Node still owns opaque-handle lookup, status and expiry, connection-epoch
currency, the `inputResponses` protocol shape, and journal-before-forward
one-use consumption. The kernel checks the exact tool-and-arguments
authorization target. Node tests project, server, continuation, expiry and
response context before presenting that authorization state to the kernel.
Therefore the accurate product claim is exactly: The authorization rule is
TESTED (`test/approval-contract.test.cjs` and `test/kernel-bridge.test.cjs`).
The state machine is TESTED.

The working Node loader does not use `seal-config.js`'s hard-coded `demo-pk`
stub envelope. It generates an Ed25519 key inside the kernel worker and signs
the config immediately before `seal_init`. That gets the real kernel onto the
product path without weakening signature verification, but it is still
demo-grade, self-authorized configuration signing—not an externally trusted
production configuration key.

## Assurance lineage — Seal family architecture

This diagram describes the Seal family product, not the Node CLI shipped by this repository.

One diagram, five roles: **decision core** (proven), **enforcement** (deployed), **receipt**
(evidence), **conformance** (ties bodies to the proof), **coverage** (audits the policy).
Solid arrows are the runtime path; dashed arrows are evidence and audit paths.

```mermaid
flowchart LR
    agent["AI agent\n(MCP client)"]
    human["Human approver\n(signed approval,\nexact target)"]
    tool["Real tool\nDB / API / service"]

    subgraph host["Enforcement — seal-host (Rust; glue is TCB)"]
        gw["Mediation boundary\n(gateway)"]
    end

    subgraph kernel["Decision core — proven in Lean 4 (mcp-seal-dev)"]
        core["default-deny · exact-target approval\nsingle-use · expiry · non-bypass"]
    end

    agent -->|tool call| gw
    human -->|approval| gw
    gw -->|canonical request| core
    core -->|ALLOW / BLOCK| gw
    gw -->|exact approved bytes only| tool

    receipt["Decision receipt (v2)\nSHA-256 hashes, tamper-evident"]
    gw --> receipt
    receipt -.-> verify["seal verify — CLI\n(seal-assurance-kit;\nshared kernel wasm)"]
    receipt -.-> browser["seal-check — browser\nshared kernel wasm"]
    receipt -.-> rdiff["seal receipt-diff:\nauthorization-surface diff\nbetween two receipts"]
    verify -.-> action["seal-verify-action:\ndownstream-stricter fork of\nthe verify closure, as a CI gate"]

    conf["Conformance — seal test:\ncorpus ties Rust/wasm/JS bodies\nbyte-for-byte to the proven kernel"] -.-> gw
    scan["Coverage — seal scan:\npolicy audit (uncovered tools,\nindistinguishable calls)"] -.-> gw

    demo["seal-live-demo:\none command, real containers,\nBLOCK vs bypass, replayable evidence"] -.-> receipt
```

## What each box is (and what it is not)

- **Decision core** (`mcp-seal-dev`) — the rulebook. Machine-checked Lean 4 theorems: default
  deny, allow **iff** a live approval record matches the exact target, single-use, expiry,
  non-bypass. Proven — but a *kernel* claim, not a whole-system claim; that the record was
  minted by the human you think is a custody assumption (truth box), not a theorem.
- **Enforcement** (`seal-host`) — the guard at the door. The Rust MCP host that routes every
  guarded call through the kernel and forwards only the exact approved bytes. The Rust glue is
  **TCB** (trusted, not proven); it is tied to the proof by conformance testing.
- **Receipt** — every decision emits a v2 receipt (normative spec:
  the host's [authorization decision schema](https://github.com/velvetmonkey/seal-host/blob/main/docs/AUTHORIZATION-DECISION-SCHEMA.md) §11) with derived SHA-256 hashes. Tamper-**evident**,
  not tamper-impossible. `seal verify` (CLI) and `seal-check` (browser) are two
  interfaces over a shared verification lineage, not two implementations that
  can be expected to catch one another's faults: their current published
  artifacts use byte-identical kernel WASM and common receipt-format semantics.
  `seal-verify-action` is derived from the CLI closure as a downstream-stricter
  fork. Agreement between these surfaces is useful conformance evidence, but a
  defect in shared kernel or format logic can make them agree on the same wrong
  answer.
- **Conformance** (`seal test`, conformance bridge) — finite, rerunnable evidence that the
  deployed bodies (Rust, wasm, JS) agree with the proven kernel byte-for-byte over a corpus.
  Evidence, not a universal theorem.
- **Coverage** (`seal scan`) — audits a policy against a tool inventory: uncovered tools,
  redundant rules, calls the policy cannot distinguish.
- **Drift** (`seal receipt-diff`) — field-level diff between two receipts, every difference
  classified authorization-surface vs minor, integrity-checked against each receipt's own
  hashes before diffing. Reports change; it does not re-verify a seal.
- **CI gate** (`seal-verify-action`) — the `seal verify` closure vendored into a GitHub
  Action as a maintained downstream-stricter fork of the kit verifier (base kit revision
  pinned, every vendored file sha256-checked in CI; the fork additionally requires a valid
  `signed_config` for an authorised outcome — see seal-verify-action/VENDORED.md): receipts
  are re-verified on every push and an unverifiable receipt fails the build.
- **Sufficiency** (`seal adequacy`) — the prior question: do the committed fields carry enough
  information to identify the effect they authorize? A found collision indicts the field set
  itself — no implementation reading those fields can fix it. This check caught Seal's own
  pre-v2 approval surface; v2's `args_hash` closes it.

Claim-status per box: [CLAIMS-MATRIX.md](../archive/CLAIMS-MATRIX.md). Honesty boundary:
[What Seal is NOT](https://github.com/velvetmonkey/seal-assurance-kit/blob/main/docs/WHAT-SEAL-IS-NOT.md).
Fleet links are public and resolve for everyone; `witness-check` remains proprietary.
