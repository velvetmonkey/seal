# Source versions and captured examples

These content examples were captured on Linux on 18 September 2026. They are source-checkout observations, not a claim that another platform or a later verifier revision behaves identically.

| Tool | Source revision | Observed task |
|---|---|---|
| seal | [fc06a5e5a7171fd9a9a94fec36360fbdeb870842](https://github.com/velvetmonkey/seal/tree/fc06a5e5a7171fd9a9a94fec36360fbdeb870842) | Interactive disposable demo and product receipt check |
| seal-check | [a93003a1e4b2c536a52637f184e6a2cd26eb5bbf](https://github.com/velvetmonkey/seal-check/tree/a93003a1e4b2c536a52637f184e6a2cd26eb5bbf) | Browser check of that fresh receipt and changed-argument refusal |
| seal-assurance-kit | [1ae0df58b3ffd68bef86bc5853e6dad67eef1968](https://github.com/velvetmonkey/seal-assurance-kit/tree/1ae0df58b3ffd68bef86bc5853e6dad67eef1968) | Receipt, scan, diff, adequacy, conformance and policy scaffolding samples |

Output excerpts are copied from actual runs; absolute scratch paths, times and hashes can differ on another run. The kit example commands use its checkout explicitly because its executable name overlaps the product's.

The full published contract accepts finite decimal arguments in its supported range. The pinned companion revisions' decimal refusal is a known implementation gap, not a contract restriction. No claim is made here that a separate fix has landed.

Not exercised for these guides: macOS/Windows installation, actual Claude Code acceptance, private operator key provisioning, hosted CI configuration, policy signing or client connect/disconnect. Public examples do not establish operator identity or effect occurrence.

The dated [evaluator report](../assurance/evaluator-start.md) and [archive](../archive/README.md) retain their own historical scope. They are not silently promoted to current measurements.

Previous: [Finite conformance evidence](conformance.md).
Up: [Current evidence and gaps](README.md).
