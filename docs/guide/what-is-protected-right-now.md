# What is protected right now

Keep the complete `seal protect` selection when it includes an argument
predicate: status and the undo suggested by `seal unprotect` display only tool
names. `seal status`, run in
the project directory, answers from the recorded state; `seal doctor` states
the one assumption approvals rest on. This page shows protection states and receipt summaries from real runs;
status also reports receipt paths that are not directories and individual
unreadable receipts, whose output is not shown here.

## Reading `seal status`

A protected project before Claude Code has restarted:

```bash
$ seal status
```

```output
Runtime: present seal-assurance-kit@aa213304018ce72d754c6befcb0b6a77dd3e05e3
Sealed MCP route db: PENDING RESTART (/home/you/.local/share/seal/projects/f245ca9632a2147b4c4f6cbb08d8f8da/servers/db/state.json)

Gated through this route:
  demo.mutate
  demo.erase

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Next:
  1. Restart Claude Code in this project.
  2. Run `seal status`.
  3. Expect ACTIVE while Claude Code runs this project's wrapper; STALE after the session exits.
Undo:
  To clear protection for every guarded tool on server db, including guarded tools: demo.mutate, demo.erase, stop Claude Code, then run `seal unprotect db`.
Receipts: 0 stored in /home/you/.local/share/seal/projects/f245ca9632a2147b4c4f6cbb08d8f8da/servers/db/receipts
Most recent: no receipt yet (receipt directory has no files; no decision has been recorded)
```

Exit code: `0`.

The Runtime line prints once, followed by Protection and Receipts for each stored server record:

- **Runtime** — the pinned kernel runtime installed beside the command, which
  `seal verify` uses. Its presence does not decide whether your project is
  protected; see below.
- **Protection** — each server's shared protection state with the state file
  path in parentheses on the route line, then each guarded tool name on its
  own indented line under `Gated through this route:`. There is one
  lease for the server, not one lease per tool.
- **Receipts** — how many decision records exist and which one was written
  last. Receipts are covered properly in
  [Knowing it worked](knowing-it-worked.md).

## Every protection state

### `- outside Seal`

```output
Sealed MCP route: - outside Seal

Gated through this route:
  none

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
```

With no server records, this means no gate in this project. After
`seal unprotect SERVER`, status names that server as outside Seal; its state
record and past receipts can remain on disk. Other server records still
report their own protection. The examples below use retained legacy state
paths; new server records use `projects/<id>/servers/<server-name>/state.json`.

### `PENDING RESTART`

