<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Docs & claims consistency](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml)

## Contents

- [1. Install](#1-install)
- [2. Demo](#2-demo)
- [Where this fits](#where-this-fits)
- [3. Protect](#3-protect)
- [4. Remove](#4-remove)
- [What Seal covers, and what it does not](#what-seal-covers-and-what-it-does-not)
- [License](#license)

The [full documentation index](docs/README.md) links the operating guide,
evidence, limitations, and design history.

Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a receipt of the decision. Today only the demo signs its receipts, with a key it generates for that run; the protected path writes its receipts unsigned.

Seal is a gate, not a sandbox: it controls the path through it, and only that path.

The authorization rule is PROVED. The state machine is TESTED. On a guarded
retry, Node owns handle lookup, freshness, protocol shape, and durable one-use
consumption; the exact-call authorization rule runs through the pinned vendored
WASM, and its answer is required before forwarding. Kernel failure or a
Node/kernel disagreement refuses—there is no JavaScript authorization
fallback. The kernel configuration is currently signed by an Ed25519 key
generated inside the same worker that submits it. That is demo-grade
self-authorization, not an externally trusted production config key.

The situation it is built for: your project's `.mcp.json` has an MCP server
whose tools are mostly harmless — schema reads, lookups, drafts — and one
tool that is not: the one that executes SQL on a shared database, issues a
refund, merges the pull request. Seal puts its gate in front of exactly that
one tool and passes the rest of that server's tools straight through.

**Seal v0.1.1 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.**

What it costs you: Node 20 or later, Git, one command and one read-only store directory installed under `~/.local`, the `claude` command for Protect (check with `claude --version`), and one restart of Claude Code when you protect a tool. What it does not cover is listed at the end, before the license.

Every command below was run, in this order, on one Linux x86-64 machine against the bytes pinned in [`SHA256SUMS`](SHA256SUMS). The output under each command is the output that run printed.

## 1. Install

```sh
cd /tmp
git clone https://github.com/velvetmonkey/seal
cd seal
node scripts/build-dist.cjs
./dist/seal-v0.1.1-linux-x64 --sha256 8e69aa4d23214c6a6b438462b5471de92431cbd28e94ef3d07e1d6de1109c149 --bytes 6118685 --prefix ~/.local
```

```
/home/monkey/wt/demodir/dist/seal-v0.1.1-linux-x64
sha256 8e69aa4d23214c6a6b438462b5471de92431cbd28e94ef3d07e1d6de1109c149
bytes 6118685
tree 3e6e891a47f8e85b997317f191ff5146ec016132aa99759543e8d93f60951427
installed seal 0.1.1 linux-x64
store: /tmp/seal-demodir-prefix.Ju6uoy/lib/seal/store/3e6e891a47f8e85b997317f191ff5146ec016132aa99759543e8d93f60951427
command: /tmp/seal-demodir-prefix.Ju6uoy/bin/seal
tree 3e6e891a47f8e85b997317f191ff5146ec016132aa99759543e8d93f60951427
```

The `--sha256` and `--bytes` values are the published pin from [`SHA256SUMS`](SHA256SUMS); the build you just ran must reproduce them or the installer refuses. The installer also refuses without a pin, refuses altered bytes by name (`artifact_digest_mismatch`), and on any platform other than Linux x86-64 refuses before changing any file. Add `~/.local/bin` to PATH before continuing:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

## 2. Demo

The demo builds a working gate in miniature, on your machine, in about a
minute. It starts a tiny MCP server as a hidden child process — that server is
this same `seal` binary playing the server role, so nothing else is involved —
and puts Seal's proxy between you and that child's one tool, `demo.mutate`,
which appends a line to a real file. The child also keeps a count file on disk
and bumps it each time the tool actually runs. That counter is the evidence to
watch: the demo reads it back to you at every step, and it is the difference
between a story about what happened and a file you can check.

```sh
seal demo
```

The first lines set the table — who is playing, then the counter's starting
value:

```
seal demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt
temporary demo directory: /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2 (remains after the demo for the printed checker command)
child calls observed: 0 (read from /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/child/data.txt.count)
```

The `tool` line names the single tool this run guards. The `child` line names
what stands behind the gate: seal itself, launched as the demo's server,
writing to a real file in the temporary directory it just printed. And `child
calls observed: 0` is the counter, read from the child's own count file. **The
counter is the ground truth of this walk: it moves only when the guarded tool
actually runs**, and it starts at zero.

Now the demo's client asks for the guarded tool. Instead of running anything,
the proxy stops and shows you the request:

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

Read the message the way you would sign it. `Tool` and `Arguments` are the
exact parsed call. `Scope` is how narrow your yes will be: this identical call
(down to argument key order and how the numbers are spelled), at most one run,
expiring in two minutes. `Outside Seal` is what your yes does not cover. And
the last line re-reads the counter: still 0. Showing you the request executed
nothing.

Type `y` and three things happen in a row: the call runs once, the demo
replays it, and the replay is refused. (Your `y` is consumed by the prompt, so
in the transcript the child's reply lands on the same line as the question.)

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

The counter has now told the whole story: 0 before anything ran, still 0 while
the approval sat on screen, 1 after your yes — exactly one run — and **still 1
after the replay: the identical retry was refused, because the one approval it
depended on was already spent.** Each decision along the way — approval
requested, call allowed, replay blocked — was written down as its own receipt
file; those paths matter in a moment.

What comes next is the part most tools leave out. `SCOPE WITNESS` is the demo
stating its own boundary, starting with the one path it controlled:

```

SCOPE WITNESS

Seal controlled this path:
  demo client -> Seal -> demo MCP server -> demo.mutate

If a route to the same effect does not pass through the printed Seal path, Seal did not control it.
```

That second sentence is a rule, and the demo now proves the rule is real by
breaking it on purpose — writing a file directly, without crossing the gate:

```
Now the demo performs a harmless direct local write
that does not cross the Seal gate.

DIRECT WRITE SUCCEEDED
Seal decisions emitted: 0 (receipts in /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts: 3 before the write, 3 after)
```

**The write succeeded and Seal emitted nothing for it** — same receipts before
and after. A route that does not cross the gate is a route Seal does not see,
which is what "a gate, not a sandbox" means. The demo closes by saying exactly
that, and by handing you a command to check one of its receipts:

```
Seal is a gate, not a sandbox: it controls the path through it, and only that path.
summary: approval matched the effect, one child call observed, replay refused; 3 receipts written; one write happened outside Seal.
receipts are claims, not proofs. Check one with the separate-process checker (V11-RECEIPT-01). It imports no Seal module at check time, but it carries a byte-identical copy of Seal's canonicalisation rule and uses the same Node crypto platform. It can detect a changed receipt against your trusted key; it cannot detect a defect shared by that rule or platform. It ships in this same artifact, so it also cannot protect against a replaced artifact:
  node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/3e6e891a47f8e85b997317f191ff5146ec016132aa99759543e8d93f60951427/checker/seal-receipt-check.mjs" "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json" --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
```

The demo just called its own receipts claims, not proofs, so take it at its
word and check one. The command it printed runs the packaged checker — a
separate process that imports no Seal module at runtime, but copies the gate's
canonicalisation rule and shares its Node crypto platform — against the BLOCK
receipt the refused replay produced, using your run's own paths. Here is that
command from the run above, run as printed:

```sh
node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/3e6e891a47f8e85b997317f191ff5146ec016132aa99759543e8d93f60951427/checker/seal-receipt-check.mjs" "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json" --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
```

```
ACCEPT BLOCK demo.mutate — decision, tool, arguments and signature all match the sealed commitments
```

Change one recorded field and the same checker refuses:

```sh
sed 's/"decision": "BLOCK"/"decision": "ALLOW"/' /home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipts/receipt-1786793452633-3115472-0003-BLOCK.json > /home/monkey/scratch/docsland-reader-walk-run/tampered.json
node "/home/monkey/scratch/docsland-reader-walk-run/home/.local/lib/seal/store/3e6e891a47f8e85b997317f191ff5146ec016132aa99759543e8d93f60951427/checker/seal-receipt-check.mjs" /home/monkey/scratch/docsland-reader-walk-run/tampered.json --pubkey "/home/monkey/scratch/docsland-reader-walk-run/tmp/seal-demo-aJvvA2/receipt-signer.pub"
```

```
REFUSE decision_binding_mismatch: the recorded decision does not match its sealed commitment
```

The checker's `--pubkey` is a trust input. The demo generated that key for this one run — it is the very key that signed the receipt — so the check above establishes self-consistency and nothing more. For a receipt check to mean something, the verifying key must reach you from a source you already trust — not from the sealer, and not from beside the receipt. This signed-receipt cycle is the demo's today: the protected path below writes its receipts without a signature, and the same checker refuses them.

> Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human's choice; Seal cannot distinguish a human click from a client-generated acceptance.

## Where this fits

Seal v0.1.1 guards one tool of one stdio MCP server in one Claude Code project,
with you approving each exact call. That is narrow on purpose. It maps onto a
specific, recognisable moment: a server you already use all day, where almost
every call is harmless and one call is not.

**The database.** Your `.mcp.json` carries a Postgres MCP server so Claude
Code can read schemas and query data while you work. The reads are the point;
the tool that executes arbitrary SQL is the exposure — one UPDATE or DELETE
with the wrong WHERE clause against the shared staging database is an
afternoon of restore work. Protect that one tool and the reads keep flowing
exactly as before, while a call to it stops and shows you the statement it
parsed. You approve that statement, once; if the client re-sends the same
approved call, Seal refuses it instead of running it again.

**The money.** Stripe publishes an MCP server for agent workflows. An agent
doing support triage reads customers and charges harmlessly, but the refund
tool moves real money, and the classic failure there is not malice — it is a
timeout followed by a retry that issues the same refund twice. That failure is
the exact shape of Seal's contract: one approval for one parsed call, spent
when the call runs, refused (`already_consumed`) when the identical retry
arrives. Every decision is written down as a receipt file; on this protected
path those receipts are unsigned today, so treat them as your own local
record, not as evidence you could hand to someone else.

**The repository.** The GitHub MCP server runs locally over stdio. An agent
can triage issues, read pull requests and draft comments all day without
supervision; the tool that merges a pull request is different, because a wrong
merge lands on a shared branch and costs the rest of the morning to unwind.
Protect the merge tool and the triage continues untouched, while a merge
stops, shows you exactly which pull request it named, and runs only after
your yes — a yes that covers that call and no other.

In every case the boundary stays what the demo showed: Seal controls the path
through the proxy and only that path. Bash, the network, other tools and other
servers are outside it.

## 3. Protect

`seal protect` needs the `claude` command and a project whose `.mcp.json` already has a stdio MCP server. Check that command first with `claude --version`. Before recording protection, Seal starts that server, completes MCP `initialize`, calls `tools/list`, and refuses unless the requested tool is in the observed names. Discovery has a 5000ms deadline for each phase. If a legitimate server needs longer to cold-start or list its tools, run `seal protect --timeout-ms 15000 SERVER TOOL` (choosing a suitable deadline); the refusal names this flag. The selected deadline is also used for the activation re-check. The `.mcp.json` written below is a stand-in for the file your project already has, pointing at Seal's own demo server in the isolated scratch run used for this transcript.

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

`protect` reports how many tools returned by that server remain outside Seal, showing at most 20 names and the number omitted, then invokes Claude Code's `claude mcp add` to install a local override, private to you, that routes the `db` server through Seal's proxy. It does not edit `.mcp.json`. Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/` while it installs that override; Seal invokes Claude Code but does not write either file. The override takes effect when Claude Code next starts, so `protect` ends in PENDING RESTART, never ACTIVE. At activation Seal repeats the handshake and tool inventory; a vanished tool makes the stored state BROKEN instead of silently forwarding around a stale name. From that restart on, `demo.mutate` calls use the same rule the demo showed: Seal will not run the approved call twice, and it may spend the approval without running it. The demo and protected path run the same proxy and contract. If the server entry in `.mcp.json` changes after protect, forwarding refuses instead of forwarding a drifted call.

Receipts are the one place the two paths differ today. The protected proxy records every decision as a receipt file, but v0.1.1 mints no operator signing key, so those receipts carry no signature and the shipped checker refuses them: `REFUSE unsealed: receipt carries no seal; it cannot be checked`. Only the demo signs receipts today, with a key that exists only for that run. Where a durable operator key comes from is an open decision, so do not build anything on protected-path receipts passing the checker yet.

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
- Seal v0.1.1 is Linux x86-64 only. On any other platform the installer refuses before changing anything.

## License

Apache-2.0. See [LICENSE](LICENSE).
