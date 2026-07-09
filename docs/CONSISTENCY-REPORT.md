# Family consistency report — 2026-07-09 documentation + product-story sweep

Scope: every family repo's README + docs, checked for the family sentence, the full sibling
roster, the receipt-tool ladder, cross-link health, truth-box uniformity, and stale claims —
ahead of the 31-Jul public-flip window. Per repo: **found** (state before this sweep),
**fixed** (on that repo's `docs/family-story-sweep` branch, committed, not pushed), and
**FLAGGED** (needs Ben's call — deliberately not papered over).

Conventions checked: family sentence = "Seal is the approval gateway for agentic tool use…";
roster = the family table/list; ladder = the four-question receipt-tool table (verify /
sufficiency / diff / CI gate), canonical copy in the umbrella README.

## Verdict in one line

The family was internally consistent (truth-box byte-uniform ×5, zero dead links, zero stale
v0 claims) but **two shipped tools were invisible** (receipt-diff outside the kit,
seal-verify-action everywhere) and witness-check was a footnote. Fixed by roster/ladder/matrix
updates in 8 repos. Four genuine items flagged below.

## FLAGGED for Ben (real disagreements + exposure risks — not harmonised silently)

1. **The briefed ladder line "seal-verify-action → gate all of the above in CI" overclaims.**
   The action vendors and runs the `seal verify` closure only; witness-check and receipt-diff
   are local tools with no CI packaging today. Written honestly everywhere as "runs `seal
   verify` in GitHub Actions… (the sufficiency and diff checks are local tools today)". If
   "gate all of the above" is the intended roadmap, that's a build item, not a doc edit.
2. **Public-flip exposure in seal-verify-action** (the intended-public wrapper):
   (a) `NOTICE` carries the real name "Ben Cassie" where every other family repo uses the
   velvetmonkey pseudonym — flipping public links the two; (b) `VENDORED.md:12` and the stray
   working file `PR-DESCRIPTION.md` name `seal-assurance-kit`/`seal-check` as private and
   assert shared authorship. Recommend: decide the NOTICE identity question and delete
   PR-DESCRIPTION.md before any flip. Not changed in this sweep (identity is not my call).
3. **mcp-seal-dev does not use the family sentence** — it leads with "Seal is a proven
   checkpoint for AI agents." Possibly deliberate (kernel-repo audience). Left unchanged;
   confirm or harmonise. Its truth-box was also missing entirely (guard was claims-only);
   this sweep ADDS docs/TRUTH-BOX.md + README block + guard wiring, byte-identical to the
   family block — review that addition since it widens the repo's guarded claim surface.
4. **Naming drift, pre-existing, unresolved:** the frozen public mirror is `mcp-seal` while
   the family roster links `mcp-seal-dev`; the mirror retirement / rename has NOT happened.
   All docs in this sweep continue to link `mcp-seal-dev` (current reality). Also latent:
   the CLI verb is `seal adequacy` while the family concept is "sufficiency" — consistent in
   docs but a naming split worth settling before public.

## Per-repo findings

### seal (umbrella — canonical)
- Found: family sentence leads (README:5) ✓; roster = 5 repos, missing witness-check +
  seal-verify-action; no ladder; CLAIMS-MATRIX had the sufficiency row (anonymous "private
  tooling") but no receipt-diff / action rows; ARCHITECTURE map had no drift or CI-gate box;
  EVALUATOR-START §8 lacked receipt-diff; index.html roster = 5. Truth-box canonical ✓,
  claims-drift + linkcheck green ✓, no dead links ✓.
- Fixed: roster +2 rows; canonical ladder table added ("The receipt toolset — one question
  each"); matrix +2 Tested rows (receipt-diff suite; action vendored/pinned/selftested) and
  sufficiency row now names `witness-check`; ARCHITECTURE +2 boxes (Drift, CI gate) with
  honest "packaging, not new verification logic" note; EVALUATOR-START §8 updated;
  index.html +2 entries. Guards green.

### seal-host
- Found: roster = 6, missing the 3 tools; family sentence present but not leading (README:16,
  after role line + truth-box — placement inconsistency, cosmetic); truth-box + guard ✓;
  legacy v0-live mentions all intentional (schema doc); no dead links.
- Fixed: roster +2 (witness-check, seal-verify-action). Sentence placement left as-is (role
  line first is arguably right for a spoke; flag only if uniformity is wanted).

### seal-check
- Found: family sentence ✓ (README:16); roster = 6, missing 3 tools; no ladder; truth-box
  byte-identical ✓; v0-live references in DECISION-RECEIPT-SCHEMA.md are the normative
  grandfathering, not staleness.
- Fixed: roster +2.

### seal-assurance-kit
- Found: family sentence ✓; roster = 6, missing 3 tools; HAS the only ladder-like table
  (3 rows, wording drifted from the canonical framing); DEPLOYMENT.md never mentions
  `seal receipt-diff` (coverage gap); CLAIMS.md names witness-check (internal note) ✓;
  WHAT-SEAL-IS-NOT needs no change (nothing stale).
- Fixed: roster +2; ladder table harmonised to the canonical 4-row form (adds the CI-gate
  row, names witness-check); DEPLOYMENT.md gains a receipt-diff step and a CI-gate note.

### seal-live-demo
- Found: family sentence ✓ (not leading, same as seal-host); roster = 6, missing 3 tools; no
  mention that receipts can be gated in CI; truth-box ✓ (self-refer note in guard header ✓).
- Fixed: roster +2; one line in "Verify in five minutes" pointing at seal-verify-action for
  CI re-verification.

### mcp-seal-dev
- Found: roster = 6, missing 3 tools; NO truth-box (guard claims-only — the sweep brief
  assumed all three guarded repos carry it; reality disagreed); family sentence absent
  (flagged, item 3); no receipt-schema claims at all so nothing v2-stale.
- Fixed: roster +2; truth-box added (docs/TRUTH-BOX.md + README block, byte-identical to the
  family block) and scripts/claims-drift.mjs extended to guard it. Flagged for review.

### witness-check (private/proprietary)
- Found: "Part of the Seal family" section lists 4 repos; no receipt-diff / action / umbrella
  mention; license proprietary ✓; worked example still accurate vs the v0→v2 schema story ✓.
- Fixed: family section gains the umbrella + the ladder (its own row marked "this tool").

### seal-verify-action
- Found: standalone framing, no family sentence, no ladder; honest-scope section already
  cites witness-check correctly; receipt-diff absent; vendored pin + hash guard ✓; exposure
  risks flagged (item 2).
- Fixed: ladder added under the honest-scope section (its own row marked "this action");
  receipt-diff named alongside witness-check in the not-checks list's family pointer.
  NOTICE / PR-DESCRIPTION.md deliberately untouched (item 2).

### Demos / mirrors (mcp-seal, seal-demo, seal-backchannel-demo, canary) — audit only
- Zero stale refs across all four (grep: "still emits", v0 receipt, seal_live_receipt,
  witness-check, receipt-diff, seal-verify-action, "proven checkpoint": one intentional
  family-sentence hit in canary README:36, correctly scoped, no private repo names). mcp-seal
  public "Related repositories" lists only public repos ✓ — clean as a public mirror.
  **No edits made.**

## Gates after this sweep

claims-drift green in seal, seal-host, seal-check, seal-assurance-kit, seal-live-demo,
mcp-seal-dev (now incl. its new truth-box); truth-box byte-identical across all six carriers;
umbrella linkcheck green; kit npm test green (tree untouched); no tracked non-doc file
changed in any repo (per-repo diff audits in the branch commits).
