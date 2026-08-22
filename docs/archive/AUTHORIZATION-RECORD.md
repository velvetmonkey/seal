# The four-leg authorization record

Status: **SPECIFIED, NOT IMPLEMENTED**.

Ben ruled Option D on 2026-07-27 at 08:34: keep **JUDGED**,
**AUTHORIZED**, **DISPATCHED**, and **ACKNOWLEDGED** separate, and print
ACKNOWLEDGED as **UNKNOWN** until an executor supplies evidence. This superseded
Option C, ruled at 08:01, and Option B, ruled on 2026-07-26.

Ben revised D on 2026-07-27 at 11:11: leg three is **DISPATCH ATTEMPTED**,
not DISPATCHED. The record is persisted before `write_child` runs. The ordering
is deliberate. This revision narrows the claim instead of moving the emit.

This document specifies the unsigned, buildable v3 profile. Authenticated record
assembly, a richer kernel interpretation claim, completed dispatch, and
executor acknowledgment are explicit future upgrades, not facts smuggled into
v3.

## 1. The claim, before the shape

This object is an **AUTHORIZATION DECISION**. It is not an effect receipt.

A valid v3 record can establish, at most and subject to its evidence:

- what decision the host recorded from its kernel-facing audit;
- whether exact request and display bytes were covered by an upgraded human
  approval, were not required by explicit policy, were not reached, or remain
  unproven because only a legacy approval was retained;
- that seal reached its final pre-write boundary with named bytes and committed
  to call `write_child` next; and
- that executor acknowledgment is unavailable, unless a later protocol supplies
  authenticated executor evidence.

It does **not** establish that `write_child` was entered, that any byte was
emitted or received, that an executor parsed a frame, that a tool was invoked,
that a syscall occurred, that external state changed, or that anything
succeeded. A standalone v3 object also does not establish who assembled it,
because v3 is unsigned.

Any API, CLI, report, or UI that labels this record `dispatched`, `executed`,
`effected`, `succeeded`, or equivalent is non-conforming. Any completed-dispatch
or effect claim requires a separate, authenticated artifact with its own
evidence boundary.

The separation is substantive:

- `docs/archive/OPEN-FINDINGS.md` finding 34 records `RUN v31run-2026-07-26`: the kernel
  signed `external.json_corpus([-10^9999])`, while Node extracted
  `external.json_corpus([-Infinity])` from the same frame.
- Findings 36 and 37 record that Lean cannot represent a lone UTF-16 surrogate
  as a `Char` or in a `String`. The complete five-observer matrix remains
  **UNVERIFIED INDEPENDENTLY** there.
- Finding 40 records why the human-facing presentation is separate. A
  JavaScript renderer can show a different integer from the wire bytes.

No field named `value`, `action`, or `agreement` may stand above the four legs.
There is no privileged fused value.

## 2. v3 envelope, discriminator, and required shape

The v3 record is this strict unsigned envelope:

```json
{
  "domain": "seal.authorization-record/v3",
  "payload_encoding": "seal.authorization-record-canonical-json/v1",
  "integrity": "UNSIGNED",
  "payload_sha256": "<64 lowercase hex>",
  "payload": {}
}
```

The envelope and every nested object reject duplicate and unknown fields. An
absent required field is malformed. In v3, fields named `signer_key_id`,
`signature_algorithm`, or `signature` are also unknown and must be rejected;
their presence must not make an unsigned record look authenticated.

`payload_sha256` is a deterministic checksum, not a signature. It is
`SHA-256(ASCII("seal.authorization-record/v3") || 0x00 ||
canonical_payload_bytes)`. Without a separately trusted copy of that digest, an
attacker can change the payload and recompute it.

The payload has these required top-level fields:

```json
{
  "record_type": "seal.authorization-decision",
  "record_version": 3,
  "claim": "AUTHORIZATION_DECISION_NOT_EFFECT_RECEIPT",
  "judged": {},
  "authorized": {},
  "dispatch_attempted": {},
  "acknowledged": {},
  "completeness": {
    "all_legs_observed": false,
    "unknown_legs": ["ACKNOWLEDGED"]
  }
}
```

`record_version: 3` is intentionally non-colliding. The repository documents
legacy authorization-decision v1 and a current v2 decision receipt. A consumer
first requires the exact pair
`("record_type", "seal.authorization-decision")` and
`("record_version", 3)`, then validates the complete v3 shape. A legacy
`seal_receipt` discriminator, version 1, version 2, a missing version, or a
mixed-version field set is not v3 and must be sent to a separately selected
legacy validator, never guessed into v3.

