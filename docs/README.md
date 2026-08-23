# Seal documentation

## Contents

- [Start here](#start-here)
- [Operate day to day](#operate-day-to-day)
- [Look up exact behavior](#look-up-exact-behavior)
- [Audit the evidence](#audit-the-evidence)
- [Understand the repository-maintenance files](#understand-the-repository-maintenance-files)

[![Seal process diagram](seal-flow.svg)](https://raw.githubusercontent.com/velvetmonkey/seal/main/docs/seal-flow.svg)

The landing page links to the routes below.

Need to interpret a refusal? Start with [the refusal-code guide](guide/when-something-looks-wrong.md); use it to find the named token and its next step.

## Start here

- [How do I install?](start/install.md) — How do I verify the release bytes, install them fail-closed, or build and install this checkout?
- [Walk a source-build receipt](start/evaluator-walk.md) — How do I inspect and tamper-check a demo receipt when the checker is outside the source-built installed store?

## Operate day to day

- [Choose your route through the operating guide](guide/README.md) — What should I read, in what order, before operating the gate for the first time?
- [Choose what to protect](guide/choosing-what-to-protect.md) — Which tools warrant approval, and what will protection change or deliberately leave alone?
- [How do I read the current state?](guide/what-is-protected-right-now.md) — Which status, runtime, receipt, and doctor lines should I interpret after a guarded call?
- [Know whether the gate worked](guide/knowing-it-worked.md) — What should I observe in the prompt, demo, refusals, and signed receipts after a guarded call?
- [Recover when something looks wrong](guide/when-something-looks-wrong.md) — What caused a named refusal token, and what is the safe next action?
- [Which GitHub run made the archive?](guide/github-actions-provenance.md) — Which GitHub-hosted run and workflow produced the downloadable demo-receipt archive, and what can that evidence establish?

## Look up exact behavior

- [Multi-tool protection semantics](reference/multi-tool-semantics.md) — Is protection additive or a declared set, how is shared state displayed, and which multi-tool states are actually exercised?

## Audit the evidence

- [Evidence map](assurance/README.md) — Where do the shipped CLI documents end, and where do the wider family and historical records begin?
- [Release evidence](assurance/RELEASE-NOTES-v0.2.0-rc.2.md) — Which material is in v0.2.0-rc.2 or outside it, and which evidence supports each release statement?
- [Architecture](assurance/architecture.md) — Which decisions stay in Node, which exact-call question reaches the pinned WASM, and how the shipped path differs from the wider family?
- [Claude Code evidence](assurance/claude-code-evidence.md) — What real-client integration gap remains, and what instrumented acceptance pack would close it without overstating the result?
- [Distribution](assurance/distribution.md) — What exactly is installed, pinned, re-hashed, platform-limited, and included or excluded from the release payload?
- [Evaluator truth surface](assurance/evaluator-start.md) — Which family-level facts have evidence, reproduction, shipment, stale status, or open status at the dated audit?
- [What is shipped, and where are the boundaries?](assurance/index.html)
- [Installed-tree pin manifest control](assurance/installed-tree-pin-control.md) — Which human review must accompany changes to the hand-maintained inventory of quoted installed-tree hashes?
- [Link-check population limits](assurance/linkcheck-population-control.md) — Which failures can the separate-source link-population cross-check catch, and which shared blind spots remain?
- [Version identity](assurance/version-identity.md) — How does an arbitrary development build avoid wearing an immutable release name, and where is that identity carried?
- [Draft policy-language specification](assurance/POLICY-LANGUAGE.md) — What finite box-based policy language and analyzer were proposed, including their explicit trust boundaries and unresolved work?

## Understand the repository-maintenance files

- [`PROTECTED-PATH-RULINGS.json`](PROTECTED-PATH-RULINGS.json) — Which exact historical blobs record the human ruling for protected installed-tree pin paths? Product users can ignore this maintenance record.
- [`check-fenced-languages.mjs`](check-fenced-languages.mjs) — How does the docs guard reject unlabeled or role-confused Markdown code fences? Readers can ignore it; documentation contributors and CI use it.
