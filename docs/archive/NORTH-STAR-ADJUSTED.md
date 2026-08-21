# North Star, adjusted 2026-07-25

Supersedes the priorities in `seal-north-star-v2-g9.md`. That document's content
stands; what changed is the ORDER and the top of the list.

## What changed, in one line

The product's hardest problem stopped being "are the proofs right" and became
**"does the human understand what they are approving"**, and the engineering
diagnosis stopped being theorem production and became **correspondence
management**.

## The reframe (external review, 2026-07-24)

> "That is not failure. It tells you precisely what the product now is: a
> correspondence-management problem, not a theorem-production problem."

This weekend produced the evidence. Seven test binaries red for two reasons,
neither of them a broken proof: shipped configs that pre-dated a kernel rule, a
shared object that could not be relinked for four days, a byte-twin comparing
two frozen artifacts to each other, a pin ledger stale on day one, and a wasm
lane behind the guards.

Every one is a correspondence between two things that were supposed to agree,
with nothing enforcing it. **The kernel was never the problem.**

## PRIORITY 0 — the comprehension check

Ruled 2026-07-25. A core kernel product pivot, not a UI change.
Design in `COMPREHENSION-CHECK.md`.

The approval prompt shows a 64-hex digest and nothing else. The agent controls
the chat window. So it narrates a benign story, the human clicks `y`, and seal
binds a perfect approval to hostile bytes. Four council seats reached this
independently.

**The cryptography is not the weak link. The comprehension of the person
clicking approve is, and it currently sits outside the formal boundary.**

Two rulings attached:

1. **The rendering must be derived from the same canonical parse the digest
   covers**, with agreement as a THEOREM: if two requests render identically
   they must digest identically. Different effects can never look the same.
2. **The receipt must record what the human was SHOWN**, not merely what they
   approved. This is the pivot. It turns the receipt from "an approval happened"
   into "this specific consent was obtained", makes a disputed approval
   forensically answerable, and makes the rendering load-bearing evidence rather
   than styling.

Known residuals, from seats asked to break their own designs: homoglyphs
survive; the unverified host still does the PRINTING so kernel computation is
necessary but not sufficient; truncation reintroduces collisions; click fatigue
is the honest ceiling.

## The transport question, settled

The council's position was that the MCP wire is the wrong interception point.
**Ben's ruling, and it is the better argument: the transport is not the thesis.**
Policy evaluation, approval binding and receipt generation are transport-agnostic.
MCP is where agents make tool calls today; the adapter is re-pointable.

Kimi's own TCP-wrappers analogy undercuts it: TCP wrappers died because the
MECHANISM could not survive encryption. Seal's mechanism is a verified decision
function over a canonical request plus signed evidence, and that survives a
transport change.

**What survives from the criticism, and must be said plainly in the claims:**
the gate covers ONE path to effect. The agent's shell, network and in-process
orchestrator calls are outside it. Qwen called that exclusion "the primary
mechanism of blindness". That is a scope limitation to state, not a transport
argument to win.

## Revised SHORT list

The g9 SHORT list is not wrong, it was ordered before we knew the instruments
were unreliable. Revised:

1. **Make the signal trustworthy.** A `release-evidence` CI job that fails
   unless every security job returned success; external oracles in required CI;
   every written control actually wired to a target. Until this lands, every
   green below is unfalsifiable. See `OPEN-docs/archive/findings.md` tier 1.
2. **The comprehension check**, kernel-side, with the rendering in the receipt.
3. **Close the red suite** to zero, for understood reasons, with negative
   controls rather than relaxed assertions.
4. **Harvest the branches that already carry the gates** (`feat/field-warrant`)
   and the v2 encoder (`feat/envelope-stageB-twin`).
5. **Monorepo into this repository**, from a green base, per `REPO-TOPOLOGY.md`.
6. Then the bundle, the verifier and the honest-claims work from g9.

## Demoted, deliberately

- **More grind rounds on the specification.** g9 is ten rounds deep and
  excellent. The gap is not specification quality, it is that almost none of it
  is built. Another round buys nothing.
- **New machinery of any kind** until tier 1 lands. We have repeatedly built
  controls faster than we have verified that they can fail.

## The standing lesson

Written here because it generated most of this weekend's defects:

**A control that is documented but not executable degrades to decoration.** An
`#[ignore]`d test, a caveat in a docstring, a discipline in a method file, a
finding recorded in a ledger and not closed. None of them run. They all feel
like management because writing them down feels like doing something about it.
