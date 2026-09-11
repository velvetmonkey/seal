# CLI reference

This page specifies the current public `seal` CLI. Arguments are separate shell
words; quote tool predicates to keep their JSON quotes and wildcard intact.
Paths resolve from the current directory unless stated otherwise. The private
`__demo-server` and `__proxy` entry points are implementation details.

## Commands and exit codes

| Invocation | Meaning | Exit codes |
|---|---|---|
| `seal`, `seal --help`, `seal -h` | Print help. | 0 |
| `seal --version`, `seal -V` | Print the version agreed by VERSION and package.json. | 0; 1 if the version cannot be read or disagrees |
| `seal demo [--dir PATH]` | Run the embedded exact-call and replay demonstration. | 0 on completion, including declining approval; 1 on EOF, refusal or failure |
| `seal verify PATH [--pubkey HEX]` | Validate a saved receipt, check its signature and replay its decision locally. PATH must be a readable, nonempty regular file. | 0 only when validation, signature and replay all succeed; 1 otherwise, including no trusted key |
| `seal reproduce TAG [--source PATH] [--platform linux-x64] [--authority same-authority\|independent] [--authority-name NAME]` | Compare a published artifact's kernel with a rebuild from source; print the comparison JSON. Requires a source checkout. | 0 for matching kernel bytes; 1 for mismatch, refusal or failure |
| `seal reproduce build-pinned-kernel TAG --output PATH [--source PATH] [--manifest PATH]` | Build the selected kernel and copy it to PATH; print the build result. | 0 on successful build and copy; 1 on refusal or failure |
| `seal protect [--timeout-ms MILLISECONDS] SERVER TOOL [TOOL...]` | Install a local Claude Code override for selected calls on the named project stdio MCP server. | 0 on success; 1 on usage error, refusal or failure |
| `seal unprotect SERVER` | Remove Seal's owned local override without editing the project .mcp.json. | 0 on success; 1 on refusal or failure |
| `seal recover --archive [SERVER]` | Archive incompatible state and remove the owned local override. Stop Claude Code first. Retain journals, receipts and signing keys. | 0 on success; 1 on usage error, refusal or failure |
| `seal receipts DIRECTORY` | Inspect receipt filenames for sequence gaps; DIRECTORY must exist and be a directory. | 0 if the scan finds no rejected names or gaps; 1 on rejected names, gaps, usage error or read failure |
| `seal doctor` | Report approval-origin assumptions and local readiness. | 0 for reportable assumptions; 1 for an automatic elicitation hook, failed readiness or failure |
| `seal status` | Report project protection, local runtime and receipt observations. | 0 for reportable route state; 1 for unreadable/refused protection state or failure; 2 if any argument follows `status` |

`seal status` exits **0 for an unprotected route**, and can also exit 0 for a stale
route or unavailable receipts/runtime. Exit 0 does not establish active protection
or complete client-route coverage; read the observations, as explained in
[Knowing it worked](../guide/knowing-it-worked.md).

An unknown command prints `seal: unknown command: NAME` to stderr, prints help to
stdout, and exits **2**. Ordinary command usage failures exit **1**, except extra
arguments to `status`, which exit **2**. These are command outcomes, not a promise
about OS signals or a process that cannot start.

## Flags and argument ranges

| Flag | Accepted value and scope |
|---|---|
| `--help`, `-h` | No value; first argument only. Extra arguments after the alias are ignored. |
| `--version`, `-V` | No value; first argument only. Extra arguments after the alias are ignored. |
| `demo --dir PATH` | A nonempty path for the embedded harness's scratch files. Created if needed; real receipt-store locations are refused. Without it, a temporary directory is created and cleaned up. An explicitly supplied directory is retained. |
| `verify --pubkey HEX` | Trusted Ed25519 public key, 32 bytes encoded as 64 lowercase hexadecimal characters. Place after PATH. Omission or an invalid key cannot yield exit 0. |
| `protect --timeout-ms MILLISECONDS` | Decimal integer **1 through 2147483647 inclusive**, default **30000**, applied per discovery phase. No sign, leading zero, decimal point or exponent. May occur among positional arguments; the last occurrence wins. |
| `recover --archive` | Required literal switch, first after `recover`; no value. Optional SERVER selects the record to archive. |
| `reproduce --source PATH` | Nonempty source-checkout path, resolved to an absolute path. Available in both reproduce forms. Source provenance must match the selected release. |
| `reproduce --platform PLATFORM` | Only `linux-x64` passes validation; this is also the default. Comparison form only. |
| `reproduce --authority AUTHORITY` | `same-authority` (default) or `independent`. Comparison form only. An authority declaration does not itself establish independence. |
| `reproduce --authority-name NAME` | Nonempty string; must contain non-whitespace text for `independent`. Comparison form only. |
| `reproduce build-pinned-kernel --output PATH` | Required nonempty destination path; its parent must exist and permit writing. |
| `reproduce build-pinned-kernel --manifest PATH` | Optional nonempty release-manifest path used to validate the selected source commit. |

Reproduce option values cannot begin with `--`; repeated options use the last
value. TAG has the form `vMAJOR.MINOR.PATCH`, optionally followed by `-` and
dot-separated alphanumeric/hyphen prerelease identifiers. Each version component
is one or more decimal digits. There is no build-metadata suffix. The release must
exist and contain the in-tree kernel; pre-import releases are refused. See
[Kernel reproduction](../reproduce.md) for build prerequisites and scope.

SERVER selects a configured server name. TOOL is an exact discovered tool name,
optionally followed by `?ARG=SCALAR` or `?ARG~"PATTERN"`. ARG matches
`[A-Za-z_][A-Za-z0-9_.-]*`; SCALAR is a JSON string, number, boolean or null, not an
array or object. PATTERN is a JSON string containing exactly one `*`. For example:
`seal protect db 'query?operation="delete"' 'read?path~"private/*"'`.
A bare tool selection gates the whole tool; duplicate selections are collapsed.

There are no general per-command help aliases or `--flag=value` forms. `demo`
accepts only `--dir` pairs (the first directory wins). `protect` and `reproduce`
reject unknown long options. `recover` requires its exact one- or two-argument
shape; `receipts` requires exactly one argument. `verify` uses the first positional
path and first later `--pubkey` value, ignoring other trailing words; `unprotect`
uses only its first argument, and `doctor` ignores trailing arguments. These
existing parsing rules do not add flags to those commands.

Up: [Reference](README.md).
