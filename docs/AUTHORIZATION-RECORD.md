# The four-leg authorization record

Status: **SPECIFIED, NOT IMPLEMENTED**.

Ben ruled Option D on 2026-07-27 at 08:34: keep **JUDGED**,
**AUTHORIZED**, **DISPATCHED**, and **ACKNOWLEDGED** separate, and print
ACKNOWLEDGED as **UNKNOWN** until an executor supplies evidence. This supersedes
Option C, ruled at 08:01, and Option B, ruled on 2026-07-26.

## 1. The claim, before the shape

This object is an **AUTHORIZATION DECISION**. It is not an effect receipt.

A valid record may establish that a kernel judged bytes, a human authorized
bytes, and seal dispatched bytes. It does not thereby establish that an
executor accepted the frame, extracted any particular value, invoked a tool,
made a syscall, changed external state, or succeeded. ACKNOWLEDGED, when it
eventually exists, will establish only what an executor says it extracted. Even
then it will not prove an effect occurred.

Any API, CLI, report, or UI that labels this record `executed`, `effected`,
`succeeded`, or equivalent is non-conforming. Any effect claim requires a
different artifact with its own evidence boundary.

The separation is substantive:

- The kernel reads JSON numbers as exact arithmetic. `OPEN-FINDINGS.md` finding
  34 records `RUN v31run-2026-07-26`: the kernel signed
  `external.json_corpus([-10^9999])`, while Node extracted
  `external.json_corpus([-Infinity])` from the same frame.
- Lean cannot represent a lone UTF-16 surrogate as a `Char` or in a `String`.
  Findings 36 and 37 record replacement-character readings in Lean, retained
  surrogate code units in Node and Python, and an independently unverified
  five-observer acceptance matrix. This is a value-domain limit, not a parser
  bug that a better Lean parser can remove.
- `COMPREHENSION-CHECK.md` shows why the human-facing value is a separate fact.
  A JavaScript renderer may round an integer above `2^53`; the authorization
  leg must preserve what was actually shown rather than substitute the
  kernel's reading after the event.

No field named `value`, `action`, or `agreement` may stand above the four legs.
There is no privileged fused value.

## 2. Signed envelope and required shape

The record is a signed envelope:

```json
{
  "domain": "seal.authorization-record/v1",
  "payload_encoding": "seal.authorization-record-canonical-json/v1",
  "payload": {},
  "signer_key_id": "<key identifier>",
  "signature_algorithm": "<registered algorithm>",
  "signature": "<encoded signature>"
}
```

| field | what it asserts | who can verify it | what it does **not** assert |
|---|---|---|---|
| `domain` | the signature is for this record protocol and version | the signature verifier | any leg's truth |
| `payload_encoding` | the deterministic byte encoding covered by the signature | any conforming encoder/verifier | that a generic JSON re-encoding is equivalent |
| `payload` | the complete four-leg claim set | the outer-signature verifier plus each leg verifier | that assembling evidence made it true |
| `signer_key_id` | which configured record-assembly key is claimed | the configured trust store | a human or executor identity |
| `signature_algorithm` | the registered verification algorithm | a conforming cryptographic verifier | semantic correctness |
| `signature` | the assembly key signed `domain` and the canonical payload bytes | anyone with the trusted public key | validity of nested human, kernel, dispatch, or executor evidence |

Its payload has these required top-level fields:

```json
{
  "record_type": "seal.authorization-decision",
  "record_version": 1,
  "claim": "AUTHORIZATION_DECISION_NOT_EFFECT_RECEIPT",
  "judged": {},
  "authorized": {},
  "dispatched": {},
  "acknowledged": {},
  "completeness": {
    "all_legs_observed": false,
    "unknown_legs": ["ACKNOWLEDGED"]
  }
}
```

All fields shown in the payload, including `completeness`, are inside the
signature. The canonical encoding and signature domain are fixed by
`record_version`; they must not be inferred from a generic JSON serializer.
The canonical encoding named above is new machinery and must be specified with
test vectors before implementation.

The payload fields mean:

