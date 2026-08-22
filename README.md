<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

Seal is a proxy that intercepts one MCP tool call, asks you to approve it, and refuses to replay it without a new approval.

Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.

A build from this checkout is a separate, source-build path; its differences are called out where they matter.

Requires Node 20+ and the `claude` command for Protect. The install creates one command and one read-only store directory under `~/.local`.

**Seal source builds support Linux x86-64 and macOS x64/arm64. The immutable v0.2.0-rc.2 release asset remains Linux x86-64; Windows and Linux ARM are unsupported.**

Check that the Claude Code command is available before Protect:

```bash
claude --version
```

## How it works

1. **Protect once.** `seal protect` reads and hashes the server entry in `.mcp.json`, then asks Claude Code to install a local override. Seal does not edit `.mcp.json` or `~/.claude.json`, and later server-entry drift refuses instead of forwarding.
2. **Approve per call.** Seal shows the exact guarded call. Its authorization kernel is a small decision program bundled as WebAssembly (WASM); Seal pins its bytes and requires its answer before forwarding. One-use consumption means the call will not run twice. Other tools on the protected server are not approval-gated, but still pass through Seal's forwarding checks.
3. **Keep the receipt.** Seal writes a signed receipt for every guarded decision. Keep it with a public key obtained from a source you trust, then use the checker or seal-check with the limits stated below.

[![Seal process diagram: one exact tool call is approval-gated; other tools on the protected server pass through Seal without approval](assets/seal-flow.svg)](https://raw.githubusercontent.com/velvetmonkey/seal/main/assets/seal-flow.svg)

## 1. Install

Install the published Linux x86-64 release with a shell and `curl`. Download the binary and the `SHA256SUMS` asset attached to the same release, check the binary with your OS SHA-256 tool, then run the installer with that pin. For the longer verification procedure, see [full SHA256SUMS verification](docs/start/install.md).

These commands fetch both files from the same release page. Their digest and byte-count checks establish transfer integrity, not provenance: a replaced release page could supply matching replacements. For provenance, compare the expected digest and byte count with release information you obtained through a separate channel before executing the binary.

```bash
SEAL_VERSION=v0.2.0-rc.2
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"
read -r expected_digest expected_bytes expected_name < SHA256SUMS
if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$expected_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "$expected_name" | awk '{print $1}')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi
test "$actual_digest" = "$expected_digest"
actual_bytes="$(wc -c < "$expected_name")"
test "$actual_bytes" = "$expected_bytes"
chmod +x "$expected_name"
./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```

You should see this output; `installed seal 0.2.0-rc.2 linux-x64` means done:

<!-- Seal installed-tree pin role: published-asset -->
```output
installed seal 0.2.0-rc.2 linux-x64
store: /home/monkey/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
command: /home/monkey/.local/bin/seal
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
```

The `store:` and `command:` paths above include the machine that ran this example; those path prefixes differ on your machine, while the other text must match.

Matching a tree digest identifies payload bytes, not their provenance: a local build of the same payload has the same tree digest.
Running a checker copied from the same installed store cannot establish that the store itself was not replaced.

Add `~/.local/bin` to PATH before continuing:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Source-build path (secondary)

At the exact release tag, your build writes `seal-v0.2.0-rc.2-linux-x64` in your own `dist/` directory; this is a separate source-build path, not the release-download path above. A build of this checkout excludes `checker/seal-receipt-check.mjs` from its payload; its installed-tree digest is the `fresh-build` pin in [install.md](docs/start/install.md).

Read this filename only if you build from source:

```text
seal-v0.2.0-rc.2-linux-x64
```

The repository root does not carry a hand-maintained `SHA256SUMS` copy. Use the `SHA256SUMS` asset attached to the same release.

## 2. Demo

```bash
seal demo
```

Leave it running until `Approve? [y/N]`, then type `y` and press Enter. This is the expected sequence, not a captured transcript: the first four lines show the protected path; the final line is the deliberately unprotected direct-write scope witness after it.

**Output:**

```text
seal demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt
demo directory: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2 (remains after the demo for the printed checker command)
child calls observed: 0 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

**Output:**

```text
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    Approval required
    Tool: demo.mutate
    Arguments:
      line: "seal demo wrote this line"
    Scope: this parsed call (key order and 1/1.0 match); at most one run; 2 min.
    Outside Seal: Bash, network, subprocesses, other tools and servers.
child calls observed: still 0 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count) — approval shown, nothing executed
```

**Output:**

```text
Approve? [y/N] y
child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

**Output:**

