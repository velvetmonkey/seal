# Model-to-runtime correspondence

Lean proves statements about specified decision models. The shipped gate additionally depends on runtime code, request parsing, process and client behavior, keys and the local machine. An executable model or a pinned kernel does not by itself prove that the complete authorization path implements that model.

Seal's current scope states that correspondence between the proved authorization model and shipped authorization path is neither tested nor proved. The seal-host model lineage and imported theorem files do not close that gap merely by being present in the repository.

A finite differential can compare named inputs against named implementations. Reproducibility can compare bytes from a source/build process. A real-client walk can show a particular configured route operating. None should be reported as universal correspondence without an applicable argument and evidence.

Retain [the current scope statement](../assurance/current-scope.md) beside stronger-looking proof or replay results. Consult [finite conformance](conformance.md) and [real-client evidence](../assurance/claude-code-evidence.md) for what has actually been exercised.

Previous: [Proof and source index](proofs.md).
Up: [Current evidence and gaps](README.md).
Next: [Finite conformance evidence](conformance.md).
