# Public-flip checklist (gated: 31 Jul / ARIA verdict)

What must be decided or scrubbed before ANY Seal-family repo goes public. Durable list —
add items as they surface; strike them only when actually done in the repo concerned.
Nothing here happens automatically at the flip: each line is an explicit pre-flip action.

## Identity decisions (Ben only — no doc pass may act on these)

- [ ] **seal-verify-action `NOTICE` carries the real name "Ben Cassie"** (twice), while every
  other family repo attributes to the "velvetmonkey" pseudonym. Flipping that repo public
  links the two. Decide: re-attribute the NOTICE, or accept the linkage. File deliberately
  left untouched by doc sweeps.
- [ ] Confirm no other file family-wide carries the real name (sweep before flip:
  `grep -ri "cassie" --exclude-dir={.git,node_modules,.lake}` across all repos).

## Scrubs done (verify they hold at flip time)

- [x] seal-verify-action `VENDORED.md` no longer asserts the upstream kit is "private during
  build phase" (pin retained — it is the vendoring provenance and resolves post-flip).
  Scrubbed 2026-07-09, docs/family-story-sweep branch.
- [x] seal-verify-action `PR-DESCRIPTION.md` no longer asserts "family repos are private" or
  shared authorship across seal-check / kit / kernel. Scrubbed 2026-07-09. Consider deleting
  the file entirely at flip time — it is a working PR draft, not user documentation.

## Per-repo pre-flip actions

- [ ] **Which repos flip, which stay private.** witness-check is proprietary and expected to
  STAY private; every public README that names it must survive that (current wording marks it
  "private/proprietary" — verify at flip that this is still the decision).
- [ ] **Private-link disclaimers.** Family READMEs say links "resolve only for authorised
  evaluators". After a partial flip this sentence is half-wrong per repo — re-scope it to
  whichever repos remain private.
- [ ] **mcp-seal / mcp-seal-dev naming.** The frozen public mirror is `mcp-seal`; the live
  private repo is `mcp-seal-dev`; all family docs link `-dev`. The retirement/rename has NOT
  happened. Decide the end-state name before flip and update rosters in one pass.
- [ ] **seal-verify-action Emscripten NOTICE gap** (flagged at its build): confirm
  `kernel/wasm/seal.js` Emscripten-generated glue attribution requirements are met in NOTICE.
- [ ] **claims-drift + truth-box final run** across all six guarded repos on the flip commit.
- [ ] **Leak sweep**: hostnames, home paths, session/tool logs
  (`grep -rE "/home/[a-z]+|\.juno_task" --exclude-dir={.git,node_modules,.lake}`) — the
  seal-check `.juno_task` incident is the precedent.

## Standing rule

Anything a doc pass finds that would prematurely expose identity, private-repo status, or
unpublished material gets LISTED here and flagged — not silently fixed, not silently shipped.
