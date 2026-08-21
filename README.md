<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

An AI coding assistant such as Claude Code can run tools on your behalf: change a database, delete files, call a paid API. Tools are wired in through a plug-in standard called MCP (Model Context Protocol). Once a tool is wired in, the assistant can call it whenever it decides to, and can call it again on a retry, and nobody is asked to look at the exact call first.

Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.

In plain terms: you pick one tool that worries you. Before the assistant can run it, Seal shows you the exact call and waits for your yes or no. A yes is good for that one call only. Every decision is written down in a file you can check later.

Two words look alike on this page. **Seal** with a capital S is this program. The lower-case **seal** in its output, as in "sealed commitments", is the ordinary verb: a receipt is sealed when it is signed.

## Before you start

**Seal v0.2.0-rc.2 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.**

Requires Node 20+ and the `claude` command for Protect. The install creates one command and one read-only store directory under `~/.local`.

What Seal is, and is not, right now:

- Protect works with Claude Code only. No other assistant or agent is supported in this release.
- It protects one tool of one MCP server per project.
- It runs on your own machine and keeps its keys and receipts there. There is no team dashboard, no central log, and no company behind it.
- It is a release candidate. The keys it makes are fine for trying it out; they are not a production key-management system. The section "What Seal covers, and what it does not" says exactly where the edges are.

If any of that rules Seal out for you, stop here; the rest of this page will not change it.

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

You need a shell and `curl`. The commands below download the program and the `SHA256SUMS` asset attached to the same release, check that the download arrived intact, and then install it. The longer procedure is in [full SHA256SUMS verification](docs/install.md).

One honest note first. Those checks show the file arrived unchanged from the release page. They do not show that the release page itself is the one the author published: a replaced page could supply a matching file and checksum. If that matters to you, compare the digest and byte count against release information you got some other way before running the binary.

```bash
SEAL_VERSION=v0.2.0-rc.2
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"
read -r expected_digest expected_bytes expected_name < SHA256SUMS
actual_digest="$(sha256sum "$expected_name" | awk '{print $1}')"
test "$actual_digest" = "$expected_digest"
actual_bytes="$(wc -c < "$expected_name")"
test "$actual_bytes" = "$expected_bytes"
chmod +x "$expected_name"
./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```