None of the four leg objects is optional. `completeness.all_legs_observed` is
always `false` in v3: a NOT_REQUIRED or NOT_REACHED slot is accounted for but
not observed, ATTEMPTED is not completed dispatch, and an attempted path has
ACKNOWLEDGED UNKNOWN. `unknown_legs` is derived from leg statuses and contains
uppercase leg names in leg order; for the cases in this version it is either
`[]`, `["AUTHORIZED"]`, `["ACKNOWLEDGED"]`, or
`["AUTHORIZED","ACKNOWLEDGED"]`.

### 2.1 Canonical payload encoding

`seal.authorization-record-canonical-json/v1` is defined here rather than
delegated to a generic serializer:

1. The input is the parsed v3 `payload` object, after strict duplicate-field,
   unknown-field, type, enum, and range validation. The envelope is not part of
   these bytes.
2. Output is UTF-8, with no BOM, whitespace, or trailing newline.
3. The only values are objects, arrays, Unicode-scalar strings, unsigned
   integers, booleans, and null. JSON fractions, exponents, negative integers,
   integers above `9007199254740991`, unpaired surrogates, and non-scalar strings
   are rejected. Semantic numeric projections, if a future version adds them,
   must be tagged strings rather than JSON numbers outside this range.
4. Object member names are unique and sorted by the lexicographic order of
   their UTF-8 byte sequences. Arrays retain input order.
5. Strings use `\"` for quotation mark, `\\` for reverse solidus, and a
   lowercase four-hex-digit `\u00xx` escape for every U+0000 through U+001F.
   Every other Unicode scalar is emitted as its shortest UTF-8 sequence.
   Solidus is not escaped. No Unicode normalization is performed.
6. Integers use base-ten ASCII with no sign and no leading zero except the
   value zero itself. Booleans and null are the lowercase JSON tokens.

Normative positive vectors:

| input value | canonical UTF-8 text | canonical hex | domain-separated SHA-256 |
|---|---|---|---|
| `{}` | `{}` | `7b7d` | `062e3561c19c0bb9b03c84f35cab515f05dc0b5d165d7d87a9b151e0460c73f1` |
| `{"z":0,"a":"x\n","list":[true,null],"é":"£"}` | `{"a":"x\u000a","list":[true,null],"z":0,"é":"£"}` | `7b2261223a22785c7530303061222c226c697374223a5b747275652c6e756c6c5d2c227a223a302c22c3a9223a22c2a3227d` | `035e1581bded3df835a38acf572a76dbbe33e44967f9fef805371a3ebe3a6803` |
| the three-field object `claim`, `record_type`, `record_version` in any input order | `{"claim":"AUTHORIZATION_DECISION_NOT_EFFECT_RECEIPT","record_type":"seal.authorization-decision","record_version":3}` | `7b22636c61696d223a22415554484f52495a4154494f4e5f4445434953494f4e5f4e4f545f4546464543545f52454345495054222c227265636f72645f74797065223a227365616c2e617574686f72697a6174696f6e2d6465636973696f6e222c227265636f72645f76657273696f6e223a337d` | `5c8080c490b502162902667634c28346fe6acff76ae982231b1067a14ea53214` |

For the first vector, the complete hash preimage in hex is
`7365616c2e617574686f72697a6174696f6e2d7265636f72642f7633007b7d`.
This pins the domain separator and rules out hashing the displayed envelope.

Normative rejection vectors are duplicate `{"a":1,"a":2}`, `-1`, `1.0`,
`1e0`, `9007199254740992`, a string containing an unpaired U+D800, invalid
UTF-8, and any object with an unknown v3 field. A conforming implementation must
reject each before hashing.

### 2.2 Byte subject

Every leg carries either this `subject` or an explicitly null subject:

```json
{
  "sha256": "<64 lowercase hex>",
  "length": 123,
  "scope": "mcp-jsonrpc-request-frame-including-delimiter",
  "encoding": "bytes"
}
```

`length` is an unsigned integer in the canonical range. `encoding: "bytes"`
forbids normalization or parse-and-print before hashing. A different framing
boundary is a different scope. Equality of subject tuples is evidence only of
byte identity at the named boundaries, not equal readings.

