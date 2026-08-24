# Artifact inheritance: the named successor to the Decision Bundle

Status: **DECLARED, NOT BUILT**. Ruling supplied in the work order: Ben,
2026-07-27 19:42.

This is a **correspondence commitment, not a byte freeze**. T1.1 and T1.2 remain
UNFRISKED, so the successor's shape, encoding, names, versions, compatibility
surface, and even the final spelling of a successful result may change. What may
not disappear silently is the checked chain. This document also does not choose
between canonical binary product encoding and tested conformance; that is the
separate Phase-2 fork in `ROADMAP-KERNEL-OUTWARD.md`.

Claims below are labelled:

- **MEASURED** means read in a cited source or implementation.
- **INFERRED / DECLARED** means a conclusion or the normative successor mapping
  established by this document. It is not implementation evidence.

## 1. What supersedes what

**MEASURED.** g9 names
`DecisionBundle { signed_config, A, H[], B, optional trace_witness }` as the
product artifact and requires an out-of-band `TrustContext`
(`seal-north-star-v2-g9.md` §2). Its verifier also requires
`verifier_context_time` and returns five disjoint typed outcomes
(`seal-north-star-v2-g9.md` §3.1).

**MEASURED.** `ApprovalRecordV2Payload` binds an approval target, authorization
time and expiry, nonce, session, exact request-subject digest/length/scope,
exact shown-byte digest/length/type/encoding, renderer identity, approver, key
identity, algorithm, and domain
(`/home/you/src/seal-host/rust/src/providers.rs:77`). The implementation
canonicalizes and domain-separates the signed payload
(`/home/you/src/seal-host/rust/src/providers.rs:314`) and verifies the key
identity, canonical payload, and Ed25519 signature
(`/home/you/src/seal-host/rust/src/providers.rs:759`).

**MEASURED.** That payload does **not** contain g9's signed configuration,
requester statement, approval constraints, deployment identifier, config
reference, adapter profile, receipt-issuer decision attestation, role-split
trust context, history anchor, or verifier result. The current authorization
decision writer emits a separate v2 host record and retains some signed config,
request, audit, approval, and kernel-identity material
(`/home/you/src/seal-host/rust/src/authorization_decision.rs:198`), but it is
not the four-leg v3 record and not the g9 verifier. The four-leg v3 specification
is explicitly unsigned and was specified as not implemented
(`AUTHORIZATION-RECORD.md:3`, `AUTHORIZATION-RECORD.md:426`).

**INFERRED / DECLARED.** The named successor is the **Authorization Decision
Evidence Package v1**, abbreviated **ADEP-v1**. ADEP-v1 supersedes the
**Decision Bundle as the named product container**, not by renaming it and not
by weakening its checked chain. It is a not-yet-built superset of the on-disk
`ApprovalRecordV2`, with these logical homes:

```text
AuthorizationDecisionEvidencePackageV1
  authorization_decision
  approval_records_v2[]
  checked_evidence
    configuration
    request_attestation
    approval_attestations[]
    decision_attestation
    history_anchor
    optional_trace_witness
  trust_context_ref
  verifier_profile
```

`TrustContext` remains a mandatory independently obtained verifier input; it is
not made trustworthy by embedding it in ADEP-v1. The logical layout above names
ownership only. It does not prescribe JSON, DSSE, canonical binary encoding,
field spelling, byte layout, or compatibility machinery.

**INFERRED / DECLARED.** `ApprovalRecordV2` is therefore **partly built**, while
ADEP-v1 is **not built**. `ApprovalRecordV2` occupies only
`approval_records_v2[]`. It does not, by itself, supersede A, H, B, CFG, the
`TrustContext`, or the verifier. A complete approval correspondence also needs
`checked_evidence.approval_attestations[]`, because the current v2 approval
payload does not carry all of H's context and constraints. A complete decision
correspondence needs `checked_evidence.decision_attestation`; an unsigned
authorization-decision record alone cannot replace B.

## 2. Correspondence matrix

**MEASURED.** The left-hand correspondences are the re-derivations and
fail-closed comparisons stated in g9 §§2–3. The §3.2 gate list is expanded where
one printed line checks several distinct byte links.

