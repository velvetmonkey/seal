<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a receipt of the decision. Today only the demo signs its receipts, with a key it generates for that run; the protected path writes its receipts unsigned.

Seal is a gate, not a sandbox: it controls the path through it, and only that path.

**Seal v1.1 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.**

What it costs you: Node 20 or later, Git, one command and one read-only store directory installed under `~/.local`, the `claude` command for Protect (check with `claude --version`), and one restart of Claude Code when you protect a tool. What it does not cover is listed at the end, before the license.

Every command below was run, in this order, on one Linux x86-64 machine against the bytes pinned in [`SHA256SUMS`](SHA256SUMS). The output under each command is the output that run printed.

## 1. Install

```sh
cd /tmp
git clone https://github.com/velvetmonkey/seal
cd seal
node scripts/build-dist.cjs
./dist/seal-v0.1.1-linux-x64 --sha256 70cfeec68d69ee27dc5abd70b9752e5ac81119d887f8c475aa6992e8ec77a98f --bytes 118221 --prefix ~/.local
```

```
/tmp/seal-readme-run-rNaUhj/repo/dist/seal-v0.1.1-linux-x64
sha256 70cfeec68d69ee27dc5abd70b9752e5ac81119d887f8c475aa6992e8ec77a98f
bytes 118221
tree 43cd51282f07bcf27b1b863b24b3642e13d994f01922cc0a2b539a2dcb019523
installed seal 0.1.1 linux-x64
store: /tmp/seal-readme-run-rNaUhj/home/.local/lib/seal/store/43cd51282f07bcf27b1b863b24b3642e13d994f01922cc0a2b539a2dcb019523
command: /tmp/seal-readme-run-rNaUhj/home/.local/bin/seal
tree: 43cd51282f07bcf27b1b863b24b3642e13d994f01922cc0a2b539a2dcb019523
```

The `--sha256` and `--bytes` values are the published pin from [`SHA256SUMS`](SHA256SUMS); the build you just ran must reproduce them or the installer refuses. The installer also refuses without a pin, refuses altered bytes by name (`artifact_digest_mismatch`), and on any platform other than Linux x86-64 refuses before changing any file. Add `~/.local/bin` to PATH before continuing:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

## 2. Demo

```sh
seal demo
```

```
seal spine demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /tmp/seal-demo-fEELrr/child/data.txt
temporary demo directory: /tmp/seal-demo-fEELrr (remains after the demo for the printed checker command)
child calls observed: 0 (read from /tmp/seal-demo-fEELrr/child/data.txt.count)
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    Approval required
    Tool: demo.mutate
    Arguments:
      line: "seal spine demo wrote this line"
    Scope: this parsed call (key order and 1/1.0 match); at most one run; 2 min.
    Outside Seal: Bash, network, subprocesses, other tools and servers.
child calls observed: still 0 (read from /tmp/seal-demo-fEELrr/child/data.txt.count) — approval shown, nothing executed
Approve? [y/N] child replied through the shared proxy: "demo server: appended 32 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /tmp/seal-demo-fEELrr/child/data.txt.count)
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /tmp/seal-demo-fEELrr/child/data.txt.count)
receipt written: /tmp/seal-readme-run-rNaUhj/home/.local/share/seal/receipts/receipt-1786787957916-3017604-0001-INPUT_REQUIRED.json
receipt written: /tmp/seal-readme-run-rNaUhj/home/.local/share/seal/receipts/receipt-1786787957919-3017604-0002-ALLOW.json
receipt written: /tmp/seal-readme-run-rNaUhj/home/.local/share/seal/receipts/receipt-1786787957922-3017604-0003-BLOCK.json

SCOPE WITNESS

Seal controlled this path:
  demo client -> Seal -> demo MCP server -> demo.mutate

If a route to the same effect does not pass through the printed Seal path, Seal did not control it.

Now the demo performs a harmless direct local write
that does not cross the Seal gate.

DIRECT WRITE SUCCEEDED
Seal decisions emitted: 0 (receipts in /tmp/seal-readme-run-rNaUhj/home/.local/share/seal/receipts: 3 before the write, 3 after)

Seal is a gate, not a sandbox: it controls the path through it, and only that path.
summary: approval matched the effect, one child call observed, replay refused; 3 receipts written; one write happened outside Seal.
receipts are claims, not proofs. Check one with the separate checker (V11-RECEIPT-01). It runs as its own process and shares no code with this binary at runtime. It ships in this same artifact, so it cannot protect against a replaced artifact:
  node "/tmp/seal-readme-run-rNaUhj/home/.local/lib/seal/store/43cd51282f07bcf27b1b863b24b3642e13d994f01922cc0a2b539a2dcb019523/checker/seal-receipt-check.mjs" "/tmp/seal-readme-run-rNaUhj/home/.local/share/seal/receipts/receipt-1786787957922-3017604-0003-BLOCK.json" --pubkey "/tmp/seal-demo-fEELrr/receipt-signer.pub"
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
```