The exact byte artifact must be retained inline outside this record or in a
content-addressed sidecar. v3 does not claim that the unauthenticated envelope
proves sidecar availability.

### 2.3 JUDGED: reduced to current audit evidence

v3 deliberately does **not** require the unproducible interpretation manifest,
consulted set, typed projection, policy identity, or kernel signature from the
previous draft. Those are deferred to a future authenticated profile because
the implementation report found no such fields in the current audit.

The required shape is:

```json
{
  "status": "RECORDED_ALLOW",
  "subject": {},
  "evidence_kind": "seal.host-audit/v1",
  "audit_sha256": "<digest of retained audit bytes>",
  "audit": {
    "verdict": "allow",
    "tool": "<retained audit tool>",
    "epoch": 1,
    "request_sha256": "<retained audit request digest>",
    "certs": [
      {
        "kernel": "<kernel name>",
        "verdict": "allow",
        "reason": "<reason>",
        "certHash": "<certificate hash as emitted by the audit>"
      }
    ]
  }
}
```

`status` is exactly `RECORDED_ALLOW` or `RECORDED_BLOCK`. The record validator
requires `audit.request_sha256 == subject.sha256`, maps only audit verdict
`allow` to `RECORDED_ALLOW`, and maps only audit verdict `deny` to
`RECORDED_BLOCK`; any other verdict is not representable in v3. `tool` and every
certificate string are retained verbatim as Unicode-scalar strings, `epoch` is
an unsigned integer in the canonical range, and `certs` preserves audit order.
Every certificate has exactly the four fields shown. `audit_sha256` covers the
exact retained audit bytes before parsing; it is not the v3 canonical
re-encoding of the nested object unless the audit protocol itself says so.

This leg asserts only that the v3 assembler retained a host audit with that
decision and byte digest. Because the envelope is unsigned, it does not
authenticate the assembler or upgrade the audit into a kernel attestation. It
does not assert a particular interpretation, policy dependency set, semantic
projection, human authorization, dispatch, acknowledgment, or effect. The
English leg name JUDGED is historical; the status prefix `RECORDED_` is
mandatory and must not be shortened in presentation.

### 2.4 AUTHORIZED and `ApprovalRecord` v2

AUTHORIZED has four statuses:

- `AUTHORIZED`: a retained ApprovalRecord v2 token signature covers the exact
  request subject, exact presentation, and approval context;
- `EVIDENCE_UNAVAILABLE`: the host accepted a legacy approval, but the retained
  data cannot prove exact-byte or shown-byte authorization;
- `NOT_REQUIRED`: explicit policy allowed the request without human approval;
  and
- `NOT_REACHED`: JUDGED recorded BLOCK, so approval was not consumed.

For `AUTHORIZED`, the required fields are `subject`, `shown`, `approver`,
`authorized_at`, `session`, `nonce`, `expiry`,
`authorization_signature_algorithm`, `authorization_signer_key_id`,
`authorization_domain`, and `authorization_token`. `reason` is null. Times are
unsigned Unix milliseconds in the canonical range; session, nonce, approver and
key ID are non-empty Unicode-scalar strings.

`shown` is:

```json
{
  "sha256": "<digest of exact displayed bytes>",
  "length": 123,
  "media_type": "text/plain",
  "character_encoding": "utf-8",
  "renderer": {
    "name": "<renderer name>",
    "version": "<renderer version>",
    "manifest_sha256": "<renderer manifest digest>"
  }
}
```

The exact presentation bytes are retained alongside the token. `shown` records
what was actually delivered to the approval surface, not a later render and not
a copy of JUDGED.

To produce `AUTHORIZED`, the host `ApprovalRecord` must grow from its reported
legacy target/time/nonce retention to an **ApprovalRecord v2** carrying:

1. `approval_record_version: 2`;
2. the existing target, issued/authorized time, expiry, nonce, and session;
3. `subject_sha256`, `subject_length`, `subject_scope`, and
   `subject_encoding`, computed from the exact framed bytes before the prompt;
4. `shown_sha256`, `shown_length`, `shown_media_type`,
   `shown_character_encoding`, renderer name, renderer version, and immutable
   renderer-manifest SHA-256, all captured from the bytes actually written to
   the approval surface;
5. the approver/signing key identifier, registered signature algorithm, and
   exact authorization domain; and
