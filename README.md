<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.

Most MCP tools are harmless. Seal gates the dangerous one; the rest pass through.

Requires Node 20+, Git, and the `claude` command for Protect (check with `claude --version`). The install creates one command and one read-only store directory under `~/.local`.

**Seal v0.2.0-rc.2 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.**

Every command below ran in this order against the [`SHA256SUMS`](SHA256SUMS)-pinned bytes. Each printed the output shown.

## 1. Install

```sh
cd /tmp
git clone https://github.com/velvetmonkey/seal
cd seal
node scripts/build-dist.cjs
./dist/seal-v*-linux-x64 --sha256 de1adfb627cb84f988f866c63179a61cd73e9fddf8cb59c8698771202691ded8 --bytes 6143790 --prefix ~/.local
```

```
/home/monkey/wt/demodir/dist/seal-v0.2.0-rc.2-dev.g2d5641c-linux-x64
sha256 de1adfb627cb84f988f866c63179a61cd73e9fddf8cb59c8698771202691ded8
bytes 6143790
tree 2deb206d3785019f20107a7723f04802a54bc3a13d396c3fe8622fdcabf52ca7
installed seal 0.2.0-rc.2 linux-x64
store: /tmp/seal-demodir-prefix.Ju6uoy/lib/seal/store/2deb206d3785019f20107a7723f04802a54bc3a13d396c3fe8622fdcabf52ca7
command: /tmp/seal-demodir-prefix.Ju6uoy/bin/seal
tree 2deb206d3785019f20107a7723f04802a54bc3a13d396c3fe8622fdcabf52ca7
```

A build off a release tag names itself `-dev.g<commit>`; the bare release name is reserved for the tag. Your build must reproduce the published pin in [`SHA256SUMS`](SHA256SUMS) or the installer refuses. It also refuses without a pin, and refuses altered bytes by name (`artifact_digest_mismatch`). The pin protects the install, not the file's future: `~/.local/bin` stays user-writable, so another process running as you can replace `seal` there later. Add `~/.local/bin` to PATH before continuing:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

## 2. Demo

The demo builds a working gate in about a minute. Watch one number: the child's call counter moves only when the guarded tool actually runs.

```sh
seal demo
```

```
seal demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt
temporary demo directory: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2 (remains after the demo for the printed checker command)
child calls observed: 0 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

The client asks for the guarded tool. The proxy runs nothing and shows the request:

```
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    Approval required
    Tool: demo.mutate
    Arguments:
      line: "seal demo wrote this line"
    Scope: this parsed call (key order and 1/1.0 match); at most one run; 2 min.
    Outside Seal: Bash, network, subprocesses, other tools and servers.
child calls observed: still 0 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count) — approval shown, nothing executed
```

`Scope` is how narrow your yes is: this identical call, at most one run, two minutes. At most one run is literal — a failure before forwarding can spend the approval with no run. The two minutes follow the local wall clock; Seal has no trusted time. `Outside Seal` is what your yes does not cover.

Type `y`: the call runs once, the demo replays it, and the replay is refused. Your `y` is consumed by the prompt, so the child's reply lands on the question's line.

```
Approve? [y/N] child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452628-3115472-0001-INPUT_REQUIRED.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452631-3115472-0002-ALLOW.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json
```

Next the demo states its own boundary:

```

SCOPE WITNESS

Seal controlled this path:
  demo client -> Seal -> demo MCP server -> demo.mutate

If a route to the same effect does not pass through the printed Seal path, Seal did not control it.
```

Then it proves the rule by breaking it. The write below does not cross the gate:

```
Now the demo performs a harmless direct local write
that does not cross the Seal gate.

DIRECT WRITE SUCCEEDED
Seal decisions emitted: 0 (receipts in /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts: 3 before the write, 3 after)
```

A route that does not cross the gate is one Seal does not see. The demo closes by handing you a checker command:

```
Seal is a gate, not a sandbox: it controls the path through it, and only that path.
summary: approval matched the effect, one child call observed, replay refused; 3 receipts written; one write happened outside Seal.
receipts are claims, not proofs. Check one with the separate-process checker (V11-RECEIPT-01). It imports no Seal module at check time, but it carries a byte-identical copy of Seal's canonicalisation rule and uses the same Node crypto platform. It can detect a changed receipt against your trusted key; it cannot detect a defect shared by that rule or platform. It ships in this same artifact, so it also cannot protect against a replaced artifact:
  node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/2deb206d3785019f20107a7723f04802a54bc3a13d396c3fe8622fdcabf52ca7/checker/seal-receipt-check.mjs" "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json" --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
  Online: https://velvetmonkey.github.io/seal-check/ runs a supplied MCP tool-call in its browser kernel and reports its receipt checks. It does not establish that this setup routes calls through Seal, and it is not the checker command above.
