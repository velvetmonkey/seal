# Receipt operations vector set v1

This versioned vector is an unsigned `seal.receipt/v2` receipt whose recorded
kernel decision is `BLOCK`. Run it from the repository root:

```bash
node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json
```

The vector covers READ, VALIDATE, REPLAY, the unsigned-signature boundary, and
the currently unreachable VERIFY result. It does not cover a valid signature,
authority-root or occurrence-witness formats, producer output, or proof that a
downstream event occurred.

Previous: [Multi-tool semantics](../multi-tool-semantics.md).
Up: [Reference](../README.md).
