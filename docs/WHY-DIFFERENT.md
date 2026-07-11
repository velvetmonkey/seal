# Why a proof, not a prompt: Seal vs heuristic guards

Most guardrails for agent tools work by judgment: an LLM judge, a prompt filter, a
pattern match on the request. Judgment is probabilistic — on the novel attack it has
never seen, it guesses. And when a heuristic guard guesses wrong it fails **open**: the
action goes through, and usually nothing is left behind to show that a guess was even
made.

Seal's kernel does not judge. It asks one checkable question — *does a live human
approval match this exact target?* — and the rule that an unapproved action is never
allowed is a machine-checked Lean 4 theorem (`default_deny_never_allowed`). Novelty
does not move it: an attack the kernel has never seen has no matching approval, so it
fails **closed**. Every decision, allow or block, leaves a tamper-evident receipt that
anyone can re-derive.

| | Heuristic guard | Seal |
|---|---|---|
| **Decision basis** | Model judgment / patterns | Machine-checked exact-target approval match |
| **Failure direction** | Fails open on the novel attack | Default-deny: fails closed (`default_deny_never_allowed`) |
| **Evidence left behind** | Logs, if any | Tamper-evident receipt, re-derivable by anyone |

What this does **not** mean — the boundary, stated up front: the theorems cover the
mediation kernel, not the whole deployed system. The shipped Rust/wasm/JS bodies are
tied to the proof by byte-exact conformance testing over a corpus, not proven bug-free,
and the runtime profile is `compatible` (strict `canonical-l0` is proved, not yet the
deployed route). Seal guarantees **authorization** match, not **intent** match: approve a
malicious-but-valid request and Seal executes it.

- The full honesty boundary: [What Seal is NOT](https://github.com/velvetmonkey/seal-assurance-kit/blob/main/docs/WHAT-SEAL-IS-NOT.md)
- Every load-bearing claim, statused: [CLAIMS-MATRIX.md](CLAIMS-MATRIX.md)
- See the difference run: [seal-live-demo](https://github.com/velvetmonkey/seal-live-demo) — the same destructive call, blocked with Seal on, executed with Seal bypassed
