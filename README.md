<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

Seal puts an approval gate in front of one tool of one MCP server. A guarded call is blocked until you approve that exact call, once. Then it runs once, and Seal writes a signed receipt.

**Seal v1.1 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.**

What it costs you: Node 20 or later, Git, one file installed under `~/.local`, and one restart of Claude Code when you protect a tool. What it does not cover is listed at the end, before the license.

Every command below was run, in this order, on one Linux x86-64 machine against the bytes pinned in [`SHA256SUMS`](SHA256SUMS). The output under each command is the output that run printed.

## 1. Install

```sh
cd /tmp
git clone https://github.com/velvetmonkey/seal
cd seal
node scripts/build-dist.cjs
./dist/seal-v0.1.1-linux-x64 --sha256 f2ab71e328346c017ed74369ccebcfd4541ea75dd64fa178519095c388094f96 --bytes 114577 --prefix ~/.local
```

```
/tmp/seal/dist/seal-v0.1.1-linux-x64
sha256 f2ab71e328346c017ed74369ccebcfd4541ea75dd64fa178519095c388094f96
bytes 114577
tree d3c29f8b8db41469461dc5c9e680246d3d962f9d70e82f49e3040251df0ab8b7
installed seal 0.1.1 linux-x64
store: /home/monkey/.local/lib/seal/store/d3c29f8b8db41469461dc5c9e680246d3d962f9d70e82f49e3040251df0ab8b7
command: /home/monkey/.local/bin/seal
tree: d3c29f8b8db41469461dc5c9e680246d3d962f9d70e82f49e3040251df0ab8b7
```

The `--sha256` and `--bytes` values are the published pin from [`SHA256SUMS`](SHA256SUMS); the build you just ran must reproduce them or the installer refuses. The installer also refuses without a pin, refuses altered bytes by name (`artifact_digest_mismatch`), and on any platform other than Linux x86-64 refuses before changing any file. If `~/.local/bin` is not on your PATH:

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
child     seal __demo-server (this same binary) mutating /tmp/seal-demo-2SDY78/child/data.txt
child calls observed: 0 (read from /tmp/seal-demo-2SDY78/child/data.txt.count)
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    Approval required
    Tool: demo.mutate
    Arguments:
      line: "seal spine demo wrote this line"
    Scope: parsed JSON; object-key order and 1 vs 1.0 match; one use; 2 min.
    Outside Seal: Bash, network, subprocesses, other tools and servers.
child calls observed: still 0 (read from /tmp/seal-demo-2SDY78/child/data.txt.count) — approval shown, nothing executed
Approve? [y/N] child replied through the shared proxy: "demo server: appended 32 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /tmp/seal-demo-2SDY78/child/data.txt.count)
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this approval was one-use and has already admitted a call"
one-use enforced: the consumed approval admitted no second call; child calls observed: still 1 (read from /tmp/seal-demo-2SDY78/child/data.txt.count)
receipt written: /tmp/seal-demo-2SDY78/receipts/receipt-1786756575885-2448664-0001-INPUT_REQUIRED.json
receipt written: /tmp/seal-demo-2SDY78/receipts/receipt-1786756575888-2448664-0002-ALLOW.json
receipt written: /tmp/seal-demo-2SDY78/receipts/receipt-1786756575891-2448664-0003-BLOCK.json

SCOPE WITNESS

Seal controlled this path:
  demo client -> Seal -> demo MCP server -> demo.mutate

Now the demo performs a harmless direct local write
that does not cross the Seal gate.

DIRECT WRITE SUCCEEDED
Seal decisions emitted: 0 (receipts in /tmp/seal-demo-2SDY78/receipts: 3 before the write, 3 after)

Seal is a gate, not a sandbox: it controls the path through it, and only that path.
summary: approval required once, executed once after approval, replay refused; 3 receipts written; one write happened outside Seal.
receipts are claims, not proofs. Check one with the separate external checker (V11-RECEIPT-01), which shares no code with this binary at runtime:
  node "/home/monkey/.local/lib/seal/store/d3c29f8b8db41469461dc5c9e680246d3d962f9d70e82f49e3040251df0ab8b7/checker/seal-receipt-check.mjs" "/tmp/seal-demo-2SDY78/receipts/receipt-1786756575891-2448664-0003-BLOCK.json" --pubkey "/tmp/seal-demo-2SDY78/receipt-signer.pub"
  Note: this demo wrote that key in the same folder as the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
