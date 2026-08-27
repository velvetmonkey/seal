# Multi-tool protection semantics

This document records the behavior shipped at commit
`466be4a5d423ad763c7325263f1d014311c95879`. It answers the four questions in
roadmap section 15.4 from the product code and from commands run on 2026-08-22.
It does not propose implementation work or decide the boxpol question.

## 1. Additive or declared as a set?

**Answer.** Protection is declared as the complete set for one server; a later
`seal protect` refuses while that server is protected instead of adding tools.

**Evidence.** `spine/protection.cjs:651-662` deduplicates the requested list and
refuses `already_protected` for every existing state except `UNPROTECTED`;
`:691-712` writes that complete list as `guardTools` in one project state.

**Observation.** Run with a test MCP server advertising `db.execute_sql`,
`db.drop_table`, and `db.read`:

```bash
seal protect db db.execute_sql
seal protect db db.drop_table
```

```output
Protection: PENDING RESTART db.db.execute_sql
exit 0
seal: REFUSE already_protected: project is already PENDING RESTART
exit 1
```

The doubled `db.db.execute_sql` is not a transcription error: the server name is
`db` and this test server advertises a tool whose full name is
`db.execute_sql`.

## 2. What does `seal status` show per tool?

**Answer.** `seal status` shows one shared server state followed by the guarded
tool names—`server.tool` for one or `server.{tool, tool}` for several—not an
independent state or lease for each tool.

**Evidence.** `bin/seal:58-74` obtains one protection view, formats all names
beside `view.state`, and prints the one `view.lease`; `spine/protection.cjs:12-19`
defines the six shared state values.

**Observation.** After protecting three advertised tools:

```bash
seal status
```

```output
Protection: PENDING RESTART db.{db.execute_sql, db.drop_table, db.read} (…/state.json)
exit 0
```

There is one `PENDING RESTART` value for the set, not three per-tool rows.

## 3. What happens when one of three tools vanishes at activation?

**Answer.** The whole server protection becomes `BROKEN`; Seal does not activate
the two remaining guarded tools as a partial set.

**Evidence.** `spine/protection.cjs:794-818` re-runs `tools/list`, collects every
guarded name that vanished, calls `markBroken`, and refuses activation;
`:766-769` writes `BROKEN` into the single shared state and clears its lease.

**Observation.** `db.drop_table` was removed from the server's advertised list
after a successful three-tool protect and before starting the proxy:

```bash
seal __proxy --protect-state <state>
```

```output
seal __proxy: protected_tool_vanished: protected tool "db.drop_table" vanished before activation; observed tools: db.execute_sql, db.read
exit 1
```

Stored-state readback:

```output
BROKEN
```

## 4. Does unprotecting one tool touch the others' leases?

**Answer.** There is no per-tool unprotect or per-tool lease: `seal unprotect
SERVER` removes the entire declared set and clears the server's one shared
lease.

**Evidence.** `bin/seal:326-332` accepts the server name and reports protection
outside Seal; `spine/protection.cjs:730-749` checks the one `state.lease`, removes
the server override, writes `UNPROTECTED`, and sets that lease to `null`.

**Observation.** A three-tool wrapper was activated and allowed to exit, leaving
one dead shared generation, before server-level unprotect:

```output
state=ACTIVE guardTools=["db.execute_sql","db.drop_table","db.read"] sharedLeaseGeneration=1
```

```bash
seal unprotect db
```

```output
Protection: - outside Seal
exit 0
```

Stored-state readback after the command:

```output
state=UNPROTECTED guardTools=["db.execute_sql","db.drop_table","db.read"] sharedLease=null
```

The historical names remain in the record, but none remains protected because
the only state is `UNPROTECTED` and the only lease is null.

## State-space count

The shipped multi-tool state machine admits **six semantic state classes**:
`UNPROTECTED`, `PENDING RESTART`, `ACTIVE`, `STALE`, `DRIFTED`, and `BROKEN`.
This is the count at the abstraction used by `STATES` in
`spine/protection.cjs:12-19`. Concrete tool-name sets are unbounded, so counting
each possible set of strings as a different configuration would not produce a
finite product-state count.