| field | assertion |
|---|---|
| `record_type` | this is a four-leg seal authorization-decision payload |
| `record_version` | the field set, validation rules, signature domain, and canonical encoding are version 1 |
| `claim` | consumers are explicitly forbidden to promote the object to an effect receipt |
| `judged`, `authorized`, `dispatched`, `acknowledged` | the four independent claims defined below |
| `completeness` | which leg observations are present; today it must name ACKNOWLEDGED as unknown and set `all_legs_observed` false |

None of the four leg objects is optional. An absent leg is a malformed record,
not an old spelling of UNKNOWN. Unknown fields are rejected unless a later
record version defines them, so a consumer cannot accidentally validate a
partial projection as the whole record.

### 2.1 The byte subject

Each of JUDGED, AUTHORIZED, and DISPATCHED carries its own required `subject`:

```json
{
  "sha256": "<64 lowercase hex>",
  "length": 123,
  "scope": "mcp-jsonrpc-request-frame-including-delimiter",
  "encoding": "bytes"
}
```

ACKNOWLEDGED carries the same shape as `expected_subject`; its
`observed_subject` is null while UNKNOWN.

`scope` removes an ambiguity already visible in finding 34, which distinguishes
the corpus vector, JSON-RPC payload, and LF-terminated frame hashes. A different
framing boundary is a different scope and therefore not silently comparable.
`length` prevents a truncation or extension from being described by a digest
alone. `encoding: "bytes"` forbids Unicode normalization, parse-and-print, or
any other semantic transformation before hashing.

The exact byte artifact must be available inline or by a content-addressed
sidecar whose digest and length equal every leg that claims those bytes. Sharing
one immutable byte artifact is permitted. Sharing one semantic value is not.

Equality of the three subject tuples is evidence of byte identity across the
named boundaries. It is not evidence of equal readings.

### 2.2 JUDGED

Required fields:

| field | what it asserts | who can verify it | what it does **not** assert |
|---|---|---|---|
| `status` | `JUDGED` means the named kernel produced a decision and projection; `REFUSED` means it refused before authorization | anyone replaying the exact bytes with the identified interpretation and policy | that any other parser agrees |
| `subject` | the exact framed bytes supplied to the judging boundary | anyone holding the byte artifact | what a human saw or an executor received |
| `interpretation` | the named, versioned reading rules used by the kernel | anyone resolving and hashing the immutable interpretation manifest | that these rules match JavaScript, Python, Rust, or an executor |
| `kernel_artifact_sha256` | the identity of the implementation that made this judgment | an auditor holding the kernel artifact and replay apparatus | that artifact identity alone specifies semantics |
| `policy` | the policy name, version, canonical digest, and entry point applied | an auditor holding the signed policy artifact | that the policy describes the human's intent |
| `consulted` | the statically computed policy dependency set and its digest | the policy compiler/checker and an independent recomputation | that an unlisted value was semantically parsed |
| `projection` | a list of separately tagged `DENOTED` or `BYTES_ONLY` field readings | replay under the interpretation manifest | a single denotation for the whole request |
| `decision` | the kernel's authorization-relevant result and reason under that policy | kernel replay | human authorization, dispatch, acknowledgment, or effect |
| `kernel_evidence` | the kernel signature or independently checkable proof binding the preceding fields | a verifier with the pinned key or proof checker | honesty of the host display or executor |

Every projection item has:

- a lossless locator: byte start, byte end, and structural path derived without
  normalizing the literal;
- `consulted: true` or `consulted: false`;
- `mode: "DENOTED"` with the interpretation's typed canonical value, or
  `mode: "BYTES_ONLY"` with the literal span digest and length;
- a reason code when `BYTES_ONLY`.

`BYTES_ONLY` is not a placeholder value. In particular, a lone surrogate must
not be printed as `U+FFFD` in that slot: doing so would turn inability to denote
the wire literal into a false denotation.

### 2.3 AUTHORIZED

Required fields:

| field | what it asserts | who can verify it | what it does **not** assert |
|---|---|---|---|
| `status` | a human authorization statement was accepted | a verifier of the human authorization signature and its validity rules | comprehension, wisdom, or intent match |
| `subject` | the exact bytes bound by that human statement | anyone with the bytes and signed authorization statement | that the human saw the kernel's reading |
| `shown` | the exact presentation delivered to the approval surface: bytes, length, digest, media type, character encoding, and renderer interpretation | a verifier holding the presentation artifact and renderer manifest | that the presentation equals JUDGED or ACKNOWLEDGED |
| `approver` | the principal/key identifier carried by the authorization statement | the configured trust root and signature verifier | real-world identity beyond that trust configuration |
| `authorized_at`, `session`, `nonce`, `expiry` | the authorization context and validity interval | the authorization verifier | dispatch within the interval unless DISPATCHED separately says so |
| `authorization_signature` | the human key signed the authorization domain, `subject`, the complete `shown` tuple, and the context fields | anyone with the trusted public key | that a click caused an effect |

`shown` belongs only to AUTHORIZED. It must record the actual output delivered,
not a later re-render and not JUDGED copied into the slot. If a JavaScript
approval surface displays `1234567890123456768` for wire bytes and a kernel
reading ending in `...789`, both facts remain visible and the record stays
valid. A consumer may report the disagreement; it may not repair either leg.

The authorization signature covers the shown artifact itself or its full
digest-and-length tuple. `ROADMAP-KERNEL-OUTWARD.md` records that the existing
signed message does not cover the rendering and that recording what was shown
is a signed-shape change. Therefore the conforming AUTHORIZED leg needs new
machinery even though an approval signature and target exist today. The new
machinery must additionally demonstrate that the target binds the exact
framed-byte `subject`; this spec does not infer that mapping from the target's
name.

### 2.4 DISPATCHED

Required fields:

| field | what it asserts | who can verify it | what it does **not** assert |
|---|---|---|---|
| `status` | `DISPATCHED` means seal emitted a frame at its named outbound boundary; `NOT_DISPATCHED` names why it did not | the seal boundary verifier and audit-signature verifier | downstream receipt, parsing, tool invocation, or effect |
| `subject` | the exact emitted frame bytes when status is `DISPATCHED` | anyone with the outbound byte artifact and boundary evidence | equality with another leg unless tuples are compared explicitly |
| `boundary` | the adapter, destination identity, transport, and observation point | an operator checking the configured route and boundary evidence | executor identity unless independently authenticated |
| `dispatched_at` | the boundary's recorded emission time | the boundary verifier | arrival time |
| `dispatch_evidence` | a seal signature or observer record binding status, subject, boundary, and time | anyone with the pinned verifier key and observer artifact | ACKNOWLEDGED or an effect |

The work order reports that the `1e308` control already demonstrated a
downstream observer reading exactly the bytes the kernel signed, with
`request_sha256` binding them. The present repository documents `1e308` as an
agreement-safe negative control in `NUMERIC-AGREEMENT.md`, but the complete
boundary artifact for that reported run was not found here; that narrower
claim remains listed as UNVERIFIED below.

### 2.5 ACKNOWLEDGED

Today the object is exactly:

```json
{
  "status": "UNKNOWN",
  "sound": false,
  "expected_subject": {
    "sha256": "<the DISPATCHED subject digest>",
    "length": 123,
    "scope": "mcp-jsonrpc-request-frame-including-delimiter",
    "encoding": "bytes"
  },
  "observed_subject": null,
  "executor": null,
  "interpretation": null,
  "extracted": null,
  "attestation": null,
  "reason": "EXECUTOR_ATTESTATION_UNAVAILABLE"
}
```

These values are inside the signed payload. `UNKNOWN`, `sound: false`, the five
null observation fields, and the reason are all mandatory. This follows the
reachability-report v0 discipline described in the work order: put both the
negative soundness flag and null coverage inside the signature rather than
letting a presenter invent completeness.

`expected_subject` says which dispatch an acknowledgment would have to answer.
It does not say the executor observed it. `observed_subject: null` makes the
missing observation machine-visible. `sound: false` applies to any
end-to-end-reading-agreement claim; it does not invalidate the narrower
authorization decision.

A consumer must:

1. reject a payload in which ACKNOWLEDGED is absent;
2. render the literal uppercase word **UNKNOWN** whenever `status` is
   `UNKNOWN`;
