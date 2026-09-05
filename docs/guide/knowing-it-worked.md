# Knowing it worked

Trust here is not a feeling; it is three things you can look at. The approval
prompt shows the exact call before it runs. A refusal shows the gate holding.
A receipt records what was decided, and a separate-process checker refuses a
receipt that has been altered. The producer and checker obey the fixed member
order in `docs/SEAL-RECEIPT-V2.md`; the checker reaches only its local WASM
kernel, not the producer's assembler. This page walks all three from real runs.

## The approval prompt, line by line

When a healthy gate receives a fresh protected call it can render, it holds
the call before forwarding and sends this approval request (captured from a
live gated call):

```output
Approval required
Tool: delete_all_notes
Arguments:
  (none)
Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min.
Outside Seal: Bash, network, subprocesses, other tools and servers.
```

- **Tool** and **Arguments** are the entire effect, exactly as parsed. When a
  tool takes arguments, each one is printed; what you approve is that exact
  combination and nothing else. If the full effect cannot fit on screen, Seal
  refuses to ask rather than truncate it — a boundary the terminal hides is
  not one you approved.
- **Scope** is the contract: your approval covers this parsed call only, can
  be used at most once, and lapses after 2 minutes.
- **Outside Seal** is the honesty line, printed every time: the gate does not
  see Bash, the network, subprocesses, or any other tool or server.

Approve, and the call runs — once:

```output
delete_all_notes first call: input_required; approval message shown to the user:
    (the prompt above)
retry with accept: notes.txt deleted
identical retry replayed: BLOCK receipt -> already_consumed
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
every count printed is read back from that server's own count file:

```output
child calls observed: 0 (read from …/child/data.txt.count)
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    (the six-line prompt)
child calls observed: still 0 … — approval shown, nothing executed
```

```console
Approve? [y/N] y
```

```output
child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from …/child/data.txt.count)
replaying the identical elicitation response with the same id…
BLOCKED   the shared proxy recorded a BLOCK receipt for the replay: "already_consumed"
one-use held: the replay did not run the call again; child calls observed: still 1
```

Zero before approval, one after, still one after the replay. The demo then
ends by writing a file *without* crossing the gate and showing that Seal
emitted nothing for it — the same "gate, not sandbox" boundary the prompt
states.

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

A refusal that *should* worry you is one you cannot explain — an
`already_consumed` when you never approved anything, say. That is the moment
to read the receipt and see what was actually decided, which is what the rest
of this page is for.

## Checking a receipt afterwards

When the gate can write its receipt directory, every decision — the prompt
being offered, an allowed call, a refusal — writes one JSON file. `seal status`
shows where they live and which is newest. A receipt records what the gate
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

```bash
$ node checker/seal-receipt-v2.mjs receipt-…-0002-ALLOW.json --pubkey "$(cat receipt-signer.pub)"
```

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

Change the arguments without repairing their commitment and the checker refuses:

```bash
$ node checker/seal-receipt-v2.mjs tampered-receipt.json --pubkey "$(cat receipt-signer.pub)"
```

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
and read its scope witness; it ends with the honest summary this guide keeps
returning to: Seal is a gate, not a sandbox — it controls the path through
it, and only that path.

Previous: [Choosing what to protect](choosing-what-to-protect.md).
Up: [Guide](README.md).
Next: [GitHub Actions provenance](github-actions-provenance.md).
