# MCP 2026-07-28 `_meta` partition specification

**Ruling, 2026-07-28 21:47:** Ben selected **Option A — commit everything**. The
complete validated `_meta` object, including unknown keys, enters the effect
commitment and guard/typed target. **Status: RULED, NOT STARTED.** This document
retains all three options as decision history.

**Correction, 2026-07-28:** this document originally specified choices for Ben
to rule on and selected no winner. It is not
an encoding, domain-tag, byte-layout, signature, or implementation
specification; the dated ruling above, not a rewrite of the option analysis,
records the selection.

Branch B is not costed again: stripping `_meta` deletes protocol-mandated
metadata, trace propagation, and legal extensions from traffic seal claims to
mediate transparently, contradicting proper support for MCP 2026-07-28.

## 1. Evidence boundary and current collision

The MCP evidence in this document is pinned to the official `2026-07-28` tag,
commit
[`5f5440bb26a62e2cf3440b92da5a667efa03b267`](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/5f5440bb26a62e2cf3440b92da5a667efa03b267).
The tagged specification says that `_meta` carries extensible interaction
metadata, defines the reserved-prefix and key-name rules, lists reserved keys,
permits official and third-party extension keys, and defines request, response,
subscription, and trace fields
([tagged `_meta` section](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L320-L427)).
The tagged TypeScript schema is the source-of-truth schema and leaves metadata
open to additional keys while defining request-, notification-, and
result-specific fields
([tagged schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/schema/draft/schema.ts#L34-L165)).

Seal currently has three different projections of the same request:

- The effect preimage is exactly
  `["seal.effect/v3", server, tool, arguments.compress]`
  (`mcp-seal-dev/Seal/EffectCommitment.lean:82-106`,
  theorem `preimage_shape`).
- The deployed guard target is derived from server identity, tool, and
  canonical arguments (`mcp-seal-dev/Seal/Classify.lean:50-59,68-78`).
- The raw-line receipt digest covers the whole terminator-stripped request, and
  the ApprovalRecord v2 subject covers the exact delimiter-bearing frame
  (`seal-host/Host/Audit.lean:13-19,40`;
  `seal-host/rust/src/providers.rs:190-195`).

Consequently, two forwarded requests may have equal effect commitments, equal
guard targets, and equal canonical-request receipt identities while differing
in `_meta`. The exact-frame subject and raw-line digest detect the byte
difference; the action/authority identity does not.

## 2. Reserved-key table and verdict on the supplied list

### 2.1 Verdict

The supplied nine-name list is **not correct as a literal wire-key list**:

1. Five names are namespace-qualified on the wire:
   `io.modelcontextprotocol/protocolVersion`,
   `io.modelcontextprotocol/clientInfo`,
   `io.modelcontextprotocol/clientCapabilities`,
   `io.modelcontextprotocol/logLevel`, and
   `io.modelcontextprotocol/subscriptionId`.
2. The specification's table headed “Reserved keys” contains nine concrete
   keys when the three trace names are counted separately. After correcting
   the five prefixes, its stem roster matches the supplied nine.
3. The same tagged section separately defines
   `io.modelcontextprotocol/serverInfo` as a per-result `_meta` field. It is
   also under a prefix the specification reserves for MCP. Thus the complete
   set of concrete core `_meta` fields defined by the revision is ten, even
   though `serverInfo` is omitted from the page's explicit “Reserved keys”
   table. This response-side inconsistency is recorded rather than silently
   choosing one reading.
4. These concrete names are not a closed universe. The tagged specification
   expressly permits official and third-party extension keys
   ([extension-key rule](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L360-L363)).

“Identical action” below means equal seal server identity, tool name, and
arguments. “Can the server act?” distinguishes action selection from other
protocol behavior; a “yes” does not necessarily make the field part of the
tool's external effect.

### 2.2 Key table

| Exact key | What carries it | May legitimately change between identical actions? | Can a server act on it? |
| --- | --- | --- | --- |
| `progressToken` | An optional request `_meta` string or integer. It opts the request into progress notifications and must be unique among active requests ([Progress, lines 7-18](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/patterns/progress.mdx#L7-L18)). | **Yes.** A caller may choose a different opaque token for each active invocation of the same action. | **Yes, at the protocol-behavior layer.** The server may emit progress notifications associated with it, or emit none ([Progress, lines 33-67](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/patterns/progress.mdx#L33-L67)). |
| `io.modelcontextprotocol/protocolVersion` | A required string in every client request's `_meta`, identifying the protocol version used for that request ([per-request fields](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L365-L382)). | **Yes.** The same action can be expressible under two mutually supported revisions. The value is normally stable within one selected modern era, but that is not an identity guarantee. | **Yes.** An unsupported value must cause `UnsupportedProtocolVersionError`; a supported value selects the request semantics ([Versioning, lines 20-25 and 44-52](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/versioning.mdx#L20-L52)). |
| `io.modelcontextprotocol/clientInfo` | Optional request `_meta` `Implementation` data; clients should normally include it. It is self-reported and intended for display, logging, and debugging ([client/server identity rule](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L373-L409)). | **Yes.** Different clients or client versions can invoke the identical action, and one client may be configured to omit it. | **Not for request behavior or security in a conforming implementation.** The specification says servers should not use it to change behavior and should not rely on it for security decisions. A server may still display, log, or debug with it. |
| `io.modelcontextprotocol/clientCapabilities` | A required `ClientCapabilities` object in every client request's `_meta`, scoped to that request ([tagged schema, lines 91-98](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/schema/draft/schema.ts#L91-L98)). | **Yes.** Capabilities are declared per request, and two clients performing the same action may declare different supported interactions or extensions. | **Yes.** A server must not infer undeclared capabilities and must reject with `-32021` when processing requires a capability the request did not declare ([capability rule](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L387-L392)). |
| `io.modelcontextprotocol/logLevel` | An optional request `_meta` `LoggingLevel`, deprecated in this revision but retained. It opts the request into request-scoped log notifications at or above the selected level ([Logging, lines 7-23 and 58-72](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/server/utilities/logging.mdx#L7-L23)). | **Yes.** The requested verbosity can change independently of the tool action. | **Yes, at the observability/protocol layer.** Presence and value control whether and which log notifications may be emitted; an invalid level should be rejected with `-32602` ([Logging, lines 58-72 and 98-105](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/server/utilities/logging.mdx#L58-L105)). |
| `io.modelcontextprotocol/subscriptionId` | Server-to-client `_meta` on acknowledgments, notifications, and the closing result of a `subscriptions/listen` stream; its value is the originating request ID ([Subscriptions, lines 52-92 and 137-153](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/patterns/subscriptions.mdx#L52-L92)). | **Yes.** Identical notifications on different subscriptions carry different IDs. It is not defined as an ordinary `tools/call` request field. | **Not as a client-supplied tool-action input.** The server produces it; the client uses it to demultiplex subscription traffic. |
| `traceparent` | Optional interaction `_meta` carrying W3C Trace Context; when present it must have W3C format ([trace rule](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L419-L445)). | **Yes.** A different valid trace or parent span may accompany the identical action. MCP does not require a fresh span on every request. | **Yes, outside tool-action selection.** Instrumentation may extract and propagate it; observability systems and downstream routing/export can react to it. It is not semantically inert. |
| `tracestate` | Optional interaction `_meta` carrying the W3C vendor trace-state list; when present it must have W3C Trace Context format ([trace rule](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L419-L427)). | **Yes.** Vendor state can change independently of the action. | **Yes, outside tool-action selection.** Trace processors, exporters, and downstream routing can use it. It is not semantically inert. |
| `baggage` | Optional interaction `_meta` carrying W3C Baggage; when present it must have W3C Baggage format ([trace and baggage rule](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L419-L427)). | **Yes.** Baggage members can vary independently of the action. | **Yes, outside tool-action selection.** Instrumentation or downstream services can propagate, route, or export based on it. It is not semantically inert. |
| `io.modelcontextprotocol/serverInfo` | Optional `Implementation` data in every result's `_meta`; the server produces it for display, logging, and debugging ([per-response field](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/docs/specification/2026-07-28/basic/index.mdx#L394-L409); [schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/5f5440bb26a62e2cf3440b92da5a667efa03b267/schema/draft/schema.ts#L136-L157)). | **Yes, across responses.** Different server instances or software versions may return the identical action result. It is not defined as a client request field. | **Not as request input.** A server produces it, and a conforming client should not use it to change behavior or make security decisions. |

## 3. Option C: computable partition rule

This section defines C semantically. All representation details remain
**PROPOSED** and non-final.

### 3.1 Inputs and validation order

For a mediated `tools/call`, start from the raw request frame and the protocol
era that seal says it enforces:

1. Perform raw duplicate-key checks before any JSON object projection.
2. Parse the request once into a JSON value without losing the raw exact-frame
   subject.
3. Validate `_meta` presence and object shape for the enforced era.
4. Validate each known key against its specified type or format.
5. Apply the resource bound.
6. Partition by exact key name.
7. Only after those steps compute any effect commitment, guard target,
   approval challenge, or authority receipt.

No invalid or resource-exhausting metadata reaches an authority decision.

### 3.2 Authority-committed keys

For C, the complete JSON value of each present key below enters action and
authority identity:

| Exact key | Reason |
| --- | --- |
| `io.modelcontextprotocol/protocolVersion` | It selects the protocol semantics under which the request is interpreted, and a server must reject unsupported versions. Equal tool arguments under different revisions are not assumed to mean an equal mediated action. |
| `io.modelcontextprotocol/clientCapabilities` | It declares which request-scoped interactions and extensions the server may rely on. The entire object is committed; selecting only a “relevant” subtree would require a separate, revision- and method-specific semantic proof. |

Required-key absence is validation failure, not a special committed value, on a
2026-07-28 request.

### 3.3 Keys excluded by exact name

For C, the values of these exact names are excluded from action and authority
identity:

| Exact key | Reason for exclusion |
| --- | --- |
| `progressToken` | Correlation for optional progress output; it is expected to vary by active invocation. |
| `io.modelcontextprotocol/clientInfo` | Self-reported display/log/debug identity that the specification says should not alter server behavior or security decisions. |
| `io.modelcontextprotocol/logLevel` | Request-scoped observability output selection, not authorization for the tool action. It can affect server output and resource use. |
| `io.modelcontextprotocol/subscriptionId` | Server-produced subscription-stream correlation, not a client tool-action input. |
| `traceparent` | Trace propagation. It affects observability and can affect downstream routing; it is not semantically inert. |
| `tracestate` | Trace vendor state. It affects observability and can affect downstream routing; it is not semantically inert. |
| `baggage` | Propagated context. It affects observability and can affect downstream routing; it is not semantically inert. |
| `io.modelcontextprotocol/serverInfo` | Server-produced result identity, not a client tool-action input; the specification limits it to display/log/debug use. |

The defensible statement is exactly:

> These keys are excluded from action and authority identity by name, while
> their values remain covered by the exact-frame subject.

They must never be described as semantically inert. A child receives and may
act on the exact bytes after approval; the partition only says that changing
these values does not name a different authority-bearing tool action.

### 3.4 Semantic partition record

The following is **PROPOSED semantic content**, not a field order or encoding:

- a protocol-era-aware `_meta` presence state;
- a map of committed known key names to complete JSON values;
- a fixed, sorted declaration of the exact names excluded by the partition
  policy;
- a sorted list of excluded names actually present in this request;
- the selected unknown-key policy;
- for the commit-unknown variant, a map of unknown key names to complete JSON
  values;
- the exact-frame subject digest and length already required by ApprovalRecord
  v2.

The fixed exclusion declaration is part of the signed partition policy, so an
implementation cannot silently add a new excluded key. The per-request list of
excluded names is signed and recorded, but is not an input to action or
authority identity; otherwise merely adding an optional trace key would still
turn the target into an invocation identity. Its values remain bound by the
exact-frame subject.

The map and list language above specifies mathematical content only. It does
not select JSON canonicalization, string encoding, framing, field order,
domain tag, digest preimage, or byte layout.

### 3.5 Unknown keys: two honest C variants

The base schema is open and the tagged specification permits future official
and third-party extension keys. C therefore has two fail-closed variants; Ben
must choose one if C is selected.

**C-refuse-unknown**

- Behavior: refuse before any authority decision when `_meta` contains a key
  not in the committed or excluded tables.
- Security property: an unreviewed key can neither affect the child under an
  old authority identity nor be silently omitted from identity.
- Forward-compatibility cost: every new extension key requires a seal update
  before otherwise valid traffic can pass. This is safe but not transparent
  forward compatibility.

**C-commit-unknown**

- Behavior: validate the key-name grammar, then include the unknown key name,
  presence, and complete JSON value in action and authority identity.
- Security property: a server-visible extension value cannot change while the
  authority identity stays equal.
- Forward-compatibility cost: legal new extensions pass without a seal update,
  but volatile unknown values make the target invocation-specific for those
  requests. This locally inherits A's target churn and requires a total,
  bounded, cross-language canonical-value treatment.

Neither variant may ignore an unknown value. A registry-driven third variant
would merely move the same commit/exclude decision into a versioned registry
and is outside this specification.

## 4. Fail-closed cases

| Case | Required behavior |
| --- | --- |
| Unknown key present | Apply exactly one declared policy from §3.5: refuse the request before authority, or commit the complete value. Record which policy was applied. Never silently exclude it. |
| Duplicate object keys anywhere relevant to the mediated request, including duplicate `_meta` or duplicate members inside `_meta` | Refuse from the raw representation before ordinary JSON object projection. No last-wins or first-wins canonical value may reach the partition. |
| `_meta` absent | Under 2026-07-28, refuse as malformed with `-32602`, because request `_meta`, `protocolVersion`, and `clientCapabilities` are required. On a separately supported legacy path where `_meta` absence is valid, represent `meta_absent` distinctly from a present object before computing identity. |
| `_meta: null` | Refuse as malformed. `null` is present but is not an object; it must not collapse into absence or an empty object. |
| `_meta` present but not an object | Refuse as malformed before authority computation. |
| Reserved key has the wrong type or format | Refuse before authority. Examples: malformed `traceparent`, non-W3C `tracestate`/`baggage`, non-string `protocolVersion`, non-object `clientCapabilities`, non-`Implementation` `clientInfo`, invalid `LoggingLevel`, or a progress/subscription token outside its allowed scalar type. Use `-32602` for malformed parameters; use the revision's specific unsupported-version error only for a well-formed but unsupported version. |
| A key's value, `_meta` as a whole, or its nesting is enormous | Refuse before canonicalization, target derivation, approval prompting, or forwarding. The implementation must pin finite limits for raw `_meta` bytes, decoded depth, member count, string length, and total canonical work. The numeric limits and exact wire error are OPEN; unlimited processing is not an option. |

For legacy/modern dual-era support, era detection must precede the
2026-required-field verdict. An absent legacy `_meta` cannot be mislabeled as a
valid 2026 request.

## 5. Receipt requirements

A receipt for C must make the partition legible without making a false
negative claim:

- State the enforced MCP revision or era.
- State the unknown-key policy.
- Include the complete committed key names and values.
- Include the sorted excluded names actually present in the request.
- Bind those excluded names under the receipt's signature or signed partition
  attestation.
- Include the fixed sorted exclusion-policy declaration or an unambiguous
  signed reference to it.
- Retain the exact-frame subject digest and length, and retain the raw-line
  request digest.
- Distinguish `_meta` absent, present-object, and rejected non-object states in
  refusal evidence.
- For C-commit-unknown, include the committed unknown names and values. For
  C-refuse-unknown, include the refused unknown names, subject to bounded and
  non-secret-safe rendering.

The receipt wording is:

> excluded from authority identity

It must never say or imply “not present” for a present excluded key, and must
never call an excluded key or value “inert.” “Not present” is reserved for a
structural absence actually observed in the request.

## 6. Option A — ruled 2026-07-28

Under A, the complete validated `_meta` object, with a distinct absence state
where the selected protocol era permits absence, enters the effect commitment
and guard/typed target. The result is complete and simple: every server-visible
metadata difference changes authority identity. The cost is that the target is
an invocation identity, not a stable name for an action. **That cost is
accepted, not overlooked, and is not reserved for later avoidance.**

### 6.1 Target-keyed consumers in the current tree

Policy rule selection is not one of them. Matching reads only arguments
(`mcp-seal-dev/Seal/Classify.lean:47-48,68-70`). Adding `_meta` to the target
does **not** make rule selection trace-sensitive.

The target-keyed consumers that do change meaning are:

| Consumer cluster | Current evidence | Effect under A |
| --- | --- | --- |
| V1 live-approval map and one-shot spend | `mcp-seal-dev/SealCore/Automaton.lean:8-23,37-44`; approval JSON becomes target events at `seal-host/Host/Evidence.lean:83-95` | An approval is live only for the exact metadata-bearing invocation target. A different trace/progress/log value cannot reuse it. The map logic itself is generic and need not be redesigned. |
| Multi-rule guard-target agreement | `mcp-seal-dev/Seal/Classify.lean:87-105` | Every matching guarded rule must receive the same metadata-bearing target. Threading changes; agreement semantics do not, because all rules see the same request metadata. |
| Signed approval payload and exact admission | `seal-host/rust/src/providers.rs:77-98,190-195,205-227,489-521` | Approval target equality becomes invocation-specific. ApprovalRecord v2 already additionally requires the exact frame, so A adds no broader replay right and does not weaken admission. |
| Outstanding challenge, signed decline, interactive prompt/retry, and pending-record consumption | `seal-host/rust/src/main.rs:1135-1140,1493-1514,1686-1761,1804-1839`; `seal-host/rust/src/main.rs:408-413`; `seal-host/rust/src/providers.rs:1096-1160` | These correlations partition by invocation target. The interactive retry uses the same wire arrival, so it still matches. A later otherwise-identical invocation with different metadata cannot match the old target. |
| Authorization-decision approval lookup and capability reporting | `seal-host/rust/src/authorization_decision.rs:278-290,384-406,436-443,498-524` | Lookup and reported capabilities become invocation-specific. Receipt filenames remain keyed by the `_meta`-blind canonical request hash, but the monotonic entry counter prevents overwrite; the projection would still need repair for coherent terminology. |
| V2 typed target, signed approval equality, and replay namespace | `mcp-seal-dev/SealV2/Validation.lean:34-40,61-90,260-289,302-340`; `seal-host/Host/StatefulNI.lean:127-145`; `seal-host/Host/AuthorityFrontierBridge.lean:88-98,104-125` | The typed target and target key must carry complete metadata. Replay namespaces multiply with metadata values. This is conservative and prevents reuse; it does not create a replay acceptance. |

Tests, vectors, signatures, target hashes, target-stability statements, and
artifact pins that fix old target bytes must be regenerated, but the consumer
audit found no in-tree policy engine selecting rules by serialized target and
no cache that grants an action-wide reusable approval independently of the
exact target.

### 6.2 Honest A/C cost comparison

The target consumer set is smaller in kind than the prior broad file-count
estimate suggests, and nearly every consumer compares, stores, or displays an
opaque target. A changes their meaning but does not require bespoke partition
logic at each site.

Therefore **A is materially cheaper to implement and verify than C**:

- both A and C must validate, parse, carry, encode, prove, vector, and repin
  `_meta`;
- A commits one complete bounded value;
- C additionally needs the field classifier, fixed exclusion declaration,
  per-request excluded-name evidence, unknown-key policy, field-specific
  validation, receipt vocabulary, and watched omission tests.

A's real risk is contractual, not hidden implementation breadth: it gives up a
stable action name and makes approvals, capabilities, and replay namespaces
invocation-specific. C preserves stable authority identity for named volatile
metadata but has more implementation surface and a greater omission risk.
**Correction, 2026-07-28:** this comparison remains decision history; Ben has
selected A.

## 7. Option C negative control (decision history)

**Correction, 2026-07-28:** the partition-boundary controls below were
mandatory only for Option C. They remain as the recorded C design and are not
Option A implementation obligations. Option A instead owes watched mutations
showing that every accepted `_meta` key, including an unknown key, changes the
committed invocation identity.

Under C, the implementation would owe a watched mutation that proves the
partition boundary can fail.

Minimum required control:

1. Keep one exact request fixture containing both
   `io.modelcontextprotocol/protocolVersion` and `traceparent`.
2. Keep paired assertions that changing only `protocolVersion` changes the
   authority identity, while changing only the valid `traceparent` value does
   not change authority identity but does change the exact-frame subject and
   the receipt's excluded-key evidence.
3. In a disposable implementation copy, mutate the partition table so
   `io.modelcontextprotocol/protocolVersion` is classified as excluded.
4. The committed-value identity assertion and partition-record golden must
   turn red. A green suite under this mutation means the authority side of the
   partition is not watched.

A companion omission mutation should delete `traceparent` from the fixed
excluded-name declaration. Under C-refuse-unknown the request must become a
refusal; under C-commit-unknown the authority-identity stability assertion must
turn red. Either outcome demonstrates that an excluded-name omission cannot
pass silently.

## 8. Remaining representation decisions and closed forks

**Correction, 2026-07-28:** two entries in the original open list are now
closed by Ben's rulings; they are retained rather than deleted.

- **C-refuse-unknown versus C-commit-unknown — CLOSED AS MOOT.** Option A
  commits unknown keys by construction.
- Exact metadata and nesting resource limits, and the wire error for a limit
  breach.
- The domain tag or version identifier for any changed effect, target,
  partition attestation, or receipt.
- Byte framing, string encoding, field order, JSON canonicalization mechanism,
  map/list encoding, and whether a semantic partition is embedded or
  referenced.
- The signature container for the partition attestation and receipt.
- **Whether V2 typed targets and effect envelopes are inside the v1 release
  boundary — RULED INSIDE V1.**
- Migration and display language for old receipts whose
  `canonical_request` projection omitted `_meta`.

Changing any later-settled representation invalidates every dependent target
hash and effect vector; approval payloads and signatures; V2 target keys and
replay namespaces; receipt and differential goldens; classifier/envelope pins;
and native/wasm provenance. That is why this specification fixes semantic
membership and failure behavior while refusing to pretend the bytes are
settled.
