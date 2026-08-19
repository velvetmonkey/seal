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

## How examples are labeled

- `bash` is a command the reader runs.
- `console` is input the reader types at a prompt.
- `output` is text the product prints.

Each command, input, and product output has its own fence, and these three
role labels are used consistently. Other fences retain their language because
they show specifications or data rather than something to run, type, or read
as product output.

## Before you start

- Linux x86-64 only. On anything else, `seal` refuses and changes nothing.
- Node 20 or newer.
- Claude Code installed (`claude --version` prints a version). `seal protect`
  needs it; `seal demo` and `seal status` do not.

Check the last one first:

```bash
$ claude --version
```

```output
2.1.233 (Claude Code)
```

Download a binary and the `SHA256SUMS` asset attached to the same release,
then run the binary with that asset's digest and byte length:

```bash
$ read -r SEAL_SHA256 SEAL_BYTES SEAL_ARTIFACT < SHA256SUMS
$ chmod +x "$SEAL_ARTIFACT"
$ "./$SEAL_ARTIFACT" --sha256 "$SEAL_SHA256" --bytes "$SEAL_BYTES"
```

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.2.0-rc.2 linux-x64
store: /home/you/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
command: /home/you/.local/bin/seal
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
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
