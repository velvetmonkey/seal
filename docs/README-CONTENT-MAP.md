# README content relocation map

This inventory maps every claim-bearing or caveat-bearing section of the
157-line pre-distillation README (`5a39c92:README.md`) to its current home.
The command inventory is separate because prerequisites were audited per
command.

| Before | Claims and caveats carried | Current home |
|---|---|---|
| Opening threat and gate description | exact-request approval, default deny, custody assumption, tamper-evident receipts | README opening; [front-page reference](FRONT-PAGE-REFERENCE.md#what-seal-does) |
| Family framing | machine-checked rule; sufficiency tested; pinned-byte re-derivation; effects/MCP/no-intent boundary | README opening and exact truth box; [claims matrix](CLAIMS-MATRIX.md) |
| First receipt in 60 seconds | fixture re-derivation and field-flip failure; standalone rather than deployed gate | [front-page reference](FRONT-PAGE-REFERENCE.md#receipts-and-assurance-tools); assurance-kit README |
| Full attack replay / five-minute path | scripted request, Docker path, block/bypass contrast, row counts, receipts | [front-page reference](FRONT-PAGE-REFERENCE.md#scripted-attack-replay); seal-live-demo README |
| What it does and diagram | mediate exact guarded effect; record receipt/chain; policy safe-call allowance | README journey; [front-page reference](FRONT-PAGE-REFERENCE.md#what-seal-does) |
| Distributed headline | lower bound, shared-store counterexample, safe shapes, TTL/model scope | [front-page reference](FRONT-PAGE-REFERENCE.md#fleet-and-distributed-results); [authorization mesh](AUTHORIZATION-MESH.md) |
| Why believe it | narrow Lean theorem; finite conformance; whole-system caveat | README claim summary and exact truth box; [claims matrix](CLAIMS-MATRIX.md) |
| Family table | repository roles and proprietary `witness-check` exception | [front-page reference](FRONT-PAGE-REFERENCE.md#repository-map) |
| Receipt toolset | verify, adequacy/sufficiency, proprietary analyzer, diff, CI action | [front-page reference](FRONT-PAGE-REFERENCE.md#receipts-and-assurance-tools); [architecture](ARCHITECTURE.md) |
| Choose your path | buyer, engineer, auditor, researcher destinations | README single developer route; [front-page reference](FRONT-PAGE-REFERENCE.md#repository-map) for the other audiences |
| Evaluator section and truth box | compatible profile, canonical-l0 gap, host token separation, custody assumption | README exact truth box; [evaluator start](../EVALUATOR-START.md); [truth box](TRUTH-BOX.md) |
| Mandatory non-claims | whole-system, cryptography, glue, intent, compromise, tamper, hallucination, axiom scope | README guarded claims block; [limitations](LIMITATIONS.md) |
| Licence | Apache-2.0 | README licence section |

No fleet statement is presented as a shipped mesh feature. No attack replay is
called a live-agent attack. Every effect-sufficiency statement says tested,
and every mention of the analyzer keeps `witness-check` private/proprietary.
