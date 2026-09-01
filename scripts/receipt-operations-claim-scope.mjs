// The scope and scanner boundary are fixed independently of the claim rows.
// A row deletion must not be able to make a covered file disappear from the
// population, and an unrecognised verb must not make a sentence disappear.
export const claimFiles = [
  "docs/reference/receipt-operations.md",
  "docs/reference/receipt-operations-v1/README.md",
];

// These are instructional fragments, not behavioral claims. Every other
// prose sentence in the fixed files is in scanner scope.
export const nonBehavioralSentences = new Set([
  "From the checkout root, run the linked v1 vector with Node 20 or newer:",
  "Run it from the repository root:",
  "Previous: [Reference](README.md).",
  "Up: [Reference](README.md).",
  "Next: [Multi-tool semantics](multi-tool-semantics.md).",
  "Previous: [Multi-tool semantics](../multi-tool-semantics.md).",
  "Up: [Reference](../README.md).",
  "Next: [Assurance](../../assurance/README.md).",
]);

// The only currently reviewed documentation-only claims. A CHECKED row may
// be downgraded only by adding a new reviewed identity and its reason; merely
// flipping the status of an existing checked identity is not a downgrade.
export const declaredClaimKeys = new Set([
  "docs/reference/receipt-operations.md\0Seal is the canonical reference for the four operations of the shipped v2 receipt verifier, `checker/seal-receipt-v2.mjs`.",
  "docs/reference/receipt-operations.md\0`seal demo` writes receipts to the `receipts` directory inside the demo directory it prints, on purpose, so that a demo run cannot plant fabricated decisions in a project's durable receipt store (`spine/demo.cjs:107-118`).",
  "docs/reference/receipt-operations.md\0A protected project writes receipts to the `receipts` directory inside the project data directory, `~/.local/share/seal/projects/<project-id>/`, under `$XDG_DATA_HOME` instead when that is set (`spine/protection.cjs:228-230` and `spine/protection.cjs:996`).",
  "docs/reference/receipt-operations.md\0The `<project-id>` part comes from a hash of the project path, so instead of guessing it, run `seal status` in the project and read the exact path from its `Receipts:` line.",
  "docs/reference/receipt-operations.md\0The normative envelope and canonicalisation rules remain in [SEAL-RECEIPT-V2.md](../SEAL-RECEIPT-V2.md).",
  "docs/reference/receipt-operations.md\0This page owns the meaning of the four operational verbs and the trust ceiling of the shipped verifier.",
  "docs/reference/receipt-operations-v1/README.md\0It does not cover a valid signature, authority-root or occurrence-witness formats, producer output, or proof that a downstream event occurred.",
]);
