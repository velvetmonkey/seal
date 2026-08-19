# The credential broker: availability, replication and where the secret lives

Ben ruled topology C on 2026-07-25. This file is the availability design that
ruling implies, plus the one fork it cannot be finished without.

Companion to `WHAT-SEAL-IS.md` (what seal is) and `COMPREHENSION-CHECK.md` (what
the human is consenting to). Read those first; this one assumes them.

## The ruling, restated so it can be argued with

Three topologies were on the table.

| | Where the check lives | Survives misconfiguration | Works with unmodified tools |
|---|---|---|---|
| A, proxy (today) | byte path, before forward | no | yes |
| B, sink verification | executor checks a token before acting | yes | no, needs integration |
| C, credential broker | executor has no credential to act with | structurally | no, broker must own the secret |

**Ruled: C, scoped to ONE sink, proven end to end before generalising.** Topology A
remains for everything unwrapped, and `CLAIMS.md` must say which sinks are which.

The reason C and not B: B still relies on the executor choosing to check. C removes
the thing the executor would otherwise act with. That is the difference between a
rule and a fact.

## What the broker actually changes

Today the agent holds the credential:

```text
[agent]  POSTGRES_PASSWORD in its environment  --->  [postgres]
```

`demo/golden_path_postgres.py:224` generates the password and puts it in the
agent's own environment. Anything in that process reads it. Any shell it spawns
prints it with `env`. Seal observes the wire and asks politely; the password is
indifferent to seal's existence.

Under the broker:

```text
[agent]   holds no credential, only a socket
    |  request + capability
    v
[broker]  holds the credential, checks the capability FIRST
    |
    v
[postgres]
```

There is no cryptography in that idea. The move is: **put the secret on the far
side of the check.** The agent asks the broker to perform an effect; the broker
verifies a capability bound to the exact request digest; only then does it use
the credential it holds.

This is the answer to Qwen's "the excluded shell / network / in-process paths are
the primary mechanism of blindness". We do not watch more paths. We remove the
authority from all of them. An agent with a shell now holds a shell and nothing
else.

## Why availability becomes a real design problem

One broker is a single point of failure: it dies, all new work stops. So it wants
replicating. Replication creates exactly two problems, and they are unrelated to
each other. Conflating them is the usual mistake.

### Problem 1 — the same capability redeemed twice

Approval tokens are single-use; a nonce is consumed on redemption.

Two brokers, each with a local consumed-set. The network partitions between them.
The same token is presented to A and then to B. Each checks its own set, each sees
an unconsumed nonce, each authorises. The effect fires twice.

Afterwards the two sets merge and agree perfectly that the nonce was consumed. The
data is consistent and the security property is dead.

**This is why a CRDT cannot be the answer here.** CRDTs guarantee convergence.
Single-use is mutual exclusion. Convergence is not mutual exclusion, and no choice
of merge function makes it one.

### The state splits, and the two halves want opposite things

| State | Shape | Mechanism |
|---|---|---|
| receipts, decisions, audit log | grow-only, never retracted | **CRDT**, merge by union, replicate freely, scales flat |
| nonce consumption | uniqueness constraint | **NOT CRDT-able**, see above |

The receipt half is genuinely a CRDT problem and should be built as one. DeepSeek's
Certificate Transparency analogy lands precisely here: CT is the public record of
certificate ISSUANCE, the seal receipt log is the record of capability EXERCISE, and
both are append-only.

### Sharding: make the race impossible rather than winning it

Do not make brokers agree about nonces. Ensure only one broker is ever asked.

Each broker owns a disjoint region of the nonce space. An approval is minted stamped
with its owning shard and is redeemable only there. Uniqueness holds **by ownership**,
not by agreement, so the hot path needs no coordination at all.

Replicate WITHIN a shard for durability: a shard is a small group of machines running
a consensus protocol among themselves so the consumed-set survives a machine loss.
Small-group consensus is cheap; global consensus is not. Keeping coordination local
is the entire trick.

Failure mode under this design is partial and legible: lose a shard's quorum and only
that shard's outstanding capabilities stop being redeemable. Every other shard keeps
serving.

### CAP, and the choice seal already made

Under partition you choose consistency or availability.

**Seal is fail-closed, therefore seal is CP, and that is correct.** An AP gate is a
gate that says yes when it cannot tell, which is fail-open, which contradicts the
product. State it in `CLAIMS.md` as a designed property with an SLO, not as an
apology: under partition, the mint path refuses.