The demo's last lines print a checker command with your run's own paths. Here is that command from the run above, run as printed:

```sh
node "/tmp/seal-readme-run-rNaUhj/home/.local/lib/seal/store/43cd51282f07bcf27b1b863b24b3642e13d994f01922cc0a2b539a2dcb019523/checker/seal-receipt-check.mjs" "/tmp/seal-readme-run-rNaUhj/home/.local/share/seal/receipts/receipt-1786787957922-3017604-0003-BLOCK.json" --pubkey "/tmp/seal-demo-fEELrr/receipt-signer.pub"
```

```
ACCEPT BLOCK demo.mutate — decision, tool, arguments and signature all match the sealed commitments
```

Change one recorded field and the same checker refuses:

```sh
sed 's/"decision": "BLOCK"/"decision": "ALLOW"/' /tmp/seal-readme-run-rNaUhj/home/.local/share/seal/receipts/receipt-1786787957922-3017604-0003-BLOCK.json > /tmp/seal-readme-run-rNaUhj/tampered.json
node "/tmp/seal-readme-run-rNaUhj/home/.local/lib/seal/store/43cd51282f07bcf27b1b863b24b3642e13d994f01922cc0a2b539a2dcb019523/checker/seal-receipt-check.mjs" /tmp/seal-readme-run-rNaUhj/tampered.json --pubkey "/tmp/seal-demo-fEELrr/receipt-signer.pub"
```

```
REFUSE decision_binding_mismatch: the recorded decision does not match its sealed commitment
```

The checker's `--pubkey` is a trust input. The demo generated that key for this one run — it is the very key that signed the receipt — so the check above establishes self-consistency and nothing more. For a receipt check to mean something, the verifying key must reach you from a source you already trust — not from the sealer, and not from beside the receipt. This signed-receipt cycle is the demo's today: the protected path below writes its receipts without a signature, and the same checker refuses them.

> Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

## 3. Protect

`seal protect` needs the `claude` command and a project whose `.mcp.json` already has a stdio MCP server. Check that command first with `claude --version`. The `.mcp.json` written below is a stand-in for the file your project already has, pointing at Seal's own demo server so the sequence runs on a scratch directory; protecting a real project is the same two words, `seal protect SERVER TOOL`, against the file that is already there.

```sh
mkdir /tmp/myproject && cd /tmp/myproject
cat > .mcp.json <<EOF
{
  "mcpServers": {
    "db": {
      "command": "$HOME/.local/bin/seal",
      "args": ["__demo-server", "/tmp/myproject/data.txt"]
    }
  }
}
EOF
seal protect db demo.mutate
```

```
Project .mcp.json hash before protect: f82f46ff49e514ea59cec6a6929114386594f2e3070429af5970611ab41d8476
Protection: PENDING RESTART db.demo.mutate
State: /home/monkey/scratch/coldwalkfix-run/xdg/seal/projects/21888168db00aa616c9c647108a4acfd/state.json
```

