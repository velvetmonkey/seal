# Knowing it worked

## First: is your project's gate up?

Run this in **the project you want protected**, after restarting Claude Code
there as directed by [Choosing what to protect](choosing-what-to-protect.md):

```bash
$ seal status
```

Read the route and tool list, not just the command's exit code. Status can
exit successfully while reporting that no gate is present.

- **Protected through the reported route:** `Runtime: present`, the intended
  `Sealed MCP route` is `ACTIVE`, and every tool you intend to guard appears
  under `Gated through this route`. An ACTIVE lease reports a live wrapper;
  it does not establish which client is using it. Confirm Claude Code selected
  that override and presents approval for the intended tool before relying on
  that client's calls being protected.
- **NOT protected:** `Sealed MCP route: - outside Seal` or `Gated through this route: none`. Stop here: this project has no gate. Protect the intended server
  and complete tool set, restart Claude Code, and repeat this check.
  Read `Not controlled:` for the routes outside this gate’s scope.
- **Protection not confirmed:** `PENDING RESTART`, `STALE`, `DRIFTED`, `BROKEN`,
  an unreadable state, a missing or mismatched runtime, a missing intended tool,
  or a failed status command. Stop and follow
  [What is protected right now](what-is-protected-right-now.md) before proceeding.

For example, after unprotecting the demo project, status reports:

```output
Sealed MCP route: - outside Seal

Gated through this route:
  none

Not controlled:
  Bash and subprocesses outside this MCP route
  direct resource access outside this MCP route
  other clients
  configured MCP servers not routed through this Seal wrapper: demo
  other uncontrolled routes can also exist
```

That is **NOT protected**, even if the demo, receipt checker and doctor below
all produce their expected output. Other servers listed as not routed through
this wrapper, Bash, network access and subprocesses remain outside its scope.
A previous receipt is not evidence that the project's gate is up now.

## What the following evidence shows

Trust here is not a feeling; it is three things you can look at. The approval
prompt shows the exact call before it runs. A refusal shows the gate holding.
A receipt records what was decided, and a separate-process checker refuses a
receipt that has been altered. The producer and checker obey the fixed member
order in `docs/SEAL-RECEIPT-V2.md`; the checker reaches only its local WASM
kernel, not the producer's assembler. This page walks all three from real runs.

## What Seal sends and Claude Code paints

When a healthy gate receives a fresh protected call it can render, it holds
the call before forwarding. For `append_note` with `note: seal-accepted-note`, the current renderer sends
this four-line message body (generated from the renderer, not a new client recording):

```output
Tool: append_note; Approval required
  note: seal-accepted-note
Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min.
Outside Seal: Bash, network, subprocesses, other tools and servers.
```

The tool and argument values lead the message; the generic approval title shares
the tool line instead of occupying a painted slot. All information from the
previous six-line body remains available to clients that paint the whole message.
The approve field's description also carries the complete arguments, full scope
and TTL, and the boundary:

```output
Arguments: note: seal-accepted-note. Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min. Outside Seal: Bash, network, subprocesses, other tools and servers.
```

The repository's historical Claude Code 2.1.251 recording paints three message
lines and the schema description. It predates this layout and shows the old text:

```output
  MCP server “notes” requests your input
  Approval required
  Tool: append_note
  Arguments:
  … (+3 more lines)
  ❯ * Approve one run: append_note: ☐
        Arguments: note: seal-accepted-note. Scope: at most one run.
    Accept    Decline
```

The current request puts the boundary and TTL into that recorded painted schema
channel; a fresh human acceptance run must still confirm the new text's layout
on the exact client.

- **Tool** and **Arguments** are the entire effect, exactly as parsed. When a
  tool takes arguments, each one is printed; what you approve is that exact
  combination and nothing else. Argument values now start on message line two,
  and the schema description repeats every argument even when later message
  lines are folded.