**INFERRED / DECLARED.** `Successor home` is the required ADEP-v1 logical home.
`Relation` concerns recoverable information, not identical bytes:

- **BIJECTION**: the g9 information and check result must be recoverable in both
  directions.
- **EMBEDDING**: all g9 information must be recoverable, and ADEP-v1 carries
  additional information.
- **NARROWED**: strictly less g9 information survives.
- **DROPPED**: no successor home carries it.

`Evidence` reports evidence for the **complete successor correspondence**, not
merely evidence that the g9 source specified it. `UNVERIFIED` means the named
home or full check was not found on disk. It must not be read as green.

| Bundle element | What it bound | Successor home | Relation | Evidence |
|---|---|---|---|---|
| S01 — Decision Bundle container (g9 §2) | CFG, A, H[], B, optional trace witness, and the requirement for independent trust travel together as one product artifact | ADEP-v1 root; `checked_evidence`; `authorization_decision`; `approval_records_v2[]`; out-of-band `TrustContext` | EMBEDDING | UNVERIFIED |
| S02 — `config_ref` (g9 §§2.0, 2.5) | Exact decoded CFG payload bytes to one domain-separated configuration identity | `checked_evidence.configuration.content_ref` | BIJECTION | UNVERIFIED |
| S03 — `trust_root_ref` (g9 §2.0) | CFG to the pinned POLICY threshold set, with the verifier re-deriving the set digest | `checked_evidence.configuration.policy_root_set_ref` and verifier re-derivation | BIJECTION | UNVERIFIED |
| S04 — `delegation_ref` (g9 §2.5) | Signed capability fields, parent linkage, and slot-specific role resolution | `checked_evidence.configuration.delegations[]` and verifier delegation resolver | BIJECTION | UNVERIFIED |
| S05 — `judged_request_sha256` (g9 §2.1) | A's exact `judged_request_bytes` to its recomputed SHA-256 | `checked_evidence.request_attestation.subject_bytes` plus `subject`, and `authorization_decision.judged.subject` | EMBEDDING | UNVERIFIED |
| S06 — raw kernel output/verdict (g9 §2.3) | Exact output bytes to the verdict read at the pinned offset | `checked_evidence.decision_attestation.kernel_output` and verifier offset check | BIJECTION | UNVERIFIED |
| S07 — `logical_time` (g9 §2.3) | The exact issuer-asserted time supplied to the kernel and framed into its input | `checked_evidence.decision_attestation.logical_time` | BIJECTION | UNVERIFIED |
| S08 — `durability_class` (g9 §§2.0, 2.3) | One issuer-asserted durability value to v1 eligibility and the honest durability label | `checked_evidence.decision_attestation.durability` | BIJECTION | UNVERIFIED |
| S09 — `operation_id` (g9 §2.3) | ALLOW deduplication to `(deployment_id, session_id, operation_id)` | `checked_evidence.decision_attestation.operation_id` plus its link to `authorization_decision.dispatch_attempted.attempt_id` | BIJECTION | UNVERIFIED |
| S10 — DSSE byte classes (g9 §2.4) | Signatures to authenticated PAE bytes, refs to decoded payload bytes, and key selection away from unauthenticated `keyid` hints | `checked_evidence.*.authentication_boundary` and verifier envelope handling | BIJECTION | UNVERIFIED |
| S11 — hashed-input rule (g9 §2.5) | Every re-derived hash to a pinned formula, differential vectors, and independent-implementation agreement | `verifier_profile.derivations` and the shipped conformance corpus | BIJECTION | UNVERIFIED |
| S12 — event ceiling (g9 §§2.3, 3.3) | B to DECIDED plus intent to record, never RELEASED or EXECUTED | `checked_evidence.decision_attestation` plus the four separate `authorization_decision` legs | EMBEDDING | UNVERIFIED |
| G01 — `CODE ROOTS PINNED` (g9 §3.2) | Kernel, parser, and release-projection targets to the CODE threshold in the independent TrustContext | out-of-band `TrustContext.code_plane` and verifier gate G01 | BIJECTION | UNVERIFIED |
| G02 — `POLICY ROOTS PINNED` (g9 §3.2) | Roots, limits, revocations, identity, and config authority to the POLICY threshold | out-of-band `TrustContext.policy_plane` and verifier gate G02 | BIJECTION | UNVERIFIED |
| G03 — `ROLE KEYS DISJOINT` (g9 §3.2) | Full CODE and POLICY root/recovery/rotation closure to disjoint canonical Ed25519 key material | TrustContext pin validation and verifier gate G03 | BIJECTION | UNVERIFIED |
| G04 — `TRUST CONTEXT BOUND` (g9 §§3.1a, 3.2) | CODE plane, POLICY plane, and shared freshness window to one re-derived anti-splice reference | `trust_context_ref`, both signed planes, and verifier gate G04 | BIJECTION | UNVERIFIED |
| G05 — `CONTEXT FRESH` (g9 §§3.1a-ii, 3.2) | Context validity to independently classified verifier time, with substitution remaining not evaluable | out-of-band verifier-time input and verifier gate G05 | BIJECTION | UNVERIFIED |
| G06 — `KERNEL PINNED` (g9 §§3.1e, 3.2) | Decision replay to a CODE-allowlisted kernel digest and eligible kernel profile | `checked_evidence.decision_attestation.kernel_identity`, TrustContext CODE registry, and verifier gate G06 | BIJECTION | UNVERIFIED |
| G07 — `Ρ DIGEST REGISTERED` (g9 §3.2) | Issuer-selected release projection to a retained CODE registry entry | `checked_evidence.decision_attestation.release_projection`, TrustContext CODE registry, and verifier gate G07 | BIJECTION | UNVERIFIED |
| G08 — `CONFIG CURRENT` (g9 §3.2) | CFG window, rollback floor, revocation view, and receipt-key delegation epoch to verifier context time | `checked_evidence.configuration`, POLICY registry, and verifier gate G08 | BIJECTION | UNVERIFIED |
| G09 — `ROLE KEYS DISTINCT + DELEGATION AUDIENCE` (g9 §§2.6, 3.2) | Requester, approver, receipt issuer, and config authority to distinct capabilities whose contexts fit their audiences and lineage | `checked_evidence.configuration.delegations[]` and verifier gate G09 | BIJECTION | UNVERIFIED |
| G10 — `ISSUER AUTHENTICATED UNDER POLICY ROOT` (g9 §3.2) | B's signer to a current receipt-issuer delegation chained to the pinned POLICY root | `checked_evidence.decision_attestation.issuer` and verifier gate G10 | BIJECTION | UNVERIFIED |
| G11 — `REQUEST SIGNATURE VERIFIED` (g9 §§2.1, 3.2) | A's authenticated PAE bytes to the accepted requester capability | `checked_evidence.request_attestation` and verifier gate G11 | BIJECTION | UNVERIFIED |
| G12 — `APPROVAL SIGNATURE VERIFIED` (g9 §§2.2, 3.2) | Each H's exact target/request, constraints, time, nonce, authority, and context to an accepted approver capability | paired `approval_records_v2[]` and `checked_evidence.approval_attestations[]`, verifier gate G12 | EMBEDDING | UNVERIFIED |
| G13 — `REQUEST_BYTES_MATCH_REF` (g9 §3.2) | Embedded exact request payload bytes to B's request reference | `checked_evidence.request_attestation.payload_bytes` plus `content_ref` and the decision-attestation request link | EMBEDDING | UNVERIFIED |
| G14 — `APPROVAL_BYTES_MATCH_REF[]` (g9 §3.2) | Every exact approval payload to its reference, sorted order, cardinality, and duplicate rejection | `checked_evidence.approval_attestations[]` plus decision-attestation approval links | BIJECTION | UNVERIFIED |
| G15 — `CONFIG_BYTES_MATCH_REF` (g9 §3.2) | Embedded exact CFG payload to B's configuration reference | `checked_evidence.configuration` plus the decision-attestation configuration link | BIJECTION | UNVERIFIED |
| G16 — `PROFILE IDENTIFIER IN CONFIG SET` (g9 §3.2) | Adapter-profile identifier to the CFG set bucketed by parser-derived kernel tool namespace | request/approval/decision context, configuration profile set, and verifier gate G16 | BIJECTION | UNVERIFIED |
| G17 — `CONTEXT EQUAL` (g9 §§2.6, 3.2) | Deployment, session, config, and adapter context to equality across A, every H, and B | all checked-evidence attestations and verifier gate G17 | BIJECTION | UNVERIFIED |
| G18 — `CONTEXT MATCHES PIN` (g9 §3.2) | Bundle deployment identity to the relying party's out-of-band expected deployment identity | TrustContext identity pin and verifier gate G18 | BIJECTION | UNVERIFIED |
| G19 — `PATH V1-ELIGIBLE` (g9 §§2.0, 3.2) | Kernel-derived admission path and asserted durability to the closed or nonce-burn v1 floor | configuration admission table, decision durability, and verifier gate G19 | BIJECTION | UNVERIFIED |
| G20 — `ADMISSION PROFILE DERIVED` (g9 §§3.1f, 3.2) | Verification-profile identifier to the total, fail-safe admission lookup keyed by kernel tool namespace | configuration admission table, parser result, and verifier gate G20 | BIJECTION | UNVERIFIED |
| G21 — `STEP_INPUT ≡ FRAME(A, H[], CONFIG, TIME)` (g9 §§3.1c, 3.2) | Kernel input bytes to the rebuilt universal frame over every verdict-influencing artifact | `checked_evidence.decision_attestation.step_input` and verifier gate G21 | BIJECTION | UNVERIFIED |
| G22 — `LIMITS DIGEST MATCHES TRUST CONTEXT` (g9 §3.2) | B's verification-profile definition digest to exact POLICY-registry limits octets | decision verification profile, TrustContext POLICY registry, and verifier gate G22 | BIJECTION | UNVERIFIED |
| G23 — `PREVIOUS_RECEIPT_REF RESOLVES` (g9 §§2.5, 3.2) | A supplied history edge to exact prior decision bytes, with standalone verification restricted to genesis | `checked_evidence.history_anchor` and verifier gate G23 | BIJECTION | UNVERIFIED |
| G24 — `DECISION CONSISTENT` (g9 §§3.1e, 3.2) | Allowlisted-kernel replay over the byte-equal frame to the recorded verdict, after all applicable gates pass | verifier typed result and checked transcript | BIJECTION | UNVERIFIED |