3. reject `UNKNOWN` if any observation field is non-null;
4. reject `OBSERVED` if any required observation field is null;
5. refuse to compute or display end-to-end agreement while `sound` is false;
6. preserve ACKNOWLEDGED and `completeness` in every export and projection
   advertised as an authorization record.

A future observed acknowledgment replaces the nulls with the executor's
authenticated identity, its named and versioned interpretation, its observed
frame subject, its typed extracted projection, and an attestation covering all
of them. It may set `sound: true` only for the narrowly defined statement that
the attested extraction is present and comparable. It still does not prove an
effect.

## 3. Interpretation identity

The initial profile name is:

```
seal.kernel-json/1
```

Every JUDGED leg carries:

```json
{
  "profile": "seal.kernel-json/1",
  "manifest_sha256": "<64 lowercase hex>",
  "manifest_media_type": "application/vnd.seal.interpretation+json"
}
```

The profile is a semantic name and major version, not a Git branch, package
version, or implementation hash. The immutable manifest defines at least:

- accepted wire grammar and framing;
- object-member and duplicate-key rules;
- the numeric value domain and canonical form;
- string escape, Unicode scalar, malformed escape, and lone-surrogate rules;
- depth, size, and parse-cost limits;
- tool/method extraction and the canonical action projection;
- refusal reasons;
- lossless field-locator construction;
- policy-path matching and the `Consulted(policy)` algorithm;
- the canonical encoding of every `DENOTED` projection value.

`manifest_sha256` pins the exact manifest. `kernel_artifact_sha256` separately
identifies the implementation used. A semantic change requires a new profile
version and manifest digest; rebuilding the same semantics requires only a new
artifact digest. A stranger can therefore distinguish the reading without
asking seal which commit happened to be deployed.

The profile must describe exact-arithmetic number readings and must admit
`BYTES_ONLY` for wire literals outside the kernel's value domain. It must not
define replacement of a lone surrogate with `U+FFFD` as faithful denotation of
the wire literal.

The manifest and its registry do not exist in this repository today. The name
above is normative for the new machinery, not a claim that a published
manifest already exists.

## 4. Narrowed guard scope

Option D removes the global cross-reader-agreement requirement. The guard
protects policy judgment, not universal parser agreement.

Define `Consulted(P)` from the exact signed policy version `P` before evaluating
the request:

1. Normalize the policy to its signed abstract syntax.
2. Collect every request-field path whose **value** is an operand, directly or
   through a derived expression, of any predicate that can contribute to the
   selected authorization entry point.
3. Take the collection over all syntactic branches, including branches that
   runtime short-circuiting would skip. Request data must not be able to make an
   otherwise consulted path become unconsulted.
4. A comparison, ordering, membership test, pattern/regex operation,
   arithmetic operation, value-derived hash, canonicalization, or whole-value
   equality consults the value. Consulting a container as a whole consults
   every descendant needed to denote that container.
5. A pure presence test consults presence, not the contained literal. A pure
   wire-type test consults the syntactic type, not the literal's denotation.
   If an operator mixes these with a value operation, the value rule wins.
6. Wildcards, aliases, or derived fields expand conservatively. If the checker
   cannot prove a literal is outside `Consulted(P)`, it is consulted.
7. Record the expanded paths and a digest of the complete dependency set in
   JUDGED.

The raw structural scanner locates literal spans and paths without first
coercing their contents into the kernel value type. For each literal `L`:

- If `L` is faithfully denotable under the named interpretation, the kernel may
  denote it.
- If `L` is not faithfully denotable and its path is in `Consulted(P)`, refuse
  before judgment, authorization, approval consumption, or dispatch. Name the
  path, byte span, interpretation, and reason.
- If `L` is not faithfully denotable and its path is outside `Consulted(P)`,
  bind its exact span bytes and enclosing request bytes, emit a `BYTES_ONLY`
  projection item, and do not construct a semantic value for `L`.
- If the scanner cannot map a span to a policy path losslessly—for example
  because a key or structure needed for path resolution is itself
  undenotable—refuse. Ambiguity is not evidence of non-consultation.

The same rule applies recursively. An undenotable descendant makes an
otherwise-consulted whole container undenotable. The policy dependency set is
static for a signed policy version, while the resulting span matches are
request-specific and recorded.