```text
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452628-3115472-0001-INPUT_REQUIRED.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452631-3115472-0002-ALLOW.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json
```

**Output:**

```text

SCOPE WITNESS

Seal controlled this path:
  demo client -> Seal -> demo MCP server -> demo.mutate

If a route to the same effect does not pass through the printed Seal path, Seal did not control it.
```

<!-- Seal installed-tree pin role: published-asset -->
**Output:**

<!-- Seal installed-tree pin role: published-asset -->
```text
Now the demo performs a harmless direct local write
that does not cross the Seal gate.

DIRECT WRITE SUCCEEDED
Seal decisions emitted: 0 (receipts in /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts: 3 before the write, 3 after)
```

**Output:**

<!-- Seal installed-tree pin role: published-asset -->
```text
Seal is a gate, not a sandbox: it controls the path through it, and only that path.
summary: approval matched the effect, one child call observed, replay refused; 3 receipts written; one write happened outside Seal.
receipts are claims, not proofs. Check one with the separate-process checker (V11-RECEIPT-01). It imports no Seal module at check time, but carries a byte-identical copy of Seal's canonicalisation rule and uses the same Node crypto platform. It can detect a changed canonical parsed value against your trusted key; semantically irrelevant JSON formatting differences are not distinguished. It cannot detect a defect shared by that rule or platform. It ships in this same artifact, so it also cannot protect against a replaced artifact:
  node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3/checker/seal-receipt-check.mjs" "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json" --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
  Online: https://velvetmonkey.github.io/seal-check/ re-checks a decision receipt you paste in your browser and reports its receipt checks; no backend, accounts, or telemetry. It does not establish that this setup routes calls through Seal, and it is not the checker command above.
```

**Output:**

```text
ACCEPT BLOCK demo.mutate — decision, tool, arguments and signature all match the sealed commitments. This shows the receipt has the same canonical parsed value that this key signed. Semantically irrelevant JSON formatting differences are not distinguished. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story.
```

**Output:**

```text
REFUSE decision_binding_mismatch: receipt line 4, field decision: recorded value "ALLOW" does not match its sealed commitment (committed value withheld)
```

The demo directory remains after the walk so you can check a receipt.

If you took the secondary source-build path, its store does not include the checker; use `checker/seal-receipt-check.mjs` from that checkout.

## 3. Protect

`seal protect SERVER TOOL` needs the `claude` command and a project whose `.mcp.json` has a stdio MCP server. Before recording protection, Seal starts the server, lists its tools, and refuses unless the requested tool is among them. Discovery allows 5000ms per phase; if a server needs longer, the refusal names `--timeout-ms`, which also governs the activation re-check.

```bash
export SEAL_PROTECT_PROJECT="$PWD/seal-protect-demo"
mkdir -p "$SEAL_PROTECT_PROJECT" &&
cd "$SEAL_PROTECT_PROJECT" &&
{
cat > .mcp.json <<EOF
{
  "mcpServers": {
    "db": {
      "command": "seal",
      "args": [
        "__demo-server",
        "./data.txt"
      ]
    }
  }
}
EOF
} &&
seal protect db demo.mutate
```