### Relation defence

**INFERRED / DECLARED.** The five **EMBEDDING** rows add information without
discarding the g9 content:

- S01 adds a separately named authorization-decision event record and
  `ApprovalRecordV2` components to the checked evidence.
- S05 and G13 add subject length, scope, and encoding to the exact request
  commitment.
- S12 expands the old event ceiling into explicit JUDGED, AUTHORIZED, DISPATCH
  ATTEMPTED, and ACKNOWLEDGED slots while retaining the old DECIDED/recording
  ceiling.
- G12 adds the exact shown bytes and renderer identity from `ApprovalRecordV2`;
  the paired approval attestation must still retain every H context,
  constraint, and authority binding.

**INFERRED / DECLARED.** Every **BIJECTION** row requires the same logical
information and the same pass/fail/not-evaluable distinction to be recoverable
in both directions. This does not require old field names or old bytes. No row
is classified NARROWED or DROPPED. That is a specification statement only:
because all complete rows are `UNVERIFIED`, none is claimed implemented.

## 3. Verifier I/O and typed outcomes

**MEASURED.** g9's logical input type is:

```text
verify(
  DecisionBundle,
  TrustContext,
  VerifierContextTime
) -> VerificationResult
```

`TrustContext` contains the out-of-band deployment identity pin; CLI
`--audit-unpinned` selects a degraded audit mode. `VerifierContextTime` declares
either an independent-clock trust class or the root-asserted substitution
class. Each fail-closed gate is tri-state: GREEN, RED, or NOT-EVALUABLE
(`seal-north-star-v2-g9.md` §3.1a-ii).

