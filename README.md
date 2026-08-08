<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![CI](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

**An AI agent tries to `rm -rf /prod`. Seal stops it cold — because no live approval ever matched that exact action.**

Bypass the boundary and the identical request wipes your data. Agents now act on the real world through tools. One bad call, one hallucination, one prompt injection — and real money moves, real records vanish.

Seal is the hard stop at that seam. For a guarded request it asks one checkable question: *does a live approval record match this exact request?* No record, no action; policy can also allow an explicitly-listed safe call without one, and everything else is denied by default. (That a record was minted by the human you intend is a declared custody assumption, not a theorem.) Every decision is emitted as a tamper-evident receipt anyone can re-derive in a browser or CLI.

This is default-deny you can watch work in three minutes. The proof story (Lean kernel, conformance, TCB) comes after you have seen it stop the attack.

## First receipt in 60 seconds — zero dependencies (no Docker, no Lean toolchain)

```bash
git clone https://github.com/velvetmonkey/seal-assurance-kit
cd seal-assurance-kit
node bin/seal verify fixtures/receipt-block.json   # -> PASS VERIFIED (exit 0)
```

That is the whole trick, standalone: a real Seal decision receipt, re-derived through the pinned kernel to `PASS VERIFIED`, before you install or build anything. Flip a field and it FAILs.

**Full attack replay (3 minutes, requires Docker)**

A separate step. Clone the core and the demo side by side, then run one command:

```bash
git clone https://github.com/velvetmonkey/seal
git clone https://github.com/velvetmonkey/seal-live-demo
cd seal
bash scripts/showcase.sh
```

It spins the gateway, kernel, and DB (the attack tool-call is scripted, not emitted by a live model — the demo's own provenance says so), then walks three steps: a staging insert is ALLOWed, the scripted prod-delete is BLOCKed (rows unchanged), and the identical bytes with Seal removed destroy the table. Real row counts and re-verifiable receipts land in your terminal. Run without the sibling `seal-live-demo` and it prints the next real step instead of dead-ending.

**Why a proof, not a prompt** — machine-checked default-deny vs fail-open judgment: [Why a proof, not a prompt](docs/WHY-DIFFERENT.md).

See the four explicit Trust boundaries (Byzantine replica, egress P6, model-vs-binary, partition liveness) and how each closes: [docs/LIMITATIONS.md#trust-boundaries](docs/LIMITATIONS.md).

## What it does

Two jobs, no more:

1. **Mediate.** Forward a guarded tool call only when the exact target has a live approval record. Otherwise it stops before the tool ever sees it.
2. **Record.** Emit a receipt and a record-chain for every decision, so anyone can replay "was this effect authorized?" long after the incident.

It does not need the model to understand *why* a request is dangerous. It checks whether the exact effect was approved. That is the whole trick.

**Distributed by proof.** Seal's guarantees extend to fleets. A one-shot approval provably cannot be double-spent across a network partition without coordination, and that impossibility is transferred to the real gate, honestly scoped to within the approval's TTL. See the [authorization mesh](docs/AUTHORIZATION-MESH.md).

## Why you can believe it

**The obvious "shared DB + dedupe" design for approvals across a fleet is provably unable to stop cross-replica double-spend of a one-shot ticket. Seal proves the lower bound — and proves which architectures actually work.**

**Fleet headliner (new, axiom-pinned):** over a shared replay-store, two replicas can both honour the same approval (`sealv2_shared_not_sealed_senders`). Single-delivery and mesh-coordinated shapes *are* Safe (`sealv2_partitioned_safe`, `sealv2_mesh_safe`). The obvious design fails; Seal tells you why and what works. (See [Why a proof, not a prompt](docs/WHY-DIFFERENT.md) and the claims matrix.)

Every guardrail on the market claims it works. Most ask you to trust a model's judgment or a pile of tests. Seal asks you to trust one small, checkable thing.

The core question is narrow enough to *prove*: a guarded action must not pass unless the approval state authorizes that exact target. That rulebook is a machine-checked theorem in Lean 4, not a policy doc and not a vibe. Then the checkers that actually ship, Rust, wasm, JavaScript, are tied back to that proven rulebook by byte-exact conformance tests over a shared corpus.

So the honest claim is precise, and that precision is the point. Seal does not claim your browser, your operators, or your toolchain are safe. It proves the kernel, and hands an evaluator the evidence to rerun the connection between the theorem and the bytes that run in production. Prove the rulebook. Check every body that runs it.

## The family

_All Seal-family repositories are currently private; these links resolve only for authorised evaluators._

| Repository | Role | Start here when... |
|---|---|---|
| [mcp-seal-dev](https://github.com/velvetmonkey/mcp-seal-dev) | The rulebook, proven. | You want the Lean kernel and core safety theorems. |
| [crdt-lean](https://github.com/velvetmonkey/crdt-lean) | The distributed spine, proven. | You want the coordination-free no-double-spend theorems under the [authorization mesh](docs/AUTHORIZATION-MESH.md). |
| [seal-host](https://github.com/velvetmonkey/seal-host) | The guard at the door. | You want the deployable MCP host, Rust transport, records, and conformance bridge. |
| [seal-check](https://github.com/velvetmonkey/seal-check) | Don't trust. Verify. | You want to replay a receipt in a browser and check the emitted bytes. |
| [seal-live-demo](https://github.com/velvetmonkey/seal-live-demo) | Watch it work. | You want to see a live-agent attack blocked, then succeed when Seal is removed. |
| [seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit) | Check your own boundary. | You want CLI evidence for receipts, coverage, conformance, and finite monitor adequacy. |
| [witness-check](https://github.com/velvetmonkey/witness-check) | The sufficiency analyzer. (private/proprietary) | You want to know whether a field set carries **enough** information to justify a claim — a found collision indicts the field set itself. |
| [seal-verify-action](https://github.com/velvetmonkey/seal-verify-action) | Gate receipts in CI. | You want `seal verify` running in GitHub Actions, failing the build on an unverifiable receipt. |

## The receipt toolset — one question each

| question | tool |
|---|---|
| Is this receipt well-formed, canonical, and re-derivable? | `seal verify` (seal-assurance-kit) |
| Does the field set carry **enough** to justify the claim? | `witness-check` — the sufficiency analyzer (private) |
| What changed between two receipts — does it touch what is **authorized**? | `seal receipt-diff` (seal-assurance-kit) |
| Gate receipts in CI | `seal-verify-action` — runs `seal verify` in GitHub Actions and fails the build on an unverifiable receipt (the sufficiency and diff checks are local tools today) |

One concept, two surfaces: the kit's `seal adequacy` command answers the same **sufficiency**
question witness-check analyses — whether the supplied evidence separates the labels/effects it
claims to — over a finite sample at the CLI. Do not read them as two different ideas.

## The five-minute path

One demo, one command, real containers, deterministic outcome:

```
git clone https://github.com/velvetmonkey/seal-live-demo && cd seal-live-demo
bash scripts/run_local.sh        # needs Docker + Node; ends with "ASSERT OK: 19/19"
```

You will watch an agent's unapproved destructive call get **blocked** by Seal, the identical
bytes **destroy** the database once Seal is bypassed, and every decision land as a signed
receipt you can re-verify yourself (`seal-check` in the browser, or `seal verify` from
`seal-assurance-kit`).

## Choose your path

- **Buyer or evaluator:** run the five-minute path above, then open the receipt in `seal-check`.
- **Engineer:** to stand the gate up in front of your own agent, follow [seal-host/docs/DEPLOY.md](https://github.com/velvetmonkey/seal-host/blob/main/docs/DEPLOY.md) (build → sign config → run in front of your MCP server → first gated call → receipt). Policy/config field reference: [mcp-seal-dev/docs/POLICY.md](https://github.com/velvetmonkey/mcp-seal-dev/blob/main/docs/POLICY.md). For the design, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (family map) and `seal-host/docs/ARCHITECTURE.md` (host detail); to gate receipts in CI use `seal-assurance-kit` / `seal-verify-action`.
- **Auditor:** start with the [claims matrix](docs/CLAIMS-MATRIX.md) and [what Seal is NOT](https://github.com/velvetmonkey/seal-assurance-kit/blob/main/docs/WHAT-SEAL-IS-NOT.md), then `seal-check` and `seal-assurance-kit`, then `seal-host/docs/PROOF-REFERENCE.md`.
- **Researcher:** start with `mcp-seal-dev` for the kernel and `seal-host` for the model properties around records, capability adequacy, non-interference, and replay isolation.

## For evaluators and auditors

**Start with [EVALUATOR-START.md](EVALUATOR-START.md)**: the proved-vs-deployed map (which profile runs, which approval channel, which receipt schema, what stays in the TCB).

**Then the one-table view: [docs/CLAIMS-MATRIX.md](docs/CLAIMS-MATRIX.md)** — every load-bearing claim, marked proven / tested / assumed / not claimed, with the theorem or CI gate that checks it. The honesty boundary itself: [What Seal is NOT](https://github.com/velvetmonkey/seal-assurance-kit/blob/main/docs/WHAT-SEAL-IS-NOT.md) — read it first.

<!-- truthbox:begin -->
> **Runtime profile: `compatible`.** Strict `canonical-l0` is proved and modelled, not the deployed route yet.
> **Claim:** policy-covered request-effects recognised by the compatible MCP boundary reach the downstream child MCP server only after every applicable Lean kernel returns Allow. Effects configured as guarded additionally require a matching live approval record. Seam failures block; every mediated decision emits replayable evidence.
> **Non-claim:** the deployed host is not proved end to end, and canonical parser rejection is not currently the runtime gate. Host `ApprovalRecord` tokens are a separate signed channel from the v2 kernel-defined approval tuple. “Canonical” in Seal names the pinned kernel byte rule, not RFC 8785/JCS. Seal verifies the configured authorization evidence. Whether that evidence represents the intended human, device or service is an identity and key-custody assumption, not a proved property.
<!-- truthbox:end -->
> Map: [EVALUATOR-START.md](EVALUATOR-START.md) · profile detail: [seal-host/PROFILE.md](https://github.com/velvetmonkey/seal-host/blob/main/PROFILE.md) — private repo; the link resolves only for authorised evaluators.

Mandatory non-claims (canonical copy: [docs/LIMITATIONS.md](docs/LIMITATIONS.md)):

<!-- claims:begin -->
- Seal proves properties of the mediation KERNEL, not of the whole deployed system.
- Seal does NOT prove SHA-256 collision resistance in Lean; it is a named, scoped cryptographic assumption (A-CR).
- The deployed Rust / wasm / JS are NOT proven bug-free; they are tied to the proof by byte-exact conformance testing over a corpus, not for every possible input.
- Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal will execute it.
- Seal does NOT prevent compromise of hosts, browsers, build systems, keys, operators, or downstream tools.
- Seal's audit chain is tamper-EVIDENT, not tamper-IMPOSSIBLE.
- Seal does NOT make the AI smarter or prevent hallucinations; it stops an unapproved effect.
- Axiom footprint {propext, Classical.choice, Quot.sound} is the minimal classical fragment; no extra axioms.
- The axiom-footprint line is a per-theorem ceiling for theorems named in the family's axiom-pin gates; it is not a repository-wide census. Pin scope and named exceptions are indexed in the seal claims matrix (seal/docs/CLAIMS-MATRIX.md).
<!-- claims:end -->

## License

Apache-2.0. See [LICENSE](LICENSE).
