# The comprehension check

Priority 0, ruled by Ben 2026-07-25. A core product pivot, not a UI tweak.

## The defect

Seal's interactive approval prompt is, verbatim
(`rust/src/providers.rs:540`):

```
seal-host: approve target {target}? [y/N]
```

`target` is a 64-character hex digest. The human is shown no tool name, no
arguments, and no description of the effect they are authorising.

The agent, meanwhile, controls the chat window. So:

> Agent: "I'll tidy up the temp files, please approve."
> Seal:  `approve target a3f9c2e1...? [y/N]`
> Human: `y`

Seal then binds the approval perfectly to bytes that say `DROP TABLE users`.
Every signature verifies, every theorem holds, and the database is gone.

Four independent council seats reached this from different directions on
2026-07-24. Qwen: "are we just building a highly secure mechanism for the agent
to trick the human into authorizing a disaster?" GLM: "what happens when the
agent is smarter than the human approver?" Kimi's framing is the sharpest: the
human is not in the model at all, `ApprovalState` is abstracted to data, so the
proof cannot ask whether its own trust anchor is trustworthy.

**The cryptography is not the weak link. The comprehension of the person
clicking approve is, and it currently sits outside the formal boundary.**

## What is already right, and must not be lost

The displayed digest is derived from the request bytes, NOT supplied by the
agent. So an injected agent cannot write text into seal's prompt. That is a real
design strength and it was clearly deliberate.

Any fix must preserve it. **Nothing the agent authors may reach the human's
screen through seal.**

## The security property

Let `bytes` be the exact request line the approval is bound to, and `digest =
sha256(bytes)`.

Required: a rendering `R` such that

1. **Derivation.** `R` is a total function of the same canonical parse of
   `bytes` that the digest covers. Not of a re-parse, not of a re-serialisation,
   not of anything the agent supplies alongside.
2. **Agreement.** If two requests render identically, they digest identically.
   Contrapositive: different effects must never look the same to the human. This
   is the property that makes the rendering trustworthy rather than decorative.
3. **Totality.** `R` is defined for every input the mediator will ever show,
   including ones the parser refuses. A rendering that can fail is a rendering
   that will be skipped under pressure.

Property 2 is the interesting one and it is a theorem, not a test.

## Why this belongs in the kernel

If the Rust host renders, a host bug can display benign text while binding
hostile bytes. That is a new fail-open, in the one channel that currently has no
guard at all, and it would be invisible to every existing test because the
digest would still be correct.

The kernel already canonically parses the line in order to mediate it. So it
already holds the tool name and canonical arguments at approval time. The
rendering should be produced there, next to the parse it is derived from, with
Property 2 proven.

Ben's phrasing, and it is correct: a core kernel product pivot.

## The trap: rendering untrusted bytes to a terminal is itself an attack surface

This is the part a naive implementation gets wrong, and it would turn a
comprehension fix into a new injection.

The arguments being rendered are attacker-influenced. Writing them to a TTY
without care allows:

- **ANSI escape sequences**: repositioning the cursor, clearing the screen,
  recolouring, or overwriting the prompt line so the human reads something other
  than what was printed.
- **Newlines**: forging a second, fake prompt beneath the real one, so the human
  answers the attacker's question.
- **Carriage returns**: overwriting the visible line while leaving different
  bytes in scrollback.
- **Bidirectional overrides** (U+202E and friends): visually reversing text so
  `drop` renders as `pord`, or reordering an argument list.
- **Homoglyphs and confusables**: `dеlete` with a Cyrillic е.
- **Length**: an argument long enough to scroll the actual effect off screen.

So the rendering is not "print the JSON". It needs an explicit, pinned,
escaping-and-truncation discipline, and that discipline needs its own negative
controls: for each class above, a test that the hostile input renders inertly.

This is the same defect family as everything else here. A control that looks
right and is not measured on hostile input.

## Open design questions

Genuinely open, not rhetorical.

- Does the rendering go on the same channel as the prompt, or does it need an
  out-of-band channel the agent provably cannot reach?
- What is shown when the canonical parse refuses? Refusing to render and
  refusing to approve are different failures.
- Is Property 2 achievable in full, or only up to a stated equivalence? If two
  genuinely different requests must render identically, that must be declared,
  not discovered.
- Does the receipt record what the human was SHOWN, as well as what they
  approved? If the rendering is load-bearing for consent, it is arguably part of
  the evidence.

That last one may be the most valuable idea on this page.

## Residual attacks, from three seats asked to break their own designs

Council 2026-07-25, metered seats DeepSeek v4-pro, GLM 5.2, Qwen 3.7. Kimi K3
failed to return (see the seat-routing note; its verdict is NOT included).

The brief withheld the terminal-injection analysis above to see whether it would
be found independently. All three found it: ANSI escapes, bidi overrides,
homoglyphs, control characters. That is confirmation rather than agreement,
since none of them were shown it.

More useful is what they could NOT kill.

**1. Homoglyphs survive, and all three said so independently.** Escaping control
characters does nothing about printable Unicode that merely LOOKS like something
else: Cyrillic `а` for Latin `a`. DeepSeek is explicit that killing it needs an
allowlist or a disambiguation display, which is policy knowledge the rendering
does not have. **This is the hard residual.**

**2. A correct kernel rendering does not save you from the host that prints it.**
GLM and Qwen both landed here. Lean computes `R`, hands `(digest, R)` to the
unverified Rust host, and the host prints it. A host bug or compromise prints
`R'` while the signature still covers `digest`. The human authorises what they
did not see.

This refines the earlier argument above, and corrects it. Computing `R` in the
kernel is NECESSARY but NOT SUFFICIENT. The display path remains unverified
Rust, so the trusted computing base for consent includes the printer. That must
be stated in `TCB.md` rather than glossed.

**3. Truncation reintroduces collisions.** Qwen: if the rendering falls back to
showing only a digest above some size, two different requests can be shown
identically wherever a SHA-256 collision is achievable. Any truncation rule is
therefore a security parameter, not a formatting preference.

**4. Type coercion mismatch.** Qwen: if the canonical parse coerces a type (an
array read as a string, say) but the rendering shows the original JSON type, the
human sees a different request from the one that executes. Directly checkable
against our parser, and worth checking before anything is built.

**5. Terminal emulator bugs.** Escaping protects against the emulator behaving
CORRECTLY on hostile input. It does not protect against an emulator with a
defect in its escape handler. Outside our boundary, but it belongs in the
threat model rather than nowhere.

**6. Click fatigue.** GLM: an agent can trigger many guarded calls until the
human is trained to press `y`. GLM's own verdict is that no deterministic
rendering fixes this. Correct, and it is the honest ceiling on the whole
approach: comprehension can be OFFERED and cannot be COMPELLED.

### One attack they raised that we have already closed

Qwen's duplicate-JSON-key case (canonical parse takes last-wins while the
rendering shows first or all, so the human reads a different request from the
one that executes) does not apply here. Duplicate object keys are refused at the
wire before the parse, in both hosts, as of 2026-07-24 and 2026-07-25.

Worth recording because it is the first time this project has been AHEAD of a
red-team finding rather than behind one.

## Status

Design only. No implementation yet. Nothing here is proven.

Next: decide the truncation rule (item 3 makes it load-bearing), check the type
coercion question (item 4) against the actual parser, and write the display path
into `TCB.md` as trusted (item 2).