The existing parse-cost guard remains a separate resource-control question.
The narrowed rule does not license pathological inputs, relax duplicate-key
controls, or turn a cost refusal into a semantic reading.

## 5. Production cost and availability

No conforming `seal.authorization-decision` v1 record exists today. The
available pieces and their costs are:

| leg | evidence available today | production cost | missing machinery |
|---|---|---|---|
| JUDGED | findings 24, 34, 36, and 37 show the kernel judgment and replay apparatus for measured vectors | kernel parse/classification, policy evaluation, projection serialization, and kernel evidence | interpretation manifest/registry, lossless partial projection, static consulted-set evidence, and the new record encoder |
| AUTHORIZED | the current signed message binds a target and authorization context; the current interactive path shows the full target digest | one human ceremony plus signature verification and retention | capture the actual shown artifact, make the human signature cover it and the exact framed-byte subject, version the renderer, and change the signed shape |
| DISPATCHED | finding 24 says raw-byte `request_sha256` survives; the work order reports the `1e308` downstream-boundary control | hash/length at the outbound boundary plus a signed boundary observation and byte-artifact retention | encode the boundary tuple in this record and independently reproduce the reported control artifact |
| ACKNOWLEDGED | no executor extraction attestation is available; only the honest UNKNOWN object can be produced | today: negligible cost to sign UNKNOWN; future: executor parse hook, identity, projection, signature, transport, retention, and verification | cooperation and protocol changes in every executor whose reading is claimed |

The outer record signature and content-addressed byte/display retention are
additional costs shared by all legs. They do not manufacture evidence a leg
does not have.

## 6. Rejected alternatives and decision history

### Option A — canonical re-encoding: rejected

Re-encoding cannot make `-10^9999` representable in binary64 and cannot make a
lone surrogate representable in Lean `String`. It also changes the bytes
between authorization and dispatch, replacing an observed byte-identity claim
with a new semantics-preservation obligation. `NUMERIC-AGREEMENT.md` section 3
records the numeric part of this rejection.

### Option B — agreement-safe restriction: ruled, then superseded

Ben accepted Option B on 2026-07-26. It globally refused numbers that did not
survive a binary64 round trip. The repository records both the repaired
predicate and its incoherent over-refusal boundary: for example,
`100000000000000000` is accepted while exactly representable `2^53` is refused
because the implementation retained a normalized-coefficient conjunct.

B was useful as a fail-closed response to the first measured numeric
disagreement, but it chooses one downstream numeric family as the admission
standard, hides legitimate differences instead of recording them, and does
nothing for the surrogate class that the kernel cannot denote at all. D
therefore supersedes B as the semantic rule. Resource-cost limits remain
independent.

### Option C — downstream attestation: rejected, ruled, then reopened

`NUMERIC-AGREEMENT.md` section 5 originally rejected C “for now”: it is correct
in principle, but no MCP server supplies an attestation and requiring one would
make seal unusable with the ecosystem it mediates.

After the surrogate finding established that kernel parser work cannot recover
an executor-only value, C was reconsidered. Ben ruled C at 08:01 on 2026-07-27:
only an executor can authoritatively state what that executor extracted.

C was reopened because making that unavailable statement a prerequisite for
the record either prevents seal from issuing an authorization decision or
quietly turns the object into an effect-side receipt. Both violate the object
boundary. Ben replaced it with D at 08:34: preserve the acknowledgment leg,
print it UNKNOWN, and do not weaken the other three facts or pretend the fourth
exists.

### Option D — four separate facts: selected

D represents the observed disagreement rather than prohibiting it or fusing
it. It keeps authorization useful without executor cooperation, keeps the
missing cooperation visible inside the signature, and leaves a precise slot
for later executor evidence.

## 7. Evidence bar

No leg may be advertised as working from a green unit test or schema-valid
record alone. Before a claim ships, observe all applicable items below and
retain exact commands, artifacts, hashes, counts, and exit statuses under a
named RUN.

### JUDGED

1. Replay the exact frame with the pinned kernel, interpretation manifest, and
   policy; reproduce the recorded decision, consulted set, and every projection
   item.
