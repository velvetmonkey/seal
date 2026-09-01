# What is protected right now

You should never have to remember what you protected. `seal status`, run in
the project directory, answers from the recorded state; `seal doctor` states
the one assumption approvals rest on. This page shows every line and every
state those two commands can print, from real runs.

## Reading `seal status`

A protected project before Claude Code has restarted:

```bash
$ seal status
```

```output
Runtime: present seal-assurance-kit@aa213304018ce72d754c6befcb0b6a77dd3e05e3
Sealed MCP route db: PENDING RESTART (/tmp/statusclaim-real-MdoUGT/home/.local/share/seal/projects/774d6ffe237e31bd44aec6f90753c037/state.json)

Gated through this route:
  demo.mutate
  demo.erase

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  configured MCP servers not routed through this Seal wrapper: cache
  other uncontrolled routes can also exist
Next:
  1. Restart Claude Code in this project.
  2. Run `seal status`.
  3. Confirm the sealed MCP route is ACTIVE.
Undo:
  To clear protection for every guarded tool on server db, including guarded tools: demo.mutate, demo.erase, stop Claude Code, then run `seal unprotect db`.
Receipts: 0 stored in /tmp/statusclaim-real-MdoUGT/home/.local/share/seal/projects/774d6ffe237e31bd44aec6f90753c037/receipts
Most recent: no receipt yet (receipt directory has no files; no decision has been recorded)
```

Exit code: `0`.

Three parts, always in this order:

- **Runtime** — a cached component that `seal verify` uses. Its presence does
  not decide whether your project is protected; see below.
- **Protection** — this project's one shared server state, then the guarded
  names: `server.tool` for one tool or `server.{tool, tool}` for several,
  followed by the path of the state file the answer came from. There is one
  lease for the server, not one lease per tool.
- **Receipts** — how many decision records exist and which one was written
  last. A protected project's receipts live in the `receipts` directory next
  to the state file, inside the same project data directory; the `Receipts:`
  line prints that exact path. Receipts are covered properly in
  [Knowing it worked](knowing-it-worked.md).

## Every protection state

Each block in this catalog is a contiguous protection excerpt from its own full
`seal status` run. The Runtime, guidance, and Receipts lines outside each
excerpt are omitted.

### `- outside Seal`

```output
Sealed MCP route: - outside Seal

Gated through this route:
  none

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  configured MCP servers not routed through this Seal wrapper: notes
  other uncontrolled routes can also exist
```

No gate in this project, so no calls are intercepted. This is also what you
see after a clean `seal unprotect`; its state record and past receipts can
still remain on disk.

### `PENDING RESTART`

```output
Sealed MCP route notes: PENDING RESTART (/home/monkey/scratch/recapture13-captures/guide-pending/home/.local/share/seal/projects/931a03760958af6d5115f8f8331dcf77/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
```

The gate is installed but no running Claude Code session has picked it up
yet. Calls made before the restart are **not** gated. Restart Claude Code in
this project. You will see `STALE`, with a detail line, after a session ends:

```output
Sealed MCP route notes: STALE (/home/monkey/scratch/recapture13-captures/guide-active-stale/home/.local/share/seal/projects/203647569f0f7890fcd9a3b0a88ce75e/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection lease: pid 358692 generation 1
Protection detail: previous wrapper lease is not live (generation 1); restart Claude Code to replace it
```

That is normal, not an error: the wrapper from the last session has exited,
and the next session will raise the gate again on start.

### `ACTIVE`

```output
Sealed MCP route notes: ACTIVE (/home/monkey/scratch/recapture13-captures/guide-active-stale/home/.local/share/seal/projects/203647569f0f7890fcd9a3b0a88ce75e/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection lease: pid 358692 generation 1
```

A live Claude Code session is running the wrapper right now. Calls to the
guarded names stop at the approval prompt; tools outside the declared set on
that server flow through.

Status reports only observable lease facts. A live pid and generation identify
the current holder as `ACTIVE`; a dead pid is `STALE` and recoverable by the
next wrapper, which takes the next generation. A second starter is refused at
startup with the holder pid and generation; that transient event is not a
project status and does not persist a conflict mode.

### `DRIFTED`

```output
Sealed MCP route notes: DRIFTED (/home/monkey/scratch/recapture13-captures/guide-drifted/home/.local/share/seal/projects/100846014db23d1ce923f95ac1f49019/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection detail: project .mcp.json server changed since protect; forwarding refused
```

The `notes` entry in `.mcp.json` is no longer the entry you protected — its
command, args, or env changed. Seal will not forward anything to a server it
did not show you, so the whole server is refused until you act. Two honest
ways out:

- The change was yours and intended: `seal unprotect notes`, then
  `seal protect notes delete_all_notes` again, so the gate binds to the new
  entry with your eyes open.
- The change was not yours or not intended: put the entry back exactly as it
  was and restart Claude Code. This was exercised in a real run — after
  restoring the entry and restarting the wrapper, the state returned to
  `ACTIVE` on its own.

`DRIFTED` is sticky on purpose. It does not clear because the file happens to
match again mid-session; it clears when a fresh wrapper starts against a
matching entry.

