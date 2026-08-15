> Scope: This document describes the Seal family product, not the Node CLI shipped by this repository.
> This repository ships a Node CLI whose gate is the JavaScript retry contract.
> For the truth about what you installed, read [docs/RELEASE-NOTES-v1.1.md](RELEASE-NOTES-v1.1.md) and the [README](../README.md).

# Truth box (canonical)

<!-- Canonical copy of the truth-box claim block: runtime profile, claim,
     non-claim. index.html mirrors these three lines verbatim between the same
     markers. The per-repo "Map" line is NOT part of this block (its links are
     relative here, absolute in the sibling repos). Edit here first;
     scripts/claims-drift.mjs enforces equality for this local mirror. -->

<!-- truthbox:begin -->
> **Runtime profile: `compatible`.** Strict `canonical-l0` is proved and modelled, not the deployed route yet.
> **Claim:** policy-covered request-effects recognised by the compatible MCP boundary reach the downstream child MCP server only after every applicable Lean kernel returns Allow. Effects configured as guarded additionally require a matching live approval record. Seam failures block; every mediated decision emits replayable evidence.
> **Non-claim:** the deployed host is not proved end to end, and canonical parser rejection is not currently the runtime gate. Host `ApprovalRecord` tokens are a separate signed channel from the v2 kernel-defined approval tuple. “Canonical” in Seal names the pinned kernel byte rule, not RFC 8785/JCS. Seal verifies the configured authorization evidence. Whether that evidence represents the intended human, device or service is an identity and key-custody assumption, not a proved property.
<!-- truthbox:end -->