6. the original signed token bytes in their original encoding, not merely
   parsed fields or a signature detached from its signed message.

ApprovalRecord v2 uses authorization domain `seal.approval-record/v2` and the
section 2.1 canonical encoder. Its signature preimage is
`ASCII("seal.approval-record/v2") || 0x00 || canonical_approval_payload`, where
the payload contains every item in 1–5 exactly once and no signature field.
The configured approval key signs that preimage with Ed25519. The token carries
the signed payload, `signature_algorithm: "Ed25519"`,
`signature_encoding: "base64url-nopad"`, signer key ID, and signature. Trust in
that key remains the approval channel's trust decision; it is not an outer v3
record signature.

The v3 `authorization_token` field is this exact-byte wrapper:

```json
{
  "encoding": "base64url-nopad",
  "decoded_length": 123,
  "sha256": "<digest of the original token bytes>",
  "bytes": "<base64url without padding>"
}
```

Decoding `bytes` must yield exactly `decoded_length` bytes and the stated
digest. Those are the originally retained token bytes; the v3 assembler does
not reconstruct or re-sign them. Retaining a legacy token while adding unsigned
subject or shown fields is non-conforming.

For `EVIDENCE_UNAVAILABLE`, `subject` is the current request subject,
`reason` is `LEGACY_APPROVAL_DID_NOT_BIND_SUBJECT_AND_SHOWN`, and every field
from `shown` through `authorization_token` is null. This status is the only
conforming mapping of an approval-gated ALLOW backed solely by the reported
legacy ApprovalRecord. It is not an authorization proof.

For `NOT_REQUIRED`, `subject` is the request subject, `reason` is
`EXPLICIT_POLICY_ALLOW`, and every human-approval field is null. For
`NOT_REACHED`, `subject` is the blocked request subject, `reason` is
`JUDGMENT_BLOCKED`, and every human-approval field is null.

### 2.5 DISPATCH ATTEMPTED

The required attempted shape is:

```json
{
  "status": "ATTEMPTED",
  "subject": {},
  "attempt_id": "<unique identifier>",
  "intended_boundary": {
    "adapter": "<adapter>",
    "destination": "<configured destination>",
    "transport": "<transport>",
    "observation_point": "immediately-before-write_child"
  },
  "attempt_recorded_at": 0,
  "completion": null,
  "reason": null
}
```

`ATTEMPTED` asserts exactly this: seal reached the last persisted pre-write
boundary, selected the subject bytes and intended route, allocated the
`attempt_id`, and committed its control flow to invoke `write_child` next. It
does **not** assert that `write_child` was entered, accepted bytes, wrote one
byte, wrote the complete frame, flushed, reached a child, or succeeded. Because
the record precedes the call, failed dispatch and successful dispatch have the
same v3 ATTEMPTED value.

`completion` is always null in v3. A presenter must render the literal
**ATTEMPTED, COMPLETION UNKNOWN**, not DISPATCHED.

For a blocked request, the complete shape instead has status
`NOT_ATTEMPTED`, null `subject`, null `attempt_id`, null `intended_boundary`,
null `attempt_recorded_at`, null `completion`, and reason
`JUDGMENT_BLOCKED`.

Upgrading an attempt to completed dispatch requires evidence captured after the
write boundary: a new authenticated `seal.dispatch-outcome/v1` artifact binding
the `attempt_id`, exact observed outbound subject, actual boundary, outcome and
time. `COMPLETED` requires a positive full-frame boundary observation, not only
a successful return code. `FAILED` binds the error and any observed byte count
without claiming completion. The v3 record is immutable; a consumer composes it
with that later artifact. An in-record `COMPLETED` status therefore requires a
future record version persisted after the observation and a configured signer
and trust root. Reordering this v3 emit is not an allowed shortcut.

### 2.6 ACKNOWLEDGED

For every attempted path, the object is exactly:

```json
{
  "status": "UNKNOWN",
  "sound": false,
  "expected_subject": {},
  "observed_subject": null,
  "executor": null,
  "interpretation": null,
  "extracted": null,
  "attestation": null,
  "reason": "EXECUTOR_ATTESTATION_UNAVAILABLE"
}
```

The `expected_subject` equals DISPATCH ATTEMPTED's intended subject. It says
what a future acknowledgment would have to answer; it does not say any executor
received it. `UNKNOWN`, `sound: false`, all five null observation fields, and
the reason are mandatory. This is an honest hole, not a presentation default.

