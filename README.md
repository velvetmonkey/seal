<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Product, identity & docs checks](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml) [![macOS build evidence](https://github.com/velvetmonkey/seal/actions/workflows/macos.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/macos.yml) [![Authorization seam differential](https://github.com/velvetmonkey/seal/actions/workflows/authorization-seam-differential.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/authorization-seam-differential.yml) [![Live family claims drift](https://github.com/velvetmonkey/seal/actions/workflows/family-claims-live.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/family-claims-live.yml)

AI agents can call dangerous tools.

Seal is a local approval boundary for AI-agent tool calls.

The [documentation map](docs/README.md) helps you choose a route through Seal. Read the rendered [documentation site](https://velvetmonkey.github.io/seal/).

*Claude can ask. Seal decides whether that exact call may cross the boundary.*

## Supported path

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and
macOS x64/arm64. Protect also needs Claude Code's `claude` command. Windows,
Linux ARM and other platforms are unsupported. The [full install guide](docs/start/install.md) covers the
published assets, provenance checks, source builds, and platform limits.

## Manual verified installation

There is no one-line installer yet: every step below is a real command you
run and check yourself. This is the Linux x86-64 form; macOS readers and
anyone who wants each check explained should use the
[full install guide](docs/start/install.md#choose-your-platform) instead.

Download and verify the published release asset, install it under `~/.local`, then put
the command on your current shell's `PATH`. Copy the whole POSIX command,
including its backslashes and `&&` operators; a failed comparison skips both
`chmod` and execution:

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.4.0
artifact_name="seal-v0.4.0-linux-x64" \
&& artifact_sha256="5b49ea26d29b608fcb4e3e370062b96e8c4a81d7fb5ce1fd30a2cbe737c69d3b" \
&& artifact_bytes=6301771 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="0552373fc3cb7f7257b4cf491395425a1ce2f7126cc60142a961f53ff29026ce" \
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

Add that export line to your shell's startup file too — `~/.bashrc` for
bash, `~/.zshrc` for zsh, `~/.profile` for a POSIX login shell — or the
installed command will not be on `PATH` in a new terminal.

Run the harmless approve-once demo and answer its real prompt yourself:

```bash
seal demo
```

The demo asks `Approve? [y/N]` over your actual terminal stdin; watch the
request it prints, then decide. Approve it, and the demo replays the same
approval a second time and shows that replay refused. It prints its own
scratch directory and, when it made that directory itself, a `Recover this
run directory with:` command; run that command when you are finished.

## What you should see

Seal holds each exact call, asks once, permits at most one execution, and writes
a signed receipt. The demo reduces that path to four observations:

```text
before approval: 0 calls
after approval:  1 call
after replay:    1 call - refused
outside Seal:    effect succeeded, 0 Seal decisions
```

The demo also prints its receipt directory and public key. Those records are
useful for inspecting the decision, but they do not establish that the recorded
effect happened.

## Protect a real tool set

Install Claude Code and confirm that its command is available:

```bash
npm install --prefix "$HOME/.local" @anthropic-ai/claude-code
export PATH="$HOME/.local/node_modules/.bin:$PATH"
claude --version
```

In a disposable Claude Code project, define a local stdio MCP server with two
tools whose effects you want Seal to hold for approval:

```bash
mkdir -p seal-protect-demo
cd seal-protect-demo
git init -q
printf '%s\n' '{"mcpServers":{"db":{"command":"seal","args":["__demo-server","./data.txt"]}}}' > .mcp.json
seal protect db demo.mutate demo.erase
```

Protect validates both names, installs a private Claude Code local override,
and leaves the project `.mcp.json` unchanged. It ends with:

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
  3. Confirm the sealed MCP route is ACTIVE.
Undo:
  To clear protection for every guarded tool on server db, including guarded tools: demo.mutate, demo.erase, stop Claude Code, then run `seal unprotect db`.
```

Restart Claude Code before using the tools, then ask the machine rather than
remembering:

```bash
seal status
```

Receipts contain the complete parsed arguments for protected tools and child
command metadata, so sharing a receipt shares those values.

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
