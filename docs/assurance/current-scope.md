# Current guarantees and limits

This page orients a reader inside the assurance material in [Assurance](README.md).
It does not add a new claim: every sentence below is drawn from, and must stay
consistent with, the canonical
["Guarantees and non-guarantees"](../../README.md#guarantees-and-non-guarantees)
section of the repository README, which remains this iteration's claim
ceiling. A repository test binds the quoted sentences below to that section so
this page cannot drift from it silently.

## Proved model properties

**Lean proof source:** [`seal-host`'s proof reference](https://github.com/velvetmonkey/seal-host/blob/main/docs/PROOF-REFERENCE.md) is the reader-facing index for the Lean proof properties stated in this section.

The following is quoted verbatim from the README so this page cannot drift
from it silently:

> Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is not yet tested.
> Release incorporation: The theorem artifact does not yet ship and run in the released build graph.
> Semantic correspondence: The theorem concerns `SealV2.decide`. The shipped authorization path is `sealHostStep -> stepImpl -> Host.dispatch`. Their correspondence is not yet tested or proved. The `interpreted Lean vs shipped WASM` job compares verdicts from the shipped implementation interpreted through `Ffi.modelStep` with verdicts from its compiled WASM on a corpus; it asserts their agreement, with no independent expected verdict. It does not compare `SealV2.decide` with the shipped path.

## Tested implementation behavior

The proof-bearing source compiles reproducibly to the WASM the product uses,
and a tested Node runtime enforces it with durable one-use state,
configuration-drift refusal, concurrent-proxy fencing and signed receipts.

The proof-bearing source rebuilds the exact kernel bytes the downloadable
product requires, and the product has no JavaScript authorization fallback.
Follow that source binding through [Reproducible kernel](../reproduce.md).

| Surface | Current shipped assurance status |
| --- | --- |
| Authorization rule | TESTED |
| Product state/forwarding | TESTED |
| Client and machine | TRUSTED |

## Trusted assumptions

- **Client and machine.** Seal trusts the host operating system, the Node
  runtime, and the interactive client (Claude Code) to render the approval
  request it is given and return the human's actual answer; a compromised
  client or host is outside Seal's threat model.
- **At-most-once, not exactly-once.** Seal permits at most one execution per
  approval. A failure before forwarding can spend an approval without running
  the call.

## Not established

Quoted verbatim from the README:

> Seal protects selected calls that pass through its boundary. A failure before forwarding can spend an approval without running the call; a human can approve a malicious but valid request; and Bash, direct writes, network access, subprocesses, other servers, and other routes to the same effect stay outside. Receipts are signed decision records, not proof that an effect happened.

- **Decision records are not event-occurrence proof.** As quoted above:
  receipts are signed decision records, not proof that an effect happened.
- **Checker agreement is not independent confirmation.** The browser checker
  (seal-check) and the assurance CLI (seal-assurance-kit) share kernel and
  receipt-format dependencies, so their agreement can also reflect a shared
  defect.

## Family context

**Lean proof source:** [`seal-host`'s proof reference](https://github.com/velvetmonkey/seal-host/blob/main/docs/PROOF-REFERENCE.md) is the reader-facing index for the Lean proof properties stated in this section.

The archived family claims matrix
([CLAIMS-MATRIX.md](../archive/CLAIMS-MATRIX.md)) describes a wider Seal
family (a Rust host, Lean proof kernels, a verifier fleet) and is historical
family context, not this product's current assurance ceiling. Read
[Architecture and verification relationships](architecture.md) for how the
shipped Node CLI relates to that family lineage.

Previous: [Claude Code evidence](claude-code-evidence.md).
Up: [Assurance](README.md).
Next: [Choose a checking tool](../verify/README.md).
