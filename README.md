<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml) [![seal-check: kernel no spine](https://img.shields.io/badge/seal--check-kernel%20no%20spine-1f6feb?style=flat-square)](https://velvetmonkey.github.io/seal-check/)

An AI coding agent can call a tool that changes or deletes something important.

Seal stops that call and asks you before the tool runs.

One exact call. One approval. One use.

<!-- generated from published release; do not edit -->
## Before you start

This is a clean-machine walkthrough for the published Linux x86-64 release.
It keeps every command in the order a new reader needs to run it.

Use a disposable project directory and a writable local tools directory.
The walkthrough creates both and leaves your project `.mcp.json` unchanged.

The commands fetch a release asset and verify its supplied digest and byte count.
Compare those values with release information obtained through a separate channel.

The demo is approve-once; Protect uses Claude Code's local override.
Both leave local evidence you can inspect before removing the throw-away files.

Keep the printed receipt paths until you have checked them.

Install the published Linux x86-64 release before you run the command. The release tag also identifies its `SHA256SUMS`. These commands download the binary and sibling receipt-checker asset from that release. Check both assets' digests and byte counts before you run them. For provenance, compare them with release information you got from a separate channel. See the [full install guide](docs/start/install.md) for source builds.

```bash
SEAL_VERSION=v0.2.0-rc.3
artifact_name="seal-v0.2.0-rc.3-linux-x64"; artifact_sha256="2b1710ece93295543b820b081734d9014f1d9bc4cf4dd772d7d59023858a46b4"; artifact_bytes=6151598
checker_name="seal-receipt-check.mjs"; checker_sha256="324e15191f093f72fe0f3e7f7bd0a791a5dc0e6ea261f3cd8c029fbc25997649"; checker_bytes=10749
sums_name="SHA256SUMS"; sums_sha256="7c03029aba5aa10fd04d003b0a5a1604dd9b87f25990a6c5142ab9ded04bedd7"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-receipt-check.mjs" # This checker does not enter the installed payload.
if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then sums_actual="$(sha256sum "$sums_name" | awk '{print $1}')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi; test "$sums_actual" = "$sums_sha256"
read -r expected_digest expected_bytes expected_name < <(awk -v name="$artifact_name" '$3 == name' "$sums_name"); test "$expected_name" = "$artifact_name"; test "$expected_digest" = "$artifact_sha256"; test "$expected_bytes" = "$artifact_bytes"
if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "$artifact_name" | awk '{print $1}')"; fi; test "$actual_digest" = "$artifact_sha256"; test "$(wc -c < "$artifact_name" | tr -d ' ')" = "$artifact_bytes"
read -r checker_sum checker_count checker_entry < <(awk -v name="$checker_name" '$3 == name' "$sums_name"); test "$checker_entry" = "$checker_name"; test "$checker_sum" = "$checker_sha256"; test "$checker_count" = "$checker_bytes"; if command -v shasum >/dev/null 2>&1; then checker_actual="$(shasum -a 256 "$checker_name" | awk '{print $1}')"; else checker_actual="$(sha256sum "$checker_name" | awk '{print $1}')"; fi; test "$checker_actual" = "$checker_sha256"; test "$(wc -c < "$checker_name" | tr -d ' ')" = "$checker_bytes"
checker="$(pwd -P)/$checker_name"; chmod +x "$expected_name"; ./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local; export PATH="$HOME/.local/bin:$PATH"
```
Requires Node 20+. The published Seal v0.2.0-rc.3 release asset is Linux x86-64, from commit `8dc16042cc1e865651185778df38dd114ff9ba3d`. Protect also needs Claude Code's `claude` command.
<!-- Seal installed-tree pin role: published-asset -->
```output
installed seal 0.2.0-rc.3 linux-x64
store: /home/you/.local/lib/seal/store/c81d89cbcba74d1b3936028b3203fdf4626e4711728ccfa16c0ada31af9717fb
command: /home/you/.local/bin/seal
tree: c81d89cbcba74d1b3936028b3203fdf4626e4711728ccfa16c0ada31af9717fb
Next:
  export PATH=/home/you/.local/bin:$PATH
  seal demo
```
<!-- end generated release docs -->
## See it work

The command supplies `y` to show the complete approve-once demonstration; run `seal demo` interactively to choose the response yourself.

```bash
demo_dir="$(mktemp -d)" && demo_dir="$(cd "$demo_dir" && pwd -P)" && printf 'y\n' | seal demo --dir "$demo_dir" && printf 'Demo directory: %s\n' "$demo_dir"
```
When you are finished, remove the directory printed as `Demo directory: /absolute/path`.
This is real output from `seal demo` (excerpted).

```text
child calls observed: 0 (read from
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
child calls observed: still 0 (read from
Approve? [y/N] child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from

OUTSIDE THE SEAL PATH
Writing directly to
File changed: yes
Protected-server call count: still 1
New Seal decisions: 0
Seal did not observe or authorise this write.

ENFORCED
The approved demo.mutate call ran once; its replay was refused.
NOT APPROVAL-GATED
The direct write to
NOT OBSERVED
That direct write; protected-server call count stayed 1 and Seal made 0 new decisions.
ASSURANCE
authorization rule tested; product state and forwarding tested; client and machine trusted.
```
<!-- generated from published release; do not edit -->
At the exact release tag, your build writes `seal-v0.2.0-rc.3-linux-x64` in your own `dist/` directory;
seal-v0.2.0-rc.3-linux-x64

The checker downloaded above is a sibling release asset covered by the same `SHA256SUMS`.
It is not in the installed binary tree.
Run the verified download when the demo prints a receipt and trusted public key.
<!-- end generated release docs -->

**macOS source portability is CI-exercised for install, demo and receipt checking. Protect is not supported on macOS yet.** Linux x86-64 is the supported Protect path; Windows and Linux ARM are unsupported.

## Protect something real

Install Claude Code into your local tools directory:

```bash
npm install --prefix "$HOME/.local" @anthropic-ai/claude-code
export PATH="$HOME/.local/node_modules/.bin:$PATH"
```

First check that Claude Code is available:

```bash
claude --version
```

In a [Claude Code project](docs/guide/choosing-what-to-protect.md), make `.mcp.json` define the stdio server and tool to gate. This makes a small local project whose `db` server is Seal's demo server:

The `git init -q` line makes this throw-away directory the Claude Code project root for the published CLI.

```bash
mkdir -p seal-protect-demo
cd seal-protect-demo
git init -q
printf '%s\n' '{"mcpServers":{"db":{"command":"seal","args":["__demo-server","./data.txt"]}}}' > .mcp.json
```
<!-- generated from published release; do not edit -->
With the published v0.2.0-rc.3 CLI, protect one tool:
<!-- end generated release docs -->
```bash
seal protect db demo.mutate
```

```output
Project .mcp.json hash before protect:
Protection: PENDING RESTART db.demo.mutate
Protection scope: 0 other tools NOT APPROVAL-GATED (they pass through Seal)
```

The command also prints a local `State:` path.
Seal checks the requested name before recording it, asks Claude Code to install a private local override, and leaves `.mcp.json` unchanged. Protect ends at `PENDING RESTART`, never `ACTIVE`. After restarting Claude Code, check it:

```bash
seal status
```

`protect` reports tools that are not approval-gated, naming at most 20 and counting the rest. They still pass through Seal's forwarding checks. Claude Code
writes `~/.claude.json` and a backup under `~/.claude/backups/`. Seal invokes
Claude Code but writes neither file. If the server entry changes, or a named
tool disappears at activation, Seal refuses forwarding or records `BROKEN`. `status` prints the runtime, current protection state, and receipt summary; after
the command above it reports `PENDING RESTART db.demo.mutate` until Claude Code restarts. **Receipt privacy:** Receipts contain the complete parsed protected-tool arguments and child command metadata. Sharing a receipt shares those values.

The protected path creates or reuses a machine-local signing key. The demo's key is generated fresh for that run. The checker accepts a receipt only with a
public key you supply, and only when the decision, tool, arguments, and
signature match its sealed commitments. Use a public key from a source you
trust. The demo prints a ready-to-run checker command for one of its receipts.
The download block above sets `checker` to the verified sibling asset's absolute path.
That path remains valid after the walkthrough changes into the protected project directory.
Use it with the trusted public key printed by the demo:

```bash
receipt="$(find "$demo_dir/receipts" -name '*BLOCK.json' -print -quit)"
node "$checker" "$receipt" --pubkey "$demo_dir/receipt-signer.pub"
```

The checker is not copied into the installed binary tree.
If you start a new shell, set `checker` to the downloaded asset's absolute path.
Use the receipt and public-key paths printed by your own demo run.

## Remove it

Stop Claude Code. Then run this in the protected project:

```bash
seal unprotect db
```

`unprotect` prints the `.mcp.json` hash before and after (the same value when
the project file was unchanged), then `Protection: - outside Seal`.

Unprotect asks Claude Code to remove only Seal's local override. It does not delete `~/.claude.json` or backups under `~/.claude/backups/`. Those files
remain until you or Claude Code remove them. Your project `.mcp.json` stays
byte-for-byte unchanged.












## The boundary

Seal controls calls that pass through the protected MCP server path.
It does not control Bash, direct file writes, network access, subprocesses,
other MCP servers, or another route to the same effect.
Seal is a gate, not a sandbox.

Seal is a proxy that intercepts one MCP tool call, asks you to approve it, and refuses to replay it without a new approval.

Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

One approval covers the displayed call only. A failure before forwarding can
spend it without running the call. If a human approves a malicious-but-valid
request, Seal runs it. Approval expiry follows the local wall clock.

The decision program is bundled as WebAssembly. Its byte-pinned answer is
required before forwarding. A failure or disagreement refuses; there is no
JavaScript authorization fallback. Single-tool and multi-tool protection are TESTED across all six shared state classes, including three-tool observations of `BROKEN`, `DRIFTED`, `STALE`, and `UNPROTECTED` atomicity.
Receipts are signed records, not evidence that an event happened. They use the
`seal.receipt/v2` envelope.
The independent checker replays the recorded inputs through the WASM kernel and
reports structure, signature, kernel decision, authority, and occurrence separately.
Positive `VERIFY` remains unavailable without an independent authority root and
occurrence witness. [seal-check](https://velvetmonkey.github.io/seal-check/) has no backend, accounts, or telemetry. The landing page has **zero `<button>` controls**.

## Links

- [Install or build Seal](docs/start/install.md)
- [Choose what to protect](docs/guide/choosing-what-to-protect.md)
- [Know whether it worked](docs/guide/knowing-it-worked.md)
- [Refusal codes and the documentation index](docs/assurance/README.md)
<!-- generated from published release; do not edit -->
- [Limitations and assurance material](docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md#what-seal-does-not-cover)
<!-- end generated release docs -->
- Apache-2.0. See [LICENSE](LICENSE).
