# A decision is not an effect

A receipt is recorded evidence about a decision and its bindings. A signature can establish that particular bytes were signed by the supplied key. It cannot establish that the physical or remote effect happened.

An ALLOW record is not proof that a database changed. A BLOCK record can be a correct, successfully checked decision. A missing receipt is not proof that no alternate route performed an action.

Keep four questions separate: are the bytes structurally valid, do their signature/bindings check, does local replay reproduce the decision, and is there independent evidence for authority or occurrence? The checkers expose different subsets of these questions.

When investigating an effect, combine the receipt with separately scoped operational evidence. Do not promote a filename count, history row or unpinned signature into authenticated execution history. [Results](../check/results.md) explains the displayed terminology.

Previous: [Approval binds an exact request](approval.md).
Up: [Concepts](README.md).
Next: [Replay and trust](replay-and-trust.md).
