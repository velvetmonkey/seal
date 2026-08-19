<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.

Most MCP tools are harmless. Seal gates the dangerous one; the rest pass through.

Requires Node 20+, Git, and the `claude` command for Protect (check with `claude --version`). The install creates one command and one read-only store directory under `~/.local`.

**Seal v0.2.0-rc.2 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.**

Every command below ran in this order against the bytes published with a
release. If you download a binary, verify it against the `SHA256SUMS` asset
attached to the same release before installing. The repository root does not
carry a hand-maintained copy.

## How it works

1. **Protect once.** `seal protect` reads and hashes the server entry in `.mcp.json`, then asks Claude Code to install a local override. Seal does not edit `.mcp.json` or `~/.claude.json`, and later server-entry drift refuses instead of forwarding.
2. **Approve per call.** Seal shows the exact guarded call. The pinned WASM answer is required before forwarding, and one-use consumption means the call will not run twice. Other tools on the protected server are not approval-gated, but still pass through Seal's forwarding checks.
3. **Keep the receipt.** Seal writes a signed receipt for every guarded decision. Keep it with a public key obtained from a source you trust, then use the shipped checker or seal-check with the limits stated below.

![Seal process diagram: one exact tool call is approval-gated; other tools on the protected server pass through Seal without approval](assets/seal-flow.svg)

## 1. Install

```sh
SEAL_VERSION=v0.2.0-rc.2
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"
chmod +x "seal-$SEAL_VERSION-linux-x64"
./seal-v0.2.0-rc.2-linux-x64 --sha256 c652f47f82778bda978725837ec77f182229872f13c12fd5a1f8619149666347 --bytes 6146418 --prefix ~/.local
```

```
./seal-v0.2.0-rc.2-linux-x64
sha256 c652f47f82778bda978725837ec77f182229872f13c12fd5a1f8619149666347
bytes 6146418
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
installed seal 0.2.0-rc.2 linux-x64
store: /home/you/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
command: /home/you/.local/bin/seal
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
```

seal-v0.2.0-rc.2-linux-x64

At the exact release tag, your build writes `seal-v0.2.0-rc.2-linux-x64` in your own `dist/` directory; other commits add `-dev.g<commit>` to their filenames. Download the artifact and its `SHA256SUMS` asset from the same release, then verify the artifact against that asset before installing. The installer refuses without a pin, and refuses altered bytes by name (`artifact_digest_mismatch`). The pin protects the install, not the file's future: `~/.local/bin` stays user-writable, so another process running as you can replace `seal` there later. Add `~/.local/bin` to PATH before continuing:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

## 2. Demo

