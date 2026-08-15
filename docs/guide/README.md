# The Seal operating guide

Seal puts one approval gate in front of one tool of one MCP server in one
project. When Claude Code tries to run that tool, you see exactly what would
run, and nothing runs until you approve that exact call — once, and only once.
Every other tool keeps working as if Seal were not there.

This guide is for using that gate day to day. It assumes you have seen a
`.mcp.json` before and can run commands in a terminal, and nothing more. Every
command shown here was actually run, and every output shown is what that run
printed; the outputs were captured in a scratch project on 2026-08-15, so the
paths in them will differ from yours.

## Before you start

- Linux x86-64 only. On anything else, `seal` refuses and changes nothing.
- Node 20 or newer.
- Claude Code installed (`claude --version` prints a version). `seal protect`
  needs it; `seal demo` and `seal status` do not.

Check the last one first:

```
$ claude --version
2.1.233 (Claude Code)
```

There is no downloadable release yet: you build the install artifact from a
clone and install it with its own printed digest. From the clone:

```
$ node scripts/build-dist.cjs --out dist
dist/seal-v0.1.1-linux-x64
sha256 8e97479eaf4df66d89b16e659db513bf12a83a928b8199244f8f4ec5c65c9c2f
bytes 118209
tree 6cb6c1584cfe297c5ae7c76be07f840705263f11a411b3321393d2078741b8bb

$ sh dist/seal-v0.1.1-linux-x64 --sha256 8e97479eaf4df66d89b16e659db513bf12a83a928b8199244f8f4ec5c65c9c2f
installed seal 0.1.1 linux-x64
store: /home/monkey/scratch/opguide-run/home2/.local/lib/seal/store/6cb6c1584cfe297c5ae7c76be07f840705263f11a411b3321393d2078741b8bb
command: /home/monkey/scratch/opguide-run/home2/.local/bin/seal
tree: 6cb6c1584cfe297c5ae7c76be07f840705263f11a411b3321393d2078741b8bb
```

The installer refuses to run without the `--sha256` pin, on purpose: you are
telling it which bytes you meant to install. Make sure `~/.local/bin` is on
your `PATH`, then run `seal demo` once — it walks the whole approve-once,
replay-blocked story in about a minute, against a harmless built-in server,
and asks for nothing but a y/N.

## The path through this guide

Read these in order the first time; each one stands alone afterwards.

1. **[Choosing what to protect](choosing-what-to-protect.md)** — the judgement
   call: which tool earns the gate, what `seal protect` changes, and what it
   deliberately leaves alone.
2. **[What is protected right now](what-is-protected-right-now.md)** — asking
   the machine instead of remembering: `seal status` and `seal doctor`, every
   state they report, and what each one means.
3. **[Knowing it worked](knowing-it-worked.md)** — the approval prompt line by
   line, what a refusal means, and how to check a receipt afterwards.
4. **[When something looks wrong](when-something-looks-wrong.md)** — every
   refusal token Seal can print, what caused it, and what to do next.

One honest sentence to carry into all four pages: Seal is a gate, not a
sandbox. It controls the path through it — Claude Code calling that one tool
of that one server — and only that path. Bash, the network, subprocesses, and
every other tool and server are outside it, and the approval prompt says so
every time.