```output
Sealed MCP route notes: PENDING RESTART (/home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/state.json)

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
this project to load the local override. The state becomes `ACTIVE` when the
Seal wrapper starts; if Claude Code shows `Select login method`, sign in first
so the interactive session can start it. You will see `STALE`, with a detail
line, after a session ends:

```output
Sealed MCP route notes: STALE (/home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection lease: pid 4127 generation 6
Protection detail: previous wrapper lease is not live (generation 6); restart Claude Code to replace it
```

That is normal, not an error: the wrapper from the last session has exited,
and the next session will raise the gate again on start.

### `ACTIVE`

```output
Sealed MCP route notes: ACTIVE (/home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection lease: pid 4127 generation 6
```

The recorded Seal wrapper lease is live; this does not establish which client
is using it or whether [Claude Code selected the override and rendered
approval](../assurance/claude-code-evidence.md#the-release-gating-client-matrix).

Status reports only observable lease facts. A live pid and generation identify
the current holder as `ACTIVE`; a dead pid is `STALE` and recoverable by the
next wrapper, which takes the next generation. A second starter for the same server is refused at
startup with the holder pid and generation; that transient event is not a
project status and does not persist a conflict mode.

### `DRIFTED`

```output
Sealed MCP route notes: DRIFTED (/home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/state.json)

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

The `notes` entry in `.mcp.json` is no longer the entry you protected — the
digest of its whole server object changed, including any extra members, not
only command, args, or env. Seal will not forward anything to a server it
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

A failed state read is reported separately from a readable `BROKEN` record.
Two real forms:

```output
Stored protection state: could not be read
Protection detail: stored protection state is unreadable: Unexpected token 'g', "garbage{" is not valid JSON
Protected tool list: unreadable because the stored protection state could not be read
MCP routing: unknown because the stored protection state could not be read
Receipts: unavailable (receipt directory could not be resolved from broken protection state)
Most recent: unavailable because the project receipt directory could not be resolved
```

The state file is damaged (here it was deliberately corrupted; JSON parser
wording depends on Node). Status exits 1 because it could not read the stored
state, so it cannot establish the protected tool list or routing. The recovery
command handles unsupported schemas; it refuses malformed
JSON and leaves those bytes untouched.

```output
Sealed MCP route notes: BROKEN (/home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/state.json)

Gated through this route:
  delete_all_notes

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  other MCP servers not routed through this Seal wrapper
  other uncontrolled routes can also exist
Protection detail: protected_server_initialize_failed: configured server input failed during initialize: write EPIPE
```

The gate was installed, but when the wrapper started it could not bring up
the configured server, so it recorded `BROKEN` with the refusal token and
reason kept as the detail. Status exits 0 here because the record itself was
readable. `seal protect` refuses (`already_protected: server "notes" is already
BROKEN`); `seal unprotect notes` completes and returns the route to outside
Seal, because the recorded Seal ownership checks pass.

When instead the `claude mcp add` step fails during `seal protect`, the record
is `BROKEN` with Claude Code's error as its reason, but it carries no proof
that Seal owns an installed override. Seal did not finish installing the gate;
because the external command failed, check Claude Code's local override before
assuming it made no partial change.

What to do about that record is honest but currently not smooth:
`seal status` reports `REFUSED no_seal_owned_override` for that record, continues
through any other server records, and exits 1,
`seal protect` refuses (`already_protected: server "notes" is already BROKEN`) and
`seal unprotect` refuses with `no_seal_owned_override`. Unprotect accepts an
absent Claude Code override only when the recorded Seal ownership checks pass,
and still requires no live lease and successful removal or Claude Code's exact
local-scope absence diagnostic before it will finish. The working recovery, exercised for real, is in
[when-something-looks-wrong](when-something-looks-wrong.md#claude_install_failed).

A related message you can see here:

> `seal recover --archive` ships in the release this guide's install block installs. Stop Claude Code first. With a compatible or absent state it refuses with `recovery_not_needed` and changes nothing; with an incompatible state it copies the record to a printed `state.json.recovered-…` archive, removes Seal's owned local override, and leaves the route outside Seal for you to protect again. It archives the record; it does not repair it.

```output
Stored protection state: could not be read
Protection detail: stored protection state has schema "seal.protect/v99", not seal.protect/v1; stop Claude Code, then run `seal recover --archive` in this project to archive the incompatible state and remove Seal's owned local override before protecting again
Protected tool list: unreadable because the stored protection state could not be read
MCP routing: unknown because the stored protection state could not be read
Receipts: unavailable (receipt directory could not be resolved from broken protection state)
Most recent: unavailable because the project receipt directory could not be resolved
```

The state declares a schema this Seal binary cannot interpret.
`seal protect` and `seal unprotect` refuse with `incompatible_state` for an
unsupported schema. The version that created a supported state does not
cause a refusal. Status exits 1 and reports the
refusal without claiming that the tool list is absent or the server is unrouted.

## The Runtime line

```output
Runtime: present seal-assurance-kit@aa213304018ce72d754c6befcb0b6a77dd3e05e3
```

The runtime is pinned and hash-checked beside the command, and both protected-call
authorization and `seal verify` load it there. The installed `seal` command
judges every stored file against its install record before it runs any
subcommand, status included, so a damaged runtime is refused before any Runtime
line can print. Two forms, both from real runs:

- `Runtime: present …` — every file status inspected matches its pinned hash.
- `REFUSE artifact_digest_mismatch: installed file digest mismatch:
  runtime/kernel/wasm/seal.js` — printed instead of any status output, with
  exit code 1, when a stored runtime file no longer matches the install record.
  A missing file is refused the same way as `REFUSE artifact_missing: installed
  file missing: runtime/kernel/wasm/seal.js`. Repair the verified installation.

## The Receipts lines

```output
Receipts: 1 stored in /home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/receipts
Most recent (by write time): ALLOW at receipt time 1788884426 (receipt-1788884427239-231060-0002-ALLOW.json)
```

"Most recent (by write time)" is exactly that: the newest receipt file, not a
verdict on your last session. A successful demo run ends with a BLOCK receipt
— the blocked replay — so a BLOCK here can be the record of the gate holding,
not of something going wrong. Open the named file to see which call it was.

Two less happy forms, both from real runs:

```output
Receipts: 0 stored in …/seal/receipts (directory does not exist)
Most recent: no receipt yet (receipt directory is missing)
```

This is a protected project whose recorded receipt directory is missing.
`seal protect` created that directory, so its absence means something removed
it since, and earlier receipts may have gone with it. Outside a protected
project, status prints `Receipts: unavailable outside a protected project`
instead.

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

`seal status` tells you which MCP routes are sealed; `seal doctor` tells you what the
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

If you see that, `SEAL_ELICITATION_AUTO_RESPONSE` or
`CLAUDE_ELICITATION_AUTO_RESPONSE` is nonempty, or the Claude settings file
has a nonempty `Elicitation` or `ElicitationResult` hook array; remove the
detected signal or hooks before trusting any approval prompt in that session. If you do not see it,
Seal has not established whether Claude Code itself can answer elicitation
requests automatically.

Previous: [When something looks wrong](when-something-looks-wrong.md).
Up: [Guide](README.md).
Next: [Knowing it worked](knowing-it-worked.md).
