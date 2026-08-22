# The comprehension check

Priority 0, ruled by Ben 2026-07-25. A core product pivot, not a UI tweak.

## The defect

Seal's interactive approval prompt is, verbatim
(`rust/src/providers.rs:540`):

```text
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

## Decision: `R`, version 1

This section answers the four questions above. It is a design, not an
implementation or a claim that the theorems already exist.

### Function and domain

The renderer identity is `seal.renderR/v1`. Let `P` be the kernel's one
canonical parse operation over an exact, finite request frame `b`. `P` must
return a lossless, coupled outcome:

```text
Accepted {
  wireBytes, wireScope, wireSha256,
  canonicalAction,
  targetPreimage, targetDigest,
  proof that canonicalAction and targetPreimage came from this parse of wireBytes
}

Refused {
  wireBytes, wireScope, wireSha256,
  reasonCode
}
```

`wireBytes` is a byte array, not a Lean `String`. `wireScope` is the fixed
`mcp-jsonrpc-request-frame-including-delimiter` scope specified by
`AUTHORIZATION-RECORD.md` section 2.2. `P`'s `reasonCode` is exactly
`CANONICAL_PARSE_REFUSED` or `UNREPRESENTABLE_UNICODE_SCALAR`. `R`'s displayed
reason domain adds `APPROVAL_DISPLAY_LIMIT` and
`APPROVAL_CHANNEL_UNAVAILABLE`; it is never parser text containing attacker
input.
`targetPreimage` is the exact byte string to which the approval target's hash is
applied. Its construction from `canonicalAction` is part of `P`, not a second
serializer owned by the display path.

The function is:

```text
R : ApprovalSurfaceState -> ParseOutcome -> {
  rendererIdentity,
  approvalSurfaceIdentity,
  disposition : APPROVAL_AVAILABLE | APPROVAL_REFUSED,
  displayBytes : UTF8
}
```

`ApprovalSurfaceState` is either `Dedicated(surfaceIdentity,
capabilityProof)` or `Unavailable`. It is supplied by the trusted mediator, not
the agent. The proof means the agent, child and shared chat/stdin/stdout paths
have no capability for that surface. The surface identity, or the literal
`NOT AVAILABLE`, is included in `displayBytes`.

Operationally the composition is `b -> P(b) -> R(surface, P(b))`, with exactly
one call to `P`; the surface state is an independent trusted input. The output
is an immutable byte tuple. The renderer, surface identity, disposition,
display length and SHA-256 of the exact `displayBytes` are the comprehension
fields item 8 puts in the signed payload. The host must write those same bytes,
not reconstruct them. `AUTHORIZATION-RECORD.md` section 2.4 separately requires
the bytes actually delivered to the approval surface to be retained and bound
by `ApprovalRecord` v2.

An `APPROVAL_AVAILABLE` display has this fixed order:

1. renderer identity and literal `APPROVAL AVAILABLE`;
2. exact target digest and target-preimage length;
3. the canonical tool and arguments as the explicitly typed tree in
   `canonicalAction`;
4. the complete `targetPreimage` as lowercase hex with fixed renderer-authored
   line breaks;
5. exact wire scope, wire length and wire SHA-256;
6. the complete `wireBytes` as lowercase hex with fixed renderer-authored line
   breaks; and
7. a final renderer-authored question that repeats the canonical tool, target
   digest and literal `approve exactly the typed action and byte subjects
   above?`.

Each hex body consists of two lowercase digits per source byte, with no omitted
bytes and no separators inside the body. `R` places 32 source bytes on each row
except the last and prefixes each row with its eight-digit lowercase byte
offset. This row syntax is renderer structure, not attacker data.

The typed tree labels every value `object`, `array`, `string`, `integer`,
`binary64-decimal`, `boolean`, or `null`; objects are shown in the canonical
action's order and every container states its element count. Original JSON
spelling appears only in the separately labelled wire-byte hex, never in a
semantic value slot.

### Obligation 1: derivation

`R` does not parse wire bytes, stringify a host value, or accept a tool,
argument, digest, description or display fragment from the agent or host. It
projects the typed action and exact target preimage from the one `Accepted`
value produced by `P`. The kernel must make it impossible to construct an
`Accepted` value whose action, preimage, digest and wire witness came from
different requests.

The derivation theorem is therefore about the coupled result, not two calls
which happen to use the same parser:

```text
P(b) = Accepted(o)
  -> o.canonicalAction = canonicalParse(b)
  /\ o.targetDigest = sha256(o.targetPreimage)
  /\ R(s, o).semanticTree = renderTyped(o.canonicalAction)
  /\ R(s, o).hexTargetPreimage = hex(o.targetPreimage)