For BLOCK, ACKNOWLEDGED has status `NOT_APPLICABLE`, `sound: false`,
`expected_subject: null`, the same five null observation fields, and reason
`DISPATCH_NOT_ATTEMPTED`.

A consumer must reject an absent ACKNOWLEDGED slot, render literal uppercase
**UNKNOWN** for that status, reject UNKNOWN with any non-null observation
field, refuse to compute end-to-end agreement while `sound` is false, and
preserve the slot in every export advertised as an authorization record.

A future observed acknowledgment needs an executor-authenticated identity,
received-frame subject, named interpretation, exact extracted projection, and
attestation binding all of them. It may establish only what that executor says
it received and extracted. It still does not prove an effect.

## 3. Total state table

“Approval-gated ALLOW” below has two permitted AUTHORIZED values because the
legacy record cannot be promoted. “Failed dispatch” means a later
`seal.dispatch-outcome/v1` artifact reports failure; the earlier immutable v3
record cannot know that result.

| leg | approval-gated ALLOW | explicit-policy ALLOW | BLOCK | failed dispatch learned later |
|---|---|---|---|---|
| JUDGED | `RECORDED_ALLOW`; request subject; retained host audit | `RECORDED_ALLOW`; request subject; retained host audit | `RECORDED_BLOCK`; request subject; retained host audit | unchanged `RECORDED_ALLOW` |
| AUTHORIZED | ApprovalRecord v2: `AUTHORIZED`, complete non-null signed fields; legacy record: `EVIDENCE_UNAVAILABLE`, reason `LEGACY_APPROVAL_DID_NOT_BIND_SUBJECT_AND_SHOWN`, proof fields null | `NOT_REQUIRED`; request subject; reason `EXPLICIT_POLICY_ALLOW`; all human fields null | `NOT_REACHED`; blocked subject; reason `JUDGMENT_BLOCKED`; all human fields null | unchanged from the applicable ALLOW column |
| DISPATCH ATTEMPTED | `ATTEMPTED`; intended subject, route, attempt ID and pre-write time; `completion: null` | same `ATTEMPTED` shape | `NOT_ATTEMPTED`; all attempt fields null; reason `JUDGMENT_BLOCKED` | unchanged `ATTEMPTED`; linked outcome says `FAILED` and v3 still does not say dispatched |
| ACKNOWLEDGED | `UNKNOWN`; `sound: false`; expected subject; five observation fields null; reason `EXECUTOR_ATTESTATION_UNAVAILABLE` | same `UNKNOWN` shape | `NOT_APPLICABLE`; `sound: false`; expected subject and observation fields null; reason `DISPATCH_NOT_ATTEMPTED` | unchanged `UNKNOWN`; a dispatch failure is not executor acknowledgment |

For approval-gated legacy ALLOW, `unknown_legs` is
`["AUTHORIZED","ACKNOWLEDGED"]`. For ApprovalRecord v2 ALLOW and
explicit-policy ALLOW it is `["ACKNOWLEDGED"]`. For BLOCK it is `[]`.
`all_legs_observed` remains false in all four columns for the reasons in
section 2.

## 4. Signing and trust

Nothing signs a v3 outer record. No record-assembly key, trust configuration,
registered record signature algorithm, or outer-envelope verifier is specified
or inferred. `integrity: "UNSIGNED"` is mandatory.

The cost is material: a portable verifier cannot authenticate the assembler,
trust the standalone state table values, or detect malicious rewrite from the
record alone. It may verify a nested ApprovalRecord v2 token when present and
may replay retained audit evidence, but that does not authenticate the outer
composition. Deployment must label v3 **UNSIGNED** and rely on a separately
authenticated transport or log if source provenance matters.

A signed successor needs a named signing authority, key provisioning and
rotation, trust-root distribution, a registered algorithm with strict
verification rules, domain-separated signature bytes, revocation semantics,
and an outer verification path with test vectors. Adding only signature-shaped
fields is forbidden.

## 5. Production cost and implementation boundary

The v3 shape is implementable without inventing the five deferred evidence
systems:

