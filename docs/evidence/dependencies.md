# Verification dependencies

The producer, browser checker and assurance CLI are separate programs, but they share parts of the kernel and receipt-format lineage. Running a companion checker removes reliance on the producer's receipt-reporting path for those checks; it does not remove all common dependencies.

Browser results depend on the delivered application, bundled kernel, JavaScript/WebAssembly execution, cryptography and supplied keys. Local serving changes delivery, not the meaning of trust. The CLI also depends on Node, its pinned artifacts and the files it reads.

Signer custody and independently provisioned authority remain outside a self-consistency demonstration. A compromised producer can sign its own claim. Actual effect occurrence needs separate evidence.

Kernel identity comparisons, finite conformance and proof references each support a different statement. Keep them separate in an assurance report, and state the exact revision being reviewed. [Sources](sources.md), [proofs](proofs.md) and [correspondence](correspondence.md) provide the boundaries.

Previous: [Current evidence and gaps](README.md).
Up: [Current evidence and gaps](README.md).
Next: [Proof and source index](proofs.md).