2. Observe the huge-number and surrogate vectors. The former must preserve the
   exact kernel arithmetic reading; an unconsulted lone surrogate must be
   `BYTES_ONLY`, never replacement-character agreement.
3. Negative control: change one request byte or one manifest byte and observe
   digest/evidence verification fail.
4. Guard ablation: remove consulted-field refusal and observe a consulted
   undenotable literal reach judgment; restore it and observe refusal before
   authorization or dispatch.

### AUTHORIZED

1. Capture the actual display bytes at the approval surface and verify their
   digest and length against `shown`.
2. Verify the human signature over both the exact request subject and complete
   shown tuple.
3. Exercise a rounded-above-`2^53` display so JUDGED and SHOWN visibly differ
   without either being overwritten.
4. Negative control: mutate one request byte and, separately, one shown byte;
   each mutation must invalidate authorization.

### DISPATCHED

1. Observe at the named outbound boundary the full frame bytes, length, scope,
   and digest matching DISPATCHED.
2. Re-run the reported `1e308` control and retain the kernel, dispatch, and
   downstream-boundary artifacts in one named RUN.
3. Negative control: mutate or truncate a frame after the dispatch claim is
   formed and observe boundary verification fail. A dispatcher that emits
   nothing must not satisfy the control.

### ACKNOWLEDGED

1. Until cooperation exists, verify that every output format prints
   ACKNOWLEDGED as UNKNOWN and that deleting the leg makes validation fail.
2. To claim `OBSERVED`, capture an executor-authenticated statement binding the
   received frame digest, executor interpretation, and exact extracted
   projection.
3. Run both huge-number and lone-surrogate disagreement vectors. The record
   must preserve disagreement or rejection; no normalizer may round either to
   JUDGED agreement.
4. Negative control: alter the received digest, extracted projection, or
   executor identity and observe attestation verification fail.

### Whole record

1. Verify the outer signature and every leg-specific evidence object.
2. Remove each leg in turn and observe strict validation fail.
3. Attempt to export UNKNOWN without `sound: false` and the null fields; observe
   validation fail.
4. Search every user-facing label for effect claims. The strongest permitted
   top-level label is **authorization decision**.

## 8. Disagreements

None with the four-leg ruling.

There is one terminology constraint worth making explicit: ACKNOWLEDGED is a
required **slot** in the authorization record, but it is not a prerequisite for
the authorization decision to be valid. Treating all four legs as jointly
required evidence for authorization would recreate Option C and turn the
record into the effect receipt this ruling forbids.

## 9. Unverified inputs and limits

The following were not independently checkable from this repository at the
starting commit and must not be promoted to observed facts by this spec:

- The 2026-07-27 08:01 Option C and 08:34 Option D rulings and their exact
  timestamps were supplied in the work order; the repository still recorded
  Option B accepted and Option C rejected for now.
- The complete five-observer surrogate matrix is already marked
  **UNVERIFIED INDEPENDENTLY** in `OPEN-FINDINGS.md` finding 36. Only the
  independently reproduced Lean/Node/Python shape is treated as verified here.
- The reported `1e308` downstream observer run with `request_sha256` byte
  binding was supplied in the work order. `NUMERIC-AGREEMENT.md` names `1e308`
  as the required agreement-safe control, but its complete run artifact is not
  present in this repository.
- The reachability-report v0 example with signed `sound: false` and
  `coverage_percent: null` was supplied in the work order; no such v0 artifact
  was found in this repository. This spec adopts its stated discipline, not an
  independently inspected implementation.
- No executor acknowledgment protocol, interpretation manifest registry, or
  conforming v1 record implementation was found here. Their shapes above are
  requirements, not current-behavior claims.

## 10. Specification evidence

This specification was derived from `OPEN-FINDINGS.md` findings 24 and 34–37,
`NUMERIC-AGREEMENT.md` sections 3–7, `COMPREHENSION-CHECK.md`, and
`ROADMAP-KERNEL-OUTWARD.md`. Claims that exceed those on-disk sources are
explicitly listed as unverified above.

Evidence: RUN fourlegs-spec-2026-07-27
