# Claude Code integration evidence

Seal's protected path runs through Claude Code: `seal protect` installs a local
override with `claude mcp add`, and Claude Code is the process that starts the
Seal proxy, renders the approval request and returns the human's answer. The
repository's automated tests exercise the protocol, the approval state machine
and the proxy against scripted MCP clients. **No test in this repository
observes the real client doing any of it.**

This page is the client matrix, the acceptance run that closes the gap, and the
machinery that makes such a run checkable instead of anecdotal.

## The honest limit

This checker establishes that a recorded run is internally consistent, that its
inputs were present and readable, and that the pack was not casually relabelled.
It does **not** establish that a real Claude Code process produced it. A
determined author with local file access can produce a passing pack. This is an
instrument against mistakes, not against forgery.

**Binding is bookkeeping, not a control.** The recorder digests live in the
run's `harness-state.json`, alongside the recorder sources and casts. Someone
who can rewrite that run directory can rewrite all of them consistently and
produce a passing pack. The binding detects accidental edits and mismatched
files; it does not stop that same writer from forging the bundle.

The harness also cannot establish that a human rather than the client
originated the decline. It reads the recorder-corresponding terminal output
history for the dialog text and correlates the declined call with the proxy's receipts, but the interactive client remains
inside the declared approval-origin boundary. This limit is repeated in every
pack's `manifest.json`.

The Claude Code matrix row stays `UNTESTED — real Claude Code call not observed`
until an operator's real run fills it. That row is the honest claim; the
checker's exit code is not.

## The release-gating client matrix

| Client | What is exercised | Status |
|---|---|---|
| Scripted stdio MCP client (`test/spine-retry.test.cjs`, `test/protect3b.test.cjs`, `test/four-beats.test.cjs`) | Protocol, retry continuation, one-use consumption, protect/unprotect state machine | TESTED — runs in CI on every push |
| Claude Code | Override selection, dialog rendering, answer return, no fallback | UNTESTED — real Claude Code call not observed |

The matrix gates on wiring and protocol behaviour. It deliberately does **not**
carry a "no alternate-route success" row. Whether a model reaches the same
effect through Bash, gives up, or invents an answer is model behaviour, and
Seal states plainly that it is a gate and not a sandbox: routes that do not pass
through the sealed path were never controlled. A behavioural probe can record
what one model did on one day; it cannot establish a product guarantee, so it
must not gate a release.

## What discharges the Claude Code row

A **human-assisted, instrumented acceptance run**. The supported product is
interactive, so a human performs the three irreducible acts — issue the
instruction, inspect the dialog, accept or decline. Every effect-level fact is
established by a machine and written to a file while it happens.

A scripted client cannot substitute. It proves the protocol, the state machine
and the proxy, and this repository already holds strong evidence there. It
cannot prove that Claude Code selects the local override, renders the
elicitation, or declines to fall back.

### Run conditions, pinned and recorded

- Node.js 20 or later, and util-linux's `script` command. Confirm both before
  starting; `script` records each terminal session that the harness checks:

  ```bash
  $ node --version
  $ node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'
  $ script --version
  ```
- One frozen Seal artifact, identified by SHA-256, byte length **and** the
  installed-tree digest the installer records.
- One exact Claude Code version, plus the SHA-256 of the client executable.
  The harness uses the explicit `--client` path when the human gives one.
  Otherwise it resolves every executable `claude` entry on `PATH`.
  It continues only when those entries resolve to one real path.
  It refuses ambiguous client paths and lists each path and SHA-256.
