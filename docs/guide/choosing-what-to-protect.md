# Choosing what to protect

Seal protects a declared set of tools on one MCP server per project. This page
about making that choice well, and about what `seal protect` does and — just
as important — what it leaves alone.

## The judgement call

Open your project's `.mcp.json` and look at each server's tools (Claude Code's
`/mcp` screen lists them, and so does the server's own documentation). Most
tools are harmless: they read, they search, they list. Choose the set whose
calls you need to stop for approval.

Ask, for each tool: *if Claude Code called this once, with arguments I never
saw, what is the worst that happens?* A tool that reads files loses you
nothing. A tool that deletes, drops, sends, pays, or publishes can lose you
something real. Name every tool in the set that warrants that gate.

The bundled demo is the useful contrast: `demo.mutate` appends to its demo data
file, while `demo.erase` truncates it. They are different risks; naming both
when both need approval is the point of choosing a set rather than selecting a
single winner.

```json
{
  "mcpServers": {
    "notes": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/you/project/notes-server.cjs"]
    }
  }
}
```

Two constraints to know before you choose:

- The server must be a `stdio` server — one your project starts as a local
  process. Seal refuses `http` and other remote types, because it works by
  standing between Claude Code and the server process, and there is no local
  process to stand in front of.
- The set is declared once, not added to later. Decide the complete list before
  you run `seal protect`: a later `seal protect` while the server is protected
  refuses `already_protected`. To change the list, unprotect the server, then
  protect the complete replacement set.

## What `seal protect` does

Run it in the project directory, naming the server and the complete tool set:

```bash
$ seal protect db demo.mutate demo.erase
```

```output
Project .mcp.json hash before protect: d46bf1f116eb99abcbb7d664032e5691bc4d217034dd96757a38a44c7ace10d8
Protection: PENDING RESTART db.{demo.mutate, demo.erase}
Protection scope: 0 other tools NOT APPROVAL-GATED (they pass through Seal)
State: /home/you/scratch/example/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/state.json
Next:
  1. Restart Claude Code in this project.
  2. Run `seal status`.
  3. Look for `Protection: ACTIVE`.
Undo:
  Stop Claude Code, then run `seal unprotect db`.
```

Exit code: `0`.

The same server cannot be extended by running `protect` again; the second
command was refused:

```bash
$ seal protect db demo.mutate demo.erase
```

```output
seal: REFUSE already_protected: project is already PENDING RESTART
```

Exit code: `1`.

The three user-visible changes are:

1. **Seal recorded the server as it is right now** — the exact `.mcp.json`
   entry, hashed — in a state file under your home directory (the `State:`
   path). If that entry later changes, Seal notices and refuses to forward to
   the changed server until you look at it.
2. **Seal asked Claude Code for a local override**: it ran
   `claude mcp add --scope local`, so that in this project, for you only,
   the name `db` now starts Seal's wrapper, and the wrapper starts your
   real server behind the gate. Local scope is private to your machine — it
   is not written to `.mcp.json` and teammates never see it.
3. **It printed the hash of your `.mcp.json`** so you can see it was not
   touched. `seal protect` never edits that file.

`PENDING RESTART` means the gate is installed but not yet standing: Claude
Code only picks up the override when it starts. Restart Claude Code in this
project and the state becomes `ACTIVE`. Until then, calls to the server go
through Claude Code's existing connection, exactly as before.

## What it leaves alone

This is most of the answer, and it is deliberate.

- **Your `.mcp.json`.** Untouched, byte for byte. The hash printed at protect
  time and the hash printed at unprotect time are the same file.
- **When an ACTIVE wrapper or session is running for a healthy, non-drifted
  gate, every other tool on the protected server flows through the gate
  unasked.** From a live run against
  the protected `notes` server:

  ```output
  tools/list through the proxy: append_note, delete_all_notes
  append_note (not the guarded tool): appended one line to notes.txt
  ```

  `append_note` ran with no prompt. Only `delete_all_notes` waits for
  approval.
- **Every other server in the project.** Seal reads the project configuration
  to find the selected server, but does not change the other servers' entries.
- **Everything that is not this server's MCP traffic.** The approval prompt
  itself names the boundary every time:
  `Outside Seal: Bash, network, subprocesses, other tools and servers.`
  If the same effect can be reached by a route that does not pass through the
  gate — Claude Code writing the file directly, a shell command, another
  server — Seal does not see it and does not claim to. `seal demo` ends by
  demonstrating exactly this, on purpose.

## Taking the gate down

```bash
$ seal unprotect notes
```

```output
Project .mcp.json hash before unprotect: 524bf3d4181dcf010cd7ecd27a19014c5f648326e9e690f2413ff3c5d24f7023
Project .mcp.json hash after unprotect: 524bf3d4181dcf010cd7ecd27a19014c5f648326e9e690f2413ff3c5d24f7023
Protection: - outside Seal
```

The local override is removed; when the before and after hashes match, they
show that `.mcp.json` had the same bytes at those two observations, and the
project is back to plain Claude Code. If a Claude Code
session is still running with the wrapper, `seal unprotect` refuses with
`active_claude_session` until you stop it — taking the gate down mid-session
is exactly the kind of silent change the gate exists to prevent.

Next: [What is protected right now](what-is-protected-right-now.md).
