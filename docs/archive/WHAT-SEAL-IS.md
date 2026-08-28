> Scope: This document argues a Seal family product position accepted on 2026-07-25; it does not describe the Node CLI shipped by this repository.
> The state machine is TESTED.
> For the truth about what you installed, read [docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md](../assurance/RELEASE-NOTES-v0.2.0-rc.3.md) and the [README](../../README.md).

# What seal is: an object-capability broker

Accepted by Ben 2026-07-25, in reply to the `premise` council of 2026-07-24.

The council's most consistent criticism, from all four seats, was that the MCP
wire is the wrong interception point. That criticism rests on reading seal as a
JSON-RPC proxy. It is not one. **Seal is an object-capability broker, and the
wire is where it currently observes requests, not where its authority lives.**

Stating this precisely changes the answer to three of the four seats, and
sharpens the fourth into something worse than they said.

## Seal already is an ocap system in the load-bearing respects

A capability is an unforgeable reference that both DESIGNATES a resource and
AUTHORISES its use, with no ambient authority in the background.

The signed approval token is exactly that:

| ocap property | seal's mechanism |
|---|---|
| unforgeable | Ed25519 over the exact signed-message bytes |
| designates | bound to the request digest, not to a name or a role |
| authorises | that one call, not a class of calls |
| single-use | nonce consumed in a durable replay store |
| non-transferable | `approval_not_transferable_across_targets` |
| exercise is auditable | the decision receipt |

The policy decides what capabilities may be minted. The kernel decides whether a
presented capability authorises the request in hand. That is a broker.

## The reply to each seat

**GLM, "attach it to the capability dispatcher, not a JSON-RPC proxy."**
This describes the product rather than criticising it. Seal mints, checks and
records capabilities. The proxy is the observation point. GLM mistook the window
for the building.

**Kimi, "approximately where TCP wrappers were in 1995."**
The analogy inverts on mechanism. TCP wrappers checked WHO was connecting
against ambient network authority; they died because encryption removed the
observation point AND because the ambient authority underneath never went away.
A capability travels WITH the request, presented rather than inferred, so it
does not care what transport carried it. That is precisely why re-pointing the
adapter is cheap for seal and was impossible for them. Seal is not a 1995 host
ACL; it is the thing that makes host ACLs unnecessary.

**DeepSeek, "a component inside a capability-token future."**
Agreed, and closer than it knew. Its other observation, that the receipt chain
is "similar in spirit" to Certificate Transparency, is the right analogy for the
right reason: CT is the public record of certificate ISSUANCE, and the seal
receipt is the record of capability EXERCISE.

**Qwen, the excluded shell / network / in-process paths are "the primary
mechanism of blindness."**
This one SURVIVES the reframe and gets sharper, so it is conceded loudly rather
than deflected. In ocap terms the property is "no authority without a
capability". An agent holding shell, network or in-process orchestrator access
holds ambient authority seal never brokered. That is not a gap in a gate. It is
a violation of the premise the whole model rests on.

So the honest claim is not "we mediate tool calls". It is:

> **We broker the capabilities we broker. Everything else in the process is
> ambient authority we do not see.**

More falsifiable, more embarrassing, and correct. It belongs in `CLAIMS.md` in
those terms.

## Why this raises the stakes on the comprehension check

Under ocap, **the human clicking approve IS the root capability grant.** Every
derived authority inherits from it.

A root grant made under misapprehension produces a chain that is formally valid
and substantively forged: every signature verifies, every theorem holds, and the
authority was never actually granted by an informed principal.

That is not a UI problem. It is the root of trust being a person who was shown a
64-character hex digest. See `COMPREHENSION-CHECK.md`; this is why it is a
kernel pivot rather than a display change.

## What the reframe does NOT rescue

Recorded so this does not become a way of dismissing the council wholesale:

- **Homoglyphs.** All three design seats independently said they survive.
- **Click fatigue.** No deterministic rendering fixes a human trained to press y.
- **The unverified printer.** The kernel can compute the rendering; unverified
  Rust still displays it, so the trusted base for consent includes the printer.
- **Never run against real traffic.** Still true.

## The consequence for positioning

If seal is a capability broker, the transport question is a deployment detail
and the product question is: **which authority paths does the broker cover, and
which stay ambient?** That is the axis worth arguing about, and the one the
claims should be honest on.
