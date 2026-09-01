# Seal commands

This page is the reference table for every public `seal` command and its
arguments. Each row names the source lines that define it, so a later reader
can check the row against the code instead of trusting this page.

The authorities are the command dispatch at `bin/seal:397-416`, the help text
at `bin/seal:417-419`, and the usage refusals cited per row. `seal --help`
prints the same list from the running binary.

| Command | What it does | Source |
|---|---|---|
| `seal protect [--timeout-ms MILLISECONDS] SERVER TOOL[?ARG=SCALAR\|?ARG~"PATTERN"] [TOOL...]` | Install a private Claude Code local override so the named server's listed tool calls wait for approval; the optional flag raises the per-phase server discovery timeout from its 5000ms default. | `bin/seal:405`, `bin/seal:354`, `spine/protection.cjs:956` |
| `seal unprotect SERVER` | Remove Seal's local override for the named server; the project `.mcp.json` is left unchanged. | `bin/seal:406`, `spine/protection.cjs:1044` |
| `seal status` | Print this project's protection state, the local runtime state, and the receipt count and paths; it takes no arguments. | `bin/seal:408-411` |
| `seal doctor` | State the approval-origin assumption, and refuse when an elicitation auto-response signal is set. | `bin/seal:407` |
| `seal demo [--dir PATH]` | Run the approve-once, replay-blocked walk against the bundled demo server; `--dir` selects the demo directory, and without it the demo makes a temporary one. | `bin/seal:400`, `spine/demo.cjs:98-111` |
| `seal verify PATH` | Read the named receipt file and re-derive its recorded decision through the v2 checker. | `bin/seal:404`, `bin/seal:318` |
| `seal --help` \| `seal -h` | Print the command list. | `bin/seal:399` |
| `seal --version` \| `seal -V` | Print the installed version. | `bin/seal:412` |

A bare `seal` prints the same command list and exits `0`. An unknown command
prints `seal: unknown command: <name>` and the list, and exits `2`
(`bin/seal:413-415`).

`seal __proxy` and `seal __demo-server` also exist in the dispatch. They are
private spine subcommands that the product starts for itself, not part of the
public command surface, and `seal --help` omits them
(`bin/seal:401-403`).

Previous: [Reference](README.md).
Up: [Reference](README.md).
Next: [Receipt operations](receipt-operations.md).
