# Choosing what to protect

Seal protects a declared set of tools on one MCP server per project. This page
is about making that choice well, and about what `seal protect` does and — just
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
      "args": ["/home/monkey/scratch/choosefix/walk/project/notes-server.cjs"]
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

Run it in the project directory, naming the server and the complete tool set.
For the `notes` server declared above, `append_note` adds one line to the notes
file and `delete_all_notes` empties it; by the question above, only the second
warrants the gate, so the set is one tool:

```bash
$ seal protect notes delete_all_notes
```

```output
Project .mcp.json hash before protect: 98f6a9de1a730b65ac4e460cf80d1e4c39fd363002799209336d1349c54e8d30
Sealed MCP route notes: PENDING RESTART (/home/monkey/scratch/choosefix/walk/runs/run1/home/.local/share/seal/projects/632eb55d096ea7eb80ff2423c952bdb5/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection scope: 1 other tool NOT APPROVAL-GATED (they pass through Seal): append_note
State: /home/monkey/scratch/choosefix/walk/runs/run1/home/.local/share/seal/projects/632eb55d096ea7eb80ff2423c952bdb5/state.json
Next:
  1. Restart Claude Code in this project.
  2. Run `seal status`.
  3. Confirm the sealed MCP route is ACTIVE.
Undo:
  To clear protection for every guarded tool on server notes, including guarded tools: delete_all_notes, stop Claude Code, then run `seal unprotect notes`.
```

Exit code: `0`.

When other tools are not approval-gated, `protect` reports their total,
naming at most 20 and counting the rest.

The same server cannot be extended by running `protect` again; the second
command was refused. The refusal is written to stderr, and stdout is empty:

```bash
$ seal protect notes delete_all_notes
```

```output
seal: REFUSE already_protected: project is already PENDING RESTART
Next:
  Run `seal status` to see the current protection before changing it.
```

Exit code: `1`.

The three user-visible changes are:

1. **Seal recorded the server as it is right now** — the exact `.mcp.json`
   entry, hashed — in a state file under your home directory (the `State:`
   path). If that entry later changes, Seal notices and refuses to forward to
   the changed server until you look at it.
2. **Seal asked Claude Code for a local override**: it ran
   `claude mcp add --scope local`, so that in this project, for you only,
   the name `notes` now starts Seal's wrapper, and the wrapper starts your
   real server behind the gate. Local scope is private to your machine — it
   is not written to `.mcp.json` and teammates never see it.
3. **It printed the hash of your `.mcp.json`** so you can see it was not
   touched. `seal protect` never edits that file.

Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/`.
Seal invokes Claude Code but writes neither file.

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
- **Everything that is not this server's MCP traffic.** Seal's message
  body and approve schema description name the boundary as `Outside Seal: Bash, network,
  subprocesses, other tools and servers.` In the recorded Claude Code 2.1.251
  dialog, the client folds that message-body line instead of painting it. That
  recording predates the boundary in the schema description, a channel it paints.
  If the same effect can be reached by a route that does not pass through the
  gate — Claude Code writing the file directly, a shell command, another
  server — Seal does not see it and does not claim to. `seal demo` ends by
  demonstrating exactly this, on purpose.

## Taking the gate down

```bash
$ seal unprotect notes
```

```output
Project .mcp.json hash before unprotect: 98f6a9de1a730b65ac4e460cf80d1e4c39fd363002799209336d1349c54e8d30
Project .mcp.json hash after unprotect: 98f6a9de1a730b65ac4e460cf80d1e4c39fd363002799209336d1349c54e8d30
Sealed MCP route notes: - outside Seal (/home/monkey/scratch/choosefix/walk/runs/run1/home/.local/share/seal/projects/632eb55d096ea7eb80ff2423c952bdb5/state.json)

Gated through this route:
  none

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Next:
  1. Run `seal status`.
  2. Confirm the sealed MCP route is outside Seal.
Undo:
  Run `seal protect notes delete_all_notes`.
```

The local override is removed; when the before and after hashes match, they
show that `.mcp.json` had the same bytes at those two observations, and the
project is back to plain Claude Code. If a Claude Code
session is still running with the wrapper, `seal unprotect` refuses with
`active_claude_session` until you stop it — taking the gate down mid-session
is exactly the kind of silent change the gate exists to prevent.

Unprotect asks Claude Code to remove only Seal's local override. It does not
delete `~/.claude.json` or backups under `~/.claude/backups/`. Those files
remain until you or Claude Code remove them.

Previous: [Guide](README.md).
Up: [Guide](README.md).
Next: [Knowing it worked](knowing-it-worked.md).
