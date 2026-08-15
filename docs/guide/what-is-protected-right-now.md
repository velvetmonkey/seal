# What is protected right now

You should never have to remember what you protected. `seal status`, run in
the project directory, answers from the recorded state; `seal doctor` states
the one assumption approvals rest on. This page shows every line and every
state those two commands can print, from real runs.

## Reading `seal status`

A healthy protected project, while a Claude Code session is running:

```
$ seal status
Runtime: present seal-assurance-kit@962823b22d179f3354f8b8cf1a7091029a23c715
Protection: ACTIVE notes.delete_all_notes (/home/monkey/scratch/opguide-run/home/.local/share/seal/projects/9852104386c7756d6abbd76408f7014b/state.json)
Receipts: 6 stored in /home/monkey/scratch/opguide-run/home/.local/share/seal/receipts
Most recent (by write time): BLOCK at receipt time 1786795258224 (receipt-1786795258224-3152203-0002-BLOCK.json)
```

Three parts, always in this order:

- **Runtime** — a cached component that `seal verify` uses. Its presence does
  not decide whether your project is protected; see below.
- **Protection** — this project's gate: its state, then
  `server.tool`, then the path of the state file the answer came from.
- **Receipts** — how many decision records exist and which one was written
  last. Receipts are covered properly in
  [Knowing it worked](knowing-it-worked.md).

## Every protection state

### `- outside Seal`

```
Protection: - outside Seal
```

No gate in this project, so no calls are intercepted. This is also what you
see after a clean `seal unprotect`; its state record and past receipts can
still remain on disk.

### `PENDING RESTART`

```
Protection: PENDING RESTART notes.delete_all_notes (…/state.json)
```

The gate is installed but no running Claude Code session has picked it up
yet. Calls made before the restart are **not** gated. Restart Claude Code in
this project. You will also see this form, with a detail line, after a
session ends:

```
Protection: PENDING RESTART notes.delete_all_notes (…/state.json)
Protection detail: previous wrapper lease pid is not live; restart Claude Code to activate the local override
```

That is normal, not an error: the wrapper from the last session has exited,
and the next session will raise the gate again on start.

### `ACTIVE`

```
Protection: ACTIVE notes.delete_all_notes (…/state.json)
```

A live Claude Code session is running the wrapper right now. Calls to
`delete_all_notes` stop at the approval prompt; everything else on `notes`
flows through.

### `DRIFTED`

```
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

```
Protection: BROKEN (stored protection state is unreadable: Unexpected token 'g', "garbage{
```

The state file is damaged (here it was deliberately corrupted). Seal refuses
to guess what it used to say.

```
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

```
Protection: BROKEN (stored protection state is from another binary version)
```

The state was written by a different Seal version than the one answering.
`seal protect` and `seal unprotect` refuse with `incompatible_state` rather
than reinterpret another binary's records.

## The Runtime line

```
Runtime: present seal-assurance-kit@962823b22d179f3354f8b8cf1a7091029a23c715
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

```
Receipts: 6 stored in /home/monkey/scratch/opguide-run/home/.local/share/seal/receipts
Most recent (by write time): BLOCK at receipt time 1786795258224 (receipt-1786795258224-3152203-0002-BLOCK.json)
```

"Most recent (by write time)" is exactly that: the newest receipt file, not a
verdict on your last session. A successful demo run ends with a BLOCK receipt
— the blocked replay — so a BLOCK here can be the record of the gate holding,
not of something going wrong. Open the named file to see which call it was.

Two less happy forms, both from real runs:

```
Receipts: 0 stored in …/seal/receipts (directory does not exist)
Most recent: no receipt yet (receipt directory is missing)
```

Nothing has ever been decided on this machine — a fresh install looks like
this until the first demo or protected call.

```
Receipts: unavailable in …/seal/receipts (directory cannot be read)
Most recent: receipts may exist, but the receipt directory cannot be read; check its permissions
```

The directory's permissions block reading; fix them and run `seal status`
again.

One honest wrinkle: `seal verify` can leave a *kernel* receipt (a different
format) in the same directory, and `seal status` then prints
`Receipt unreadable: … (missing decision or receipt time)` for it. The file
is not damaged — it is a format this listing deliberately does not parse.
That wording is misleading and is recorded as an open finding; if the named
file is one `seal verify` accepts, nothing is wrong.

## `seal doctor`

`seal status` tells you what is protected; `seal doctor` tells you what the
approval itself rests on:

```
$ seal doctor
ASSUMPTION
  Claude Code presents approval requests to a human and faithfully returns
  the response. Seal cannot distinguish a human click from client-generated
  acceptance.
```

That is the trust boundary stated plainly: Seal binds the approval to the
exact call, but it cannot prove a human clicked. And if Claude Code is
configured to answer elicitation prompts automatically, doctor refuses
loudly:

```
$ SEAL_ELICITATION_AUTO_RESPONSE=1 seal doctor
REFUSED
  Claude Code can automatically answer elicitation requests.
  Human approval origin cannot be assumed in this configuration.
REFUSE elicitation_hook_configured: an auto-response hook is set; human approval origin cannot be assumed
```

If you see that, an auto-response hook is set in your environment; remove it
before trusting any approval prompt in that session.

Next: [Knowing it worked](knowing-it-worked.md).
