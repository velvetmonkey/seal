# Choosing what to protect

Seal protects exactly one tool of one MCP server per project. This page is
about making that choice well, and about what `seal protect` does and — just
as important — what it leaves alone.

## The judgement call

Open your project's `.mcp.json` and look at each server's tools (Claude Code's
`/mcp` screen lists them, and so does the server's own documentation). Most
tools are harmless: they read, they search, they list. Protect the one whose
worst possible call you could not undo.

Ask, for each tool: *if Claude Code called this once, with arguments I never
saw, what is the worst that happens?* A tool that reads files loses you
nothing. A tool that deletes, drops, sends, pays, or publishes can lose you
something real. That one gets the gate.

The running example in this guide is a small `notes` server with two tools:
`append_note`, which adds a line to a file, and `delete_all_notes`, which
deletes the file. One of those is worth an approval prompt.

```json
{
  "mcpServers": {
    "notes": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/monkey/scratch/opguide-run/project/notes-server.cjs"]
    }
  }
}
```

Two constraints to know before you choose:

- The server must be a `stdio` server — one your project starts as a local
  process. Seal refuses `http` and other remote types, because it works by
  standing between Claude Code and the server process, and there is no local
  process to stand in front of.
- One tool per project. If two tools on the server scare you, that is worth
  knowing before you commit; today the gate holds one name.

## What `seal protect` does

Run it in the project directory, naming the server and the tool:

```
$ seal protect notes delete_all_notes
Project .mcp.json hash before protect: 524bf3d4181dcf010cd7ecd27a19014c5f648326e9e690f2413ff3c5d24f7023
Protection: PENDING RESTART notes.delete_all_notes
State: /home/monkey/scratch/opguide-run/home/.local/share/seal/projects/9852104386c7756d6abbd76408f7014b/state.json
```

Three things happened, and only three:

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

`PENDING RESTART` means the gate is installed but not yet standing: Claude
Code only picks up the override when it starts. Restart Claude Code in this
project and the state becomes `ACTIVE`. Until then, calls to the server go
through Claude Code's existing connection, exactly as before.

## What it leaves alone

This is most of the answer, and it is deliberate.

- **Your `.mcp.json`.** Untouched, byte for byte. The hash printed at protect
  time and the hash printed at unprotect time are the same file.
- **Every other tool on the protected server.** They flow through the gate
  unasked. From a live run against the protected `notes` server:

  ```
  tools/list through the proxy: append_note, delete_all_notes
  append_note (not the guarded tool): appended one line to notes.txt
  ```

  `append_note` ran with no prompt. Only `delete_all_notes` waits for
  approval.
- **Every other server in the project.** Seal never reads or touches their
  entries.
- **Everything that is not this server's MCP traffic.** The approval prompt
  itself names the boundary every time:
  `Outside Seal: Bash, network, subprocesses, other tools and servers.`
  If the same effect can be reached by a route that does not pass through the
  gate — Claude Code writing the file directly, a shell command, another
  server — Seal does not see it and does not claim to. `seal demo` ends by
  demonstrating exactly this, on purpose.

## Taking the gate down

```
$ seal unprotect notes
Project .mcp.json hash before unprotect: 524bf3d4181dcf010cd7ecd27a19014c5f648326e9e690f2413ff3c5d24f7023
Project .mcp.json hash after unprotect: 524bf3d4181dcf010cd7ecd27a19014c5f648326e9e690f2413ff3c5d24f7023
Protection: - outside Seal
```

The local override is removed, the two hashes tell you `.mcp.json` was never
touched, and the project is back to plain Claude Code. If a Claude Code
session is still running with the wrapper, `seal unprotect` refuses with
`active_claude_session` until you stop it — taking the gate down mid-session
is exactly the kind of silent change the gate exists to prevent.

Next: [What is protected right now](what-is-protected-right-now.md).
