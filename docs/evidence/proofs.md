# Proof and source index

**Lean proof source: seal-host.** The imported model files below preserve that source lineage.

The model and theorem boundary is distinct from the shipped Node authorization path. seal-host contains the host model lineage; Seal carries imported model sources and a runtime whose correspondence has its own limits.

The following immutable Seal source snapshot makes the imported statements inspectable without relying on moving line numbers:

| Source | Subject to inspect |
|---|---|
| [Host/Composition.lean](https://github.com/velvetmonkey/seal/blob/fc06a5e5a7171fd9a9a94fec36360fbdeb870842/Host/Composition.lean) | Composition and non-bypass within the model |
| [Host/Record.lean](https://github.com/velvetmonkey/seal/blob/fc06a5e5a7171fd9a9a94fec36360fbdeb870842/Host/Record.lean) | Append-only and tamper-evidence model statements |
| [Host/CapabilityAdequacy.lean](https://github.com/velvetmonkey/seal/blob/fc06a5e5a7171fd9a9a94fec36360fbdeb870842/Host/CapabilityAdequacy.lean) | Capability commitments and target authorization |
| [Host/ReplayIsolation.lean](https://github.com/velvetmonkey/seal/blob/fc06a5e5a7171fd9a9a94fec36360fbdeb870842/Host/ReplayIsolation.lean) | Replay isolation within the modeled state transitions |

Read each statement with its hypotheses, definitions and imported assumptions. A theorem name is not evidence that arbitrary JavaScript, client configuration or a remote tool obeys it. No Lean build was performed for this content-only pass.

Use [current scope](../assurance/current-scope.md) for the product-facing claim and [correspondence](correspondence.md) for the model-to-runtime gap.

Previous: [Verification dependencies](dependencies.md).
Up: [Current evidence and gaps](README.md).
Next: [Model-to-runtime correspondence](correspondence.md).
