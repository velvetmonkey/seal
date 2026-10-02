# Protect your first tool

This five-step walk guards only `demo.erase` on a disposable `db` MCP server. `demo.mutate` still reaches the server without a Seal approval. The captured client calls below used an adapted copy of [Seal's synthetic Claude Code client](../../harness/claude-code/synthetic-client.cjs), configured for `db` and the two demo tools. Its approval text is **not** a real Claude Code dialog. A human Claude Code acceptance walk remains separate.

## Prerequisites

Install Seal using the [verified installer](../start/install.md), install and sign in to Claude Code, and make both `seal` and `claude` available on `PATH`. Use Node 22 or newer for Claude Code. The captured walk used a fresh build installed in a disposable prefix, rather than an uninstalled source checkout: approving from an uninstalled checkout stopped at `runtime_tree_unknown` before `demo.erase` ran.

## 1. Set up a disposable project

Run these in an empty directory where you can leave the demo's data files. The capture used `/mnt/scratch/lanes/sealfirsttoolwalk/cold/project`.

```bash
git init -q
printf '%s\n' '{"mcpServers":{"db":{"command":"seal","args":["__demo-server","./data.txt"]}}}' > .mcp.json
find . -type f | sort | xargs sha256sum
```

The last command captures project bytes before protection. Its `.mcp.json` line was:

```output
aacdd2ef4696c853be3fffab5519e6ee5ff1a351c0da6c982b21650d4d349e05  ./.mcp.json
```

## 2. Protect only the erase tool

Stop any Claude Code session in this project, then run:

```bash
seal protect db demo.erase
```

The capture printed these lines:

```output
Gated through this route:
  demo.erase
Protection scope: 1 other tool NOT APPROVAL-GATED (they pass through Seal): demo.mutate
```

Protection installed a private local Claude Code override; it left `.mcp.json` unchanged. The full output also named the state file and said `PENDING RESTART`. Keep that printed state path: replace `state.json` with `receipts` to obtain the receipts directory used in step 5.

## 3. Restart and check readiness

Start Claude Code in this project. If it asks whether to enable the project MCP server, accept. Keep that session open and run `seal status` from another terminal in this same directory:

```bash
seal status
```

Before the client connected, the captured status said:

```output
Observation client: Claude Code static configuration; effective client route UNKNOWN
  BROKERED — Local MCP entry "db" matches Seal's installed wrapper; this wrapper gates demo.erase. Client use of this entry is UNKNOWN.
Sealed MCP route db: PENDING RESTART (/mnt/scratch/lanes/sealfirsttoolwalk/cold/xdg/seal/projects/3c3eddb5aed87a8793c1039c9e2c0016/servers/db/state.json)
Gated through this route:
  demo.erase
Not controlled:
  Bash and subprocesses outside this MCP route
```

While the synthetic client held the wrapper open, the same command printed:

```output
Observation client: Claude Code static configuration; effective client route UNKNOWN
  BROKERED — Local MCP entry "db" matches Seal's installed wrapper; this wrapper gates demo.erase. Client use of this entry is UNKNOWN.
Observed client: seal-cc-synthetic-stand-in 0.0.0-synthetic-stand-in (self-asserted, unsigned)
Sealed MCP route db: LEASE ACTIVE (/mnt/scratch/lanes/sealfirsttoolwalk/cold/xdg/seal/projects/3c3eddb5aed87a8793c1039c9e2c0016/servers/db/state.json); authorization runtime judgment is evaluated for each approval.
Gated through this route:
  demo.erase
Not controlled:
  Bash and subprocesses outside this MCP route
```

`LEASE ACTIVE` says a wrapper is running. Status still says effective client routing is **UNKNOWN**; it does not confirm which route Claude Code used. If it remains `PENDING RESTART`, use [the protection state guide](what-is-protected-right-now.md#pending-restart).

## 4. Append, then try to clear

In the client, call `db`'s `demo.mutate` with `{"line":"first line"}`. The synthetic client showed the tool result below and no approval dialog:

```output
tools: demo.mutate, demo.erase
result: {"content":[{"type":"text","text":"demo server: appended 11 bytes to data.txt; total tool calls: 1"}]}
```

Next call `db`'s `demo.erase` with `{}`. The synthetic client displayed the approval request below. Choose **Decline** first:

```output
  Tool: demo.erase; Approval required
  Approve one run: demo.erase
  Accept    Decline
the stand-in answers: decline
result: {"content":[{"type":"text","text":"approval refused: declined — the answer was decline; denial is terminal for this request"}],"isError":true}
```

The lane ran `sha256sum data.txt` after append and decline. Both outputs were identical:

```output
812702a1550d251abb2b813409daf5960269f1b9d62fa1c027c319e7baca3ae8  data.txt
```

Call `db`'s `demo.erase` with `{}` again and choose **Accept**. The synthetic client showed the tool result separately from Seal's recorded decision:

```output
  Tool: demo.erase; Approval required
  Approve one run: demo.erase
  Accept    Decline
the stand-in answers: accept
result: {"content":[{"type":"text","text":"demo server: erased data.txt; total tool calls: 2"}]}
```

After approval, `sha256sum data.txt` printed the empty-file digest:

```output
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  data.txt
```

Once the captured client exited, `seal status` showed the wrapper's previous lease was stale. Client routing remained unknown:

```bash
seal status
```

```output
Observation client: Claude Code static configuration; effective client route UNKNOWN
Sealed MCP route db: STALE (/mnt/scratch/lanes/sealfirsttoolwalk/cold/xdg/seal/projects/3c3eddb5aed87a8793c1039c9e2c0016/servers/db/state.json)
Gated through this route:
  demo.erase
Not controlled:
  Bash and subprocesses outside this MCP route
```

## 5. Inspect and undo

Use the receipts directory beside the state file that `seal protect` printed. This is the actual path from the captured walk; substitute your printed path on your machine:

```bash
seal history /mnt/scratch/lanes/sealfirsttoolwalk/cold/xdg/seal/projects/3c3eddb5aed87a8793c1039c9e2c0016/servers/db/receipts --limit 5
```

The captured history reported the two decisions, separately from the tool result:

```output
Matching decision claims observed: 2; ALLOW 1; BLOCK 1; additional matches not observed
1790622370000 ALLOW tool "demo.erase"
1790622367000 BLOCK tool "demo.erase"
```

Stop Claude Code before removing the override. Then run:

```bash
seal unprotect db
find . -type f | sort | xargs sha256sum
```

Unprotect reported:

```output
Project .mcp.json hash before unprotect: aacdd2ef4696c853be3fffab5519e6ee5ff1a351c0da6c982b21650d4d349e05
Project .mcp.json hash after unprotect: aacdd2ef4696c853be3fffab5519e6ee5ff1a351c0da6c982b21650d4d349e05
Sealed MCP route db: - outside Seal (/mnt/scratch/lanes/sealfirsttoolwalk/cold/xdg/seal/projects/3c3eddb5aed87a8793c1039c9e2c0016/servers/db/state.json)
Gated through this route:
  none
Not controlled:
  Bash and subprocesses outside this MCP route
```

Check status after unprotect:

```bash
seal status
```

```output
Observation client: Claude Code static configuration; effective client route UNKNOWN
Sealed MCP route db: - outside Seal (/mnt/scratch/lanes/sealfirsttoolwalk/cold/xdg/seal/projects/3c3eddb5aed87a8793c1039c9e2c0016/servers/db/state.json)
Gated through this route:
  none
Not controlled:
  Bash and subprocesses outside this MCP route
```

Comparing the full `find` outputs before protect and after unprotect left only the demo's `data.txt` and `data.txt.count` files in the project. The private Claude Code configuration file at `/mnt/scratch/lanes/sealfirsttoolwalk/cold/config/.claude.json` changed when the local override was removed; its `db` entry no longer pointed at Seal. Delete this disposable project when finished.

Up: [Guide](README.md).
