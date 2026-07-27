# Roadmap, kernel-outward

Set 2026-07-25 after Ben ruled: batch the comprehension field into the pending
`seal.effect/v2` bump, one domain-tag change rather than two.

Supersedes the ordering in `OPEN-FINDINGS.md`. That document remains the
inventory; this is the sequence.

## The organising decision

The comprehension check changes what the human SIGNS, not merely what they see.
Today's approval covers:

```lean
structure SignedMessage where
  target : Target        -- the digest, and nothing about the rendering
  session : SessionId
  issuedAt : UnixSeconds
  expiry : UnixSeconds
  nonce : Nonce
```

If the human is shown a rendering but signs only the digest, **their signature
does not cover what they saw**, and an attacker who influences the display shows
one thing while the signature attests to another. The rendering, or its digest,
must be inside the signed payload or the comprehension check is decoration next
to a signature.

That makes it a signed-shape change, which makes it a domain-tag bump, which
puts it under the repin razor. `feat/envelope-stageB-twin` is already carrying
the `seal.effect/v2` bump. **One bump covers both.**

Everything else is sequenced around that.

## Phase 0 — host-side, does not touch signed shape (in progress)

Can proceed in parallel with kernel design. None of it invalidates on a shape
change.

1. **`release-evidence` CI gate.** CI can currently pass while skipping the Lean
   build, axiom checks, host tests, conformance and the three-way differential.
   Until a missing secret turns CI red, every green below is unfalsifiable.
   **LANDED.** Verified 2026-07-27 11:44: `ci/release-evidence` (`f198642`) is an
   ancestor of `seal-host` main, which carries `scripts/release_evidence_gate.py`
   and the workflow wiring. **Phase 1 is therefore unblocked.**
2. **`differential.rs` and `parser_boundary.rs` 0/1 classify contract.** Both
   assert a two-outcome contract that the duplicate-key and digit guards
   superseded. Fix with negative controls, not relaxed assertions.
   **PARTLY LANDED.** Verified 2026-07-27: `differential.rs:279` and
   `host_path.rs:1254` assert `matches!(.., 1 | 2)`, an enumerated fail-closed
   set rather than a relaxed `assert_ne!`. `parser_boundary.rs` NOT verified;
   treat that half as open.
3. **Interior NUL test.** A claimed hardening property in `TCB.md` whose only
   corpus entry uses a JSON escape rather than a literal `0x00` byte. Found from
   outside, and small.
4. **`RepinStep2Guards` into a real lakefile target**, then ablate the NFD
   comparison to prove it goes red.
5. **Emscripten toolchain install.** Prerequisite for phase 2, not a task in its
   own right. Started 2026-07-25.

## Phase 1 — kernel, the batched shape change

Nothing here starts until phase 0 item 1 lands, because otherwise we cannot
tell whether the result is green or merely unmeasured.

6. **Design the rendering function `R`** and its three obligations: derivation
   from the same canonical parse the digest covers, AGREEMENT as a theorem (two
   requests rendering identically must digest identically), and totality.
7. **Escaping and truncation discipline**, with a negative control per hostile
   class: ANSI escapes, newlines, carriage returns, bidi overrides, homoglyphs,
   length. Truncation is a SECURITY parameter, because falling back to a digest
   above some size reintroduces collision-based ambiguity.
8. **Extend `SignedMessage`** so the human's signature covers the rendering.
   This is the batched bump: `seal.effect/v2` plus the comprehension field, one
   domain tag, per the razor.
9. **Prove agreement.** Not a test. If it is only achievable up to some stated
   equivalence, declare the equivalence rather than discover it later.
10. **Check type coercion** between the canonical parse and the rendering. If
    the parse coerces a type and the rendering shows the original, the human
    sees a different request from the one that executes. Qwen's finding,
    directly checkable.

## Phase 2 — host, outward from the kernel

11. **The printer.** Unverified Rust, and therefore trusted for consent. GLM and
    Qwen both showed that a correct kernel rendering does not save you from the
    process that prints it. **Add the display path to `TCB.md` as trusted.**
12. **Receipt records what was shown.** Ben's ruling. Turns the receipt from
    "an approval happened" into "this specific consent was obtained", and makes
    a disputed approval forensically answerable.
13. **Rebuild `seal.wasm` ONCE**, against the settled shape, and repin: artifact,
    `PINNED_WASM_SHA256`, and `PROVENANCE.txt` together. Deferred here
    deliberately; rebuilding before the shape settles means doing it twice.
14. **Harvest `feat/field-warrant`** (42 behind), which carries the expiry,
    issuedAt-freshness, policy-version and delegation gates the kernel proves
    and the host does not enforce.

## Phase 3 — consolidate

15. External oracles (Wycheproof, JSONTestSuite) into required CI.
16. Merge remaining branches, abandon `feat/v2.1-principal` (114 and 53 behind).
17. Monorepo into this repository per `REPO-TOPOLOGY.md`, from a green base.

## Known red, carried deliberately

`three_way_agreement` stays red until item 13. The pinned wasm predates the wire
guards, so native and the model refuse unsafe-number cases that the wasm passes
through. This is a dated, reasoned red with a scheduled close, not a mystery.

Recorded because a red with a known cause and a plan is acceptable, and a red
that everyone has stopped looking at is how this weekend started.