- Linux x86-64.
- A clean temporary `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and project.
- `seal doctor` reporting no elicitation auto-response hook; with one
  configured, the harness refuses to start, because human approval origin
  could not then be claimed.
- A purpose-built MCP fixture ([`harness/claude-code/fixture-server.cjs`](../../harness/claude-code/fixture-server.cjs))
  that appends every frame it receives to an fsynced append-only log, records
  the process ancestry it was launched under, and writes one `child-call`
  record per guarded call.

### The eight fixed cases

| Case | Required observation |
|---|---|
| `activation` | After restart, Claude Code selects the local Seal override |
| `negotiation` | The proxy records the retry-model interaction |
| `approval_shown` | Recorder-corresponding terminal output history contains the complete exact-call dialog; the published pack does not include the raw cast for an independent display check |
| `before_approval` | Child call count remains `0` |
| `accept` | Child call count becomes exactly `1`; expected effect hash matches |
| `decline` | Child call count remains `0` |
| `missing_launcher` | Claude Code does not fall back to the original `.mcp.json` server |
| `unprotect` | The local override disappears and `.mcp.json` remains byte-identical |

This table summarizes each requirement because the literal requirement strings
also name the file-backed facts that support the observation.
The test renders this table from the harness cases. The test rejects a document
that differs from that rendering.

How each one is established from files rather than from the operator's memory:

- **activation** — the fixture's `start` record carries its process ancestry.
  The run requires a chain of `claude` → `seal __proxy --protect-state …` →
  fixture, requires that proxy's pid to equal the lease pid Seal wrote into its
  own protection state, and requires that no fixture process started with any
  other parent.
- **negotiation** — the proxy's own receipts: an `INPUT_REQUIRED` receipt and a
  later receipt carrying the same approval correlation, with the matching
  `issued` and `consumed` entries in the fsynced approval journal.
- **approval_shown** — the dialog text is rendered by the **installed
  artifact's own** `contract/renderer.cjs`, and every line of it is looked for
  in the terminal recording. The cast must also match its recorder-written
  digest and be the deterministic asciicast conversion of the same session's
  raw output and advanced timing files. A substituted text-only cast therefore
  refuses even if it contains every expected dialog line.
- **before_approval / accept / decline** — child-call records counted out of
  the append-only log, plus the effect digest, which is computed three ways
  that must agree: by the fixture as it wrote the file, by the harness from the
  instructed note, and by the checker from the pack alone.
- **missing_launcher** — the harness moves the override's command aside. The
  session's rendered transcript must carry `seal-fallback-note` or `does not
  fall back`. The child log must
  gain no record at all: not a Seal-started one, and not a directly started
  one. `.mcp.json` must be unchanged, and the installed tree must re-verify
  after the launcher is restored.
- **unprotect** — the override entry is gone from `~/.claude.json` and from
  `claude mcp get`, and `.mcp.json` matches the digest **and** byte length
  recorded before `seal protect` ran. `seal unprotect notes` must also exit
  zero and report that the sealed MCP route is outside Seal. A pre-existing
  absent override is not evidence that this act occurred.

## Running the acceptance walk

First download one published Linux x86-64 artifact and the `SHA256SUMS` asset
attached to that same GitHub release. Set `SEAL_VERSION` to the release being
accepted. These commands obtain the frozen artifact and set the digest and
length used by `init`; they also verify that the downloaded bytes match the
release's checksum record.

```bash
$ read -r -p 'Published release tag (for example vX.Y.Z): ' SEAL_VERSION
$ test -n "$SEAL_VERSION"
$ SEAL_ARTIFACT="seal-${SEAL_VERSION}-linux-x64"
$ curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
$ curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$SEAL_ARTIFACT"
$ read -r SEAL_SHA256 SEAL_BYTES named < <(awk -v name="$SEAL_ARTIFACT" '$3 == name { print; exit }' SHA256SUMS)
$ test "$named" = "$SEAL_ARTIFACT"
$ sha256sum "$SEAL_ARTIFACT" > artifact.sha256
$ read -r actual_sha256 _ < artifact.sha256
$ test "$actual_sha256" = "$SEAL_SHA256"
$ test "$(wc -c < "$SEAL_ARTIFACT")" = "$SEAL_BYTES"
$ chmod +x "$SEAL_ARTIFACT"
```

Choose a new, empty run directory. `mkdir` below both creates it and makes the
empty-directory requirement explicit; do not reuse a directory from an earlier
run. The harness creates its clean temporary `HOME`, XDG directories, and
project beneath that run directory.

```bash
$ run_dir="$PWD/cc-acceptance"
$ mkdir "$run_dir"
$ node harness/claude-code/cc-harness.cjs init --artifact "./$SEAL_ARTIFACT" --sha256 "$SEAL_SHA256" --bytes "$SEAL_BYTES" --run-dir "$run_dir"
$ node harness/claude-code/cc-harness.cjs next --run-dir "$run_dir"
```

`next` is the whole run: it takes the machine readings, prints what the human
must do, launches the recorded session, and stops. Repeat it for each prompted
stage through `unprotect`. When its final prompt offers the finishing step, do
**not** run a final `next`: `finish --out` below replaces that final `next` and
writes the pack straight into the current checkout. (Without `--out`, that
final `next` writes the pack under `<run-dir>/pack`.)

```bash
$ node harness/claude-code/cc-harness.cjs finish --run-dir "$run_dir" --out .
```

Run it in a terminal at least
80 columns wide — the approval dialog is measured at 80, and a narrower
terminal would wrap the effect out of the recording.

Two cautions for the operator:

1. Claude Code starts in a fresh `HOME` and may ask you to sign in. Do that in
   the first recorded session **before** anything else, or sign in beforehand:
   the raw recording is a verbatim capture of your terminal, and anything you type
   into it is in the run directory. The pack carries a rendered transcript. Read
   `rendered-transcript.txt` before publishing it.
2. The installed store is read-only by design. `chmod -R u+w` the run directory
   before deleting it.

## The evidence pack

```text
<separately captured evidence-pack directory>/
  <client-version>/
    linux-x64/
      <seal-artifact-sha256>/
        manifest.json
        rendered-transcript.txt
        rendered-transcript-activation.txt
        rendered-transcript-decline.txt
        rendered-transcript-missing-launcher.txt
        proxy.jsonl
        child.jsonl
        before-after.json
        approvals.journal
        receipts/
        snapshots.json