### The asymmetry that rescues availability

| Path | Coordination | Scaling |
|---|---|---|
| verify an existing receipt | none | flat, read-only, replica-friendly |
| mint an approval, consume a nonce | yes | narrow coordinated waist |

Only minting is expensive. Verification is stateless against a replicated log. So
"seal down means work stops" is true only for NEW approvals, never for anything
already authorised. That is a far easier operational promise to make, and it should
be made explicitly rather than left for an operator to discover.

## Problem 2 — replication multiplies the secret

Replicate a broker three ways for durability and the credential now sits on three
machines instead of one. **Redundancy and secret hygiene pull in opposite
directions**, and this is the harder of the two problems.

**CORRECTED 2026-07-25, same day, before this design was built on.** The first
version of this section proposed Shamir secret sharing of the sink credential. That
is wrong, and the refutation is decisive. Kimi K3, in the topology-C council:

> You cannot threshold-*present* a password. SCRAM requires the secret on the client
> side at authentication. m-of-n over a sink password means reconstituting it into
> broker memory at the moment of use, which means the broker holds the credential at
> exactly the moment that matters. Threshold cryptography protects *signing*, not
> *possession-and-presentation*.

DeepSeek reached the same place independently: "if your broker is compromised,
splitting the key doesn't help when the secret must be reassembled in memory to talk
to Postgres; a sophisticated attacker extracts the reassembled secret from the
replica that is currently live."

So splitting a sink password buys nothing against the attacker who matters. It
protects the secret at rest, which was never the exposure.

**The correct answer, four seats across two benches converging:**

- **Lease, do not guard.** Per-request ephemeral database users, Vault-style dynamic
  secrets, RDS IAM. On approval, mint a role scoped to exactly the approved effect
  with a TTL of seconds. Compromising a replica yields credentials that expire before
  they are useful. This eliminates the standing secret rather than defending it, and
  it uses the database's own authentication instead of a bespoke shim.
- **Threshold belongs on seal's OWN signing key** (FROST), so no single replica can
  mint capabilities unilaterally. That is signing, which is what threshold
  cryptography is actually for.
- **Shamir only where leasing is impossible**, on un-leaseable legacy sinks, with
  named human shareholders and an explicitly labelled risk tier.

Two honest costs of leasing, not to be glossed: the **provisioner credential is still
standing and high-value**, so the exposure is moved rather than removed; and
per-request `CREATE ROLE` / `DROP ROLE` is cluster-global catalog churn, so leasing
covers the human-approved path well and a high-QPS auto-approved path badly.

**Consequence for the wedge.** Under leasing the agent DOES briefly hold a credential,
so "the agent holds no credential" stops being literally true. It becomes "the agent
holds a credential that is cryptographically narrow and expires in seconds". DeepSeek's
verdict on defending the absolute: "dismissing this because it violates the wedge is
green-measuring form over function."

## The fork this design cannot be finished without

`m_code`, `n_code`, `m_pol`, `n_pol` are **already named in the spec**. They are
exactly the m-of-n shape above. The threshold design was anticipated.

**It is not built.** Frisked on disk 2026-07-25: none of those four names appear
anywhere in `SealV2/EffectEnvelope.lean`. The round-10 register lists them as a
family-C gap ("a named hash input without a pinned byte formula") and records that
it is not settled whether they are signed at all.

So two questions gate this document:

1. Are the threshold fields signed?
2. What is their pinned byte formula?

**Until those are ruled, the honest design is single-holder per shard**, and that is
a real availability and blast-radius limitation that belongs in `CLAIMS.md` rather
than being papered over. A broker that cannot be replicated without duplicating its
credential is a broker with a stated ceiling.

This is a bigger fork than the nonce question, because it decides whether the broker
can be made highly available at all without multiplying what an attacker gets from
compromising one machine.

## What to build first

One sink, end to end, before any of the above is generalised.

Postgres, because `demo/golden_path_postgres.py` already stands up a real database
and already contains the exact defect the design removes.

Success criteria, all four:

1. The agent has no DSN and no password. Verify by inspecting its environment.
2. The effect fires only on a capability bound to the approved request digest.
3. The receipt records what the human was shown, per `COMPREHENSION-CHECK.md`.
4. **The negative control**: an agent with full shell inside that container attempts
   a direct connection and cannot make one. Observed failing, recorded verbatim.

Criterion 4 is the one that matters. Without it this is an architecture diagram.