```

The demo called its receipts claims, not proofs. Check one, with the printed command:

```sh
node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/2deb206d3785019f20107a7723f04802a54bc3a13d396c3fe8622fdcabf52ca7/checker/seal-receipt-check.mjs" "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json" --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
```

```
ACCEPT BLOCK demo.mutate — decision, tool, arguments and signature all match the sealed commitments. This shows the receipt is exactly what Seal on that machine signed and has not changed since. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story.
```

[Open seal-check](https://velvetmonkey.github.io/seal-check/) to run a supplied MCP tool-call in its browser kernel and inspect the receipt checks it reports. The page does not establish that your setup routes calls through Seal, and it is not the shipped checker command above.

Change one recorded field and the same checker refuses:

```sh
sed 's/"decision": "BLOCK"/"decision": "ALLOW"/' /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json > /home/monkey/scratch/docsland-reader-walk-run/tampered.json
node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/2deb206d3785019f20107a7723f04802a54bc3a13d396c3fe8622fdcabf52ca7/checker/seal-receipt-check.mjs" /home/monkey/scratch/docsland-reader-walk-run/tampered.json --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
```

```
REFUSE decision_binding_mismatch: the recorded decision does not match its sealed commitment
```

> Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

## 3. Protect

`seal protect` needs the `claude` command and a project whose `.mcp.json` has a stdio MCP server. Before recording protection, Seal starts the server, lists its tools, and refuses unless the requested tool is among them. Discovery allows 5000ms per phase; if a server needs longer, the refusal names `--timeout-ms`, which also governs the activation re-check. The `.mcp.json` below is a stand-in, pointing at Seal's demo server in this transcript's scratch run.

```sh
mkdir -p /home/monkey/scratch/toolexists-readme-20260815/final-project
cd /home/monkey/scratch/toolexists-readme-20260815/final-project
cat > .mcp.json <<EOF
{
  "mcpServers": {
    "db": {
      "command": "/home/monkey/scratch/toolexists-readme-20260815/prefix-final/bin/seal",
      "args": [
        "__demo-server",
        "/home/monkey/scratch/toolexists-readme-20260815/final-project/data.txt"
      ]
    }
  }
}
EOF
HOME=/home/monkey/scratch/toolexists-readme-20260815/final-home \
XDG_DATA_HOME=/home/monkey/scratch/toolexists-readme-20260815/final-home/.local/share \
/home/monkey/scratch/toolexists-readme-20260815/prefix-final/bin/seal protect db demo.mutate
```

```
Project .mcp.json hash before protect: 23435a951a3532cbca051f1fe8b978d153f5dc38ade8c6cb3942954406cb84e2
Protection: PENDING RESTART db.demo.mutate
Protection scope: 0 other tools OUTSIDE Seal
State: /home/monkey/scratch/toolexists-readme-20260815/final-home/.local/share/seal/projects/4198aa21a911c2c7e9899c24a49e6b28/state.json
```

`protect` reports how many of that server's tools remain outside Seal, naming at most 20 and counting the rest. It then invokes Claude Code's `claude mcp add` to install a local override, private to you, routing the `db` server through Seal's proxy. It does not edit `.mcp.json`. Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/` while it installs that override. Seal invokes Claude Code but does not write either file. The override takes effect when Claude Code next starts, so `protect` ends PENDING RESTART, never ACTIVE. At activation Seal repeats the discovery; a vanished tool makes the stored state BROKEN instead of silently forwarding around a stale name. If the server entry in `.mcp.json` changes after protect, forwarding refuses instead of forwarding a drifted call.

The protected proxy records every decision as a signed receipt file. On first activation it creates a machine-local Ed25519 receipt key under the Seal data directory, prints the public key and its file path, and reuses that key on later activations. The shipped checker accepts a protected-path receipt when every recorded commitment and signature matches under the public key you supply. That result has the limits printed by the checker: it does not show that the recorded decision happened, and anyone able to use the machine's Seal key could sign a different story.

