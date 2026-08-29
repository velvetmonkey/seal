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
Protection: PENDING RESTART db.{demo.mutate, demo.erase} (/home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/state.json)
Next:
  1. Restart Claude Code in this project.
  2. Run `seal status`.
  3. Look for `Protection: ACTIVE`.
Undo:
  Stop Claude Code, then run `seal unprotect db`.
Receipts: 0 stored in /home/you/.local/share/seal/projects/a055aba8ce9cbe0bd8bbe684f394297b/receipts
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
  last. Receipts are covered properly in
  [Knowing it worked](knowing-it-worked.md).

## Every protection state

### `- outside Seal`

```output
Protection: - outside Seal
```

No gate in this project, so no calls are intercepted. This is also what you
see after a clean `seal unprotect`; its state record and past receipts can
still remain on disk.

### `PENDING RESTART`

```output
Protection: PENDING RESTART notes.delete_all_notes (…/state.json)
```

The gate is installed but no running Claude Code session has picked it up
yet. Calls made before the restart are **not** gated. Restart Claude Code in
this project. You will see `STALE`, with a detail line, after a session ends:

```output
Protection: STALE notes.delete_all_notes (…/state.json)
Protection lease: pid 4127 generation 6
Protection detail: previous wrapper lease is not live (generation 6); restart Claude Code to replace it
```

That is normal, not an error: the wrapper from the last session has exited,
and the next session will raise the gate again on start.

### `ACTIVE`

```output
Protection: ACTIVE notes.delete_all_notes (…/state.json)
Protection lease: pid 4127 generation 6
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
Protection: DRIFTED notes.delete_all_notes (…/state.json)
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

`BROKEN` means the recorded state itself cannot be trusted. Two real forms:

```output
Protection: BROKEN (stored protection state is unreadable: Unexpected token 'g', "garbage{
```

The state file is damaged (here it was deliberately corrupted). Seal refuses
to guess what it used to say.

```output
Protection: BROKEN notes.delete_all_notes (…/state.json)
Protection detail: simulated: cannot write local config
```

`seal protect` got halfway: it recorded the state, then the
`claude mcp add` step failed, and the failure reason is kept as the detail.
Seal did not finish installing the gate; because the external command failed,
check Claude Code's local override before assuming it made no partial change.

What to do about `BROKEN` is honest but currently not smooth:
`seal protect` refuses (`already_protected: project is already BROKEN`) and
`seal unprotect` needs the Claude Code override to exist before it will
finish. The working recovery, exercised for real, is in
[when-something-looks-wrong](when-something-looks-wrong.md#claude_install_failed).

A related message you can see here:

```output
Protection: BROKEN (stored protection state is from another binary version)
```

The state was written by a different Seal version than the one answering.
`seal protect` and `seal unprotect` refuse with `incompatible_state` rather
than reinterpret another binary's records.

## The Runtime line

```output
Runtime: present seal-assurance-kit@aa213304018ce72d754c6befcb0b6a77dd3e05e3
```

The runtime is a pinned, hash-checked component that only `seal verify`
loads, and it is downloaded on demand the first time `seal verify` needs it.
Three states:

- `Runtime: absent … (kernel/wasm/seal.js is unavailable)` — not downloaded
  yet. **This is the normal state of a fresh install** and affects nothing
  but `seal verify`.
- `Runtime: present …` — cached and every file matches its pinned hash.
- `Runtime: integrity check failed … (kernel/wasm/seal.js hash mismatch;
  cached bytes do not match the published runtime)` — the cached copy does
  not match what was published. Seal will not use it; delete the cache
  directory (`~/.cache/seal`) and let `seal verify` re-download.

## The Receipts lines

```output
Receipts: 1 stored in /home/you/.local/share/seal/projects/guide-example/receipts
Most recent (by write time): APPROVE at receipt time 2026-08-16T12:00:00.000Z (approved.json)
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

`seal status` tells you what is protected; `seal doctor` tells you what the
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

Previous: [When something looks wrong](when-something-looks-wrong.md).
Up: [Guide](README.md).
Next: [Knowing it worked](knowing-it-worked.md).