`protect` reports how many of that server's tools are not approval-gated, naming at most 20 and counting the rest. Those calls still route through Seal's proxy, where live server-entry drift or a lease-generation mismatch can refuse forwarding. It then invokes Claude Code's `claude mcp add` to install a local override, private to you, routing the `db` server through Seal's proxy. It does not edit `.mcp.json`. Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/` while it installs that override. Seal invokes Claude Code but does not write either file. The override takes effect when Claude Code next starts, so `protect` ends PENDING RESTART, never ACTIVE. At activation Seal repeats the discovery; a vanished tool makes the stored state BROKEN instead of silently forwarding around a stale name.

The protected proxy records every decision as a signed receipt file. On first activation it creates a machine-local Ed25519 receipt key under the Seal data directory, prints the public key and its file path, and reuses that key on later activations.

The checker accepts a receipt only against the public key you supply and only when the decision, tool, arguments and signature match the sealed commitments. Semantically irrelevant JSON formatting differences are not distinguished. It cannot detect a defect shared by that rule or platform. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story. The checker never reads the key from the receipt; obtain the verifying key from a source you trust.

Then, in that project:

```bash
seal status
```

## 4. Remove

Run these commands to return the project to outside Seal:

```bash
cd "$SEAL_PROTECT_PROJECT"
seal unprotect db
```

`unprotect` invokes Claude Code's `claude mcp remove` to remove only the local override. It does not delete Claude Code's `~/.claude.json` or backups under `~/.claude/backups/`; those files remain.

The store is read-only, so make it writable before removing Seal itself:

```bash
chmod u+w ~/.local/bin/seal && rm ~/.local/bin/seal
chmod -R u+w ~/.local/lib/seal && rm -r ~/.local/lib/seal
```

The demo's temporary directory remains after the walk. After running the checker, use these commands to remove the retained state and the exact demo directory printed for your run:

```bash
rm -r ~/.local/share/seal
rm -r "$SEAL_DEMO_DIR"
```

In the demo, Seal controlled only `demo client -> Seal -> demo MCP server -> demo.mutate`.

## How the gate decides

The demo and the protected path run the same proxy and rule. The state machine is TESTED. On a guarded retry, Node owns handle lookup, freshness, protocol shape, and durable one-use consumption. The exact-call authorization rule runs through the pinned vendored WASM, and its answer is required before forwarding. Kernel failure or a Node/kernel disagreement refuses — there is no JavaScript authorization fallback. The kernel configuration is currently signed by an Ed25519 key generated inside the same worker that submits it. That is demo-grade self-authorization, not an externally trusted production config key.

## What Seal covers, and what it does not

Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

- Seal is a gate, not a sandbox. It controls the path through it, and only that path. Protect mediates only a stdio MCP server entry; other MCP transport shapes are outside the protected path. Bash, network, subprocesses, other servers, and a direct local write are outside Seal. Other tools on the protected server are not approval-gated, but pass through Seal's forwarding checks.
- One approval covers the displayed call only. Seal will not run it twice, and a failure before forwarding can spend the approval without running it at all. Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal executes it. Seal binds a client's retry to the displayed request. It cannot establish that a human, rather than the client or an automatic elicitation hook, supplied the approval. Approval expiry follows the local wall clock; Seal provides no trusted-time guarantee.
- Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. Checking a signed receipt is only as good as the key you check against. A key stored next to the receipt establishes self-consistency only. The optional verification path fetches a separately pinned runtime from GitHub. Verification is therefore bounded by that external repository and the integrity of the fetched bytes. That is demo-grade key custody, not an externally trusted production key; a production-grade path would verify against a key you obtained from a source you already trust.
- Protect delegates its local override to Claude Code, whose configuration and backups remain after Unprotect.
- The installed command sits in a user-writable prefix. Another process running as that user can replace the entry point before the next run. The packaged store is read-only and integrity-checked; the entry point is not. Seal v0.2.0-rc.2 is Linux x86-64 only.

## Links

- [Operating guide](docs/guide/README.md)
- [Assurance / release notes](docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md)
- [Limitations](docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md#what-seal-does-not-cover)
- [Evaluator walk](docs/start/evaluator-walk.md)
- [Full documentation index](docs/assurance/README.md)
- [Install verification](docs/start/install.md)

[Paste a receipt into seal-check](https://velvetmonkey.github.io/seal-check/): it re-checks the decision receipt in your browser. The landing page has **zero `<button>` controls**. The page states that it has no backend, accounts, or telemetry, and that nothing you paste leaves the page. It does not establish that your setup routes calls through Seal, and it is not the shipped checker command above.

<!-- Scope of the live-page guard: it checks the marked README wording, two old phrasings, literal <button> tags, and a frozen HTML blob only. It does not inspect or execute app.js or wasm/seal.js; a green guard does not show that the page runs nothing or that no MCP tool-call runs. -->

## License

Apache-2.0. See [LICENSE](LICENSE).

<!-- Repository transcript instrumentation (not a walkthrough step)

The repository's reproducibility check runs the demo through this harness to capture its output and recover its generated directory. Readers following the steps above do not run it.

```bash
export SEAL_DEMO_LOG="$(mktemp "${TMPDIR:-/tmp}/seal-demo-log.XXXXXX")"
(set -o pipefail; seal demo </dev/tty | tee "$SEAL_DEMO_LOG")
SEAL_DEMO_STATUS="$?"
if test "$SEAL_DEMO_STATUS" -ne 0; then
  echo "README walk stopped: seal demo failed (exit $SEAL_DEMO_STATUS)" >&2
  exit "$SEAL_DEMO_STATUS"
fi
export SEAL_DEMO_DIR="$(sed -n 's/^temporary demo directory: \(.*\) (remains after the demo for the printed checker command)$/\1/p' "$SEAL_DEMO_LOG")"
if test -z "$SEAL_DEMO_DIR"; then
  echo "README walk stopped: seal demo printed no temporary demo directory" >&2
  exit 1
fi
```
-->
