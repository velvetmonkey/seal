<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

**Seal is a proven checkpoint for AI agents.**

AI agents are crossing the line from suggestion into action. They can send money, delete data, update tickets, call vendors, and trigger production systems through MCP tools. That power is useful. It is also where a hallucination, prompt injection, stale approval, or confused workflow becomes a real-world effect.

Seal puts a checkpoint at that boundary. When an AI agent tries to use a real tool over MCP, Seal asks one question: did a human explicitly approve *this exact request*? No matching approval, no action. Every decision is written into a tamper-evident record you can check yourself.

What makes Seal different from ordinary guardrails is the rulebook. The core mediation rules are machine-checked theorems in Lean 4. The same decision logic is then run in the Rust host, browser wasm, and JavaScript checkers, with byte-exact conformance tests tying those bodies back to the proven rulebook over a shared corpus. The honest frame is simple: prove the rulebook, check every body that runs it.

## The problem

MCP makes agents concrete. A model no longer just writes text; it asks tools to mutate state. Prompt filters and tests can reduce risk, but they do not give an auditor a crisp answer to the question that matters after an incident: was this external effect explicitly authorized?

Seal answers at the point of effect. It does not need the model to understand why a request is dangerous. It checks whether the exact target commitment has a live human approval. If not, the call stops before the downstream tool sees it.

## The answer

Seal has two jobs:

1. **Mediate** guarded MCP tool calls: forward only when the exact target has a live approval.
2. **Record** the decision: emit receipts and record-chain evidence that can be rechecked later.

That gives buyers a clear operational story, engineers a deployable host, auditors a verifier, and researchers a compact proof surface.

## Why proof matters

Tests are still necessary. Seal uses them heavily. But the core question is small enough to prove: a guarded action must not pass unless the approval state authorizes that exact target. Lean checks that rulebook directly. Conformance testing then checks that the deployed bodies used by the product family match that rulebook over the corpus.

This split is the point. The theorem is not a blanket claim about browsers, Rust, wasm, operators, or toolchains. It is a precise kernel claim, connected to deployed artifacts by evidence an evaluator can rerun.

## The family

| Repository | Role | Start here when... |
|---|---|---|
| [mcp-seal-dev](https://github.com/velvetmonkey/mcp-seal-dev) | The rulebook, proven. | You want the Lean kernel and core safety theorems. |
| [seal-host](https://github.com/velvetmonkey/seal-host) | The guard at the door. | You want the deployable MCP host, Rust transport, records, and conformance bridge. |
| [seal-check](https://github.com/velvetmonkey/seal-check) | Don't trust. Verify. | You want to replay a receipt in a browser and check the emitted bytes. |
| [seal-live-demo](https://github.com/velvetmonkey/seal-live-demo) | Watch it work. | You want to see a live-agent attack blocked, then succeed when Seal is removed. |
| [seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit) | Check your own boundary. | You want CLI evidence for receipts, coverage, conformance, and finite monitor adequacy. |

## Choose your path

- **Buyer or evaluator:** start with `seal-live-demo`, then open the receipt in `seal-check`.
- **Engineer:** start with `seal-host`, read `docs/ARCHITECTURE.md`, then run the conformance bridge.
- **Auditor:** start with `seal-check` and `seal-assurance-kit`, then read `seal-host/docs/PROOF-REFERENCE.md`.
- **Researcher:** start with `mcp-seal-dev` for the kernel and `seal-host` for the model properties around records, capability adequacy, non-interference, and replay isolation.

## For evaluators and auditors

Mandatory non-claims:

- Seal proves properties of the mediation KERNEL, not of the whole deployed system.
- Seal does NOT prove SHA-256 collision resistance in Lean; it is a named, scoped cryptographic assumption (A-CR).
- The deployed Rust / wasm / JS are NOT proven bug-free; they are tied to the proof by byte-exact conformance testing over a corpus, not for every possible input.
- Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal will execute it.
- Seal does NOT prevent compromise of hosts, browsers, build systems, keys, operators, or downstream tools.
- Seal's audit chain is tamper-EVIDENT, not tamper-IMPOSSIBLE.
- Seal does NOT make the AI smarter or prevent hallucinations; it stops an unapproved effect.
- Axiom footprint {propext, Classical.choice, Quot.sound} is the minimal classical fragment; no extra axioms.

## License

Apache-2.0. See [LICENSE](LICENSE).
