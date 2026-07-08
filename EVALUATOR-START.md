# Seal: Start Here (Evaluators & Auditors)

Seal is explicit about the line between what is **proved** and what is
**deployed**. Read this before probing any repo. If you think you have found a
gap, check here first; we have most likely already named it. The failure mode
we care about is an auditor finding a seam before we state it.

## 1. What is proved (Lean 4, axiom-clean)

Kernel theorems, axiom footprint `{propext, Classical.choice, Quot.sound}`, no
`sorry` / `native_decide`:

- **Safety** in `mcp-seal-dev/SealCore/Safety.lean`: `default_deny_never_allowed`,
  `guarded_allow_iff_live`, `approval_binds_to_target`,
  `confused_deputy_blocks_from_single_other_approval`,
  `consumed_approval_not_live`, `expired_not_live`.
- **Validation** in `mcp-seal-dev/SealV2`: `parse_total` (ParserTheorems),
  `canonical_roundtrip` (SerializationTheorems), `signed_parse_canonical`
  (ValidationTheorems), `non_bypass` (DecideTheorems).
- **Host model** in `seal-host/Kernels` and `seal-host/Host`: consensus,
  linear / no-double-spend, budget, and non-interference (the gate reveals only
  the one authorized bit).

The theorem is a precise KERNEL claim. It is not a blanket claim about browsers,
Rust, wasm, operators, or toolchains.

## 2. What is deployed (the running host)

`seal-host` runs the **`compatible` mediation profile**. The deployed
`Ffi.stepImpl` path routes by `stepRoute`; the strict **`canonical-l0`** profile
exists at the proof layer (`Host/CanonicalL0.lean`) and is **not** the deployed
default. Under `compatible`, the v2 canonical parse is attached as *audit data*;
a non-canonical line is **not** rejected at the boundary on canonical grounds
alone.

## 3. Which profile is running

`compatible`. If you throw duplicate keys, non-canonical decimals, Unicode
escapes, or whitespace variants and they route, that is the documented
`compatible` profile, **not** a bypass of a strict-canonical claim.
(`stepRouteP .compatible = stepRoute` holds by `rfl`; `canonicalL0`
reject-on-parse-failure is proved separately.)

## 4. Which approval channel is in use

The host production channel signs an **`ApprovalRecord`** payload (Ed25519).
This is **separate** from the v2 canonical approval tuple
`(target, session, issuedAt, expiry, nonce)` proved in `mcp-seal-dev`. Both are
real signed channels; they are not the same object. Nonce replay isolation
applies to signed-token mode with a replay store; file and interactive demo
channels are freshness-scoped and process-local.

## 5. Which receipt schema is current

Current = **v1**, with a hard split between `kernel_identity` (kernel hash,
self-verified flag) and `asserted_provenance` (toolchain, axioms). The v1
validator rejects a `kernel_identity` that carries toolchain/axioms. The
`seal-live-demo` bundle still emits legacy **v0** (`seal_live_receipt: "v0"`), a
tolerated legacy dialect, not the current schema.

## 6. Which conformance corpus was run

The conformance corpus is **finite evidence, not a universal theorem**. Current
coverage is a small labelled set (destructive-disguise, passthrough,
approved-forward, plus kit traces). It does not yet exhaust the
wire / canonical / approval / record / receipt equivalence classes.

## 7. What remains TCB (trusted, not proved)

Rust host glue, wasm/JS mirror bodies, the Lean toolchain, the OS, the Ed25519
provider, and human operators. Collision resistance of the commitment hash is a
**named, scoped assumption (A-CR)**, not a Lean theorem. The proof guarantees
*ordering*; the out-of-band channel guarantees *origin*; origin is not proven.
MCP is assumed the **sole effect channel**. An unconfined shell bypasses the
gate by design scope. The audit chain is tamper-**evident**, not
tamper-**impossible**.

## 8. Exact commands to reproduce

- **Receipts / CLI evidence:** `cd seal-assurance-kit && npm test`
  (runs verify + fixture-drift + bypass + format + adequacy; leaves the tree untouched).
- **Host conformance bridge:** `cd seal-host && node scripts/conformance_bridge.mjs`.
- **Kernel + axioms:** build `mcp-seal-dev` with Lake and run the axiom gates
  (`lake exe axiom_check`, `lake exe v2_m4_axiom_check`, `lake exe v2_m6_axiom_check`)
  or `#print axioms` on the theorems in §1 to confirm the footprint.
- **Browser replay:** open a receipt in `seal-check` and check the emitted bytes.

Each repo README carries its own quickstart; this file is the map, not a
replacement.
