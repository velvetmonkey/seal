<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

Seal is a proxy that intercepts one MCP tool call, asks you to approve it, and refuses to replay it without a new approval.

Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.

Requires Node 20+ and the `claude` command for Protect. The install creates one command and one read-only store directory under `~/.local`.

Check that the Claude Code command is available before Protect:

```bash
$ claude --version
```

## How it works

1. **Protect once.** `seal protect` reads and hashes the server entry in `.mcp.json`, then asks Claude Code to install a local override. Seal does not edit `.mcp.json` or `~/.claude.json`, and later server-entry drift refuses instead of forwarding.
2. **Approve per call.** Seal shows the exact guarded call. The pinned authorization kernel (vendored WASM) answer is required before forwarding, and one-use consumption means the call will not run twice. Other tools on the protected server are not approval-gated, but still pass through Seal's forwarding checks.
3. **Keep the receipt.** Seal writes a signed receipt for every guarded decision. Keep it with a public key obtained from a source you trust, then use the separately published checker or seal-check with the limits stated below.

[![Seal process diagram: one exact tool call is approval-gated; other tools on the protected server pass through Seal without approval](assets/seal-flow.svg)](https://raw.githubusercontent.com/velvetmonkey/seal/main/assets/seal-flow.svg)

## 1. Install

Install Seal on Linux x86-64 only with a shell and `curl`. Download the binary and the `SHA256SUMS` asset attached to the same release, check them with your own `sha256sum`, then run the installer with that pin. The [full SHA256SUMS verification](docs/install.md) is the copy-paste wall; the short form below is the same install.

```bash
$ SEAL_VERSION=v0.2.0-rc.2
$ curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
$ curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"
$ read -r expected_digest expected_bytes expected_name < SHA256SUMS
$ chmod +x "$expected_name"
$ ./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```

You should see this output; `installed seal 0.2.0-rc.2 linux-x64` means done:

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.2.0-rc.2 linux-x64
store: /home/monkey/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
command: /home/monkey/.local/bin/seal
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
```

The `store:` and `command:` paths above include the machine that ran this example; those path prefixes differ on your machine, while the other text must match.

Add `~/.local/bin` to PATH before continuing:

```bash
$ export PATH="$HOME/.local/bin:$PATH"
```

At the exact release tag, your build writes `seal-v0.2.0-rc.2-linux-x64` in your own `dist/` directory; this is a separate source-build path, not the release-download path above.

Read this filename only if you build from source:

```text
seal-v0.2.0-rc.2-linux-x64
```

The repository root does not carry a hand-maintained `SHA256SUMS` copy. Use the `SHA256SUMS` asset attached to the same release.

## 2. Demo

```bash
$ seal demo
```

Leave it running until `Approve? [y/N]`, then type `y` and press Enter. Expected sequence, not a captured transcript:

```text
child calls observed: 0
approval shown; child calls observed: still 0
approve with y; child calls observed: 1
replay refused; child calls observed: still 1
DIRECT WRITE SUCCEEDED; Seal decisions emitted: 0
```

The demo directory remains after the walk so you can check a receipt. The checker is not inside the installed store; download `seal-receipt-check.mjs` from the same release and follow [the evaluator walk](docs/evaluator-walk.md).

## 3. Protect

`seal protect SERVER TOOL` needs the `claude` command and a project whose `.mcp.json` has a stdio MCP server. Before recording protection, Seal starts the server, lists its tools, and refuses unless the requested tool is among them.

```bash
$ export SEAL_PROTECT_PROJECT="$PWD/seal-protect-demo"
$ mkdir -p "$SEAL_PROTECT_PROJECT" &&
$ cd "$SEAL_PROTECT_PROJECT" &&
$ {
$ cat > .mcp.json <<EOF
$ {
$   "mcpServers": {
$     "db": {
$       "command": "seal",
$       "args": [
$         "__demo-server",
$         "./data.txt"
$       ]
$     }
$   }
$ }
$ EOF
$ } &&
$ seal protect db demo.mutate
```

`protect` reports how many of that server's tools are not approval-gated, naming at most 20 and counting the rest. Those calls still route through Seal's proxy, where live server-entry drift or a lease-generation mismatch can refuse forwarding. It then invokes Claude Code's `claude mcp add` to install a local override, private to you, routing the `db` server through Seal's proxy. It does not edit `.mcp.json`. Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/` while it installs that override. Seal invokes Claude Code but does not write either file. The override takes effect when Claude Code next starts, so `protect` ends PENDING RESTART, never ACTIVE.

The protected proxy records every decision as a signed receipt file. On first activation it creates a machine-local Ed25519 receipt key under the Seal data directory, prints the public key and its file path, and reuses that key on later activations.

Then, in that project:

```bash
$ seal status
```

## 4. Remove

Run these commands to return the project to outside Seal:

```bash
$ cd "$SEAL_PROTECT_PROJECT"
$ seal unprotect db
```

`unprotect` invokes Claude Code's `claude mcp remove` to remove only the local override. It does not delete Claude Code's `~/.claude.json` or backups under `~/.claude/backups/`; those files remain.

The store is read-only, so make it writable before removing Seal itself:

```bash
$ chmod u+w ~/.local/bin/seal && rm ~/.local/bin/seal
$ chmod -R u+w ~/.local/lib/seal && rm -r ~/.local/lib/seal
```

The demo's temporary directory remains after the walk. After running the checker, use these commands to remove the retained state and the exact demo directory printed for your run:

```bash
$ rm -r ~/.local/share/seal
$ rm -r "$SEAL_DEMO_DIR"
```

In the demo, Seal controlled only `demo client -> Seal -> demo MCP server -> demo.mutate`.

## How the gate decides

The demo and the protected path run the same proxy and rule. The state machine is TESTED. On a guarded retry, Node owns handle lookup, freshness, protocol shape, and durable one-use consumption. The exact-call authorization rule runs through the pinned vendored WASM, and its answer is required before forwarding. Kernel failure or a Node/kernel disagreement refuses — there is no JavaScript authorization fallback. The kernel configuration is currently signed by an Ed25519 key generated inside the same worker that submits it. That is demo-grade self-authorization, not an externally trusted production config key.

## What Seal covers, and what it does not

Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

- Seal is a gate, not a sandbox. It controls the path through it, and only that path. Protect mediates only a stdio MCP server entry; other MCP transport shapes are outside the protected path. Bash, network, subprocesses, other servers, and a direct local write are outside Seal. Other tools on the protected server are not approval-gated, but pass through Seal's forwarding checks.
- One approval covers the displayed call only. Seal will not run it twice, and a failure before forwarding can spend the approval without running it at all. Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal executes it. Seal binds a client's retry to the displayed request. It cannot establish that a human, rather than the client or an automatic elicitation hook, supplied the approval. Approval expiry follows the local wall clock; Seal provides no trusted-time guarantee.
- Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. Checking a signed receipt is only as good as the key you check against. A key stored next to the receipt establishes self-consistency only. The optional verification path fetches a separately pinned runtime from GitHub. That is demo-grade key custody, not an externally trusted production key; a production-grade path would verify against a key you obtained from a source you already trust.
- Protect delegates its local override to Claude Code, whose configuration and backups remain after Unprotect.
- The installed command sits in a user-writable prefix. Another process running as that user can replace the entry point before the next run. The packaged store is read-only and integrity-checked; the entry point is not. Seal v0.2.0-rc.2 is Linux x86-64 only.

## Links

- [Operating guide](docs/guide/README.md)
- [Assurance / release notes](docs/RELEASE-NOTES-v0.2.0-rc.2.md)
- [Limitations](docs/LIMITATIONS.md)
- [Evaluator walk](docs/evaluator-walk.md)
- [Full documentation index](docs/README.md)
- [Install verification](docs/install.md)

<!-- live-page-claims:begin -->
[Paste a receipt into seal-check](https://velvetmonkey.github.io/seal-check/): it re-checks the decision receipt in your browser. The landing page has **zero `<button>` controls**. The page states that it has no backend, accounts, or telemetry, and that nothing you paste leaves the page. It does not establish that your setup routes calls through Seal, and it is not the shipped checker command above.
<!-- live-page-claims:end -->

## License

Apache-2.0. See [LICENSE](LICENSE).

### Repository transcript instrumentation (not a walkthrough step)

The repository's reproducibility check runs the demo through this harness to capture its output and recover its generated directory. Readers following the steps above do not run it.

```bash
$ export SEAL_DEMO_LOG="$(mktemp "${TMPDIR:-/tmp}/seal-demo-log.XXXXXX")"
$ (set -o pipefail; seal demo </dev/tty | tee "$SEAL_DEMO_LOG")
$ SEAL_DEMO_STATUS="$?"
$ if test "$SEAL_DEMO_STATUS" -ne 0; then
$   echo "README walk stopped: seal demo failed (exit $SEAL_DEMO_STATUS)" >&2
$   exit "$SEAL_DEMO_STATUS"
$ fi
$ export SEAL_DEMO_DIR="$(sed -n 's/^temporary demo directory: \(.*\) (remains after the demo for the printed checker command)$/\1/p' "$SEAL_DEMO_LOG")"
$ if test -z "$SEAL_DEMO_DIR"; then
$   echo "README walk stopped: seal demo printed no temporary demo directory" >&2
$   exit 1
$ fi
```
