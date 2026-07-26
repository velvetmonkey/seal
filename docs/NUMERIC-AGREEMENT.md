# Numeric agreement: remediation spec for the V3.1 parser disagreement

Status: **PROPOSED**, awaiting ruling. Written 2026-07-26 after `v31run` measured
the first cross-parser disagreement on an approved request.

## 1. The defect, stated exactly

Vector `i_number_neg_int_huge_exp.json`, one wire line, one approval:

```
Lean CanonicalAction :  external.json_corpus([-10^9999])   exact, 10,000 digits
Node extraction      :  external.json_corpus([-Infinity])
```

The bytes are identical end to end. The corpus digest, the terminator-stripped
request digest and the LF-framed request digest all match, and the downstream
observer reported the same frame hash it was sent. Nothing was tampered with.

The kernel reads JSON numbers as **exact arithmetic**. Every mainstream JSON
reader parses them to **IEEE-754 doubles**. For literals outside double range the
two readings differ, and the approval is bound to the kernel's.

Independently reproduced, so this is not a Node quirk:

```
node   JSON.parse("[-1e9999]")  ->  -Infinity   (typeof number, isFinite false)
python json.loads("[-1e9999]")  ->  -inf
```

Any float-based reader does this. It is the specified behaviour of the format as
everyone implements it.

**What is established:** approval under the kernel's `CanonicalAction` does not by
itself establish that a downstream parser assigns the same argument semantics to
the approved bytes.

**What is NOT established:** an end-to-end unsafe act. In the measured run the
downstream application went on to reject the array-shaped arguments for unrelated
reasons. The disagreement is real; the exploit is not demonstrated. Do not let
anyone, including us, describe this as a proven bypass.

## 2. The existing gate measures a different quantity

`Seal/JsonUtil.lean` already scans the raw wire for numbers:

```lean
def maxExponentDigits : Nat := 6
def wireNumbersSafe (s : String) : Bool :=
  (s.toList.foldl numberScanStep {}).worst ≤ maxExponentDigits
```

It counts **exponent digits**, bounding how expensive a literal is to parse. That
is a denial-of-service guard and a good one. It is not an agreement guard, and
the distinction is the whole finding. Measured against the current bound:

| literal | exponent digits | passes gate | Node reads |
|---|---|---|---|
| `-1e9999` | 4 | yes | `-Infinity` |
| `1e999` | 3 | yes | `Infinity` |
| `1e310` | 3 | yes | `Infinity` |
| `99999999999999999999` | 0 | yes | silently loses precision |
| `1e308` | 3 | yes | `1e+308`, agrees |

Four of five pass a gate that exists to stop pathological numbers, and four of
five are read differently by the party that acts on them. `OPEN-FINDINGS.md`
already carries a row saying `wireNumbersSafe` measures the wrong thing. This
spec says precisely which thing it should have measured, and keeps the DoS guard.

## 3. Option A, canonical re-encoding: REJECT

The proposal: re-encode the approved `CanonicalAction` back to JSON and forward
those bytes rather than the agent's.

**It does not fix this defect.** `-10^9999` has no IEEE-754 representation. Any
JSON encoding of it, canonical or otherwise, is still read as `-Infinity` by a
float-based parser. Re-encoding addresses *representational* ambiguity (duplicate
keys, Unicode escape forms, `1.0` versus `1`) and is worth considering for those
on its own merits. It cannot address *range*.

It also costs something real. Today the approval binds to the exact wire bytes
and the receipt attests to bytes that were forwarded unchanged. Re-encoding
inserts a transformation between the approved artifact and the forwarded one,
which must then itself be proved semantics-preserving. That trades a measurable
gap for an unproven one.

## 4. Option B, agreement-safe numeric restriction: RECOMMENDED

Refuse, before signing, any request containing an unquoted numeric literal whose
exact value is not preserved by an IEEE-754 double round trip.

**Predicate.** A JSON number literal is *agreement-safe* iff
`decimal -> double -> decimal` is the identity on its exact mathematical value.
In practice:

- integers: `|n| <= 2^53 - 1`
- non-integers: the shortest round-trip decimal of the parsed double equals the
  literal's exact value

**Properties that make this the right shape for this project:**

- **Decidable on the raw wire, before any parse and before any signature.** Same
  place and same style as the existing scan, so no new trusted machinery.
- **Fails closed, and names the offending literal** in the refusal, in the manner
  of the boxpol size bound: hard error naming the cause, never silent coercion.
- **Non-growth.** It removes accepted inputs. It never adds an accepted input,
  which is the direction this project's constitutional posture allows.
- **It makes the claim true rather than louder.** After it, "an approved request
  means every conforming parser reads the same arguments" is a statement we can
  defend for numbers.

**What it costs.** Integers above 2^53 and reals outside double range become
refusals. That is a real narrowing. It is also, for MCP tool calls, close to
free: an argument that cannot survive JSON's own universal reading was never
going to be transmitted faithfully to a tool.

**Keep `wireNumbersSafe` unchanged** as the DoS bound. The two gates measure
different things and both are wanted. Adding the agreement gate does not license
relaxing the cost gate.

## 5. Option C, downstream attestation: REJECT for now

Bind approval to a semantic digest both sides compute, and require the downstream
to attest to its own reading. Correct in principle and unshippable in practice:
no MCP server offers such an attestation, and requiring one makes the system
unusable with the ecosystem it exists to mediate. Record it as the direction a
future protocol revision could take, not as this remediation.

## 6. Required evidence before this ships

Not "the code looks right". Each of these observed, verbatim:

1. **The measured vector now refuses.** `i_number_neg_int_huge_exp.json` produces
   a refusal naming the literal, before any approval is offered.
2. **A negative control.** `1e308`, which round-trips exactly, is still accepted
   and still forwarded, with the downstream observer reading the same value the
   kernel signed. A gate that refuses everything is not a fix.
3. **The boundary is tested on both sides.** `2^53 - 1` accepted, `2^53 + 1`
   refused, both observed.
4. **The disagreement experiment re-run.** `v31run` over the vectors that remain
   reachable, showing agreement or a new disagreement. The stop-at-first rule
   left **13 of 18 untested**; shipping a fix without running them substitutes a
   plausible story for a measurement.
5. **An ablation.** Remove the gate, watch the refusal disappear, restore it.

## 7. What this does not fix, stated plainly

- **The other 17 vectors are untested.** One disagreement was measured and the
  run halted by design. Surrogates and deep nesting are unexamined.
- **Four of five configured observers never ran.** Node only.
- **Non-numeric divergence classes are untouched.** Duplicate keys and
  Unicode-equivalent keys have their own gate and their own open questions;
  nothing here speaks to them.
- **The encoder twin passing 13/13 does not bear on any of this.** Writing
  agreement is not reading agreement, and conflating them is how this gap stayed
  open.