```

The demo's last lines print a checker command with your run's own paths. Here is that command from the run above, run as printed:

```sh
node "/home/monkey/.local/lib/seal/store/d3c29f8b8db41469461dc5c9e680246d3d962f9d70e82f49e3040251df0ab8b7/checker/seal-receipt-check.mjs" "/tmp/seal-demo-2SDY78/receipts/receipt-1786756575891-2448664-0003-BLOCK.json" --pubkey "/tmp/seal-demo-2SDY78/receipt-signer.pub"
```

```
ACCEPT BLOCK demo.mutate — decision, tool, arguments and signature all match the sealed commitments
```

Change one recorded field and the same checker refuses:

```sh
sed 's/"decision": "BLOCK"/"decision": "ALLOW"/' /tmp/seal-demo-2SDY78/receipts/receipt-1786756575891-2448664-0003-BLOCK.json > /tmp/tampered.json
node "/home/monkey/.local/lib/seal/store/d3c29f8b8db41469461dc5c9e680246d3d962f9d70e82f49e3040251df0ab8b7/checker/seal-receipt-check.mjs" /tmp/tampered.json --pubkey "/tmp/seal-demo-2SDY78/receipt-signer.pub"
```

```
REFUSE decision_binding_mismatch: the recorded decision does not match its sealed commitment
```

The checker's `--pubkey` is a trust input. The demo wrote that key next to the receipt, so the check above establishes self-consistency and nothing more. For a receipt check to mean something, the verifying key must reach you from a source you already trust — not from the sealer, and not from beside the receipt.

> Seal enforces that only a matching, one-use approval response can release the exact effect; on the Claude Code path, it trusts Claude Code to present that request to a human and faithfully return the human's choice, and does not claim to distinguish a human click from a client-generated acceptance.

## 3. Protect

`seal protect` needs the `claude` command and a project whose `.mcp.json` already has a stdio MCP server. The `.mcp.json` written below is a stand-in for the file your project already has, pointing at Seal's own demo server so the sequence runs on a scratch directory; protecting a real project is the same two words, `seal protect SERVER TOOL`, against the file that is already there.

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
Project .mcp.json hash before protect: f7f2cf0f10e6e8d2c231f8443ae5d9b5812cd2ef011bea563fd328c84a7c92af
Protection: PENDING RESTART db.demo.mutate
State: /home/monkey/.local/share/seal/projects/31bb674eeb73f9c84ed476fbe8c450c2/state.json
```

`protect` installs a local Claude Code override, private to you, that routes the `db` server through Seal's proxy. It does not edit `.mcp.json`. The override takes effect when Claude Code next starts, so `protect` ends in PENDING RESTART, never ACTIVE. From that restart on, `demo.mutate` calls are held for the same one-use approval the demo showed — the demo and the protected path run the same proxy and the same approval contract — and if the server entry in `.mcp.json` changes after protect, forwarding refuses instead of forwarding a drifted call.

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
Project .mcp.json hash before unprotect: f7f2cf0f10e6e8d2c231f8443ae5d9b5812cd2ef011bea563fd328c84a7c92af
Project .mcp.json hash after unprotect: f7f2cf0f10e6e8d2c231f8443ae5d9b5812cd2ef011bea563fd328c84a7c92af
Protection: - outside Seal
```

The project file is byte-identical before and after; only the local override is removed. To remove Seal itself (the store is installed read-only, so make it writable first):

```sh
rm ~/.local/bin/seal
chmod -R u+w ~/.local/lib/seal && rm -r ~/.local/lib/seal
```

Receipts and per-project state remain under `~/.local/share/seal/`. They are yours; delete them with `rm -r ~/.local/share/seal` if you want nothing left.

## What Seal covers, and what it does not

- Seal is a gate, not a sandbox. It controls the path through it, and only that path. The demo ends by writing a file outside the gate and reporting zero Seal decisions for it; that is the honest boundary, demonstrated rather than footnoted.
- One project, one server, one selected tool. Everything else — Bash, network, subprocesses, other tools and other servers — is outside Seal, and other controls may or may not exist there.
- Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal executes it.
- An approval matches one exact call — parsed JSON arguments, one use, a short expiry — and the dialog shows that scope before you answer. A consumed approval admits no second call.
- A receipt is a signed claim, and checking it is only as good as the key you check against. The checker never reads the key from the receipt, and a key stored next to the receipt establishes self-consistency only. Obtain the verifying key from a source you already trust.
- Seal v1.1 is Linux x86-64 only. On any other platform the installer refuses before changing anything.

## License

Apache-2.0. See [LICENSE](LICENSE).