<!-- live-page-claims:begin -->
[![seal-check: paste a receipt](https://img.shields.io/badge/seal--check-paste%20a%20receipt-1f6feb?style=flat-square)](https://velvetmonkey.github.io/seal-check/)
<!-- live-page-claims:end -->

### Step 1: Start the demo and establish the baseline

**Run:**

```sh
seal demo
```

**Do:** Nothing yet. Leave this command running until it asks `Approve? [y/N]`. The demo starts a sample tool behind Seal; the “child” is that real sample tool, and its call counter records how many times the tool actually ran.

**Output:**

```text
seal demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt
temporary demo directory: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2 (remains after the demo for the printed checker command)
child calls observed: 0 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

**Look at:** `child calls observed: 0`. The sample tool has not run; this is the baseline for every later count.

### Step 2: Watch Seal stop the call

**Run:** Nothing new. The `seal demo` command is still running.

**Do:** Nothing to do here. Read the request Seal is holding, but do not answer until the approval prompt appears.

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

**Look at:** `child calls observed: still 0`. Seal displayed the exact request but did not let it reach the tool.

`Scope` limits this yes to the identical call, at most once, for two minutes on the untrusted local clock. Failure before forwarding can spend it. `Outside Seal` lists what your yes does not cover.

### Step 3: Approve this one request

**Run:** Nothing new. The same `seal demo` process is waiting for your answer.

**Do:** At `Approve? [y/N]`, type exactly:

```text
y
```

Then press Enter.

**Output:**

```text
Approve? [y/N] child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

**Look at:** `child calls observed: 1`. The count moved from 0 to 1 only after your approval, so the guarded tool ran once.

### Step 4: Watch the automatic replay fail

**Run:** Nothing new. The demo itself retries the identical approved request.

**Do:** Nothing to do here; do not type a second approval.

**Output:**

```text
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452628-3115472-0001-INPUT_REQUIRED.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452631-3115472-0002-ALLOW.json
receipt written: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json
```

**Look at:** `one-use held: the replay did not run the call again; child calls observed: still 1`. The count stayed at 1, so reusing the approval did not run the tool a second time.

### Step 5: Read what Seal controlled

**Run:** Nothing new. The demo is still printing its explanation.

**Do:** Nothing to do here.

**Output:**

```text

SCOPE WITNESS

Seal controlled this path:
  demo client -> Seal -> demo MCP server -> demo.mutate

If a route to the same effect does not pass through the printed Seal path, Seal did not control it.
```

**Look at:** `If a route to the same effect does not pass through the printed Seal path, Seal did not control it.` Seal guards only calls routed through it; it is not a sandbox around the whole machine.

### Step 6: Watch an effect happen outside Seal

**Run:** Nothing new. The demo performs this direct write automatically.

**Do:** Nothing to do here.

**Output:**

```text
Now the demo performs a harmless direct local write
that does not cross the Seal gate.

DIRECT WRITE SUCCEEDED
Seal decisions emitted: 0 (receipts in /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts: 3 before the write, 3 after)
```

**Look at:** `Seal decisions emitted: 0`. The write succeeded without a Seal decision because it did not travel through the guarded path.

### Step 7: Keep the receipt and its checking command

**Run:** Nothing new. This is the end of `seal demo`.

**Do:** Keep the temporary demo directory: the receipts and public key needed below are inside it. Also keep the exact `node ... --pubkey ...` command printed for your run; its paths will differ from this captured output.

**Output:**

```text
Seal is a gate, not a sandbox: it controls the path through it, and only that path.
summary: approval matched the effect, one child call observed, replay refused; 3 receipts written; one write happened outside Seal.
receipts are claims, not proofs. Check one with the separate-process checker (V11-RECEIPT-01). It imports no Seal module at check time, but it carries a byte-identical copy of Seal's canonicalisation rule and uses the same Node crypto platform. It can detect a changed canonical parsed value against your trusted key; semantically irrelevant JSON formatting differences are not distinguished. It cannot detect a defect shared by that rule or platform. It ships in this same artifact, so it also cannot protect against a replaced artifact:
  node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3/checker/seal-receipt-check.mjs" "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json" --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
  <!-- live-page-claims:begin -->
  Online: https://velvetmonkey.github.io/seal-check/ re-checks a supplied Seal decision receipt in its browser kernel and reports those receipt checks. The landing page has **zero `<button>` controls**. Scope of the live-page guard: it checks the marked README wording, two old phrasings, literal `<button>` tags, and a frozen HTML blob only. It does not inspect or execute `app.js` or `wasm/seal.js`; a green guard does not show that the page runs nothing or that no MCP tool-call runs. The page states that it has no backend, accounts, or telemetry, and that nothing you paste leaves the page. It does not establish that this setup routes calls through Seal, and it is not the checker command above.
  <!-- live-page-claims:end -->
```

**Look at:** `summary: approval matched the effect, one child call observed, replay refused; 3 receipts written; one write happened outside Seal.` This is the whole demonstration in one line, including the effect that Seal did not control.

Receipts are claims, not proofs. The demo-generated key below proves only that the receipt and that key agree, not that a trusted party controlled the key.

### Step 8: Save the directory path for the next commands

**Run:**

```bash
read -r -p "Paste the temporary demo directory: " SEAL_DEMO_DIR
```

**Do:** Copy only the path after `temporary demo directory:` in Step 1, paste it at this prompt, and press Enter.

**Look at:** the Step 1 line beginning `temporary demo directory:`. Nothing is printed now; this command stores that exact path in `SEAL_DEMO_DIR`.

### Step 9: Check the blocked receipt

**Run — locate the checker installed in Step 1 of this README:**

```sh
SEAL_CHECKER="$(find "$HOME/.local/lib/seal/store" -path '*/checker/seal-receipt-check.mjs' -print -quit)"
```

**Run — locate the blocked receipt from your demo:**

```bash
SEAL_BLOCK_RECEIPT="$(find "$SEAL_DEMO_DIR/receipts" -name '*-BLOCK.json' -print -quit)"
```

**Run — check it against the demo's public key:**

```bash
node "$SEAL_CHECKER" "$SEAL_BLOCK_RECEIPT" --pubkey "$SEAL_DEMO_DIR/receipt-signer.pub"
```

**Do:** Run those three commands in order. You do not type any input after starting them.

**Output:**

```text
ACCEPT BLOCK demo.mutate — decision, tool, arguments and signature all match the sealed commitments. This shows the receipt has the same canonical parsed value that this key signed. Semantically irrelevant JSON formatting differences are not distinguished. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story.
```

**Look at:** `ACCEPT BLOCK demo.mutate`. The separate-process checker found that this key signed the same parsed decision, tool and arguments; the rest of the line states the limit of that result.

<!-- live-page-claims:begin -->
> **Receipt in hand?** [Paste it into seal-check](https://velvetmonkey.github.io/seal-check/): it re-checks the decision receipt in your browser. The page states that it has no backend, accounts, or telemetry, and that nothing you paste leaves the page. It does not establish that your setup routes calls through Seal, and it is not the shipped checker command above.

[Open seal-check](https://velvetmonkey.github.io/seal-check/) to re-check a supplied Seal decision receipt in its browser kernel and inspect the receipt checks it reports. The landing page has **zero `<button>` controls**. Scope of the live-page guard: it checks the marked README wording, two old phrasings, literal `<button>` tags, and a frozen HTML blob only. It does not inspect or execute `app.js` or `wasm/seal.js`; a green guard does not show that the page runs nothing or that no MCP tool-call runs. The page states that it has no backend, accounts, or telemetry, and that nothing you paste leaves the page. The page does not establish that your setup routes calls through Seal, and it is not the shipped checker command above.
<!-- live-page-claims:end -->

### Step 10: Change the recorded decision and check again

**Run — write a copy with `BLOCK` changed to `ALLOW`:**

```sh
sed 's/"decision": "BLOCK"/"decision": "ALLOW"/' "$SEAL_BLOCK_RECEIPT" > "$SEAL_DEMO_DIR/tampered.json"
```

**Run — check the changed copy:**

```bash
node "$SEAL_CHECKER" "$SEAL_DEMO_DIR/tampered.json" --pubkey "$SEAL_DEMO_DIR/receipt-signer.pub"
```

**Run — confirm that refusal was the expected exit status:**

```bash
test "$?" -eq 1
```

**Do:** Run the three commands in order, with nothing between the last two because `test` checks the preceding command's status. You do not edit the original receipt.

**Output:**

```text
REFUSE decision_binding_mismatch: the recorded decision does not match its sealed commitment
```

**Look at:** `REFUSE decision_binding_mismatch`. Changing the recorded decision broke its sealed commitment, so the same checker rejected the copy.

> Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

### Repository transcript instrumentation (not a walkthrough step)

The repository's reproducibility check runs the demo through this harness to capture its output and recover its generated directory. Readers following the ten steps above do not run it.

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

## 3. Protect

`seal protect` needs the `claude` command and a project whose `.mcp.json` has a stdio MCP server. Before recording protection, Seal starts the server, lists its tools, and refuses unless the requested tool is among them. Discovery allows 5000ms per phase; if a server needs longer, the refusal names `--timeout-ms`, which also governs the activation re-check. The `.mcp.json` below is a stand-in, pointing at Seal's demo server in this transcript's scratch run.

```sh
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

```
Project .mcp.json hash before protect: 23435a951a3532cbca051f1fe8b978d153f5dc38ade8c6cb3942954406cb84e2
Protection: PENDING RESTART db.demo.mutate
Protection scope: 0 other tools NOT APPROVAL-GATED (they pass through Seal)
State: /home/monkey/scratch/toolexists-readme-20260815/final-home/.local/share/seal/projects/4198aa21a911c2c7e9899c24a49e6b28/state.json
```

`protect` reports how many of that server's tools are not approval-gated, naming at most 20 and counting the rest. Those calls still route through Seal's proxy, where live server-entry drift or a lease-generation mismatch can refuse forwarding. It then invokes Claude Code's `claude mcp add` to install a local override, private to you, routing the `db` server through Seal's proxy. It does not edit `.mcp.json`. Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/` while it installs that override. Seal invokes Claude Code but does not write either file. The override takes effect when Claude Code next starts, so `protect` ends PENDING RESTART, never ACTIVE. At activation Seal repeats the discovery; a vanished tool makes the stored state BROKEN instead of silently forwarding around a stale name. If the server entry in `.mcp.json` changes after protect, forwarding refuses instead of forwarding a drifted call.

The protected proxy records every decision as a signed receipt file. On first activation it creates a machine-local Ed25519 receipt key under the Seal data directory, prints the public key and its file path, and reuses that key on later activations. The shipped checker accepts a protected-path receipt when every recorded commitment and signature matches under the public key you supply. That result has the limits printed by the checker: it does not show that the recorded decision happened, and anyone able to use the machine's Seal key could sign a different story.

Seal states its trust assumption:

```sh
seal doctor
```

```
ASSUMPTION
  Seal has not established whether this Claude Code configuration can
  automatically answer elicitation requests.
```

## 4. Remove

```sh
cd "$SEAL_PROTECT_PROJECT"
seal unprotect db
```

```
Project .mcp.json hash before unprotect: 23435a951a3532cbca051f1fe8b978d153f5dc38ade8c6cb3942954406cb84e2
Project .mcp.json hash after unprotect: 23435a951a3532cbca051f1fe8b978d153f5dc38ade8c6cb3942954406cb84e2
Protection: - outside Seal
```

The project file is byte-identical before and after. `unprotect` invokes Claude Code's `claude mcp remove` to remove only the local override. It does not delete Claude Code's `~/.claude.json` or backups under `~/.claude/backups/`; those files remain. The store is read-only, so make it writable before removing Seal itself:

```sh
chmod u+w ~/.local/bin/seal && rm ~/.local/bin/seal
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
- One project, one server, one selected tool. Bash, network, subprocesses and other servers are outside Seal. Other tools on the protected server are not approval-gated, but pass through Seal's forwarding checks; other controls may or may not exist outside Seal.
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
