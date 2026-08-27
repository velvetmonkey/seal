# When something looks wrong

Every refusal Seal prints carries a token — a fixed `snake_case` name for
what happened. This page lists every token the product can emit, grouped by
where you meet it, with the cause and the way out. A test in this repository
(`test/guide-tokens.test.mjs`) checks this page against the source in both
directions, so a token you hit is on this page, and a token on this page
exists in the code.

Refusals arrive in one of four shapes:

- as the protected tool's error result in Claude Code:
  `approval refused: <token> — <detail>`
- from a `seal` command on stderr: `seal: <token>: <message>`
- from the wrapper as Claude Code starts the protected server (visible in
  Claude Code's MCP logs): `seal __proxy: <token>: <message>`
- as a plain refusal line from the installer, the installed launcher, the
  checker, or `seal doctor`: `REFUSE <token>: <reason>`

A refusal means Seal did not complete the action at the point named by that
token. It does not prove an earlier step changed nothing: for example, an
installer or a failed external command can have made partial changes first.

## While using the protected tool

Minted in `contract/contract.cjs` and `spine/proxy.cjs`; delivered as the
tool's error result. The first group is the approval contract judging a
retry; unless a token says otherwise, the way to proceed is simply to make a
fresh call and approve it fresh.

### `already_consumed`

You saw: `approval refused: already_consumed — this one-use approval has
already been consumed`. The same approval was presented a second time; the
call did not run again. This is the replay protection holding. If you wanted
the effect twice, call twice and approve twice. If you never approved a first
time, read the receipts before doing anything else.

### `declined`

You answered Decline at the prompt. The call did not run, and this request
can never be revived by re-sending the same approval — see
`terminally_declined`.

### `terminally_declined`

A retry arrived for a request you already declined. Denial is terminal per
request: nothing you declined can be re-approved later by replaying it. A
fresh call gets a fresh prompt.

### `cancelled`

You answered Cancel (rather than Decline) at the prompt, and a later retry
referenced that cancelled request. Make a fresh call.

### `expired`

More than 2 minutes passed between the prompt appearing and the approval
arriving, so the window closed. Exercised for real: after a 125-second wait
the retry was refused with `expired — the approval window closed before the
retry arrived`. Call again and answer within the window.

### `restart_invalidated`

The approval prompt was issued before a restart (of Claude Code, and with it
the wrapper), and the answer arrived after. Pending approvals deliberately do
not survive a restart. Call again in the new session.

### `unknown_state`

The retry carried an approval handle Seal never issued — an altered handle
and a never-issued one are indistinguishable by design, because the handle
carries no information to tamper with. Make a fresh call. If this happens
without anything unusual on your side, something rewrote the client's
traffic; that is worth investigating.

### `state_malformed`

The retry's `requestState` is not even the shape of a handle Seal issues.
Same standing as `unknown_state`.

### `arguments_altered`

The retried call's arguments differ from the exact arguments shown at the
prompt — exercised for real by slipping an extra argument into an approved
call. The approval covers the exact effect you saw, so the changed call was
refused. If the new arguments are what you want, call with them and approve
what the prompt then shows.

### `tool_altered`

Defensive: the retry names a different tool than the one the approval was
bound to. In the shipped gate only the guarded tool's calls reach the
contract, so this token was not reachable in our runs; it exists so the
binding is enforced in depth.

### `context_mismatch`

Defensive, like `tool_altered`: the retry claims a different project or
server than the approval was bound to. Not reachable through the shipped
gate, which pins both.

### `response_malformed`

The approval answer did not have the expected shape — for example an accept
with no readable approve value. Usually a client defect rather than a user
action. Call again; if it repeats, the client is not returning the form
faithfully.

### `authorization_disagreement`

Node and the WASM kernel gave different answers to an authorization row. The
detail names the side that refused. Seal fails closed and does not consume or
forward the call. Preserve the receipt and report the disagreement; retrying
without understanding it is not a remedy.

### `kernel_integrity_refused`

The vendored WASM is missing, unreadable, or its SHA-256 does not match the
published pin. Seal does not fall back to JavaScript authorization. Restore the
installed artifact from bytes that match the trusted distribution pin.

### `kernel_manifest_refused`

The runtime manifest is missing, unreadable, malformed, or lacks a valid WASM
pin. Restore a complete pinned installation; do not invent a replacement hash.

### `kernel_execution_refused`

The isolated kernel worker could not start, exceeded its 5000ms execution
deadline, `seal_init` rejected its signed configuration, or kernel execution
failed. Nothing forwards. A deadline refusal includes the exceeded limit in
milliseconds, which distinguishes a hung worker from other execution failures.
Preserve the full detail and report it; this may expose a slow or damaged
runtime, or an incompatible kernel/config boundary.

### `kernel_output_refused`

The kernel worker returned unreadable output or a verdict other than ALLOW or
BLOCK. Seal treats silence and malformed output as denial. Preserve the output
detail and report it.

### `unrenderable_effect`

Seal refused to *ask* for approval, because the complete effect could not be
shown honestly — an argument line too wide for the terminal, or more lines
than the approval dialog can display without hiding some. Seal never
truncates an effect to keep the Approve button. The tool call is refused;
nothing ran. If you control the arguments, make them smaller; otherwise this
tool's calls cannot be interactively approved at that terminal size.

### `project_server_drifted`

The server's `.mcp.json` entry changed while the gate was up, so forwarding
stopped — for the guarded tool and everything else on that server. `seal
status` will show `DRIFTED`; the ways out are on
[the status page](what-is-protected-right-now.md#drifted).

### `state_absent`

The recorded protection state file disappeared while the wrapper was
running (exercised by removing it mid-session). Seal fails closed: nothing
forwards without the record. If you deleted Seal's data directory, unprotect
and protect again; if you did not, find out what did.

### `protected_server_missing`

The protected server's command no longer exists — its file was deleted or
moved since protect. Seen at wrapper start as `seal __proxy:
protected_server_missing: protected server command is missing: <path>`, or
mid-session as a tool refusal. Restore the server (or unprotect, fix
`.mcp.json`, and protect again).

### `protected_server_failed`

The protected server's process failed to start for a reason other than the
command being missing (permissions, for example). Not reached in our runs —
the failure modes we provoked surfaced as the server exiting instead. Fix
whatever stops the server starting; the gate refuses to forward until it
does.

### `forward_refused`

A defensive fallback: a pre-forward check refused without naming a token.
The shipped checks always name one (`project_server_drifted`,
`state_absent`), so meeting this token would itself be worth reporting.

## Running `seal protect` and `seal unprotect`

Minted in `spine/protection.cjs`; printed as `seal: <token>: <message>`.

### `usage`

Arguments missing: `seal protect SERVER TOOL` and `seal unprotect SERVER`
need their names. (The printed line currently reads
`seal: usage: usage: seal protect SERVER TOOL` — the doubled word is a known
cosmetic defect, not a deeper problem.)

### `project_server_absent`

There is no `.mcp.json` in the project, or it has no server by the name you
gave. Run in the project directory, and spell the server exactly as
`.mcp.json` does.

### `project_server_invalid`

`.mcp.json` exists but could not be used: not valid JSON, or the named
server entry is malformed (a non-array `args`, a non-object `env`, a missing
command). The message names the specific problem; fix the file.

### `project_server_non_stdio`

The named server is `http` (or anything but `stdio`). Seal gates local
stdio servers only — there is no local process to stand in front of
otherwise.

### `protected_server_start_failed`

Seal could not start the configured server while checking its tools, or the
server exited before initialization began. Check the command, permissions,
environment, and any stderr included in the message, then run `seal protect`
again. The same check runs when the wrapper activates; a failure there marks
the protection state `BROKEN`.

### `protected_server_initialize_failed`

The configured server did not complete the MCP initialize exchange: it may
have timed out, exited, rejected the request, or returned malformed output.
Fix the server or increase the discovery limit with `--timeout-ms`, then run
`seal protect` again. At wrapper activation this failure marks the state
`BROKEN`.

### `protected_server_tools_list_failed`

The configured server did not return a usable, complete `tools/list`: it may
have timed out, exited, rejected the request, returned malformed output, or
repeated a pagination cursor. Fix the server or increase the discovery limit
with `--timeout-ms`, then run `seal protect` again. At wrapper activation this
failure marks the state `BROKEN`.

### `protected_server_tools_empty`

The server's complete `tools/list` contained no named tools, so there is
nothing Seal can guard. Fix the server's tool registration and protect again.
At wrapper activation this failure marks the state `BROKEN`.

### `protected_tool_absent`

The server answered `tools/list`, but the tool named on `seal protect` was not
among the observed names. Check the spelling or fix the server so it exposes
that tool, then protect again.

### `claude_unavailable`

The `claude` command is not on `PATH`. `seal protect` installs the gate
*through* Claude Code, so it needs it. Install Claude Code or fix `PATH`,
then re-run.

### `local_override_exists`

Claude Code already has a local-scope override for this server name — maybe
an earlier experiment, maybe something else using the same mechanism. Seal
will not overwrite it. Look at it with `claude mcp get <server>`; remove it
with `claude mcp remove --scope local <server>` if it is yours to remove.

### `local_override_unreadable`

Seal could not read or parse the local Claude Code configuration; the refusal
names the underlying error, and no configuration was changed.

### `local_override_drifted`

Seal read the local Claude Code configuration and found that the server's
local override is not the definition Seal installed. Restore that definition
before trusting status or asking Seal to remove the override.

### `no_seal_owned_override`

Seal has no stored ownership proof for this server's local override, so it
will not remove or reinterpret that override.

### `already_protected`

This project already has recorded protection (the message names its state,
e.g. `project is already PENDING RESTART`). One gate per project: unprotect
first if you want to protect a different tool.

### `active_claude_session`

`seal unprotect` found a live Claude Code session still running the wrapper.
Stop that session first. Taking the gate down under a live session is
exactly the kind of silent change Seal exists to prevent.

### `lease_generation_mismatch`

The proxy's durable lease generation changed while it was evaluating an
approval. Seal refuses at the consume boundary; the journal remains
authoritative, and the retry must be issued by the current lease holder.

### `claude_install_failed`

The `claude mcp add` step reported failure, and Seal recorded the state as
`BROKEN` with that reason. Because the external command may have made a
partial change, check Claude Code's local override before recovery. The
message carries Claude Code's own error; fix that (permissions,
configuration) first. Then recover — this is currently awkward, found and
recorded as a product finding: `seal protect` refuses (`already_protected`)
and `seal unprotect` refuses too if there is no override to remove
(`claude_remove_failed`). The recovery that worked in a real run: re-create
the override by hand with `claude mcp add --scope local <server> --
<anything>`, then run `seal unprotect <server>`, which removes it and returns
the project to `- outside Seal`.

### `claude_remove_failed`

The `claude mcp remove` step failed during unprotect — most simply because
the local override was already removed by hand. Exercised for real: the fix
is to re-add a local override for the server name (see
`claude_install_failed` above) so the removal has something to remove, then
unprotect again.

### `incompatible_state`

The recorded state was written by a different Seal version (or an unknown
schema). Seal refuses to reinterpret another binary's records. Re-run with
the version that wrote it, or unprotect with that version and protect again
with this one.

## As Claude Code starts the protected server

Printed by the wrapper on stderr, visible in Claude Code's MCP logs as
`seal __proxy: <token>: <message>`. `protected_server_missing` and
`incompatible_state` (above) can also appear here.

### `proxy_lease_active`

Another Seal proxy already owns this project's protected route. The second
starter is refused with the holder pid and lease generation. Stop that
session, or let it exit and retry; a crashed owner is recoverable when its
PID and process-start witness are no longer live and the next holder takes
the next generation. This is a transient start event, not a persisted project
status.

### `process_witness_unavailable`

Seal found a live PID for a stored lease or project lock but could not read a
process-start witness for that PID. It refuses instead of guessing whether
the owner is current or stale. On Linux x86-64, Seal can read `/proc/<pid>/stat`;
on macOS x64/arm64 that witness is unavailable, so Seal refuses rather than
guessing. Stop the recorded owner and retry.

### `drifted`

The `.mcp.json` server entry changed between sessions, discovered at wrapper
start: `seal __proxy: drifted: project server drifted before proxy
activation`. The server does not start; `seal status` shows `DRIFTED`. Ways
out are on [the status page](what-is-protected-right-now.md#drifted).

### `state_broken`

The recorded state file exists but cannot be read (exercised by corrupting
it). Seal will not gate on a record it cannot read. If you have no
explanation for the damage, treat that seriously; the blunt recovery is to
remove the broken state and the local override and protect again.

### `protected_tool_vanished`

The guarded tool existed at protect time but was absent from `tools/list` when
the wrapper tried to activate. Seal marks the protection state `BROKEN`
instead of starting a gate for a different tool set. Restore the tool, then
remove the broken state and local override and protect again.

## From `seal doctor`

### `elicitation_hook_configured`

`seal doctor` found an auto-response hook configured
(`SEAL_ELICITATION_AUTO_RESPONSE` or `CLAUDE_ELICITATION_AUTO_RESPONSE`), so
approval prompts in this environment may be answered by software, not by
you. No approval should be trusted until the hook is removed.

## From `seal verify`

The optional verifier reads and parses the receipt before it obtains the
pinned runtime needed to re-derive a kernel receipt. Each runtime refusal
below names the exact cache path and source it tried, gives the next `seal
verify` command, and says whether the runtime file was changed.

### `runtime_download_failed`

The fetch to the named pinned runtime source failed; the refusal includes the
underlying fetch error. This does not establish why it failed or whether the
machine is offline. Check the source and its network path, then run the
printed `seal verify` command. Seal did not write the missing runtime file.

### `runtime_download_not_found`

The named source responded HTTP 404 for the pinned runtime file. Check that
the pinned runtime revision is published, then run the printed `seal verify`
command. Seal did not write the missing runtime file.

### `runtime_download_unavailable`

The named runtime source responded with the HTTP status in the refusal. Check
the runtime source, then run the printed `seal verify` command. Seal did not
write the missing runtime file.

### `runtime_cache_unreadable`

Seal found the named cached runtime path but could not read it. Make that path
readable, then run the printed `seal verify` command. Seal did not replace the
cached runtime file.

### `spine_receipt_use_separate_checker`

You pointed `seal verify` at one of the gate's own receipts. The format is
recognized, but this binary does not verify its own receipts; the message
hands you the separate checker command to run instead. Use that checker to
learn whether the receipt is valid.

## Platform and version refusals

### `unsupported_platform`

Printed by the installer, the installed launcher, and the demo alike for Seal
v0.2.0-rc.3. macOS source portability is CI-exercised for install, demo and receipt checking.
Protect is not supported on macOS yet. Linux x86-64 is the supported Protect path.
Windows, Linux ARM and other unsupported installations refuse without changing files.

### `node_missing`

The install artifact could not find `node` on `PATH`. Seal requires Node 20 or
newer on Linux x86-64. On macOS, install and demo are CI-exercised, but Protect is not supported yet.

### `version_mismatch`

Two version records that must agree do not — the installed `VERSION` file
against the install record, or `package.json` against `VERSION` in a build.
A healthy install never shows this; it means a mixed or hand-edited
installation. Reinstall from a fresh artifact.

## From the installer

The installer checks the artifact before it runs it, but some later checks
occur while extraction is writing the store. A refusal here can therefore
follow partial store writes; remove the failed install and reinstall from a
verified artifact. Minted in `scripts/install.cjs`.

### `install_parent_unwritable`

Seal could not create, replace, or clean up an installer target because its
parent directory is not writable. Check that the selected prefix and its
`bin` and `lib/seal` parents are owned and writable by the installing user;
then repair those permissions or choose a different prefix and rerun the
verified artifact.

### `install_target_unwritable`

Seal found an existing install target but cannot inspect or read it because
the installing user lacks permission. Do not force past that boundary: repair
the target's ownership and read permission if it is your install, or select a
fresh prefix that you control and install there.

### `existing_install_untrusted`

The selected prefix already contains incomplete, non-regular, unreadable, or
non-verifying Seal install targets, or store content that differs from the
artifact being installed. Do not overwrite it blindly. Choose a fresh prefix,
or repair the existing install only after determining why it no longer
verifies; then rerun the verified artifact.

### `macos_helper_build_failed`

On macOS, the installer could not compile the bundled process-start witness
helper with `cc`. The install cannot safely continue without that helper.
Install the Xcode Command Line Tools (or repair the reported compiler error),
remove the partial install, and rerun the verified artifact.

### `pin_missing`

You ran the artifact without `--sha256`. The pin is required, on purpose:
you state the digest of the bytes you meant to install, from where you got
them, and the installer confirms it.

### `pin_invalid`

The `--sha256` value is not 64 lowercase hex characters. Copy the published
digest exactly.

### `unknown_flag`

The installer takes only `--sha256`, `--prefix`, and `--bytes`; anything
else is refused rather than ignored.

### `artifact_malformed`

The file is not a built release artifact — no payload, a damaged header, or
trailing bytes. Re-download it.

### `artifact_truncated`

The artifact ends before its payload does (an interrupted download, as
exercised by cutting a real artifact short). Re-download it.

### `artifact_digest_mismatch`

The artifact's bytes do not match the `--sha256` pin, or an inner file does
not match the payload manifest. Either the download is corrupt or the pin is
for a different artifact. From the installed launcher, the same token means
an installed file no longer matches the install record — the store has been
modified since install (exercised by editing one installed file). Reinstall.

### `artifact_missing`

A file the record promises is not there — the installer's payload lacks a
required file, or (from the launcher) an installed file has been deleted
from the store. Reinstall.

### `artifact_unreadable`

An installed file exists but cannot be read (permissions, for example).
The launcher refuses to run a store it cannot fully judge. Fix the
permissions or reinstall.

## From the installed `seal` command at startup

Before running anything, the installed launcher checks the whole store
against its install record. The `artifact_*` tokens above are its refusals
too. Minted in `scripts/seal-launch.cjs`.

### `install_record_missing`

`lib/seal/install.json` is gone from the install prefix. The launcher
refuses to guess what should be in the store. Reinstall.

### `install_record_unreadable`

The install record exists but is not readable JSON (exercised by corrupting
it). Reinstall.

### `install_record_malformed`

The install record's store path points outside the install prefix. This
should never occur from a genuine install; treat the installation as
untrustworthy and reinstall from a verified artifact.

## From the receipt checker

`checker/seal-receipt-check.mjs` accepts a receipt only when every recorded
fact matches its sealed commitment under a key you supplied. Each refusal
names the first thing that did not. For any `*_mismatch` token: the receipt
does not prove what it appears to say — do not rely on it, and keep it as
evidence that something rewrote it. This is a separate process which imports
no Seal module at check time, not a separately implemented checker: it
copies the producer's canonicalisation rule and shares Node crypto, so it
cannot detect a defect common to those parts.

### `unreadable_receipt`

The receipt path does not exist or is not readable JSON. Check the path
first; this is the mundane one.

### `not_a_receipt`

The file parsed, but is not a JSON object at all.

### `unknown_format`

The file is JSON but not a `seal.spine/v1` receipt. Pointing the checker at
a `seal verify`-style kernel receipt lands here — that format has its own
command.

### `unsealed`

The receipt carries no seal block, so there is nothing to check it against.
Current demo and protected-path receipts carry a seal. This refusal can still
describe an older receipt or a JSON file produced by something else; inspect
its source before deciding what the missing seal means.

### `unknown_algorithm`

The seal names an algorithm the checker does not know (it accepts
`ed25519`). An altered or foreign seal.

### `incomplete_receipt`

The receipt is missing one of the fields (`decision`, `tool`, `arguments`)
the seal commits to, so it cannot be checked.

### `decision_binding_mismatch`

The recorded decision does not match its sealed commitment — the decision
was edited after sealing (exercised by flipping ALLOW to BLOCK).

### `tool_binding_mismatch`

The recorded tool name was altered after sealing.

### `arguments_binding_mismatch`

The recorded arguments were altered after sealing.

### `effect_binding_mismatch`

The combined tool-plus-arguments commitment fails even though the individual
ones pass — someone repaired a commitment to match an edited field
(exercised by doing exactly that). Defence in depth doing its job.

### `signature_malformed`

The seal's signature is missing or not even signature-shaped.

### `signature_invalid`

The signature does not verify under the key you supplied. Either the receipt
was altered (and its commitments repaired wholesale), or your key is not the
sealer's key. Both readings matter: the check is only as meaningful as where
your key came from.

### `pubkey_invalid`

The supplied public key is unusable — not a 32-byte hex key.

### `pubkey_missing`

The `--pubkey` argument is neither 64 hex characters nor a readable file.

### `checker_error`

An unexpected internal error while checking — not a verdict on the receipt.
Not reached in our runs. Re-run; if it persists, report it with the receipt.
