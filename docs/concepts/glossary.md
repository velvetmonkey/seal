# Scope glossary

| Term | Meaning in these guides |
|---|---|
| Gate | Approval boundary for selected routed calls |
| Exact request | The tool and parsed argument identity an approval covers |
| Receipt | A decision record whose checks depend on its family |
| Commitment | A binding to data; equality alone does not establish occurrence |
| Receipt signer | Key holder signing a Protect/Spine receipt |
| Config signer | Key holder signing a decision-family policy/configuration |
| Trust anchor / pin | Independently provisioned expected identity, not a value trusted merely because the receipt carries it |
| Replay | Verifier-local re-evaluation of recorded inputs |
| Profile | A named verifier contract, including authority and reduced-scope behavior |
| Unpinned | Authority not established against an independent expected key |
| Reduced scope | A check cannot support the full result from available evidence |
| Ungated | A mutating tool explicitly allowed without an approval guard in the scanned policy |
| Adequacy | Whether the observed finite monitor evidence distinguishes supplied labels |
| Vacuous | A formally satisfied condition that distinguished no meaningful alternatives in the sample |

These words are component-specific. In particular, scan coverage is not live route coverage, and successful receipt verification is not proof that an effect happened. Continue with [evidence](../evidence/README.md) or return to [receipt results](../check/results.md).

Previous: [Replay and trust](replay-and-trust.md).
Up: [Concepts](README.md).
Next: [Current evidence and gaps](../evidence/README.md).
