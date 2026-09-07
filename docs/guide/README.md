# The Seal operating guide

Seal puts one approval gate in front of a named set of tools on one MCP server in one
project. When a healthy gate can show a fresh approval request for that tool,
you see exactly what would run, and the call waits for approval — once, and
only once. In a healthy, non-drifted wrapper, other tools keep working as if
Seal were not there; drift, missing state, or a server-start failure refuses
the server instead.

This guide is for using that gate day to day. It assumes you have seen a
`.mcp.json` before and can run commands in a terminal, and nothing more. The
install command was updated to chain verification before execution. Other
commands shown here were actually run. Literal output blocks reproduce that run;
blocks marked with an ellipsis or explanatory text are excerpts. The outputs
were captured in a scratch project on 2026-08-15, so paths in them will differ
from yours.

## How examples are labeled

- `bash` is a command the reader runs (the install command also uses POSIX syntax).
- `console` is input the reader types at a prompt.
- `output` is text the product prints.

Each command, input, and product output has its own fence, and these three
role labels are used consistently. Other fences retain their language because
they show specifications or data rather than something to run, type, or read
as product output.

## Before you start

- Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64. Windows, Linux ARM and other platforms are unsupported.
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

Download and independently verify the pinned Linux x86-64 release, then install. Fetch the release's `SHA256SUMS` asset from the same release.
Copy the whole POSIX command, including the backslashes and `&&` operators.
For other supported platforms, see the [install guide](../start/install.md):

```bash
SEAL_VERSION=v0.2.1
artifact_name="seal-v0.2.1-linux-x64" \
&& artifact_sha256="4063ea160b1e8cea8f0ca0c87453484a7827bf0cbfb9ac1179888814e490b9dd" \
&& artifact_bytes=6214316 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="79054c0c63d1c70ca5b1e9d0c1d5670a947f49d7abeded441ad742b392ee19c0" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& expected_record="$(awk -v name="$artifact_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$expected_record" = "$artifact_sha256 $artifact_bytes $artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name")"; else actual_digest="$(sha256sum "$artifact_name")"; fi \
&& test "${actual_digest%% *}" = "$artifact_sha256" \
&& actual_bytes="$(wc -c < "$artifact_name")" \
&& test "$actual_bytes" -eq "$artifact_bytes" \
&& chmod +x "$artifact_name" \
&& ./"$artifact_name" --sha256 "$artifact_sha256" --bytes "$artifact_bytes" --prefix ~/.local
```

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.2.1 linux-x64
store: /home/you/.local/lib/seal/store/13e2b2a8b1e6301b2e3562e3bf6bcee78da8cb9302e12a41a1261ae08fef9f72
command: /home/you/.local/bin/seal
tree: 13e2b2a8b1e6301b2e3562e3bf6bcee78da8cb9302e12a41a1261ae08fef9f72
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
every other tool and server are outside it. In the recorded Claude Code
2.1.251 dialog, the client folds the message-body line that states this
boundary; the fold does not bring those other paths inside Seal.

Previous: [Evaluator walk](../start/evaluator-walk.md).
Up: [Documentation map](../README.md).
Next: [Choosing what to protect](choosing-what-to-protect.md).
