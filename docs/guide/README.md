# The Seal operating guide

Seal puts one approval gate in front of one tool of one MCP server in one
project. When a healthy gate can show a fresh approval request for that tool,
you see exactly what would run, and the call waits for approval — once, and
only once. In a healthy, non-drifted wrapper, other tools keep working as if
Seal were not there; drift, missing state, or a server-start failure refuses
the server instead.

This guide is for using that gate day to day. It assumes you have seen a
`.mcp.json` before and can run commands in a terminal, and nothing more. Every
command shown here was actually run. Literal output blocks reproduce that run;
blocks marked with an ellipsis or explanatory text are excerpts. The outputs
were captured in a scratch project on 2026-08-15, so paths in them will differ
from yours.

## Before you start

- Linux x86-64 only. On anything else, `seal` refuses and changes nothing.
- Node 20 or newer.
- Claude Code installed (`claude --version` prints a version). `seal protect`
  needs it; `seal demo` and `seal status` do not.

Check the last one first:

```
$ claude --version
2.1.233 (Claude Code)
```

Download the `v0.2.0-rc.2` release artifact and run it
with the digest and byte length recorded in `SHA256SUMS`:

```
$ curl -fLO https://github.com/velvetmonkey/seal/releases/download/v0.2.0-rc.2/seal-v0.2.0-rc.2-linux-x64
$ chmod +x seal-v0.2.0-rc.2-linux-x64
$ ./seal-v0.2.0-rc.2-linux-x64 --sha256 e4932a1962f3066dd361db372d558634b9dcfd55937e1c5c3ac64cac300eee73 --bytes 6146222
installed seal 0.2.0-rc.2 linux-x64
store: /tmp/seal-demodir-prefix.Ju6uoy/lib/seal/store/06da1f27c0d1f0ddb935a23aedd41b1bbc85750e5f323d36abbcc43c67ec1d4f
command: /tmp/seal-demodir-prefix.Ju6uoy/bin/seal
tree 06da1f27c0d1f0ddb935a23aedd41b1bbc85750e5f323d36abbcc43c67ec1d4f
```

The installer refuses to run without the `--sha256` pin, on purpose: you are
telling it which bytes you meant to install. Make sure `~/.local/bin` is on
your `PATH`, then run `seal demo` once — it walks the whole approve-once,
replay-blocked story in about a minute, against a harmless built-in server,
and asks for nothing but a y/N.

One limit to know before you rely on receipt checking: `seal demo` generates a
temporary signing key for its run, while the protected Claude Code path creates
or reuses a machine-local signing key. A checker result is only as meaningful
as the source of the public key you supply; a key taken from the same machine
establishes self-consistency, not that the recorded decision happened.

For the CI demo receipt, [GitHub Actions provenance](github-actions-provenance.md)
lets a signed-in GitHub reader check the runner and workflow that produced a
published evidence archive. It does not establish the receipt is true.

## The path through this guide

Read these in order the first time; each one stands alone afterwards.

1. **[Choosing what to protect](choosing-what-to-protect.md)** — the judgement
   call: which tool earns the gate, what `seal protect` changes, and what it
   deliberately leaves alone.
2. **[What is protected right now](what-is-protected-right-now.md)** — asking
   the machine instead of remembering: `seal status` and `seal doctor`, every
   state they report, and what each one means.
3. **[Knowing it worked](knowing-it-worked.md)** — the approval prompt line by
   line, what a refusal means, and how to check a receipt afterwards.
4. **[When something looks wrong](when-something-looks-wrong.md)** — every
   refusal token Seal can print, what caused it, and what to do next.

One honest sentence to carry into all four pages: Seal is a gate, not a
sandbox. It controls the path through it — Claude Code calling that one tool
of that one server — and only that path. Bash, the network, subprocesses, and
every other tool and server are outside it, and the approval prompt says so
every time.
