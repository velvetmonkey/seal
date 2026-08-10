<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)
[![Host acceptance](https://github.com/velvetmonkey/seal-host/actions/workflows/golden-path.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal-host/actions/workflows/golden-path.yml)

**Seal is the agent authorization gate whose decision rule is machine-checked,
whose effect commitment is tested for sufficiency, and whose deployed
decisions can be independently re-derived against pinned kernel bytes.**

Seal protects effects. Its current production adapter mediates MCP
`tools/call`: an unapproved guarded call stops before the real tool sees it;
one exact approval lets that exact call flow once; every decision leaves a
receipt. Seal enforces authorization at the effect boundary. It does not claim
to read intent.

## One journey

```text
blocked → approved once → executed → independently verified → tamper rejected
```

That is the product loop and the only first-run route:

1. Put `seal-host` in front of one MCP server.
2. Send a guarded call and see `approval required: <64-hex>`.
3. Approve the exact displayed request while that host session is live.
4. Retry the identical call and see it reach the tool once.
5. Verify the receipt, change one recorded verdict, and see verification fail.

The complete walkthrough, including every prerequisite before its command and
observed terminal output, is in
[seal-host's getting-started guide](https://github.com/velvetmonkey/seal-host/blob/main/docs/GETTING-STARTED.md).

**Availability today:** `seal-host` v0.1.5 is the first published release. Its
eight assets include x86_64 and aarch64 Linux hosts, both SBOMs, checksums, and
signed provenance. The host guide records the actual download, checksum,
provenance verification, and x86_64 extraction. Windows/WSL2 remains untested;
the 20m55s source-build path is separate and is not silently substituted for
the release install.

## Why the claim is narrow

- **Proven:** selected properties of the authorization kernel, including
  default deny, target-bound one-shot approvals, and model-level non-bypass.
- **Tested, not proven:** deployed-body conformance and effect-commitment
  sufficiency. The pre-v2 committed fields admitted two different effects with
  the same visible commitment; v2's `args_hash` closes that concrete collision.
  `witness-check`, wherever this sufficiency clause appears, is private and
  proprietary.
- **Assumed:** cryptography, toolchains, host and key custody, operator identity,
  and that effects cannot bypass the mediated boundary.
- **Not claimed:** end-to-end correctness, intent understanding,
  tamper-impossibility, bug-free glue, or safety after host/key/tool compromise.

Read the one-table [claims matrix](docs/CLAIMS-MATRIX.md) for the exact theorem,
test, assumption, or non-claim behind every sentence.

The Seal fleet repositories are public and their links resolve for everyone;
`witness-check` remains private and proprietary.

<!-- truthbox:begin -->
> **Runtime profile: `compatible`.** Strict `canonical-l0` is proved and modelled, not the deployed route yet.
> **Claim:** policy-covered request-effects recognised by the compatible MCP boundary reach the downstream child MCP server only after every applicable Lean kernel returns Allow. Effects configured as guarded additionally require a matching live approval record. Seam failures block; every mediated decision emits replayable evidence.
> **Non-claim:** the deployed host is not proved end to end, and canonical parser rejection is not currently the runtime gate. Host `ApprovalRecord` tokens are a separate signed channel from the v2 kernel-defined approval tuple. “Canonical” in Seal names the pinned kernel byte rule, not RFC 8785/JCS. Seal verifies the configured authorization evidence. Whether that evidence represents the intended human, device or service is an identity and key-custody assumption, not a proved property.
<!-- truthbox:end -->

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

## Go deeper

- [Front-page reference](docs/FRONT-PAGE-REFERENCE.md) — receipt tools,
  scripted attack replay, fleet results, public family map, and the full moved caveats.
- [Architecture](docs/ARCHITECTURE.md) — how the proof, host, receipts, and
  verifiers fit together.
- [What Seal does not claim](docs/LIMITATIONS.md) — the honesty boundary.
- [Evaluator start](EVALUATOR-START.md) — proved versus deployed, with the
  current runtime profile and trusted components.

## License

Apache-2.0. See [LICENSE](LICENSE).