```

There are rendered transcripts only for the four recorded terminal sessions:
`rendered-transcript.txt` is the `accept` session, while the suffixed files
above are respectively the `activation`, `decline`, and `missing_launcher`
sessions. The other four cases are established from the fixture, proxy,
approval, and state records, so they have no rendered transcript file.

The evidence contract is `seal.claude-code-evidence/v2`. The identifier lives
in `manifest.json.manifest`. The harness writes it in
`harness/claude-code/cc-harness.cjs`, and the checker reads it in
`scripts/check-cc-evidence.mjs`. Version 1 packs are refused because they
publish raw `.cast` files instead of the required rendered transcript.

`manifest.json` names the artifact, the client, the environment, the fixture
revision, the eight expected cases with their required observations, what was
observed, the renderer provenance, and the SHA-256 and byte length of every
other file in the pack. The rendered transcript holds any retained scrollback
followed by the terminal's last visible frame. It is NOT a record of the whole
session. The renderer keeps scrollback for synthetic casts. Real Claude Code
recordings can contribute scrollback when terminal output scrolls. If a line
is repainted, the transcript carries its final content once. Earlier versions
of that line are lost.
It removes terminal control sequences. It also redacts Claude Code session
URLs, bare `session_` identifiers, and UUID-shaped identifiers. Other visible
text can still contain secrets or sensitive content. A ULID or a 32-character
hex string is not a Claude Code session identifier by shape alone, so these
forms remain visible. This pack is not safe to publish without inspection.

## The checker

```bash
$ node scripts/check-cc-evidence.mjs <evidence-pack-directory>
```

This repository does not ship an `evidence/claude-code/` pack. [`scripts/check-cc-evidence.mjs`](../../scripts/check-cc-evidence.mjs) accepts a
pack or refuses it by name. It holds its own copy of the eight required cases
and its own copy of the label rule, so a manifest cannot tell the checker what
the rules are. It refuses a file whose hash does not match, a file the manifest
names but the pack does not carry, a file added beside the manifest that no
hash covers, a manifest naming an artifact other than the one under release, an
altered case requirement, a case that is not observed, a manifest whose
child-call count its own `child.jsonl` contradicts, and a summary label that is
not the label the observations produce. It also strictly parses the fixture's
numbered digest chain, compares the complete log to the independent final
boundary digest, length, and record count in `snapshots.json`, and derives the
client executable identity from process ancestry the fixture read from `/proc`
while the client and Seal proxy were alive. It also reads every rendered
transcript; a synthetic fixture banner in a transcript is synthetic evidence,
not ignored data. It refuses a transcript that contains a Claude Code session
URL, a bare `session_` identifier, a UUID-shaped session identifier, or a
C0/C1 control byte other than LF. A ULID or a 32-character hex string can pass
this check because its text shape does not identify it as a Claude Code session.

For a release claim, the operator must additionally supply the SHA-256 of the
actual Claude Code executable they independently verified (not a hash copied
out of the pack):

```bash
$ node scripts/check-cc-evidence.mjs <evidence-pack-directory> --release --artifact-sha256 <artifact-digest> --artifact-bytes <artifact-bytes> --client-executable-sha256 <independently-verified-claude-executable-digest>
```

The checker compares that supplied digest to the executable identity the live
fixture recorded above Seal's proxy. Without it, a release pack is refused as
`client_identity_expected_absent`; a file named `claude` or a client-reported
version is not identity.

The release workflow runs it against the exact artifact it just built. With no
pack for that artifact, the release states the untested row and continues; with
a pack, the pack and the operator-supplied executable digest must verify or the
release fails.

## The honest label

```text
Claude Code <version> integration:
PASS — manually exercised on Linux x86-64 against artifact sha256 …
Not automated in CI.
```

That sentence claims exactly one thing: this combination of client version and
artifact was exercised, once, by hand, on Linux x86-64. It is not independent
assurance, it is not a CI result, and it says nothing about any other Claude
Code version. Until such a pack exists and verifies, the row reads
`UNTESTED — real Claude Code call not observed`.

## The synthetic run, and why it can never be mistaken for a real one

[`harness/claude-code/synthetic-run.cjs`](../../harness/claude-code/synthetic-run.cjs)
drives the entire harness with a scripted stand-in
([`harness/claude-code/synthetic-client.cjs`](../../harness/claude-code/synthetic-client.cjs))
so the instrument itself is exercised on every CI run: the real artifact is
installed, `seal protect` runs, and the real proxy gates a real fixture. Its
`--run-dir` must be empty when opened; the runner creates its artifact and
stand-in inputs in the sibling directory `<run-dir>-inputs`. For example:

```bash
$ synthetic_run_dir="$PWD/synthetic-acceptance"
$ mkdir "$synthetic_run_dir"
$ node harness/claude-code/synthetic-run.cjs --run-dir "$synthetic_run_dir"
```

The synthetic runner prints one `Check it:` command for the pack it wrote. It
does not run the checker itself. Run these two commands to show both outcomes:
the first accepts the synthetic pack only with the explicit opt-in, and the
second intentionally refuses it without that opt-in.

```bash
$ node scripts/check-cc-evidence.mjs "$synthetic_run_dir/pack/evidence/claude-code" --allow-synthetic
$ node scripts/check-cc-evidence.mjs "$synthetic_run_dir/pack/evidence/claude-code"
```

It proves the harness works. It proves nothing about Claude Code — a stand-in
that declines to fall back declines because it was written to.

The four labels below remain useful warnings, but release refusal no longer
derives realness from them. The fixture hashes the actual files named by live
process ancestry; the checker requires the manifest's client executable above
the Seal proxy and recognizes the checked-in stand-in's digest there. Deleting
all the labels therefore cannot turn the observed stand-in process into Claude
Code:

1. `synthetic: true` in the manifest, with a `synthetic_banner`;
2. a `SYNTHETIC-NOT-A-REAL-RUN.txt` file beside the manifest;
3. the client version `0.0.0-synthetic-stand-in`, which is also the directory
   the pack lives in;
4. a banner record inside the derived `proxy.jsonl`.

Removing the warnings does not launder the pack: the raw fixture log still
commits to the stand-in executable digest observed above the Seal proxy, so the
checker derives synthetic provenance and refuses the pack as
`synthetic_pack_in_release_evidence`. The
synthetic run is never written into `evidence/`; it goes to a temporary
directory, and
[`test/cc-evidence.test.cjs`](../../test/cc-evidence.test.cjs) fails if any pack
appears in this repository at all. Committing a real pack is the deliberate act
of the person who performed the run, in a commit that changes that test and
this page's status row together.

Previous: [Version identity](version-identity.md).
Up: [Assurance](README.md).