### `BROKEN`

`BROKEN` means the recorded state cannot be used safely. Three real forms:

```output
Sealed MCP route: BROKEN

Gated through this route:
  unknown: stored protection state has no protected tool list

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  configured MCP servers not routed through this Seal wrapper: notes
  other uncontrolled routes can also exist
Protection detail: stored protection state is unreadable: Unexpected token 'g', "garbage{" is not valid JSON
```

The state file is damaged (here it was deliberately corrupted). Seal refuses
to guess what it used to say.

```output
Sealed MCP route notes: BROKEN (/home/monkey/scratch/recapture13-captures/guide-broken-vanished/home/.local/share/seal/projects/18239a1b6be3bf11ec87c033cbd664fe/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection detail: protected_tool_vanished: protected tool "delete_all_notes" vanished before activation; observed tools: append_note
```

Here the server advertised `delete_all_notes` during `seal protect`, then no
longer advertised it when the proxy tried to activate. Seal refused activation
and recorded the whole route as broken instead of silently protecting a
different tool set.

For an activation failure like this one, restore the expected server and tool
set, unprotect the route, then protect the intended complete set again.

A related message you can see here:

```output
Sealed MCP route: BROKEN

Gated through this route:
  unknown: stored protection state has no protected tool list

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  configured MCP servers not routed through this Seal wrapper: notes
  other uncontrolled routes can also exist
Protection detail: stored protection state is from another binary version
```

The state was written by a different Seal version than the one answering.
`seal protect` and `seal unprotect` refuse with `incompatible_state` rather
than reinterpret another binary's records.

## The Runtime line

```output
Runtime: present seal-assurance-kit@aa213304018ce72d754c6befcb0b6a77dd3e05e3
```

The shipped runtime includes pinned, hash-checked kernel files under
`runtime/kernel/`; `seal status` checks those files, and `seal verify` loads
the local checker, which replays using the shipped kernel.
Three states:

- `Runtime: absent … (kernel/wasm/seal.js is unavailable)` — a checked
  shipped kernel file is unavailable; this is not the normal state when the
  shipped kernel is present.
- `Runtime: present …` — the checked shipped kernel files are present and
  match their pinned hashes; this status does not say that every manifest
  file, including the separate `src/verify.cjs`, is present in the shipped
  tree.
- `Runtime: integrity check failed … (kernel/wasm/seal.js hash mismatch;
  runtime bytes do not match the published runtime)` — one or more checked
  shipped kernel files do not match their pinned hashes, and Seal will not
  treat that shipped runtime as present.

## The Receipts lines

This contiguous excerpt is from the PENDING RESTART status run above,
immediately after `seal protect` created the project's empty receipts directory:

```output
Receipts: 0 stored in /home/monkey/scratch/recapture13-captures/guide-pending/home/.local/share/seal/projects/931a03760958af6d5115f8f8331dcf77/receipts
Most recent: no receipt yet (receipt directory has no files; no decision has been recorded)
```

After decisions exist, "Most recent (by write time)" means the newest receipt
file, not a verdict on your last session. A successful demo run ends with a
BLOCK receipt — the blocked replay — so a BLOCK can be the record of the gate
holding, not of something going wrong. Open the named file to see which call it
was.

Two less happy forms, both from real runs:

```output
Receipts: 0 stored in …/seal/receipts (directory does not exist)
Most recent: no receipt yet (receipt directory is missing)
```

On a fresh install before the first demo or protected call, nothing has yet
been decided, and status looks like this. A missing directory by itself does
not prove that history: an earlier receipt directory may have been removed.

```output
Receipts: unavailable in …/seal/receipts (directory cannot be read)
Most recent: receipts may exist, but the receipt directory cannot be read; check its permissions
```

The directory's permissions block reading; fix them and run `seal status`
again.

Producer output and the kernel replay path now share the one
`seal.receipt/v2` envelope. `seal status` reads its `action`, kernel `verdict`,
and exact kernel `now`; `seal verify` validates and replays that same file.

## `seal doctor`

`seal status` tells you which MCP route is sealed; `seal doctor` tells you what the
approval itself rests on:

```bash
$ seal doctor
```

```output
ASSUMPTION
  Seal has not established whether this Claude Code configuration can
  automatically answer elicitation requests.
```

That is the trust boundary stated plainly: Seal binds the approval to the
exact call, but it cannot prove a human clicked or determine the client's
elicitation configuration. If an auto-response signal is set in the process
environment, doctor refuses loudly:

```bash
$ SEAL_ELICITATION_AUTO_RESPONSE=1 seal doctor
```

```output
REFUSED
  Claude Code can automatically answer elicitation requests.
  Human approval origin cannot be assumed in this configuration.
REFUSE elicitation_hook_configured: an auto-response hook is set; human approval origin cannot be assumed
```

If you see that, an auto-response signal is set in your environment; remove it
before trusting any approval prompt in that session. If you do not see it,
Seal has not established whether Claude Code itself can answer elicitation
requests automatically.

Previous: [Choosing what to protect](choosing-what-to-protect.md).
Up: [Guide](README.md).
Next: [Knowing it worked](knowing-it-worked.md).
