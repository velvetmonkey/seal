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
| `seal verify PATH [--pubkey HEX] [--json]` | Validate a saved receipt, check its signature and replay its decision locally. Exactly one PATH is accepted and must be a readable, nonempty regular file. Flags may precede PATH; use `--` before a path starting with a dash. Extra paths (including duplicates), unknown flags, missing `--pubkey` values and repeated `--pubkey` flags are refused with exit 2. | 0 only when validation, signature and replay all succeed; 1 for signature, binding or replay failure (including no usable key), or unavailable runtime; 2 for invalid arguments, unreadable input or invalid receipt schema |
| `seal seal_block [--pubkey HEX] < receipt.json` | Check stdin receipt bytes and emit a v1 JSON result. | 0 for validation, signature and replay success; 3 for kernel integrity failure; 5 for missing/malformed key; 1 otherwise |
| `seal reproduce TAG [--source PATH] [--platform linux-x64] [--authority same-authority\|independent] [--authority-name NAME]` | Compare a published artifact's kernel with a rebuild from source; print the comparison JSON. Requires a source checkout. | 0 for matching kernel bytes; 1 for mismatch, refusal or failure |
| `seal reproduce build-pinned-kernel TAG --output PATH [--source PATH] [--manifest PATH]` | Build the selected kernel and copy it to PATH; print the build result. | 0 on successful build and copy; 1 on refusal or failure |
| `seal protect [--timeout-ms MILLISECONDS] SERVER TOOL [TOOL...]` | Install a local Claude Code override for selected calls on the named project stdio MCP server. | 0 on success; 1 on usage error, refusal or failure |
| `seal unprotect SERVER` | Remove Seal's owned local override without editing the project .mcp.json. | 0 on success; 1 on refusal or failure |
| `seal recover --archive [SERVER]` | Archive incompatible state and remove the owned local override. Stop Claude Code first. Retain journals, receipts and signing keys. | 0 on success; 1 on usage error, refusal or failure |
| `seal history DIRECTORY [--limit N] [--since EPOCH_MS] [--until EPOCH_MS] [--tool NAME]` | Count observed receipt files and list recent decision claims; see bounds below. | 0 for a report including UNKNOWN; 1 for invalid arguments or unavailable directory |
| `seal receipts DIRECTORY` | Inspect receipt filenames for sequence gaps; DIRECTORY must exist and be a directory. | 0 if the scan finds no rejected names or gaps; 1 on rejected names, gaps, usage error or read failure |
| `seal coverage` | Report known mediated, unmediated and unknown routes from this deployment. Does not discover every alternate route. | 0 for a report; 1 for unreadable/refused configuration; 2 for extra arguments |
| `seal uninstall` | Preview and confirm removal of an installed distribution and its owned overrides. Retain history, journals, receipts and signing keys. | 0 on completion or cancellation; 1 on refusal/failure |
| `seal doctor` | Report approval-origin assumptions and local readiness. | 0 for reportable assumptions; 1 for an automatic elicitation hook, failed readiness or failure; 2 if any argument follows `doctor` |
| `seal status` | Report project protection, local runtime and receipt observations. | 0 for reportable route state; 1 for unreadable/refused protection state or failure; 2 if any argument follows `status` |

`seal status` exits **0 for an unprotected route**, and can also exit 0 for a stale
route or unavailable receipts/runtime. Exit 0 does not establish active protection
or complete client-route coverage; read the observations, as explained in
[Knowing it worked](../guide/knowing-it-worked.md).

An unknown command prints `seal: unknown command: NAME` to stderr, prints help to
stdout, and exits **2**. Ordinary command usage failures exit **1**, except extra
arguments to `doctor`, `status` or `coverage`, which exit **2**. These are command outcomes, not a promise
about OS signals or a process that cannot start.

## Flags and argument ranges

| Flag | Accepted value and scope |
|---|---|
| `--help`, `-h` | No value; first argument only. Extra arguments after the alias are ignored. |
| `--version`, `-V` | No value; first argument only. Extra arguments after the alias are ignored. |
| `demo --dir PATH` | A nonempty path for the embedded harness's scratch files. Created if needed; real receipt-store locations are refused. Without it, a temporary directory is created and retained for receipt inspection. An explicitly supplied directory is also retained. |
| `verify --pubkey HEX` | Trusted Ed25519 public key, 32 bytes encoded as 64 lowercase hexadecimal characters. May appear before or after PATH. Omission or an invalid key cannot yield exit 0. |
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
shape; `receipts` requires exactly one argument. `verify` accepts exactly one
positional path, one optional `--pubkey` value,
`--json`, and a `--` separator. It refuses extra paths and unknown options; `unprotect`
uses only its first argument. `doctor` rejects any trailing argument with
`seal doctor takes no arguments` on stderr, no stdout, and exit 2. These
existing parsing rules do not add flags to those commands.


### Machine-readable receipt checks