- **Scope** in both channels states that approval covers this parsed call only,
  can be used at most once, and lapses after 2 minutes by default.
- **Outside Seal** appears in both the message body and schema description:
  the gate does not see Bash, the network, subprocesses, or any other tool or server.

Approve, and the call runs — once:

```output
delete_all_notes first call: input_required; four-line approval message sent to the client
retry with accept: notes.txt deleted
identical retry replayed: BLOCK receipt -> verdict BLOCK
```

The same approval presented a second time did not run the tool a second time.
Decline instead, and the denial is terminal for that request:

```output
retry with decline: REFUSED -> approval refused: declined — the answer was decline; denial is terminal for this request
retry again after the decline: REFUSED -> approval refused: terminally_declined — this request was declined; denial is terminal
```

## Watching it hold: `seal demo`

You do not have to take the paragraph above on faith, and you do not need a
protected project to see it. `seal demo` runs the same gate against a
harmless built-in server that counts every call it actually receives, and
every count printed is read back from that server's own count file.
It creates a separate temporary directory: it proves the demo gate holds its
own call and blocks its replay. It does **not** test your project's routing or
show that your project is protected; it succeeds even after you unprotect that
project. Keep the project-status result above separate from this demonstration:

```output
child calls observed: 0 (read from …/child/data.txt.count)
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    (the four-line approval message plus the Selection predicate line)
child calls observed: still 0 … — approval shown, nothing executed
```

```console
Approve? [y/N] y
```

```output
child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from …/child/data.txt.count)
replaying the identical elicitation response with the same id…
BLOCKED   the shared proxy recorded a BLOCK receipt for the replay: verdict BLOCK
one-use held: the replay did not run the call again; child calls observed: still 1
```

Zero before approval, one after, still one after the replay. The demo then
ends by writing a file *without* crossing the gate and showing that Seal
emitted nothing for it — the "gate, not sandbox" boundary stated in this
guide.

## What a refusal means

A retry refusal from the approval contract has this shape:

```output
approval refused: <token> — <plain-language detail>
```

A refusal is not a malfunction. It means the gate compared the retry against
what you actually approved — same call, same arguments, same session, within
the window, not yet used — and something did not match, so the server was not
touched. What ran instead is nothing. Approvals also do not survive tampering
or bookkeeping damage: if the gate cannot prove the approval is the one it
issued, it refuses. Every token you can see, with its cause and remedy, is in
[When something looks wrong](when-something-looks-wrong.md).

A refusal that *should* worry you is one you cannot explain — a BLOCK receipt
when you never approved anything, say. That is the moment
to read the receipt and see what was actually decided, which is what the rest
of this page is for.

## Checking a receipt afterwards

When the gate can write its receipt directory, a kernel decision — the prompt
being offered, an allowed call, a kernel BLOCK — writes one JSON file. If the
kernel produced no result, Seal still refuses the call and keeps serving, but
it writes no receipt: a signed receipt cannot claim a decision the kernel did
not make. Inside a protected project, `seal status` shows where they live
and which is newest; in any other directory, including a `seal demo`
directory, it prints `Receipts: unavailable outside a protected project` and
names no receipt, so the demo's receipts are found from the `receipt written:`
lines in its own output. A receipt records what the gate
decided and about what. Both `seal demo` and the protected Claude Code path
write signed receipts. The demo generates a temporary key for its run; the
protected path creates or reuses a machine-local key. In either case, the
check is only as meaningful as the source of the public key you supply.

This signed example is from `seal demo`:

```json
{
  "seal_receipt": "v2",
  "tool": "demo.mutate",
  "action": "ALLOW",
  "arguments": {
    "line": "seal demo wrote this line"
  },
  "now": 1786796243,
  "kernel_config": { "...": "the exact config given to the kernel" },
  "granted_capabilities": [{ "target": "..." }],
  "kernel_inputs": { "approvals": ["..."], "votes": "", "grants": "", "forecasts": "" },
  "verdict": "ALLOW",
  "reason": "every gating kernel allows",
  "replay": { "args_sha256": "...", "config_sha256": "..." },
  "signature": { "algorithm": "ed25519", "value": "..." }
}
```