```

This also fixes renderer drift: the signed renderer identity selects this exact
grammar and escaping table. A renderer change is a new identity, not an
in-place presentation change.

### Obligation 2: agreement

Agreement is **full on the approval domain, with no semantic or Unicode
equivalence quotient**. Equality means byte-for-byte equality of
`displayBytes` under the same renderer identity, not “looks similar in a
particular font.”

The full digest-agreement theorem is:

```text
P(b1) = Accepted(o1)
/\ P(b2) = Accepted(o2)
/\ R(s1, o1).displayBytes = R(s2, o2).displayBytes
  -> o1.targetDigest = o2.targetDigest
```

Every display produced from an accepted parse, including a length refusal,
contains the target digest, so this implication is a projection theorem. On
the approval-available subdomain the required stronger theorem is:

```text
R(s1, o1).disposition = APPROVAL_AVAILABLE
/\ R(s2, o2).disposition = APPROVAL_AVAILABLE
/\ R(s1, o1).displayBytes = R(s2, o2).displayBytes
  -> o1.targetPreimage = o2.targetPreimage
```

This follows because an available display contains the entire,
length-delimited target preimage in an injective lowercase-hex encoding. Digest
equality then also follows by congruence, without assuming SHA-256 is
collision-free. The complete wire-byte field gives the stronger analogous
result for the framed request subject.

Every refusal display contains its exact wire digest, so identical refusal
displays imply identical wire digests. Oversize refusals deliberately do not
claim byte identity: they cannot be approved or dispatched. No equivalence is
being hidden here; the approval theorem has exact equality, while a refusal has
no approval target and no effect-authorising transition.

The sentence above that calls “different effects must never look the same” a
contrapositive is too strong. The actual contrapositive is “different target
digests cannot have identical render bytes.” Effect equality is not defined by
that theorem, and visually confusable but byte-different ASCII remains possible.
The byte-injectivity result for `APPROVAL_AVAILABLE` is the stronger property
needed here.

### Obligation 3: totality and parse refusal

`R` is total for every pair of `ApprovalSurfaceState` and `ParseOutcome`, and
`P` must return `Refused` rather than fail to construct an outcome for every
finite byte frame. An internal inability to obtain a `ParseOutcome` is a kernel
failure and must terminate mediation; it must never fall through to the host's
ordinary prompt.

For `Refused`, `R` always emits a bounded, ASCII-only display containing:

```text
seal.renderR/v1
APPROVAL REFUSED -- NO APPROVAL INPUT WILL BE READ
reason: <closed reason code>
wire-scope: <fixed scope name>
wire-length: <decimal byte count>
wire-sha256: <64 lowercase hex digits>
target-sha256: <64 lowercase hex digits, or NOT AVAILABLE after parse refusal>
wire-bytes: <complete lowercase hex, only when within the display bounds>
request was not authorized and must not be dispatched
```

There is no `[y/N]`, button, token-consumption path or other approval affordance.
For a syntactically malformed but in-bound request, this is a successful
rendering of a refused request. It distinguishes refusal to parse from failure
to render.

### Escaping discipline

All renderer output is the ASCII subset of UTF-8. Structural line feeds are
inserted only by `R`; byte `0x0d` is never emitted. In the typed tree, only ASCII
letters, digits, space, `.`, `_`, `/` and `-` may be copied as glyphs. Every
other Unicode scalar is printed as an uppercase `\u{HEX}` token with its scalar
width made explicit by the value's scalar count. Raw bytes are shown only as
lowercase hex. These are security rules, not styling choices:

- **ANSI escapes:** ESC and every other control byte occur only as hex or a
  `\u{HEX}` token. No attacker-controlled terminal control byte is emitted.
- **Newlines:** an input LF is data (`0a` in the byte view and `\u{A}` in a
  scalar value). Only fixed renderer-authored LFs can create display lines.
- **Carriage returns:** input CR is `0d` or `\u{D}`; `R` emits no CR byte.
- **Bidirectional overrides:** all non-ASCII scalars, including U+202A through
  U+202E and U+2066 through U+2069, are numeric tokens, so they never enter the
  terminal's bidi algorithm as controls.
- **Homoglyphs:** non-ASCII letters are numeric tokens, so a Cyrillic `е` cannot
  be displayed as a Latin `e`. The scalar count, explicit string type and full
  byte view prevent it being silently fused with an adjacent field. ASCII
  lookalikes such as `I`, `l` and `1` remain a human/display-font residual; no
  Unicode normalization or confusable folding is an allowed equivalence.
- **Length:** the exact bounds and refusal below prevent attacker data from
  scrolling an approval's named action away and forbid fold/collapse UI.

The printer and approval surface must reproduce the bytes faithfully in a
pinned monospace presentation with wrapping disabled except at `R`'s line
breaks. Terminal-emulator defects and a lying printer remain in the consent TCB;
this function cannot prove them away.

### Truncation and length refusal

The v1 security parameters are:

```text
MAX_APPROVABLE_WIRE_BYTES    = 4096
MAX_APPROVABLE_DISPLAY_BYTES = 16384
```

Both bounds are inclusive. A 4096-byte wire subject may be approved only if its
complete rendered display is at most 16384 bytes. At 4097 wire bytes, or when
the complete display would be 16385 bytes, `R` emits
`APPROVAL_REFUSED` with reason `APPROVAL_DISPLAY_LIMIT`; mediation reads no
approval and performs no dispatch. The refusal includes length and digest but
omits the oversize byte body.

There is no truncation, ellipsis, prefix/suffix summary, scrollable collapse or
digest-only fallback on an approval path. The bounds are security parameters:
raising either enlarges the length/scroll attack surface; permitting a
digest-only approval above either bound would replace byte-injectivity with a
SHA-256 collision assumption. A future bound change therefore requires a new
renderer identity and the same review as any other signed-shape change.

### Type coercion and numbers

The semantic panel is rendered only from `canonicalAction`, and execution must
consume that same typed value. If the canonical parser turns an input into a
string, the panel says `string`; if it produces an array, the panel says
`array`. `R` never infers a type from the original literal and never asks
JavaScript, Rust or a GUI toolkit to parse or stringify a number. The original
literal remains visible only as labelled wire bytes. Thus a coercion cannot
make the semantic display retain the pre-coercion type.

For an accepted number, the typed tree prints the exact mathematical integer or
the admitted shortest round-tripping decimal from the canonical action. The
measured `1234567890123456789` case must refuse before `R`; it must never reach
a JavaScript `number`. `docs/archive/OPEN-FINDINGS.md` row 40 records the concrete failure:
JavaScript renders that literal as `1234567890123456800` through
`JSON.stringify` and `1234567890123456768` through `toFixed(0)`, while Python
retains the literal. `docs/NUMERIC-AGREEMENT.md` section 4 and
`docs/archive/OPEN-FINDINGS.md` rows 35 and 40 establish on disk that the recorded kernel rule
accepts integer syntax only when the exponent-applied value is exactly
representable in binary64 (with an additional coefficient restriction), and
accepts decimal/exponent syntax only for the shortest round-tripping decimal.
Those admission properties are sufficient for `R`, although the extra integer
over-refusal is not required by this design.

`R` may rely on that guard only as an explicit proposition carried by
`Accepted`; it must not duplicate the numeric check. The named
`fix/coefficient-conjunct-demoted` branch and its exact rule are not present in
this repository and are **UNVERIFIED HERE**. Removing the coefficient conjunct
is compatible with this design only if exact binary64 representability remains
proved for every newly accepted integer.

This closes the parser-to-display coercion question. It does not establish that
an arbitrary downstream executor assigns the same semantics to the unchanged
wire bytes. That cross-parser property remains outside `R`.

### Bytes the kernel value type cannot represent

Wire validation must detect an unpaired UTF-16 surrogate escape before
constructing a Lean `String` and return
`Refused(reasonCode = UNREPRESENTABLE_UNICODE_SCALAR)` while retaining the
original byte array. `R` then shows the standard refusal. Within the bounds it
also shows every original byte as hex: for example the ASCII wire bytes for
`\ud800` appear as `5c7564383030`. No replacement character is shown as though
it were the parsed value, and no Unicode scalar is invented.

The same byte path handles invalid UTF-8 and any other input the kernel value
types cannot denote. Above the bound it shows the refusal reason, exact byte
length and wire digest, but no body and no approval affordance. This is not
better parsing; it is total rendering of a byte-preserving refusal.

`docs/archive/OPEN-FINDINGS.md` rows 36 and 37 support the Lean type limitation and the
independently reproduced Lean/Node/Python shape. The reported complete
five-observer, nine-vector matrix remains **UNVERIFIED INDEPENDENTLY**, as the
finding itself says.

### Q1: approval channel

The rendering and approval input go to a dedicated out-of-band approval surface
whose write and input capabilities are owned only by seal's approval component.
Agent output, child stdout/stderr, tool results and chat content must have no
route to it. The surface must identify itself independently of agent-authored
content and must atomically bind its input to the exact displayed tuple.

If that capability separation or surface identity cannot be established, the
result is `APPROVAL_REFUSED` with reason `APPROVAL_CHANNEL_UNAVAILABLE`; seal
does not fall back to chat, shared stdout or shared stdin. Escaping makes hostile
request data inert, but it cannot give a shared channel trustworthy provenance.
The host printer and channel implementation remain trusted and must be named in
`TCB.md`.

The current live channel routing cannot be checked from this repository and is
**UNVERIFIED HERE**.

### Q2: canonical-parse refusal

Answered by the total refusal display above. A refusal is shown, but approval is
not offered. In-bound unrepresentable bytes are displayed completely as hex;
oversize bytes are represented by reason, scope, exact length and digest because
the only permitted next state is refusal. A renderer failure is not converted
to this display: it terminates mediation without approval.

### Q3: equivalence

Full agreement, not agreement modulo JSON spelling, Unicode normalization,
numeric value, font appearance or any other equivalence. The theorem compares
exact display bytes under the exact renderer identity and concludes exact target
preimage and digest equality on the approval domain. Distinct wire spellings
may produce distinct displays even when they denote the same canonical action.

### Q4: record of what was shown -- closed

Landed as a specification in `AUTHORIZATION-RECORD.md` section 2.4, confirmed on
disk. Its AUTHORIZED leg requires the exact displayed-byte tuple and renderer
identity, and `ApprovalRecord` v2 retains the original signed token bytes
(`AUTHORIZATION-RECORD.md:230-309`). The file records Ben's Option D ruling at
08:34 (`AUTHORIZATION-RECORD.md:5-12`). This is specified, not implemented.

## Disagreements and limits

1. The earlier absolute sentence “Nothing the agent authors may reach the
   human's screen through seal” cannot coexist with a comprehension display of
   attacker-influenced tool names and arguments. The enforceable rule is:
   nothing agent-authored reaches the surface except as a bound,
   kernel-derived, inert rendering inside `R`.
2. The earlier definition `digest = sha256(bytes)` is not precise enough for
   the approval target. `docs/archive/OPEN-FINDINGS.md` row 24 says the target is computed by
   Lean from `argsJson`, while raw `request_sha256` is a separate retained
   digest. This design therefore names `targetPreimage`, `targetDigest`,
   `wireBytes` and `wireSha256` separately. Item 8 must pin their exact scopes;
   it must not call both values “the digest.”
3. Computing `R` in the kernel is necessary but does not prove that the host
   wrote `displayBytes`, that a terminal rendered them faithfully, that the
   human understood them, or that the downstream executor parsed the wire like
   the kernel. Those are separate TCB, human-factors and cross-parser
   obligations.
4. No implementation or proof of `P`, `R`, derivation, agreement, channel
   separation or renderer totality exists in this repository. The two numeric
   admission properties above are recorded evidence, not an imported theorem
   available to `R`.
5. The 4096/16384 bounds are new normative design choices. No on-disk
   measurement establishes that they fit every supported approval surface.
   Raising them is forbidden without a renderer-version change; lowering them
   is fail-closed but still changes the signed presentation contract.

## Specification evidence

Checked on `main` against `ROADMAP-KERNEL-OUTWARD.md` item 6-10,
`AUTHORIZATION-RECORD.md` section 2.4, `NUMERIC-AGREEMENT.md` section 4, and
`docs/archive/OPEN-FINDINGS.md` rows 24, 35-37 and 40. The unavailable implementation
repositories and worktrees were not entered.

Evidence: RUN renderR-spec-2026-07-27
