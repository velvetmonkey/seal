# Choosing what to protect

Seal protects a declared set of tools on each selected MCP server in a project. This page
is about making that choice well, and about what `seal protect` does and — just
as important — what it leaves alone.

## The judgement call

Open your project's `.mcp.json` and look at each server's tools (Claude Code's
`/mcp` screen lists them, and so does the server's own documentation). Choose
the set whose calls you need to stop for approval, based on what each call
can actually do, not on whether it is labelled a read or a write.

Ask, for each tool: *if Claude Code called this once, with arguments I never
saw, what is the worst that happens?* Judge that by consequence, not by verb:

- **Destructive or irreversible changes** — deletes, drops, truncates,
  overwrites, force-pushes: anything that loses or corrupts data you cannot
  get back.
- **External sends** — anything that leaves your machine: publishes, pays,
  emails, posts, or calls another service. Once it is sent, you cannot
  unsend it.
- **Sensitive reads** — a "read" tool is not automatically harmless. A tool
  that can read secrets, private messages, customer data, or anything you
  would not want exfiltrated is a real risk even though it never writes
  anything. Reading is how data leaves a system just as surely as sending
  does.
- **Credential or privilege access** — anything that can read, mint, or use
  an API key, token, password, or session that grants further access beyond
  the tool call itself.

A tool that only lists or searches over data you would not mind Claude Code
seeing and does not touch any of the categories above is a reasonable one to
leave ungated. Name every tool in the set that warrants the gate.

The bundled demo is the useful contrast: `demo.mutate` appends to its demo data
file, while `demo.erase` truncates it. They are different risks; naming both
when both need approval is the point of choosing a set rather than selecting a
single winner.

The worked example on this page uses the demo server Seal already ships. Make
an empty project directory, enter it, and create the data file the demo server
uses:

```bash
$ mkdir choosing-demo && cd choosing-demo
$ : > demo-data.txt
```

Then declare the shipped server in `.mcp.json`. The data-file path is relative
to the project directory:

```json
{
  "mcpServers": {
    "demo": {
      "type": "stdio",
      "command": "seal",
      "args": ["__demo-server", "./demo-data.txt"]
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

## When Seal fits, and when it does not

**The route boundary shapes the audience.** Seal is strongest where a
consequential operation already has one deliberate MCP entry point. It gates
a decision at that tool call; it does not close off every other way an agent
or a person could reach the same effect. It is weaker where the same
capability is reachable through several uncontrolled routes.

Before choosing tools, ask: *does the operation I care about actually have to
cross this MCP route?* A deliberate approval point is useful when your
workflow already concentrates that operation there. If you need to prevent
the effect by every possible route, gating one call is not enough.

Here are two worked calls to the bundled server, with both tools selected
for approval using the [complete-set setup below](#what-seal-protect-does).
The JSON shows MCP tool-call parameters, not shell commands. These calls were
exercised through Seal's shared proxy against the bundled demo server.

1. **Appending a line with `demo.mutate`.** Call with:

   ```json
   {"name":"demo.mutate","arguments":{"line":"keep this line"}}
   ```

   While approval waited, the file was empty and the server's call count was
   zero. After approval, it contained `keep this line` followed by a newline,
   and the count was one. This is a useful gate if the decision you need is
   whether this exact append may pass through the deliberate MCP entry point.

2. **Discarding those contents with `demo.erase`.** Call with:

   ```json
   {"name":"demo.erase","arguments":{}}
   ```

   Declining preserved the line and left the server's count at one. A fresh
   call, approved, emptied the file and raised the count to two. This is a
   different consequence from appending: if losing the contents needs your
   decision, select erase as well. For how a decline applies to a request,
   see [declined](when-something-looks-wrong.md#declined).

**Weak fit: treating that same file as protected from all changes.** If the
agent can also write it through a shell, direct file access or another server,
gating these MCP calls gives a false sense of safety if you take it to mean
that every change needs approval. The bundled demo demonstrates the gap:

```bash
$ seal demo
```

Answer `y` at its approval prompt. After the approved append and blocked
replay, the demo writes directly to the same file: the file changes, the
protected-server call count stays at one, and there are zero new Seal
decisions. That is a weak fit for preventing unapproved file changes, even
though the MCP approval gate works. See [What it leaves alone](#what-it-leaves-alone)
for the boundary, and [What is protected right now](what-is-protected-right-now.md)
for interpreting the route's current state. A live wrapper does not establish
that every route to the capability is controlled.

## What `seal protect` does

Run it in the project directory, naming the server and the complete tool set.
For the `demo` server declared above, `demo.mutate` appends to the demo data
file and `demo.erase` empties it. Both warrant the gate, so name the complete
set:

```bash
$ seal protect demo demo.mutate demo.erase
```

```output
Project .mcp.json hash before protect: ee4ddc490173e87d0b347f3eac86e041042f2c48f4230fe5f3036fd809f68c1c
Sealed MCP route demo: PENDING RESTART (/home/you/.local/share/seal/projects/b74bc86b66b5e27d972ab304ef2298e9/servers/demo/state.json)

Gated through this route:
  demo.mutate
  demo.erase

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection scope: 0 other tools NOT APPROVAL-GATED (they pass through Seal)
State: /home/you/.local/share/seal/projects/b74bc86b66b5e27d972ab304ef2298e9/servers/demo/state.json
Next:
  1. Restart Claude Code in this project.
  2. Run `seal status`.
  3. Expect ACTIVE while Claude Code runs this project's wrapper; STALE after the session exits.
Undo:
  To clear protection for every guarded tool on server demo, including guarded tools: demo.mutate, demo.erase, stop Claude Code, then run `seal unprotect demo`.
```

Exit code: `0`.

When other tools are not approval-gated, `protect` reports their total,
naming at most 20 and counting the rest.

The same server cannot be extended by running `protect` again; the second
command was refused. The refusal is written to stderr, and stdout is empty:

```bash
$ seal protect demo demo.mutate demo.erase
```

```output
seal: REFUSE already_protected: server "demo" is already PENDING RESTART
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
   the name `demo` now starts Seal's wrapper, and the wrapper starts your
   real server behind the gate. Local scope is private to your machine — it
   is not written to `.mcp.json` and teammates never see it.
3. **It printed the hash of your `.mcp.json`** so you can see it was not
   touched. `seal protect` never edits that file.

Claude Code writes `~/.claude.json` and a backup under `~/.claude/backups/`.
Seal invokes Claude Code but writes neither file.

`PENDING RESTART` means the gate is installed but not yet standing: restart
Claude Code in this project to load the local override. The state becomes
`ACTIVE` when the Seal wrapper starts; if Claude Code shows `Select login
method`, sign in first so the interactive session can start it. Until then,
calls to the server go through Claude Code's existing connection, exactly as before.

## What it leaves alone

This is most of the answer, and it is deliberate.

- **Your `.mcp.json`.** Untouched, byte for byte. The hash printed at protect
  time and the hash printed at unprotect time are the same file.
- **When an ACTIVE wrapper or session is running for a healthy, non-drifted
  gate, every other tool on the protected server flows through the gate
  unasked.** From a live run against
  the protected `demo` server:

  ```output
  tools/list through the proxy: demo.mutate, demo.erase
  ```

  Both tools wait for approval because both are guarded.
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
$ seal unprotect demo
```

```output
Project .mcp.json hash before unprotect: ee4ddc490173e87d0b347f3eac86e041042f2c48f4230fe5f3036fd809f68c1c
Project .mcp.json hash after unprotect: ee4ddc490173e87d0b347f3eac86e041042f2c48f4230fe5f3036fd809f68c1c
Sealed MCP route demo: - outside Seal (/home/you/.local/share/seal/projects/b74bc86b66b5e27d972ab304ef2298e9/servers/demo/state.json)

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
  Run `seal protect demo demo.mutate demo.erase`.
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

## Several servers in one project

Run `seal protect SERVER TOOL [TOOL...]` once for each server and its complete
selection. `seal status` prints each stored server's route, tools, lease and
receipts. `seal unprotect SERVER` removes only that server's override; the
other servers keep their gates. A configured server without an override is
named under the other wrappers' `Not controlled` lists. Those lists describe
each wrapper's boundary, even when another Seal wrapper protects that server.

New records live at `projects/<id>/servers/<encoded-server-name>/state.json`.
Server names are encoded as single directory components. Existing records at
`projects/<id>/state.json` are included on every read and stay authoritative
there: this compatibility migration leaves the original override, live wrapper,
approval journal and receipts in place. It performs no one-shot move or copy.
An upgrade therefore needs no re-protect operation for an existing server.

The lock remains per project. It serializes activation, recovery and the
configuration-writing part of protect/unprotect, then releases. A concurrent
operation refuses with `proxy_lease_active` and the owner's PID; retry after
the operation finishes. The lock is not held during a running proxy session,
so two activated servers can gate calls concurrently with independent leases.
For incompatible state in a project with several records, select the route
with `seal recover --archive SERVER`; recovery of the other routes is separate.

Previous: [Guide](README.md).
Up: [Guide](README.md).
Next: [Knowing it worked](knowing-it-worked.md).
