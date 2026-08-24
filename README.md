<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml) [![seal-check: kernel no spine](https://img.shields.io/badge/seal--check-kernel%20no%20spine-1f6feb?style=flat-square)](https://velvetmonkey.github.io/seal-check/)

An AI coding agent can call a tool that changes or deletes something important.

Seal stops that call and asks you before the tool runs.

One exact call. One approval. One use.

## See it work

```bash
seal demo
```

This is real output from `seal demo` (excerpted).

```text
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
child calls observed: still 0 (read from /var/tmp/seal-demo/child/data.txt.count) — approval shown, nothing executed
Approve? [y/N] child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /var/tmp/seal-demo/child/data.txt.count)
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
```

Install the published Linux x86-64 release before you run the command. These commands fetch the binary and its `SHA256SUMS` from the same release. Check the digest and byte count before you run it. For provenance, compare them with release information you got from a separate channel. See the [full install guide](docs/start/install.md) for source builds.

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
export PATH="$HOME/.local/bin:$PATH"
```

Requires Node 20+. The published Seal v0.2.0-rc.2 asset is Linux x86-64. Protect also needs Claude Code's `claude` command.

<!-- Seal installed-tree pin role: published-asset -->
```output
installed seal 0.2.0-rc.2 linux-x64
store: /home/you/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
command: /home/you/.local/bin/seal
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
```

At `Approve? [y/N]`, type `y` and press Enter. The demo prints its temporary
directory. Keep it if you want to check the blocked receipt.

At the exact release tag, your build writes `seal-v0.2.0-rc.2-linux-x64` in your own `dist/` directory;
seal-v0.2.0-rc.2-linux-x64

The installed release tree includes the receipt checker. The repository root
has no hand-maintained `SHA256SUMS`.

**Seal source builds support Linux x86-64 and macOS x64/arm64. The immutable v0.2.0-rc.2 release asset remains Linux x86-64; Windows and Linux ARM are unsupported.**

## Protect something real

First check that Claude Code is available:

```bash
claude --version
```

In a [Claude Code project](docs/guide/choosing-what-to-protect.md), first make
sure `.mcp.json` defines the stdio server and tool you want to gate. For
example, this project starts a local `db` server:

```json
{
  "mcpServers": {
    "db": {
      "command": "node",
      "args": ["./db-server.mjs"]
    }
  }
}
```

With the published v0.2.0-rc.2 CLI, protect one tool:

```bash
seal protect db demo.mutate
```

```output
Project .mcp.json hash before protect: <the SHA-256 of your project file>
Protection: PENDING RESTART db.demo.mutate
Protection scope: 0 other tools NOT APPROVAL-GATED (they pass through Seal)
```

The command also prints a local `State:` path.
Seal checks the requested name before recording it. It then asks Claude Code to
install a private local override and leaves `.mcp.json` unchanged. Protect ends
at `PENDING RESTART`, never `ACTIVE`. After restarting Claude Code, check it:

```bash
seal status
```

`protect` reports tools that are not approval-gated, naming at most 20 and
counting the rest. They still pass through Seal's forwarding checks. Claude Code
writes `~/.claude.json` and a backup under `~/.claude/backups/`. Seal invokes
Claude Code but writes neither file. If the server entry changes, or a named
tool disappears at activation, Seal refuses forwarding or records `BROKEN`.
`status` prints the runtime, current protection state, and receipt summary; after
the command above it reports `PENDING RESTART db.demo.mutate` until Claude Code
restarts. **Receipt privacy:** Receipts contain the complete parsed protected-tool arguments and child command metadata. Sharing a receipt shares those values.

The protected path creates or reuses a machine-local signing key. The demo's key is generated fresh for that run. The checker accepts a receipt only with a
public key you supply, and only when the decision, tool, arguments, and
signature match its sealed commitments. Use a public key from a source you
trust. The demo prints a ready-to-run checker command for one of its receipts.
To run the installed checker yourself, substitute the receipt and public-key
paths printed by your demo:

```bash
checker="$(find "$HOME/.local/lib/seal/store" -path '*/checker/seal-receipt-check.mjs' -print -quit)"
node "$checker" /path/to/receipt.json --pubkey /path/to/receipt-signer.pub
```

## Remove it

Stop Claude Code. Then run this in the protected project:

```bash
seal unprotect db
```

`unprotect` prints the `.mcp.json` hash before and after (the same value when
the project file was unchanged), then `Protection: - outside Seal`.

Unprotect asks Claude Code to remove only Seal's local override. It does not
delete `~/.claude.json` or backups under `~/.claude/backups/`. Those files
remain until you or Claude Code remove them. Your project `.mcp.json` stays
byte-for-byte unchanged.

To remove Seal itself, make its read-only files writable first:

```bash
chmod u+w ~/.local/bin/seal && rm ~/.local/bin/seal
chmod -R u+w ~/.local/lib/seal && rm -r ~/.local/lib/seal
rm -r ~/.local/share/seal
```

Remove the exact temporary demo directory printed by your run after checking
its receipt.

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
JavaScript authorization fallback. The state machine is tested for the
single-tool case. Multi-tool coverage reaches `PENDING RESTART` and `ACTIVE`;
four state classes remain uncovered.

Receipts are signed records, not evidence that an event happened. The checker
uses the same Node crypto platform and cannot find a defect shared by its rule
or that platform. Formatting differences that do not change parsed JSON are not
distinguished. Hosted checker checks kernel receipts; it refuses seal.spine/v1 proxy receipts. [seal-check](https://velvetmonkey.github.io/seal-check/) has no backend, accounts, or telemetry. The landing page has **zero `<button>` controls**.

## Links

- [Install or build Seal](docs/start/install.md)
- [Choose what to protect](docs/guide/choosing-what-to-protect.md)
- [Know whether it worked](docs/guide/knowing-it-worked.md)
- [Refusal codes and the documentation index](docs/assurance/README.md)
- [Limitations and assurance material](docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md#what-seal-does-not-cover)
- Apache-2.0. See [LICENSE](LICENSE).