**INFERRED / DECLARED.** The successor input type replaces only the first
parameter:

```text
verify(
  AuthorizationDecisionEvidencePackageV1,
  TrustContext,
  VerifierContextTime
) -> VerificationResult
```

The output remains a sum type consisting of one typed status and exit code,
the gate transcript, and the tiered always-on limitation lines. Consumers may
authorize only the typed success case, never a matched line or numeric band.
T1.2 may later rename or narrow the success claim, but it may not collapse a
degraded or failed case into success.

**MEASURED.** The complete g9 outcome set and precedence are
`REFUTED(30) > UNVERIFIABLE(20) > STALE-UNKNOWN(11) >
UNPINNED-AUDIT(10) > AUTHORIZED(0)` (`seal-north-star-v2-g9.md` §3.1a-ii).

| Typed outcome | g9 meaning | Implementation on disk | Evidence |
|---|---|---|---|
| `AUTHORIZED` (0) | Every mode-applicable gate green and freshness evaluated green under an independent clock | UNVERIFIED — no ADEP-v1/g9 implementation located | `ROADMAP-KERNEL-OUTWARD.md:96` |
| `UNPINNED-AUDIT` (10) | Explicit unpinned audit; identity-pin gate not evaluable; grants nothing | UNVERIFIED — no ADEP-v1/g9 implementation located | `ROADMAP-KERNEL-OUTWARD.md:96` |
| `STALE-UNKNOWN` (11) | Substitution time makes freshness not evaluable; never authorization | UNVERIFIED — no ADEP-v1/g9 implementation located | `ROADMAP-KERNEL-OUTWARD.md:96` |
| `UNVERIFIABLE` (20) | A required check cannot be evaluated, including absent root/pin, invalid schema, extraction failure, or unknown digest | UNVERIFIED — no ADEP-v1/g9 implementation located | `ROADMAP-KERNEL-OUTWARD.md:96` |
| `REFUTED` (30) | At least one fail-closed gate is positively red; degraded modes cannot mask it | UNVERIFIED — no ADEP-v1/g9 implementation located | `ROADMAP-KERNEL-OUTWARD.md:96` |