Seal states its trust assumption:

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
cd /home/monkey/scratch/toolexists-readme-20260815/final-project
HOME=/home/monkey/scratch/toolexists-readme-20260815/final-home \
XDG_DATA_HOME=/home/monkey/scratch/toolexists-readme-20260815/final-home/.local/share \
/home/monkey/scratch/toolexists-readme-20260815/prefix-final/bin/seal unprotect db
```

```
Project .mcp.json hash before unprotect: 23435a951a3532cbca051f1fe8b978d153f5dc38ade8c6cb3942954406cb84e2
Project .mcp.json hash after unprotect: 23435a951a3532cbca051f1fe8b978d153f5dc38ade8c6cb3942954406cb84e2
Protection: - outside Seal
```

The project file is byte-identical before and after. `unprotect` invokes Claude Code's `claude mcp remove` to remove only the local override. It does not delete Claude Code's `~/.claude.json` or backups under `~/.claude/backups/`; those files remain. The store is read-only, so make it writable before removing Seal itself:

```sh
rm ~/.local/bin/seal
chmod -R u+w ~/.local/lib/seal && rm -r ~/.local/lib/seal
```

Receipts and per-project state remain under `~/.local/share/seal/`. Delete them with `rm -r ~/.local/share/seal` to leave nothing. The demo's temporary directory — the `/tmp/seal-demo-*` path it printed — also remains after the walk. It holds the run's evidence, including the key the printed checker command needs. After you run that command, remove the exact directory the demo printed with `rm -r`.

In the demo, Seal controlled only `demo client -> Seal -> demo MCP server -> demo.mutate`.

## How the gate decides

The demo and the protected path run the same proxy and rule. The authorization rule is PROVED. The state machine is TESTED. On a guarded retry, Node owns handle lookup, freshness, protocol shape, and durable one-use consumption. The exact-call authorization rule runs through the pinned vendored WASM, and its answer is required before forwarding. Kernel failure or a Node/kernel disagreement refuses — there is no JavaScript authorization fallback. The kernel configuration is currently signed by an Ed25519 key generated inside the same worker that submits it. That is demo-grade self-authorization, not an externally trusted production config key.

## What Seal covers, and what it does not

Seal is deliberately narrow, and none of these edges is small print.

### Where the gate's authority ends

- Seal is a gate, not a sandbox. It controls the path through it, and only that path. The demo ends by writing a file outside the gate and reporting zero Seal decisions for it.
- One project, one server, one selected tool. Everything else — Bash, network, subprocesses, other tools and other servers — is outside Seal, and other controls may or may not exist there.
- Protect mediates only a stdio MCP server entry; other MCP transport shapes are outside the protected path.

### What your approval does and does not mean

- One approval covers the displayed call only. Seal will not run it twice, and a failure before forwarding can spend the approval without running it at all. The approval expires after a short time.
- Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal executes it.
- Seal binds a client's retry to the displayed request. It cannot establish that a human, rather than the client or an automatic elicitation hook, supplied the approval.
- Approval expiry follows the local wall clock; Seal provides no trusted-time guarantee.

### What a receipt is worth today

- Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. The checker accepts a receipt only against the public key you supply and only when the recorded decision, tool, arguments and signature match the sealed commitments.
- Checking a signed receipt is only as good as the key you check against. The checker never reads the key from the receipt, and a key stored next to the receipt establishes self-consistency only. Obtain the verifying key from a source you already trust.
- The optional verification path fetches a separately pinned runtime from GitHub. Verification is therefore bounded by that external repository and the integrity of the fetched bytes.

### What surrounds the gate on your machine

- Protect delegates its local override to Claude Code, whose configuration and backups remain after Unprotect.
- The installed command sits in a user-writable prefix. Another process running as that user can replace the entry point before the next run. The packaged store is read-only and integrity-checked; the entry point is not.
- Seal v0.2.0-rc.2 is Linux x86-64 only. On any other platform the installer refuses before changing anything.

The [full documentation index](docs/README.md) links the operating guide, evidence, limitations, and design history.

## License

Apache-2.0. See [LICENSE](LICENSE).
