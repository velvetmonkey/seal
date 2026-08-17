# Knowing it worked

Trust here is not a feeling; it is three things you can look at. The approval
prompt shows the exact call before it runs. A refusal shows the gate holding.
A receipt records what was decided, and a separate-process checker refuses a
receipt that has been altered. The checker imports no Seal module at runtime,
but copies Seal's canonicalisation rule and uses the same Node crypto
platform, so it cannot detect defects shared there. This page walks all
three, from real runs.

## The approval prompt, line by line

When a healthy gate receives a fresh protected call it can render, it holds
the call before forwarding and sends this approval request (captured from a
live gated call):

```
Approval required
Tool: delete_all_notes
Arguments:
  (none)
Scope: this parsed call (key order and 1/1.0 match); at most one run; 2 min.
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

```
delete_all_notes first call: input_required; approval message shown to the user:
    (the prompt above)
retry with accept: notes.txt deleted
identical retry replayed: REFUSED -> approval refused: already_consumed — this one-use approval has already been consumed
```

The same approval presented a second time did not run the tool a second time.
Decline instead, and the denial is terminal for that request:

```
retry with decline: REFUSED -> approval refused: declined — the answer was decline; denial is terminal for this request
retry again after the decline: REFUSED -> approval refused: terminally_declined — this request was declined; denial is terminal
```

## Watching it hold: `seal demo`

You do not have to take the paragraph above on faith, and you do not need a
protected project to see it. `seal demo` runs the same gate against a
harmless built-in server that counts every call it actually receives, and
every count printed is read back from that server's own count file:

```
child calls observed: 0 (read from …/child/data.txt.count)
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    (the six-line prompt)
child calls observed: still 0 … — approval shown, nothing executed
Approve? [y/N] y
child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from …/child/data.txt.count)
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1
```

Zero before approval, one after, still one after the replay. The demo then
ends by writing a file *without* crossing the gate and showing that Seal
emitted nothing for it — the same "gate, not sandbox" boundary the prompt
states.

## What a refusal means

A retry refusal from the approval contract has this shape:

```
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
  "receipt": "seal.spine/v1",
  "at": 1786796243578,
  "decision": "ALLOW",
  "tool": "demo.mutate",
  "arguments": {
    "line": "seal demo wrote this line"
  },
  ...
}
```

Receipts are claims written by the gate, not proofs — so they are checked by
a separate process that imports no Seal module at runtime and needs a public
key you already trust as input. Its canonicalisation is nevertheless a
byte-identical copy of the producer's rule, and both use Node crypto: a defect
shared there can make both agree on a wrong receipt.

```
$ node …/checker/seal-receipt-check.mjs receipt-…-0002-ALLOW.json --pubkey receipt-signer.pub
ACCEPT ALLOW demo.mutate — decision, tool, arguments and signature all match the sealed commitments. This shows the receipt has the same canonical parsed value that this key signed. Semantically irrelevant JSON formatting differences are not distinguished. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story.
```

Change one recorded fact — here, the decision — and the checker names what
was touched:

```
$ node …/checker/seal-receipt-check.mjs tampered-receipt.json --pubkey receipt-signer.pub
REFUSE decision_binding_mismatch: the recorded decision does not match its sealed commitment
```

Two caveats the checker itself insists on, repeated here because they are the
whole meaning of the check:

- The key must come from a source you already trust, not from beside the
  receipt. Checking a receipt against the sealer's own key (as the demo does)
  proves only self-consistency — a hostile sealer could sign its own.
- The checker ships in the same artifact as Seal, so it cannot protect
  against a wholesale replaced artifact.
- The checker is runtime-separate, not implementation-independent: it copies
  the producer's canonicalisation rule and shares the Node crypto platform.
  It cannot expose a defect common to those parts.

One routing note: `seal verify` is **not** the command for these receipts. It
handles a different, older receipt format, and pointed at one of its own
gate receipts it tells you so and exits — use the checker above instead.

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

Next: [When something looks wrong](when-something-looks-wrong.md).