`protect` invokes Claude Code's `claude mcp add` to install a local override, private to you, that routes the `db` server through Seal's proxy. It does not edit `.mcp.json`. Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/` while it installs that override; Seal invokes Claude Code but does not write either file. The override takes effect when Claude Code next starts, so `protect` ends in PENDING RESTART, never ACTIVE. From that restart on, `demo.mutate` calls use the same rule the demo showed: Seal will not run the approved call twice, and it may spend the approval without running it. The demo and protected path run the same proxy and contract. If the server entry in `.mcp.json` changes after protect, forwarding refuses instead of forwarding a drifted call.

Receipts are the one place the two paths differ today. The protected proxy records every decision as a receipt file, but v1.1 mints no operator signing key, so those receipts carry no signature and the shipped checker refuses them: `REFUSE unsealed: receipt carries no seal; it cannot be checked`. Only the demo signs receipts today, with a key that exists only for that run. Where a durable operator key comes from is an open decision, so do not build anything on protected-path receipts passing the checker yet.

Seal states its trust assumption instead of decorating it with a green tick:

```sh
seal doctor
```

```
ASSUMPTION
  Claude Code presents approval requests to a human and faithfully returns
  the response. Seal cannot distinguish a human click from client-generated
  acceptance.
```

## 4. Remove

```sh
cd /tmp/myproject
seal unprotect db
```

```
Project .mcp.json hash before unprotect: f82f46ff49e514ea59cec6a6929114386594f2e3070429af5970611ab41d8476
Project .mcp.json hash after unprotect: f82f46ff49e514ea59cec6a6929114386594f2e3070429af5970611ab41d8476
Protection: - outside Seal
```

The project file is byte-identical before and after. `unprotect` invokes Claude Code's `claude mcp remove` to remove only the local override. It does not delete Claude Code's `~/.claude.json` or backups under `~/.claude/backups/`; those files remain. To remove Seal itself (the store is installed read-only, so make it writable first):

```sh
rm ~/.local/bin/seal
chmod -R u+w ~/.local/lib/seal && rm -r ~/.local/lib/seal
```

Receipts and per-project state remain under `~/.local/share/seal/`. They are yours; delete them with `rm -r ~/.local/share/seal` if you want nothing left.

The demo's temporary directory — the `/tmp/seal-demo-*` location it prints before asking for approval — also remains after the walk. It holds the demo journal, child data and count, the outside-the-gate write, and the receipt-signing public key needed by the checker command. After you run that command, remove the exact directory the demo printed with `rm -r` if you want nothing left.

In the demo, Seal controlled only `demo client -> Seal -> demo MCP server -> demo.mutate`. The direct write, Bash, and everything else were outside it.

## What Seal covers, and what it does not

- Seal is a gate, not a sandbox. It controls the path through it, and only that path. The demo ends by writing a file outside the gate and reporting zero Seal decisions for it; that is the honest boundary, demonstrated rather than footnoted.
- One project, one server, one selected tool. Everything else — Bash, network, subprocesses, other tools and other servers — is outside Seal, and other controls may or may not exist there.
- Protect mediates only a stdio MCP server entry; other MCP transport shapes are outside the protected path.
- Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal executes it.
- Seal binds a client’s retry to the displayed request, but cannot establish that a human rather than the client or an automatic elicitation hook supplied the approval.
- One approval covers the displayed call only. Seal will not run it twice, and a failure before forwarding can spend the approval without running it at all. The approval expires after a short time.
- Approval expiry follows the local wall clock; Seal provides no trusted-time guarantee.
- Receipts from the protected path are unsigned today, and the shipped checker refuses them (`REFUSE unsealed`). Both paths write receipt files; only the demo signs them, with a key generated fresh for that run and gone with it. Until an operator signing key exists, a protected-path receipt is a plain local record, not checkable evidence.
- Checking a signed receipt is only as good as the key you check against. The checker never reads the key from the receipt, and a key stored next to the receipt establishes self-consistency only. Obtain the verifying key from a source you already trust.
- The optional verification path fetches a separately pinned runtime from GitHub, so verification is bounded by that external repository and the integrity of the fetched bytes.
- Protect delegates its local override to Claude Code, whose configuration and backups remain after Unprotect.
- The installed command sits in a user-writable prefix, so another process running as that user can replace the entry point before the next run even though the packaged store is read-only and integrity-checked.
- Seal v1.1 is Linux x86-64 only. On any other platform the installer refuses before changing anything.

## License

Apache-2.0. See [LICENSE](LICENSE).