You should see these four lines; `installed seal 0.2.0-rc.2 linux-x64` means it worked. The two paths start with the home directory of the machine that ran this example and will start with yours instead; the rest must match exactly. (The bold "pin role" line just above the block is a label for this repository's own release checks, not something the installer prints. Ignore it.)

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.2.0-rc.2 linux-x64
store: /home/monkey/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
command: /home/monkey/.local/bin/seal
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
```

The long `tree:` number identifies the installed files, not where they came from: a build of the same files from source has the same number. A checker copied out of that same store cannot tell you whether the store itself was swapped.

Add `~/.local/bin` to PATH before continuing:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### If you build from source instead

Most readers can skip this. At the exact release tag, your build writes `seal-v0.2.0-rc.2-linux-x64` in your own `dist/` directory; that is a separate path from the release download above, and a build of this checkout leaves out `checker/seal-receipt-check.mjs`. Its installed-tree digest is the `fresh-build` pin in [install.md](docs/install.md). The filename to look for:

```text
seal-v0.2.0-rc.2-linux-x64
```

The repository root does not carry a hand-maintained `SHA256SUMS` copy. Use the `SHA256SUMS` asset attached to the same release.

## 2. Demo

The demo needs nothing but the installed command. It starts a throwaway MCP server with one tool, `demo.mutate`, that appends a line to a file, and puts Seal in front of it.

Every output block on this page is the expected sequence, not a captured transcript. Paths, numbers and timestamps will differ on your machine; the wording will not.

```bash
seal demo
```

Leave it running until `Approve? [y/N]`, then type `y` and press Enter.

First the demo announces what it is about to do. Nothing has run yet:

**Output:**

```text
seal demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt
demo directory: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2 (remains after the demo for the printed checker command)
child calls observed: 0 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

The assistant-side client asks to run the tool. Seal holds the call and shows you exactly what was asked:

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

You type `y`. The call goes through once:

**Output:**

```text
Approve? [y/N] y
child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

The client tries the identical call again, the way a retry would. Your earlier yes does not cover it, and three receipts are written, one per decision:

**Output:**

```text
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452628-3115472-0001-INPUT_REQUIRED.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452631-3115472-0002-ALLOW.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json
```

Then the demo says, in one line, what Seal actually controlled:

**Output:**

```text
SCOPE WITNESS

Seal controlled this path:
  demo client -> Seal -> demo MCP server -> demo.mutate

If a route to the same effect does not pass through the printed Seal path, Seal did not control it.
```

To make that point concrete, the demo now writes to the same file directly, not through Seal. It succeeds, and Seal has nothing to say about it:

**Output:**

```text
Now the demo performs a harmless direct local write
that does not cross the Seal gate.

DIRECT WRITE SUCCEEDED
Seal decisions emitted: 0 (receipts in /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts: 3 before the write, 3 after)
```

The closing summary. The demo also prints, for your run, the exact command to check one receipt; it is a `node` command pointing at `checker/seal-receipt-check.mjs` inside the installed store, and you can copy it as printed:

**Output:**

```text
Seal is a gate, not a sandbox: it controls the path through it, and only that path.
summary: approval matched the effect, one child call observed, replay refused; 3 receipts written; one write happened outside Seal.
receipts are claims, not proofs. Check one with the separate-process checker (V11-RECEIPT-01). It imports no Seal module at check time, but carries a byte-identical copy of Seal's canonicalisation rule and uses the same Node crypto platform. It can detect a changed canonical parsed value against your trusted key; semantically irrelevant JSON formatting differences are not distinguished. It cannot detect a defect shared by that rule or platform. It ships in this same artifact, so it also cannot protect against a replaced artifact:
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
```

Run the printed checker command and the untouched receipt is accepted:

**Output:**

```text
ACCEPT BLOCK demo.mutate — decision, tool, arguments and signature all match the sealed commitments. This shows the receipt has the same canonical parsed value that this key signed. Semantically irrelevant JSON formatting differences are not distinguished. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story.
```

Edit one field in the receipt file, say the decision from `BLOCK` to `ALLOW`, and run the same command again. The checker refuses:

**Output:**

```text
REFUSE decision_binding_mismatch: receipt line 4, field decision: recorded value "ALLOW" does not match its sealed commitment (committed value withheld)
```

The demo's temporary directory remains after the walk so you can check a receipt. If you built from source, that store has no checker; use `checker/seal-receipt-check.mjs` from your checkout.

## 3. Protect

This is the real thing: Seal in front of one tool that Claude Code can call in one of your projects. `seal protect SERVER TOOL` needs the `claude` command and a project whose `.mcp.json` has a stdio MCP server. Before recording protection, Seal starts the server, lists its tools, and refuses unless the requested tool is among them. Discovery allows 5000ms per phase; if a server needs longer, the refusal names `--timeout-ms`, which also governs the activation re-check.

The example below makes a small project that uses Seal's own demo server as the MCP server, so you can try Protect without touching anything real. Create it somewhere that is not inside another git repository: Claude Code files its local override under the nearest git root, and if that is a parent directory Seal will not find the override there.

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

What happens: `protect` reports how many of that server's tools are not approval-gated, naming at most 20 and counting the rest. Those calls still route through Seal's proxy, where live server-entry drift or a lease-generation mismatch can refuse forwarding. It then invokes Claude Code's `claude mcp add` to install a local override, private to you, routing the `db` server through Seal's proxy. It does not edit `.mcp.json`. Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/` while it installs that override. Seal invokes Claude Code but does not write either file. The override takes effect when Claude Code next starts, so `protect` ends PENDING RESTART, never ACTIVE. At activation Seal repeats the discovery; a vanished tool makes the stored state BROKEN instead of silently forwarding around a stale name.

From then on, every decision about the protected tool is written as a signed receipt file. On first activation Seal creates a machine-local Ed25519 receipt key under the Seal data directory, prints the public key and its file path, and reuses that key on later activations.

About checking those receipts: the checker accepts a receipt only against the public key you supply and only when the decision, tool, arguments and signature match the sealed commitments. Semantically irrelevant JSON formatting differences are not distinguished. It cannot detect a defect shared by that rule or platform. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story. The checker never reads the key from the receipt; obtain the verifying key from a source you trust.

To see the state of protection in that project:

```bash
seal status
```

## 4. Remove

To put the project back the way it was:

```bash
cd "$SEAL_PROTECT_PROJECT"
seal unprotect db
```

`unprotect` invokes Claude Code's `claude mcp remove` to remove only the local override. It does not delete Claude Code's `~/.claude.json` or backups under `~/.claude/backups/`; those files remain.

To remove Seal itself, make the read-only store writable first:

```bash
chmod u+w ~/.local/bin/seal && rm ~/.local/bin/seal
chmod -R u+w ~/.local/lib/seal && rm -r ~/.local/lib/seal
```

The demo's temporary directory remains after the walk. After running the checker, use these commands to remove the retained state and the exact demo directory printed for your run:

```bash
rm -r ~/.local/share/seal
rm -r "$SEAL_DEMO_DIR"
```

`SEAL_DEMO_DIR` is not set for you; replace it with, or set it to, the `demo directory:` path your demo printed.

In the demo, Seal controlled only `demo client -> Seal -> demo MCP server -> demo.mutate`.

## What Seal covers, and what it does not

Read this section before relying on Seal for anything. It is the part of the page that matters most.

Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

- **It is a gate, not a sandbox.** Seal controls the path through it, and only that path. Protect mediates only a stdio MCP server entry; other MCP transport shapes are outside the protected path. Bash, network, subprocesses, other servers, and a direct local write are outside Seal. Other tools on the protected server are not approval-gated, but pass through Seal's forwarding checks.
- **One yes covers one displayed call, and only that.** Seal will not run it twice, and a failure before forwarding can spend the approval without running it at all. Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal executes it. Seal binds a client's retry to the displayed request. It cannot establish that a human, rather than the client or an automatic elicitation hook, supplied the approval. Approval expiry follows the local wall clock; Seal provides no trusted-time guarantee.
- **A receipt is a claim, not a proof.** Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. Checking a signed receipt is only as good as the key you check against. A key stored next to the receipt establishes self-consistency only. The optional verification path fetches a separately pinned runtime from GitHub. Verification is therefore bounded by that external repository and the integrity of the fetched bytes. That is demo-grade key custody, not an externally trusted production key; a production-grade path would verify against a key you obtained from a source you already trust.
- **Protect leaves traces in Claude Code.** Protect delegates its local override to Claude Code, whose configuration and backups remain after Unprotect.
- **The installed command can be replaced by anything running as you.** The installed command sits in a user-writable prefix. Another process running as that user can replace the entry point before the next run. The packaged store is read-only and integrity-checked; the entry point is not. Seal v0.2.0-rc.2 is Linux x86-64 only.

## How the gate decides

For readers who want the mechanism. The demo and the protected path run the same proxy and rule. The state machine is TESTED. On a guarded retry, Node owns handle lookup, freshness, protocol shape, and durable one-use consumption. The exact-call authorization rule runs through the pinned vendored WASM, and its answer is required before forwarding. Kernel failure or a Node/kernel disagreement refuses — there is no JavaScript authorization fallback. The kernel configuration is currently signed by an Ed25519 key generated inside the same worker that submits it. That is demo-grade self-authorization, not an externally trusted production config key.

## Links

- [Operating guide](docs/guide/README.md)
- [Assurance / release notes](docs/RELEASE-NOTES-v0.2.0-rc.2.md)
- [Limitations](docs/LIMITATIONS.md)
- [Evaluator walk](docs/evaluator-walk.md)
- [Full documentation index](docs/README.md)
- [Install verification](docs/install.md)

<!-- live-page-claims:begin -->
[Paste a receipt into seal-check](https://velvetmonkey.github.io/seal-check/): it re-checks the decision receipt in your browser. The landing page has **zero `<button>` controls**. Scope of the live-page guard: it checks the marked README wording, two old phrasings, literal `<button>` tags, and a frozen HTML blob only. It does not inspect or execute `app.js` or `wasm/seal.js`; a green guard does not show that the page runs nothing or that no MCP tool-call runs. The page states that it has no backend, accounts, or telemetry, and that nothing you paste leaves the page. It does not establish that your setup routes calls through Seal, and it is not the shipped checker command above.
<!-- live-page-claims:end -->

## License

Apache-2.0. See [LICENSE](LICENSE).

### Repository transcript instrumentation (not a walkthrough step)

Not for readers. This repository's own reproducibility check runs the demo through the script below to capture its output and recover its generated directory. The check reads it from this file, which is why it lives here; nothing above depends on it.

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