| item | v3 action | deferred upgrade |
|---|---|---|
| canonical encoding | implement the algorithm and vectors in section 2.1 | none |
| version | emit and strictly dispatch on the v3 discriminator pair | coordinated legacy migration remains separate |
| outer signing | emit explicitly unsigned checksum envelope | authenticated record-assembly protocol |
| JUDGED | retain current audit bytes and use `RECORDED_` status | interpretation manifest, consulted set, projection, policy identity, kernel evidence |
| AUTHORIZED | map legacy records to `EVIDENCE_UNAVAILABLE`; implement ApprovalRecord v2 to earn `AUTHORIZED` | richer display/approver schemes require a new approval version |
| dispatch | persist ATTEMPTED at the existing point | authenticated post-write outcome |
| acknowledgment | emit signed-by-nobody but structurally mandatory UNKNOWN | executor cooperation and attestation |

An implementation lane may build v3 now, including the ApprovalRecord v2
producer/retention path if it wants to emit `AUTHORIZED`. It must remain able to
emit `EVIDENCE_UNAVAILABLE` for legacy approvals and must not call that status
authorized. A lane that cannot change the approval protocol can still build an
honest v3 recorder, but cannot claim a completed AUTHORIZED leg.

The wire schema, canonical vectors, strict validator tests, and examples should
enter the contract-region freeze set described by `docs/archive/OPEN-FINDINGS.md` finding
41. That freeze work is not a prerequisite for writing the first implementation
but is a prerequisite for shipping the shape as stable.

## 6. Rejected alternatives and decision history

### Option A — canonical re-encoding: rejected

Re-encoding request bytes cannot make `-10^9999` representable in binary64 and
cannot make a lone surrogate representable in Lean `String`. It also changes
the bytes between authorization and dispatch, replacing byte identity with a
new semantics-preservation obligation. `NUMERIC-AGREEMENT.md` section 3 records
the numeric part of this rejection. The canonical encoding in section 2.1 is
only for the record payload; it never rewrites the mediated request.

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

### Option C — downstream attestation: rejected, ruled, then reversed

`NUMERIC-AGREEMENT.md` section 5 originally rejected C “for now”: it is correct
in principle, but no MCP server supplies an attestation and requiring one would
make seal unusable with the ecosystem it mediates.

After the surrogate finding established that kernel parser work cannot recover
an executor-only value, C was reconsidered. Ben ruled C at 08:01 on 2026-07-27:
only an executor can authoritatively state what that executor extracted.

C as the whole-record prerequisite was reversed at 08:34. Making the
unavailable statement a prerequisite either prevents seal from issuing an
authorization decision or quietly turns the object into an effect-side receipt.
Ben replaced it with D: preserve the acknowledgment leg, print it UNKNOWN, and
do not pretend executor evidence exists. C remains the upgrade path for that
one leg, not the admission rule for the other legs.

### Option D — four separate facts: selected, then claim-narrowed

D represents disagreement rather than prohibiting it or fusing it. It keeps
missing executor cooperation visible and leaves a precise slot for later
evidence.

The implementation refusal exposed that the first D draft still demanded facts
the producer did not possess: undefined canonical signing, an over-rich JUDGED
leg, exact-byte/display approval fields absent from ApprovalRecord, and a
DISPATCHED claim written before dispatch. This v3 revision keeps four required
slots but reduces JUDGED to retained audit evidence, admits legacy
authorization evidence is unavailable, makes the envelope unsigned, and changes
leg three to DISPATCH ATTEMPTED under Ben's 11:11 ruling. The emit order remains
unchanged.

## 7. Evidence bar

Before v3 is advertised as implemented, retain exact commands, artifacts,
hashes, counts, and exit statuses under a named RUN.

### Canonical envelope and version

1. Reproduce all three positive digests and every rejection vector in section
   2.1 through the production encoder and independent verifier.
2. Change one payload byte and observe checksum failure.
3. Send legacy v1, current v2, v3, and mixed-version objects through the
   discriminator; observe only exact v3 reach the v3 validator.
4. Add each unknown signature-shaped field and observe strict rejection.

### JUDGED

1. Retain exact audit bytes and independently recompute `audit_sha256`.
2. Replay ALLOW and BLOCK and reproduce the audit-to-status mapping and
   `request_sha256 == subject.sha256`.
3. Change one request or audit byte and observe validation fail.
4. Confirm every output uses `RECORDED_ALLOW` or `RECORDED_BLOCK`, never a
   stronger unqualified JUDGED claim.

### AUTHORIZED

