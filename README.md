<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Product, identity & docs checks](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml) [![macOS build evidence](https://github.com/velvetmonkey/seal/actions/workflows/macos.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/macos.yml) [![Authorization seam differential](https://github.com/velvetmonkey/seal/actions/workflows/authorization-seam-differential.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/authorization-seam-differential.yml) [![Live family claims drift](https://github.com/velvetmonkey/seal/actions/workflows/family-claims-live.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/family-claims-live.yml)

AI agents can call dangerous tools.

Seal is a local approval boundary for AI-agent tool calls.

The [documentation map](docs/README.md) helps you choose a route through Seal. Read the rendered [documentation site](https://velvetmonkey.github.io/seal/).

*Claude can ask. Seal decides whether that exact call may cross the boundary.*

## Supported path

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and
macOS x64/arm64. Seal itself requires Node 20 or newer.
Protect needs Claude Code, which needs Node 22 or newer. If you want Protect and
`node --version` reports below v22, get Node from https://nodejs.org/en/download
or use a version manager such as nvm; then run `node --version` again and expect
v22 or newer. Windows,
Linux ARM and other platforms are unsupported. The [full install guide](docs/start/install.md) covers the
published assets, provenance checks, source builds, and platform limits.

## Try Seal in two minutes

Download and verify the published release asset, install it under `~/.local`, then put
the command on your current shell's `PATH`. Copy the whole POSIX command,
including its backslashes and `&&` operators; a failed comparison skips both
`chmod` and execution:

<!-- generated from published release; do not edit -->
> This source tree's `VERSION` file reads `1.0.0-rc.1`. The release docs generator does not compare this source with a release tag. The install commands below fetch the
> published `v0.5.3`, the live Latest release whose assets the commands below install.

```bash
SEAL_VERSION=v0.5.3
artifact_name="seal-v0.5.3-linux-x64" \
&& artifact_sha256="cc0835c7d7f8c90b7b6858ea80a9f447a1be25d84cb5f496a33ef61985f2868e" \
&& artifact_bytes=6418125 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="1617beb751f1a1569ab5fa338ed82abb9b8aee65370b409b14be7fe926c4c479" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& expected_record="$(awk -v name="$artifact_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$expected_record" = "$artifact_sha256 $artifact_bytes $artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name")"; else actual_digest="$(sha256sum "$artifact_name")"; fi \
&& test "${actual_digest%% *}" = "$artifact_sha256" \
&& actual_bytes="$(wc -c < "$artifact_name")" \
&& test "$actual_bytes" -eq "$artifact_bytes" \
&& expected_name="$artifact_name" \
&& expected_digest="$artifact_sha256" \
&& expected_bytes="$artifact_bytes" \
&& chmod +x "$expected_name" \
&& ./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local \
&& export PATH="$HOME/.local/bin:$PATH"
```
<!-- end generated release docs -->

The command above installs the published `v0.5.3` release under `~/.local`.
The demo is a separate step.

Add the PATH export to `~/.bashrc`, `~/.zshrc`, or `~/.profile` so a new terminal finds `seal`.

Run the harmless approve-once demo and answer its prompt in your terminal:

```bash
seal demo
```

For a script or a run without a terminal prompt, use the installer's approve-once form:

```bash
demo_dir="$(mktemp -d)" && demo_dir="$(cd "$demo_dir" && pwd -P)" && printf 'y\n' | seal demo --dir "$demo_dir" && printf 'Demo directory: %s\n' "$demo_dir"
```

Keep the demo directory for the printed checker command.
When you are finished, use the printed `Recover this run directory with:` command to remove the temporary demo directory.
The `--dir` form above prints no `Recover this run directory with:` line. When you are finished with it, remove that directory yourself.

## What you should see

Seal holds each exact call, asks once, permits at most one execution, and writes
a signed receipt. Here are selected lines from a run where you answer `y`.
`<demo-dir>` stands for the printed absolute demo directory; `<id>` stands for
the generated receipt identifier.

```text
child calls observed: 0 (read from <demo-dir>/child/data.txt.count)
child calls observed: 1 (read from <demo-dir>/child/data.txt.count)
BLOCKED   the shared proxy recorded a BLOCK receipt for the replay: verdict BLOCK
one-use held: the replay did not run the call again; child calls observed: still 1 (read from <demo-dir>/child/data.txt.count)
receipt written: <demo-dir>/receipts/receipt-<id>-INPUT_REQUIRED.json
receipt written: <demo-dir>/receipts/receipt-<id>-ALLOW.json
receipt written: <demo-dir>/receipts/receipt-<id>-BLOCK.json
File changed: yes
Protected-server call count: still 1
New Seal decisions: 0
```

Before approval, the child has received no tool calls.
After approval, the child has received one tool call.
The replay is refused and the child call count stays at one.
The three receipt paths record the approval request, allowed call and blocked replay.
The direct write changes the file without another protected-server call or Seal decision.

Read the [v0.4.0 standalone checker exit-status notice](docs/verify/README.md#v040-standalone-checker-exit-status) before scripting receipt checks.

The demo also prints its receipt directory and the path of the public key file,
`<demo-dir>/receipt-signer.pub`, rather than the key itself.
Copy the printed `Run:` command to check the replay receipt.
It reads that file and checks the signature and recorded decision against the
checker's verifier-local kernel.
Because the demo supplies its own signing key, this establishes self-consistency,
not a trusted signer's identity or proof that the recorded effect happened.

## Protect a real tool set

Check Node before installing Claude Code:

```bash
node --version
```

```output
v22.23.3
```

This captured version meets the v22 or newer requirement; if yours is older, upgrade Node before continuing. Install Claude Code and confirm that its command is available:

```bash
npm install --prefix "$HOME/.local" @anthropic-ai/claude-code
export PATH="$HOME/.local/node_modules/.bin:$PATH"
claude --version
```

In a disposable Claude Code project, define a local stdio MCP server with two
tools whose effects you want Seal to hold for approval:

Before this command, have the operator sign the guard and forward payloads
for `demo.mutate` and `demo.erase`. Set `SEAL_KERNEL_POLICY_FILE` to the file
with those two signed envelopes and `SEAL_KERNEL_PUBKEY` to the independent
Ed25519 public key pin. See [the config signing steps](docs/assurance/architecture.md).

```bash
mkdir -p seal-protect-demo
cd seal-protect-demo
git init -q
printf '%s\n' '{"mcpServers":{"db":{"command":"seal","args":["__demo-server","./data.txt"]}}}' > .mcp.json
seal protect db demo.mutate demo.erase
```

Protect validates both names, installs a private Claude Code local override,
and leaves the project `.mcp.json` unchanged. It creates `data.txt` (0 bytes)
and `data.txt.count` (`0` followed by a newline). It ends with:

```output
Project .mcp.json hash before protect: aacdd2ef4696c853be3fffab5519e6ee5ff1a351c0da6c982b21650d4d349e05
Sealed MCP route db: PENDING RESTART (/home/you/.local/share/seal/projects/02a372233b91435a486924d1d5539612/servers/db/state.json)

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
State: /home/you/.local/share/seal/projects/02a372233b91435a486924d1d5539612/servers/db/state.json
Next:
  1. Restart Claude Code in this project.
  2. Run `seal status`.
  3. Expect ACTIVE while Claude Code runs this project's wrapper; STALE after the session exits.
Undo:
  To clear protection for every guarded tool on server db, including guarded tools: demo.mutate, demo.erase, stop Claude Code, then run `seal unprotect db`.
```

Before the restart:

```bash
PATH="$HOME/.local/bin:$PATH" seal status
```

Captured before the restart. Paths under `/home/you`, the project identifier, and the observation time are examples that differ for each run:

```output
Runtime at status check: kernel payload bytes matched runtime-manifest.json for seal-assurance-kit@aa213304018ce72d754c6befcb0b6a77dd3e05e3; per-authorization installed-tree and Node-floor judgments have not yet been observed.
Observation project: /home/you/seal-protect-demo
Observation client: Claude Code static configuration; effective client route UNKNOWN
Observation config: /home/you/.claude.json
Observation time: <time of status check>
MCP scope precedence: local > project > user; plugins, connectors and managed/session sources are not inspected
Scopes inspected: user, local, project (direct files only; this is not a complete active inventory)
UNKNOWN — user MCP configuration has no inspectable mcpServers object
Observed MCP definitions (scoped configuration facts; not a complete active inventory):
  UNKNOWN — entry "db" has conflicting definitions across local, project; scope shadowing and approval eligibility are unresolved
  BROKERED — Local MCP entry "db" matches Seal's installed wrapper; this wrapper gates demo.mutate, demo.erase. Client use of this entry is UNKNOWN.
UNKNOWN — Client route completeness has not been established: Seal cannot confirm this session's effective MCP, shell or network access.
Boundary: shell and network routes are outside this Seal MCP wrapper; their effective reachability is UNKNOWN.
Sealed MCP route db: PENDING RESTART (/home/you/.local/share/seal/projects/02a372233b91435a486924d1d5539612/servers/db/state.json)

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
Receipts: no receipt files observed (receipt directory has no receipt-shaped files)
Receipt completeness: UNKNOWN (receipt filenames are not signed; deleted receipts can be renumbered)
Most recent: no receipt yet (receipt directory has no receipt-shaped files; no decision has been recorded)
```

The `UNKNOWN` lines describe limits of this observation:

- `effective client route UNKNOWN` means static configuration does not show which route this client session actually uses; do not treat it as proof of a live route.
- `user MCP configuration has no inspectable mcpServers object` means this run found no inspectable user-scope server list; no action is needed for this demo, but user-scope coverage remains unknown.
- `entry "db" has conflicting definitions` means the local wrapper and project entry differ, so scope shadowing and approval eligibility remain unresolved; do not assume this confirms the selected route.
- `Client use of this entry is UNKNOWN` means the local wrapper matches the recorded definition, but status cannot see whether the client uses it; confirm the route before relying on it.
- `Client route completeness has not been established` means status cannot confirm every MCP, shell, or network path; do not read this as complete coverage.
- `their effective reachability is UNKNOWN` means shell and network routes are outside this wrapper; account for those routes separately if they matter to your project.
- `Receipt completeness: UNKNOWN` means unsigned filenames cannot prove that no receipts were removed; no receipt exists yet in this pre-restart run, so there is nothing to inspect now.

Receipt directory for this example, beside the printed `State:` file: `/home/you/.local/share/seal/projects/02a372233b91435a486924d1d5539612/servers/db/receipts`. After a call, rerun the status command above. Its `Receipts:` line gives the observed count, and `Most recent:` gives the newest readable receipt by write time; before a call, the captured line says `no receipt yet`.

For first sign-in, run this command in the terminal:

```bash
claude auth login
```

If Claude Code is already running in this project, exit that session first.
Start Claude Code from the `seal-protect-demo` project directory (the `cd`
command above puts you there):

```bash
claude
```

Keep Claude Code running and open a second terminal in `seal-protect-demo`, then check the route:

```bash
PATH="$HOME/.local/bin:$PATH" seal status
```

The protection guidance uses `ACTIVE`; the live route line in status uses `LEASE ACTIVE`. If it still says `PENDING RESTART`, follow the [protection state guide](docs/guide/what-is-protected-right-now.md#pending-restart).

Receipts contain the complete parsed arguments for protected tools, so sharing a
receipt shares those arguments.

## Remove it

Stop Claude Code, run this in the protected project, then restart Claude Code:

```bash
seal unprotect db
```

The command removes Seal's local override and reports that the sealed MCP route
is outside Seal. The project `.mcp.json` remains byte-for-byte unchanged.

### Recover incompatible state

> Seal includes `seal recover`. It archives incompatible protection state and removes Seal’s owned local override, leaving the route outside Seal.

Seal accepts stored state with a schema it can read, regardless of the Seal
version that created it. If Seal reports `incompatible_state` for an unsupported
schema, stop Claude Code and run this in the affected project:

```bash
seal recover --archive
```

Recovery requires explicit `--archive` and refuses compatible or absent state.
It saves the exact old state to the printed `state.json.recovered-…` path before
removing Seal's local override, using the same ownership checks as unprotect.
It refuses a live recorded session or a replaced override. The project
`.mcp.json`, approval journal, receipts and signing keys are retained. Recovery
runs locally with the current Seal binary and the installed Claude CLI; it
does not download anything. If removal fails, the old state and archive remain.

The route is now outside Seal. Review the archived server, tools and predicates,
then run `seal protect SERVER TOOL [TOOL...]` with your chosen selections.
Restart Claude Code and use `seal status` to check activation. Recovery does not
reuse the incompatible state as current protection or restore protection by itself.

## Guarantees and non-guarantees

Seal is a formally anchored authorization gate for selected MCP `tools/call`
effects.

Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is not yet tested.
Release incorporation: The theorem artifact does not yet ship and run in the released build graph.
Semantic correspondence: The theorem concerns `SealV2.decide`. The shipped authorization path is `sealHostStep -> stepImpl -> Host.dispatch`. Their correspondence is not yet tested or proved. The `interpreted Lean vs shipped WASM` job compares verdicts from the shipped implementation interpreted through `Ffi.modelStep` with verdicts from its compiled WASM on a corpus; it asserts their agreement, with no independent expected verdict. It does not compare `SealV2.decide` with the shipped path.
The proof-bearing source compiles reproducibly to the WASM the product uses,
and a tested Node runtime enforces it with durable one-use state,
configuration-drift refusal, concurrent-proxy fencing and signed receipts.

The proof-bearing source rebuilds the exact kernel bytes the downloadable product requires, and the product has no JavaScript authorization fallback.
Follow that source binding through [Reproducible kernel](docs/reproduce.md).

The separately implemented verifier replays the recorded inputs through the
verifier's local WASM kernel and reports its checks separately.

| Surface | Current shipped assurance status |
| --- | --- |
| Authorization rule | TESTED |
| Product state/forwarding | TESTED |
| Client and machine | TRUSTED |

Seal is not an agent framework, a sandbox, an IAM platform, a policy language,
a general AI safety product, or a replacement for human judgement. It is an
authorization microkernel: a circuit breaker plus a one-shot transaction
authorization.

Seal protects selected calls that pass through its boundary. A failure before
forwarding can spend an approval without running the call; a human can approve
a malicious but valid request; and Bash, direct writes, network access,
subprocesses, other servers, and other routes to the same effect stay outside.
Receipts are signed decision records, not proof that an effect happened.

## Choose your next page

- [Choose a route through the documentation](docs/README.md).
- [Install and verify the release](docs/start/install.md).
- [Choose what to protect](docs/guide/choosing-what-to-protect.md).
- [Operate and inspect protection](docs/guide/what-is-protected-right-now.md).
- [Understand receipts](docs/reference/receipt-operations.md).
- [Troubleshoot refusals](docs/guide/when-something-looks-wrong.md).
- [Audit architecture and assurance](docs/assurance/README.md).
- Apache-2.0. See [LICENSE](LICENSE).