**MEASURED.** Related receipt verifiers do exist on disk, but they are not this
implementation. For example, `seal-check` declares the distinct P-ENFORCE set
`{authorised, authorised-unparseable, unpinned, failure}` mapped to exits
`0/4/3/1` (`/home/you/src/seal-check/receipt.js:17`). Neither matching exit
zero nor the word “authorised” makes that verifier an implementation of g9's
different input type, gates, and five-case result.

## 4. What is not inherited, and why

**INFERRED / DECLARED.** There are no NARROWED or DROPPED rows to justify. The
checked chain is carried as a specification obligation. An absent
implementation is recorded as `UNVERIFIED`, not laundered into either an
implemented inheritance or a deliberate drop.

The following are intentionally not inherited because they are outside the
correspondence commitment, not because a matrix row was weakened:

- byte layout, JSON/DSSE use, field spelling, object boundaries, version
  numbers, and compatibility strategy;
- the name `Decision Bundle` as the product container;
- a decision on canonical binary product encoding versus tested conformance;
- an assumption that current `ApprovalRecordV2` covers H in full;
- an assumption that the unsigned authorization-decision record authenticates
  B's issuer or outer composition;
- an assumption that the five g9 verifier outcomes already exist merely because
  other verifier profiles return superficially similar words or exit codes; and
- a freeze of the `AUTHORIZED` label before T1.2 is frisked.

If a future change proposes to remove any S- or G-row, that row must become
NARROWED or DROPPED here and use exactly one of these reasons: **superseded by a
stronger check** (named), **the claim was never earned**, **deliberately out of
scope now** (with ruler and time), or **UNKNOWN — needs Ben**.

## Disagreements and limits

**MEASURED.** The brief is correct that `ApprovalRecordV2` is the strongest
signed successor component currently on disk. It is not the only related
artifact: an authorization-decision v2 writer also exists
(`/home/you/src/seal-host/rust/src/authorization_decision.rs:60`). That
writer does not change the conclusion because it is neither the four-leg v3
record nor ADEP-v1.

**MEASURED.** The required sources do not contain Ben's 2026-07-27 19:42
inheritance ruling. Its wording and timestamp are therefore work-order inputs,
not independently measured repository facts.

**MEASURED.** g9 §2 shows a two-argument shorthand
`verify(DecisionBundle, TrustContext)`, while g9 §3.1 gives the operative
three-input form including `verifier_context_time`. This document uses the
later, fuller verifier signature.

**INFERRED / DECLARED.** No other disagreement with the work order was found.

Evidence: RUN inherit-2026-07-27