1. For ApprovalRecord v2, capture the exact display bytes and request frame and
   verify both against the signed token fields.
2. Mutate request, shown bytes, renderer manifest, session, nonce, and expiry
   one at a time; each must invalidate approval.
3. Feed a legacy ApprovalRecord and observe `EVIDENCE_UNAVAILABLE`, null proof
   fields, and the required reason.
4. Exercise explicit-policy ALLOW and BLOCK and observe the exact nullability
   and reasons in section 3.

### DISPATCH ATTEMPTED

1. At the persisted pre-write point, recompute the intended subject and retain
   attempt ID, route, and timestamp.
2. Make `write_child` fail. The v3 record must still say ATTEMPTED with null
   completion; only a linked outcome may say FAILED.
3. Ablate the `write_child` call after persistence. The record must still not
   say DISPATCHED or COMPLETED. This negative control demonstrates the limit,
   not dispatch success.
4. To claim completed dispatch later, observe exact full-frame bytes after the
   boundary and verify a separately authenticated outcome binding attempt ID.

### ACKNOWLEDGED

1. Verify every attempted output prints UNKNOWN and deleting the slot makes
   validation fail.
2. Verify UNKNOWN has `sound: false` and all five observation fields null.
3. Verify BLOCK produces NOT_APPLICABLE rather than inventing an expected
   dispatch.
4. Do not claim OBSERVED until an executor-authenticated protocol passes
   identity, received-subject, interpretation, extraction, and tamper controls.

### Whole record

1. Exercise every cell of the state table, including both legacy and v2
   approval-gated ALLOW.
2. Remove each leg in turn and observe strict validation fail.
3. Verify the record is visibly labelled UNSIGNED in every output.
4. Search user-facing labels; the strongest permitted top-level label is
   **authorization decision**.

## 8. Disagreements

Four is a presentation ruling, not an evidentiary invariant. In v3, JUDGED is
only a retained host-audit statement, AUTHORIZED can honestly be
EVIDENCE_UNAVAILABLE or NOT_REQUIRED, and DISPATCH ATTEMPTED is deliberately a
pre-call claim. Naming the slots with completed English participles invites
overstatement. A future redesign may be clearer as an event sequence plus
optional authenticated evidence rather than exactly four “legs.”

That concern does not justify fusing facts or violating the ruling. This spec
keeps four mandatory slots and makes the weak statuses literal. ACKNOWLEDGED
UNKNOWN and ATTEMPTED-with-null-completion must not be softened in UI or prose.

## 9. Unverified inputs and limits

The following were not independently checkable from this repository at the
starting commit and must not be promoted to observed facts by this spec:

- Ben's 2026-07-27 08:01 Option C, 08:34 Option D, and 11:11 DISPATCH ATTEMPTED
  rulings and exact timestamps were supplied in work orders.
- The `fourleg-impl` report says the current kernel audit has verdict, tool,
  epoch, request digest and certificate fields but lacks interpretation,
  consulted-set and projection evidence. The implementation lives outside this
  repository, so the exact live field set is **UNVERIFIED HERE**.
- The report says ApprovalRecord retains only target/time/nonce and discards
  the signed token. The general separation of ApprovalRecord from the canonical
  approval tuple is documented in this repository; the exact live struct is
  **UNVERIFIED HERE**.
- The report says the authorization record is persisted before `write_child`
  and that no record signer/trust path exists. Neither implementation is in this
  repository, so those live-code claims are **UNVERIFIED HERE**. This spec
  nonetheless adopts the supplied ordering and unsigned constraint as
  normative inputs.
- The complete five-observer surrogate matrix remains **UNVERIFIED
  INDEPENDENTLY** in `docs/archive/OPEN-FINDINGS.md` finding 36.
- No conforming v3 encoder, validator, ApprovalRecord v2, dispatch-outcome
  protocol, executor acknowledgment, or end-to-end implementation test was
  found in this repository. Their shapes above are requirements, not
  current-behavior claims.

## 10. Specification evidence

This revision was derived from `docs/archive/OPEN-FINDINGS.md` findings 34–37 and 40–42,
`NUMERIC-AGREEMENT.md`, `COMPREHENSION-CHECK.md`, the prior specification, and
the mandated `fourleg-impl` refusal report. Claims exceeding on-disk sources
are listed as unverified above.

Evidence: RUN specrev-fourlegs-v3-2026-07-27
