# Public visibility checklist (completed 12 Aug 2026)

Historical checklist used before the Seal-family repositories became public. All nine
Seal-family repositories are public; `witness-check` is the single intentional private,
proprietary exception. The remaining unchecked items below are non-visibility follow-ups.

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

## Per-repo visibility results

- [x] **Which repos are public.** All nine Seal-family repositories are public.
  `witness-check` remains private and proprietary on purpose.
- [x] **Link disclaimers.** Family links resolve for everyone; no evaluator-only access
  disclaimer remains for a public family repository.
- [x] **mcp-seal / mcp-seal-dev naming.** Both the frozen `mcp-seal` repository and the live
  `mcp-seal-dev` repository are public. Current family documentation links `mcp-seal-dev`.
- [ ] **seal-verify-action Emscripten NOTICE gap** (flagged at its build): confirm
  `kernel/wasm/seal.js` Emscripten-generated glue attribution requirements are met in NOTICE.
- [ ] **claims-drift + truth-box final run** across all six guarded repos on the flip commit.
- [ ] **Leak sweep**: hostnames, home paths, session/tool logs
  (`grep -rE "/home/[a-z]+|\.juno_task" --exclude-dir={.git,node_modules,.lake}`) — the
  seal-check `.juno_task` incident is the precedent.

## Standing rule

Anything a doc pass finds that would expose sensitive identity or unpublished material gets
listed and flagged. Public repository status itself is not sensitive.