`seal verify PATH [--pubkey HEX] --json` writes exactly one JSON object to stdout.
It retains the checker's `read`, `validate`, `replay`, `signature`, `authority`,
`occurrence`, `verify` and `receipt` fields on a completed check, plus `ok` and
`code`. `ok` is validation AND signature AND replay; `code` is null when `ok` is
true. As in text mode, `verify` remains false: a caller-supplied key does not
establish authority or event occurrence.

On refusal, `code` preserves the checker's typed error and `message` explains it.
The boolean fields report only established checks; false can also mean a check
was not reached or no partial result was returned. In particular, a thrown
verification error does not return partial validation/signature/replay results.
An absent signature or absent/invalid public key reports
`signature_unverifiable` when the other checks complete. File-access failures
report `read_failed`; an unavailable or damaged local runtime reports
`runtime_unavailable`. Human-readable verification output is unchanged.

Argument refusals emit one JSON object with `ok: false`, `code: "invalid_arguments"`
and a message naming extra paths when present. No receipt is checked on these
refusals. Zero paths with `--json` retains the JSON usage result.

The exit classes apply in both output modes. Exit 1 retains the existing
signature/binding/replay failure meaning, including `commitment_mismatch`,
`verdict_mismatch`, `action_verdict_mismatch` and `inert_input`. Exit 2 distinguishes
unreadable or schema-invalid input, following the CLI's existing use of 2 for
invalid `status`/`coverage` arguments; there was no existing three-class receipt
exit convention. Missing PATH in text mode retains the legacy usage exit 1.
Consumers that formerly asserted exactly 1 for schema errors must accept 2;
consumers checking zero versus nonzero remain compatible.


### `seal history DIRECTORY`

Count the filename-validated receipt population and list recent ALLOW/BLOCK
claims using `--limit N` (default 20, maximum 100), `--since EPOCH_MS`,
`--until EPOCH_MS`, and/or `--tool NAME` (exact match, at most 256 characters).
Time bounds are inclusive and apply to the receipt's kernel `now`, in epoch
milliseconds; the default window ends when the query starts. Future-dated
contents are UNKNOWN, not recent decisions. The proxy `action` takes precedence
over the kernel `verdict`; other actions are counted separately.

This reads the same filename population as `seal receipts`. Counts refer to
files, not unique events: duplicate sequence numbers are not deduplicated.
Contents are unverified claims; signature, occurrence, and current route/server
context remain UNKNOWN. Use `seal verify` with a trusted key for signature
checking. Filename rejection counts and content UNKNOWN counts are separate.
Deletion, renumbering, and concurrent writes can never establish completeness.

Work is capped at 10,000 directory entries, 64 KiB per receipt, 16 MiB of receipt
bytes, and 100 output rows. A directory cap makes population, rejected-file,
and ignored-file counts lower bounds and their totals UNKNOWN. Unreadable,
malformed, oversized, symlinked, changing, or byte-budget-excluded receipts
count as content UNKNOWN; their matching decisions are also UNKNOWN. Listed
rows are the newest observed claims, not a snapshot guarantee. Ties use filename
order. The command opens regular files read-only without taking writer locks.
It exits 0 for a report (including UNKNOWN), and 1 for invalid arguments or an
unavailable directory. Underlying filesystem stalls are outside these work caps.

### `seal seal_block [--pubkey HEX]`

The `seal_block` command reads one v2 receipt from stdin as raw bytes and passes
those bytes directly to the existing verifier. It does not parse and reserialize
the request first. The verifier still applies the v2 canonical signature and
commitment rules; whitespace in the transport is not signed. Invalid UTF-8 and
duplicate JSON members are refused by the verifier.

The response is one JSON object with `seal_block: "v1"`, `ok`, `authority`,
`occurrence`, and `verify`. Completed checks also include the existing verifier
fields (`read`, `validate`, `signature`, `replay`, `receipt`); refusals include
`error` and `message`. The existing labelled `authority`/`occurrence` convention
is retained to distinguish caller-key signature success from authority and event
occurrence. Even exit 0 leaves `verify: false`, authority
`"UNPINNED / CALLER-SUPPLIED"`, and occurrence `"NOT ESTABLISHED"`.

Only no arguments or one `--pubkey` option are accepted. After reading stdin,
runtime inspection takes precedence: a kernel hash mismatch exits 3
(`kernel_integrity`), while an absent runtime exits 1 (`runtime_absent`). Next,
an omitted key, missing option value, or value other than 64 lowercase hexadecimal
characters exits 5 (`no_key`), before receipt validation. A well-formed wrong key,
missing signature, malformed receipt, usage error, or other failure exits 1.
These new exit classes belong only to `seal_block`; `seal verify` is unchanged.

The existing receipt verdict `BLOCK` describes a kernel decision. It is distinct
from the `seal_block` command: a correctly signed, reproducible `BLOCK` receipt
can yield command exit 0. Exit meanings are command-local across the family:
seal-check uses 3 for unpinned results, while seal-assurance-kit uses 3 for its
uncaught-exception handler. Neither meaning is this command's kernel-integrity
class.

Up: [Reference](README.md).