For the canonical meaning of receipt operations and their trust ceiling, see
[Receipt operations](../reference/receipt-operations.md). The independently
landed v2 checker reads the document, validates its commitments, and replays
its exact inputs through the checker's local WASM kernel. Supply a public key
you already trust if you also want the signature row checked.

For the demo you just ran, copy its complete `Run: (cd ... && node ...)`
command. It enters the installed store that contains the checker and checks
the existing `-0003-BLOCK.json` receipt from the blocked replay. The ALLOW
example above illustrates the receipt's contents; it is not the printed
checker's target.

Equivalently, set `SEAL_STORE` to the absolute directory after `cd` in that
printed command, `SEAL_DEMO_DIR` to the printed temporary demo directory, and
`SEAL_BLOCK_RECEIPT` to the full BLOCK receipt path. With those values from
**your run**, this works from the demo directory or your project:

```bash
$ (cd "$SEAL_STORE" && node checker/seal-receipt-v2.mjs "$SEAL_BLOCK_RECEIPT" --pubkey "$(cat "$SEAL_DEMO_DIR/receipt-signer.pub")")
```

The checker exits 0 and prints:

```output
Document structure       VALID
Signature and bindings   VALID
Verifier-local verdict   REPRODUCED
Authority key            UNPINNED / CALLER-SUPPLIED
Event occurrence         NOT ESTABLISHED
                         ------------------
READ      available
VALIDATE  available
REPLAY    available
VERIFY    UNVERIFIED
```

Save a copy of that BLOCK receipt as `tampered-receipt.json` in
`SEAL_DEMO_DIR`. Change its `arguments.line` value to `tampered`, without
repairing the commitment. Check the copy with the same installed checker:

```bash
$ (cd "$SEAL_STORE" && node checker/seal-receipt-v2.mjs "$SEAL_DEMO_DIR/tampered-receipt.json" --pubkey "$(cat "$SEAL_DEMO_DIR/receipt-signer.pub")")
```

The checker exits 1 and prints:

```output
REFUSE commitment_mismatch: arguments commitment mismatch
```

Two caveats the checker itself insists on, repeated here because they are the
whole meaning of the check:

- The key must come from a source you already trust, not from beside the
  receipt. Checking a receipt against the sealer's own key (as the demo does)
  proves only self-consistency — a hostile sealer could sign its own.
- The v2 verifier was landed before this producer and does not import the
  producer's assembler or canonicaliser.

`seal verify PATH` runs the same v2 read/validate/replay path without treating a
receipt-embedded key as authority.

## The limit, stated plainly

Seal makes the approved call and the executed call the same call: same tool,
same arguments, once, within the window. What it cannot prove is that a human
clicked Accept — Claude Code is trusted to put the prompt in front of you and
return your answer faithfully. That is a declared assumption, not an enforced
property; `seal doctor` prints it, and refuses if it finds a configuration
that automates the answer. Even the internal evidence attached to each
allowed call records `human_present: "unknown"` rather than claiming
otherwise.

If you want the boundary demonstrated rather than described, run `seal demo`
and read its scope witness; once you approve its one call it ends with three
labelled blocks, `ENFORCED`, `NOT APPROVAL-GATED` and `NOT OBSERVED`, whose
last line reports that the direct write left the protected-server call count
unchanged and Seal made 0 new decisions, which is the honest summary this
guide keeps returning to, measured rather than stated: Seal is a gate, not a
sandbox — it controls the path through it, and only that path.

Previous: [Choosing what to protect](choosing-what-to-protect.md).
Up: [Guide](README.md).
Next: [GitHub Actions provenance](github-actions-provenance.md).
