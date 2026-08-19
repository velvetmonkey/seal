# Numeric agreement: remediation spec for the V3.1 parser disagreement

Status: **ACCEPTED**. Ben ruled Option B on 2026-07-26 19:46. Written earlier the
same day after `v31run` measured the first cross-parser disagreement on an
approved request.

Implementation note added on acceptance: the gate this replaces lives in the
KERNEL, not the host. `Seal/JsonUtil.wireNumbersSafe` is called from
`SealV2/ClassifyTransport.lean` at three sites, and the Rust host has no numeric
gate of its own. So Option B is a change to `mcp-seal-dev` followed by a repin of
`seal-host`, which puts it under the repin razor. It is a kernel change to a
signed shape and is off the clock.

## 1. The defect, stated exactly

Vector `i_number_neg_int_huge_exp.json`, one wire line, one approval:

```text
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

```text
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

## 4. Option B, agreement-safe numeric restriction: ACCEPTED, with a rule defect

The accepted principle was to refuse, before signing, any request containing an
unquoted numeric literal whose exact value is not preserved by an IEEE-754
double round trip. The kernel at `mcp-seal-dev` `b83fdff` does not implement that
single predicate for integer syntax.

**Implemented predicate.** For integer syntax, the kernel first normalizes the
literal by stripping leading zeroes and moving trailing zeroes into a decimal
exponent. It then accepts only when both of these conjuncts hold:

1. the absolute, trailing-zero-stripped coefficient is at most
   `9007199254740991`; and
2. the exponent-applied value is exactly representable in binary64.

The coefficient bound therefore runs *after* normalization. It is not a bound
on the magnitude of the integer denoted by the literal. For syntax carrying a
decimal point or exponent marker, the other branch accepts exactly when the
normalized mathematical value is the shortest decimal that round-trips through
binary64.

The measured consequences are:

| integer literal | normalized coefficient and exponent | verdict | reason |
|---|---|---|---|
| `100000000000000000` | `1 * 10^17` | ACCEPT | coefficient passes; value is exactly binary64 |
| `9007199254740992` | `9007199254740992 * 10^0` | REFUSE | coefficient fails, although the value is exactly binary64 |
| `9007199254740991` | `9007199254740991 * 10^0` | ACCEPT | both conjuncts pass |
| `90071992547409910` | `9007199254740991 * 10^1` | REFUSE | coefficient passes; exponent-applied value is not exactly binary64 |

**This is a rule, not a principle.** `100000000000000000` and
`9007199254740992` are both integer syntax, both above the safe-integer bound,
and Node and Python agree on the mathematical value of both. The kernel accepts
the first and refuses the second. The operative difference is that the first
literal has trailing zeroes for normalization to move into the exponent. That
is an artifact of normalization, not an agreement principle.

**How the green check preserved the defect.** The Monkey froze the six known
over-refusals as a constraint on the fix, including the requirement that
`9007199254740992` remain refused, while repairing the accepted integer literals
whose exponent-applied values disagreed. The repair therefore kept the
coefficient conjunct and added the exponent-applied exactness conjunct. That
correctly refuses `90071992547409910` while continuing to accept
`100000000000000000`; the 43-literal corpus went green with
`UNDER_REFUSALS=[]` and the six-item over-refusal set unchanged. The corpus went
green; the principle did not. The check measured preservation of the frozen
verdicts, not whether those verdicts came from one coherent principle.

**Open decision — Ben's call.** A principled alternative is to drop the
coefficient conjunct and accept integer syntax exactly when the exponent-applied
value is representable in binary64. That would accept `9007199254740992` and
shrink the measured over-refusal set. It would also change behaviour in a signed
shape. This document records the alternative and its cost; it does not choose
it.

**Properties that make this the right shape for this project:**

- **Decidable on the raw wire, before any parse and before any signature.** Same
  place and same style as the existing scan, so no new trusted machinery.
- **Fails closed, and names the offending literal** in the refusal, in the manner
  of the boxpol size bound: hard error naming the cause, never silent coercion.
- **Non-growth.** It removes accepted inputs. It never adds an accepted input,
  which is the direction this project's constitutional posture allows.
- **It refuses every measured Node/Python disagreement.** The 43-literal probe
  reports `UNDER_REFUSALS=[]`; that is the reproduced claim, rather than a
  universal claim about unmeasured readers or literals.

**What it costs, in both directions.** The same 43-literal probe reports exactly
six over-refusals: `9007199254740992`, `1e-400`,
`1.7976931348623158e308`, `0.1000000000000000055511151231257827`,
`1e-324`, and `0.10000000000000001`. Node and Python agree on each value,
but the kernel refuses it. The gate does not broadly refuse ordinary JSON
numbers: the same probe accepts `0.1` and `1.5e3`, with the readers agreeing.
The cost is therefore neither zero nor a blanket rejection of ordinary
numbers; it is the measured six-item over-refusal set.

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
3. **The named boundary observations are tested on both sides.** `2^53 - 1`
   accepted and `2^53 + 1` refused, both re-observed. These two verdicts remain
   true, but they do not characterize the implemented integer rule:
   `2^53` is refused while `10^17` in integer syntax is accepted, as Section 4
   records.
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