The four answers keep the semantic count at six rather than multiplying it per
tool: protection replaces no member independently, status exposes one shared
value, one vanished member breaks the whole set, and unprotect clears the whole
set and its shared lease. `STALE` is a status view of an `ACTIVE` record whose
lease is dead (`spine/protection.cjs:629-639`), but it is a distinct value the
shipped status state machine admits and displays.

## Multi-tool coverage

All six state classes are exercised with a guarded set containing more than one
distinct tool. Four tests use the same declaration of three distinct tools and
observe the guarded set after the state transition.

| State class | Multi-tool coverage | Existing test |
|---|---:|---|
| `UNPROTECTED` | Yes | `UNPROTECTED guards none of a former three-tool declaration and clears its shared lease` in `test/multi-tool-semantics-doc.test.cjs`. |
| `PENDING RESTART` | Yes | `three protected tools round-trip through stored state` (lines 159-169). |
| `ACTIVE` | Yes | `a named tool list gives both tools separate asks` (lines 92-128); starting its proxy activates the shared lease before the calls. |
| `STALE` | Yes | `STALE exposes one complete three-tool guard set for a dead shared lease` in `test/multi-tool-semantics-doc.test.cjs`. |
| `DRIFTED` | Yes | `DRIFTED guards the complete three-tool declaration after server configuration changes` in `test/multi-tool-semantics-doc.test.cjs`. |
| `BROKEN` | Yes | `BROKEN guards the complete three-tool declaration after one member vanishes` in `test/multi-tool-semantics-doc.test.cjs`. |

The tests for `STALE`, `DRIFTED`, and `BROKEN` assert that the observed guarded
names equal the declared three-tool set. The `UNPROTECTED` test first observes
that complete set after a real wrapper activation, then unprotects the server
and asserts through the product view that no declared member remains guarded.
A later protect test also observes the stored guarded set after replacement is
refused. The shared set-comparison helper has its own known-incomplete input
check, and the post-unprotect set assertion has a one-member-still-guarded
check.

## Verdict on “The state machine is TESTED”

**The state machine is TESTED across all six shared multi-tool state classes.**
This badge reports behavioral test observations. The four added state tests use
three distinct tools, and physical tamper runs showed each targeted test failing
with the omitted tool named when its state exposed only two guarded members.

## Document/code disagreements

- `docs/guide/choosing-what-to-protect.md:3-5,35-42` says Seal protects exactly
  one tool and that the gate holds one name. The code accepts `TOOL [TOOL...]`
  and stores a nonempty list (`bin/seal:290-317` and
  `spine/protection.cjs:651-712`).
- `README.md:7-9`, `docs/guide/README.md:3,94`, and
  `docs/README.md:74-75` describe one protected tool. That is narrower than the
  shipped named-set behavior.
- `docs/guide/what-is-protected-right-now.md:23-29` says the protection line is
  `server.tool` and does not document the shipped `server.{tool, tool}` form.
- Roadmap section 17.10, lines 11418-11425, says disappearance after protect is
  open. Current `spine/protection.cjs:794-818` implements the activation-time
  re-check and whole-server `BROKEN` result. The troubleshooting guide at
  `docs/guide/when-something-looks-wrong.md:349-354` agrees with the current code,
  although it describes the guarded tool in the singular.
- Roadmap section 17.10 labels the status behavior “per tool.” Its example of
  the braces format matches the code, but the code supplies one shared state and
  one shared lease, not independent per-tool status values.

## UNVERIFIED

**Lean proof source:** [`seal-host`'s proof reference](https://github.com/velvetmonkey/seal-host/blob/main/docs/PROOF-REFERENCE.md) is the reader-facing index for the Lean proof properties stated in this section.

The protection state machine has no machine-checked model in the `seal-host` Lean kernel.
The coverage verdict is based on the shipped CLI and product spine test paths;
no external Claude Code acceptance claim is made here.
