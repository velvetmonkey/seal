<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>

# Seal

[![Product, identity & docs checks](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/ci.yml) [![macOS build evidence](https://github.com/velvetmonkey/seal/actions/workflows/macos.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/macos.yml) [![Authorization seam differential](https://github.com/velvetmonkey/seal/actions/workflows/authorization-seam-differential.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/authorization-seam-differential.yml) [![Live family claims drift](https://github.com/velvetmonkey/seal/actions/workflows/family-claims-live.yml/badge.svg?branch=main)](https://github.com/velvetmonkey/seal/actions/workflows/family-claims-live.yml)

AI agents can call dangerous tools.

Seal is a local approval boundary for AI-agent tool calls.

The [documentation map](docs/README.md) helps you choose a route through Seal.

*Claude can ask. Seal decides whether that exact call may cross the boundary.*

## Supported path

Seal supports install, demo, receipt checking and Protect on Linux x86-64 and
macOS x64/arm64. Protect also needs Claude Code's `claude` command. Windows,
Linux ARM and other platforms are unsupported. The [full install guide](docs/start/install.md) covers the
published assets, provenance checks, source builds, and platform limits.

## Try Seal in two minutes

Download and verify the published release asset, install it under `~/.local`, then put
the command on your current shell's `PATH`:

<!-- generated from published release; do not edit -->
```bash
SEAL_VERSION=v0.2.1
artifact_name="seal-v0.2.1-linux-x64"
artifact_sha256="4063ea160b1e8cea8f0ca0c87453484a7827bf0cbfb9ac1179888814e490b9dd"
artifact_bytes=6214316
sums_name="SHA256SUMS"
sums_sha256="79054c0c63d1c70ca5b1e9d0c1d5670a947f49d7abeded441ad742b392ee19c0"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"
if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name" | awk '{print $1}')"; else sums_actual="$(sha256sum "$sums_name" | awk '{print $1}')"; fi
test "$sums_actual" = "$sums_sha256"
read -r expected_digest expected_bytes expected_name < <(awk -v name="$artifact_name" '$3 == name' "$sums_name")
test "$expected_name" = "$artifact_name" && test "$expected_digest" = "$artifact_sha256" && test "$expected_bytes" = "$artifact_bytes"
if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name" | awk '{print $1}')"; else actual_digest="$(sha256sum "$artifact_name" | awk '{print $1}')"; fi
test "$actual_digest" = "$artifact_sha256" && test "$(wc -c < "$artifact_name" | tr -d ' ')" = "$artifact_bytes"
chmod +x "$expected_name"
./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
export PATH="$HOME/.local/bin:$PATH"
```
<!-- end generated release docs -->

Run the harmless approve-once demo and answer `y`:

```bash
demo_dir="$(mktemp -d)" && demo_dir="$(cd "$demo_dir" && pwd -P)" && printf 'y\n' | seal demo --dir "$demo_dir" && printf 'Demo directory: %s\n' "$demo_dir"
```

When you are finished, remove the directory printed as `Demo directory: /absolute/path`.

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
and leaves the project `.mcp.json` unchanged. Its report includes:

```output
Sealed MCP route db: PENDING RESTART (/home/you/.local/share/seal/projects/guide-example/state.json)

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

## Guarantees and non-guarantees

Seal is a formally anchored authorization gate for selected MCP `tools/call`
effects.

Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is TESTED.
Release incorporation: The theorem artifact does not yet ship and run in the released build graph.
Semantic correspondence: The theorem concerns `SealV2.decide`. The shipped authorization path is `sealHostStep -> stepImpl -> Host.dispatch`. Their correspondence is tested, not proved. The `interpreted Lean vs shipped WASM` job runs the correspondence test.
The proof-bearing source compiles reproducibly to the WASM the product uses,
and a tested Node runtime enforces it with durable one-use state,
configuration-drift refusal, concurrent-proxy fencing and signed receipts.

The proof-bearing source rebuilds the exact kernel bytes the downloadable product requires, and the product has no JavaScript authorization fallback.
Follow that source binding through [Reproducible kernel](docs/reproduce.md).

The separately implemented verifier replays the recorded inputs through the
WASM kernel and reports its checks separately.

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
