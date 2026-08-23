# Seal canonicalization rules — frozen specification

| | |
|---|---|
| Version | 1 |
| Frozen at | 2026-08-23 |
| Source of truth | `contract/canonical.cjs`, `spine/receipt-seal.cjs`, `checker/seal-receipt-check.mjs` at commit `72d564f8` |
| Change policy | This document is frozen. A change to any rule below is published as version 2 of this document with the new frozen-at date; version 1 is never edited in place. |

This document exists so that a person who has never read Seal's code can
write their own canonicalizer and get the same bytes Seal gets. Every
statement here was taken from the implementation at the commit above, not
from any other document. Where the implementation leaves something open, the
open point is stated as such in the last section rather than decided here.

## The finding this document records

**Seal contains two canonicalization rules, and they accept different sets
of values.** Both render "compact JSON with object keys sorted by UTF-8
byte order", and for every value both accept they produce identical bytes.
They differ in what they refuse:

| | Contract rule | Receipt rule |
|---|---|---|
| Where | `contract/canonical.cjs` (`canonicalString`) | `spine/receipt-seal.cjs` (`canonical`) |
| Used for | the approval contract's `canonical_effect_bytes` and the kernel hand-off (see [approval-contract-rs1.md](approval-contract-rs1.md)) | every receipt commitment and the signed receipt body (see [receipt-seal-spine-v1.md](receipt-seal-spine-v1.md)) |
| Numbers | **safe integers only**: finite, integral, and within ±9007199254740991 | **any finite IEEE-754 double**, rendered by ECMAScript `Number::toString` |
| `1.5` | refused | `1.5` |
| `9007199254740992` | refused | `9007199254740992` |
| `1e21` | refused | `1e+21` |
| `NaN`, `±Infinity` | refused | refused |
| `undefined` | refused | refused (by a named code) |

The shipped checker, `checker/seal-receipt-check.mjs`, carries a hand copy
of the **receipt rule**. When other Seal documents say the checker "copies
Seal's canonicalisation rule", the rule copied is the receipt rule, not the
contract rule. That is the correct choice — the checker recomputes receipt
commitments — but it had not been written down before this document.

The split is deliberate and is **not** to be unified. The contract commits
tool arguments for an approval, where refusing anything that is not a safe
integer is a narrowing chosen on purpose (a `1` and a `1.0` cannot be two
different approvals). The receipt serialises a wider set because a receipt
must be able to record whatever the contract was asked about, including an
effect the contract refused as unrenderable.

## Shared definitions

These apply to both rules.

**Input domain.** A JavaScript value. In practice: the result of parsing a
JSON-RPC frame (`params.arguments`) or a receipt file with `JSON.parse`,
plus objects the product builds itself. Implementers in other languages
should read "JavaScript value" as the JSON data model (null, boolean,
number, string, array, object) plus the non-JSON values named in the
refusal tables.

**Output.** A string. The **canonical bytes** are the UTF-8 encoding of
that string. Every digest in Seal is SHA-256 over those UTF-8 bytes
(`crypto.createHash("sha256").update(Buffer.from(text, "utf8"))` in both
files), rendered as 64 lowercase hexadecimal characters.

**Structure.** Compact JSON: no whitespace anywhere outside string
literals. Arrays are `[`, the elements' canonical forms joined by `,`, `]`.
Objects are `{`, the members joined by `,`, `}`, each member being the
escaped key, `:`, the value's canonical form. An empty array is `[]`; an
empty object is `{}`.

**Which object members.** `Object.keys(value)`: the object's **own,
enumerable, string-keyed** properties. Symbol-keyed properties are never
rendered. Inherited properties are never rendered. A member whose value is
`undefined` **is** enumerated by `Object.keys` and therefore reaches the
value rule, which refuses it (see each rule's table). Arrays are
recognised by `Array.isArray`; any other non-null object (including `Date`,
`Map`, class instances) is treated as a plain object and rendered from its
own enumerable string keys, which for a `Map` or `Date` means `{}`.

**Key ordering.** Keys are sorted by comparing their **UTF-8 byte
sequences** as unsigned bytes, shortest-prefix-first
(`Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))`). This is
**not** JavaScript's default `sort()` (UTF-16 code-unit order) and it is not
a locale collation. The two orders differ whenever one key contains a
character outside the Basic Multilingual Plane and another contains a BMP
character at or above U+E000 — see example 8. Duplicate keys cannot occur
in a JavaScript object, so the spec does not define their order.

**String escaping.** Exactly ECMAScript `JSON.stringify` applied to the
string (ECMA-262 *QuoteJSONString*), for both keys and values:

| Input | Output |
|---|---|
| `"` (U+0022) | `\"` |
| `\` (U+005C) | `\\` |
| U+0008, U+000C, U+000A, U+000D, U+0009 | `\b`, `\f`, `\n`, `\r`, `\t` |
| any other code unit below U+0020 | `\u` followed by four **lowercase** hex digits, e.g. `\u0001` |
| a lone surrogate code unit (U+D800–U+DFFF not part of a valid pair) | `\u` followed by four lowercase hex digits, e.g. `\ud83d` |
| everything else, including `/`, U+007F, U+2028, U+2029 and all non-ASCII characters | the character itself, encoded as UTF-8 in the output bytes |

**Number rendering, when a number is accepted.** ECMAScript
`Number::toString(10)` — the shortest decimal string that round-trips to
the same double, using the ECMAScript rules for when to switch to exponent
notation (`1e+21` at and above 10²¹, `1e-7` below 10⁻⁶) — with one override
present in both rules: **negative zero renders as `0`**, never `-0`. For
the contract rule this collapses to "the integer's decimal digits with an
optional leading `-`", because every accepted value is a safe integer and
safe integers never reach exponent notation.

**Top-level value.** Either rule may be given any value at the top level,
not only an object; a bare string canonicalises to its escaped form, a bare
number to its rendering.

**Depth.** Both rules recurse without a depth limit. Neither rule has a
size limit.

## Rule A — the contract rule (`contract/canonical.cjs`)

Evaluation order for one value, first match wins:

1. `null` → `null`
2. `true` → `true`; `false` → `false`
3. a number:
   1. not finite (`NaN`, `Infinity`, `-Infinity`) → **refuse**
      `non-finite number has no canonical form`
   2. not an integer (`Number.isInteger` false) → **refuse**
      `non-integer number has no canonical form in the contract`
   3. less than −9007199254740991 or greater than 9007199254740991 →
      **refuse** `integer outside the safe canonical range`
      (the bounds are `±Number.MAX_SAFE_INTEGER`, both inclusive)
   4. negative zero → `0`
   5. otherwise → the integer's decimal digits, with a leading `-` if negative
4. a string → escaped as above
5. an array → `[` … `]` with each element canonicalised by this rule
6. any other object → `{` … `}`, keys sorted and escaped as above, values
   canonicalised by this rule
7. anything else (`undefined`, `bigint`, `symbol`, `function`) → **refuse**
   `value of type <typeof> has no canonical form`, e.g.
   `value of type undefined has no canonical form`

Refusals are thrown as a plain `Error` whose `message` is the text shown.
The contract converts them into named refusals (`unrenderable_effect` at
issue time, `arguments_altered` at retry time); the canonicalizer itself
carries no code.

The whole-effect form the contract commits is the object
`{ args: <arguments or {} if absent>, tool: <tool name> }` canonicalised
by this rule — so its bytes always begin `{"args":` and end with
`,"tool":"…"}` (key `args` sorts before key `tool`).

## Rule B — the receipt rule (`spine/receipt-seal.cjs`)

Evaluation order for one value, first match wins:

1. `undefined` → **refuse** code `receipt_value_absent`, message
   `receipt value is absent`
2. a number that is not finite → **refuse** code `receipt_value_malformed`,
   message `receipt number is not finite`
3. `null`, any (finite) number, or a boolean → its `JSON.stringify`
   rendering: `null`, the number rendering defined above, `true`, `false`
4. a string → escaped as above
5. an array → `[` … `]` with each element canonicalised by this rule
6. anything whose `typeof` is not `"object"` (`bigint`, `symbol`,
   `function`) → **refuse** code `receipt_value_malformed`, message
   `receipt value has unsupported type <typeof>`, e.g.
   `receipt value has unsupported type bigint`
7. any other object → `{` … `}`, keys sorted and escaped as above, values
   canonicalised by this rule

Refusals are thrown as `ReceiptRefusal`, an `Error` subclass with `code`,
`message`, `name = "ReceiptRefusal"` and `refusal = true`.

There is no integer restriction and no magnitude restriction: `1.5`,
`9007199254740992`, `1e300` and `-2.25` are all accepted and rendered by
ECMAScript `Number::toString`.

## Rule B′ — the checker's copy (`checker/seal-receipt-check.mjs`)

The checker's `canonical` is Rule B with steps 1, 2 and 6 **omitted**:
it has no refusal branches at all. For every value that can come out of
`JSON.parse` — which is the only way a value reaches the checker — its
output is byte-identical to Rule B, and the comparison in the last section
of this document confirms that on every worked example. The omitted
branches are reachable only with values JSON cannot carry:

| Input | Rule B | Checker copy |
|---|---|---|
| `NaN`, `±Infinity` | refuse `receipt_value_malformed` | `null` (what `JSON.stringify` returns) |
| `undefined` | refuse `receipt_value_absent` | throws `TypeError` from `Object.keys(undefined)`, surfaced by the CLI as `checker_error` |
| `bigint` | refuse `receipt_value_malformed` | throws `TypeError` from `JSON.stringify` |

Consequently the phrase "byte-identical copy", used in `README.md` and
`docs/guide/knowing-it-worked.md` for the checker's rule, is true of the
**output on the JSON domain** and false of the **source text**. An
implementer of a second checker should implement Rule B as written; a
checker only ever sees `JSON.parse` output, so the difference cannot change
a verdict.

A further hand copy of Rule B′ exists outside this repository, in the
browser re-checker `seal-check` (`spine-receipt.js`, same key comparator
written over `TextEncoder` bytes). It is named here for completeness and is
not specified by this document.

## Worked examples

Each example gives the input as a JavaScript literal, then the exact output
of each rule. `bytes` is the UTF-8 encoding of the output as hexadecimal,
so a second implementation can be compared byte for byte. Where a rule
refuses, the refusal text is the complete `message`. These are the inputs
fed to the comparison described in the last section; the bytes shown were
produced by the product's own functions.

### Example 1 — nested object whose keys need ordering

Input: `{ b: 1, a: [true, null, "x"], Z: {}, aa: [] }`

Both rules:

```text
{"Z":{},"a":[true,null,"x"],"aa":[],"b":1}
```

```text
bytes 7b225a223a7b7d2c2261223a5b747275652c6e756c6c2c2278225d2c226161223a5b5d2c2262223a317d
```

`Z` (0x5A) sorts before `a` (0x61); `a` sorts before `aa` because it is a
proper prefix; insertion order (`b` first) is irrelevant.

### Example 2 — string needing escaping

Input: `{ s: "tab\tquote\"back\\slash\u0001é😀 /" }` — a tab, a double
quote, a backslash, U+0001, U+00E9, U+1F600, a space and a slash.

Both rules:

```text
{"s":"tab\tquote\"back\\slash\u0001é😀 /"}
```

```text
bytes 7b2273223a227461625c7471756f74655c226261636b5c5c736c6173685c7530303031c3a9f09f9880202f227d
```

Note `\u0001` is escaped with lowercase hex, `é` is the two bytes `c3 a9`
and `😀` the four bytes `f0 9f 98 80` unescaped, and `/` is not escaped.

### Example 3 — the largest safe integer

Input: `{ n: 9007199254740991 }`

Both rules:

```text
{"n":9007199254740991}
```

```text
bytes 7b226e223a393030373139393235343734303939317d
```

### Example 4 — one past the largest safe integer

Input: `{ n: 9007199254740992 }`

Contract rule: **refuse** `integer outside the safe canonical range`

Receipt rule:

```text
{"n":9007199254740992}
```

```text
bytes 7b226e223a393030373139393235343734303939327d
```

### Example 5 — a non-integer

Input: `{ n: 1.5 }`

Contract rule: **refuse** `non-integer number has no canonical form in the contract`

Receipt rule:

```text
{"n":1.5}
```

```text
bytes 7b226e223a312e357d
```

### Example 6 — a non-finite number

Input: `{ n: NaN }` (and likewise `[Infinity]`)

Contract rule: **refuse** `non-finite number has no canonical form`

Receipt rule: **refuse** code `receipt_value_malformed`, message `receipt number is not finite`

### Example 7 — negative zero

Input: `{ n: -0 }`

Both rules:

```text
{"n":0}
```

```text
bytes 7b226e223a307d
```

### Example 8 — keys where UTF-8 order and UTF-16 order disagree

Input: `{ "😀": 1, "！": 2, z: 3 }` — U+1F600 (UTF-8 `f0 9f 98 80`,
UTF-16 `d83d de00`), U+FF01 (UTF-8 `ef bc 81`, UTF-16 `ff01`), and `z`.

Both rules:

```text
{"z":3,"！":2,"😀":1}
```

```text
bytes 7b227a223a332c22efbc81223a322c22f09f9880223a317d
```

JavaScript's default `sort()` would put `😀` before `！` (0xD83D < 0xFF01);
the UTF-8 comparator puts `！` first (0xEF < 0xF0). An implementation that
sorts by code point or by UTF-16 unit will produce different bytes and a
different digest for such keys. (Code-point order and UTF-8 byte order
agree with each other; UTF-16 unit order is the odd one out.)

### Example 9 — an integer at 10²¹

Input: `{ n: 1e21 }`

Contract rule: **refuse** `integer outside the safe canonical range`
(it is an integer, but outside ±2⁵³−1)

Receipt rule:

```text
{"n":1e+21}
```

```text
bytes 7b226e223a31652b32317d
```

### Example 10 — small fractions

Input: `{ n: 0.000001, m: 1e-7 }`

Contract rule: **refuse** `non-integer number has no canonical form in the contract`

Receipt rule:

```text
{"m":1e-7,"n":0.000001}
```

```text
bytes 7b226d223a31652d372c226e223a302e3030303030317d
```

### Example 11 — an `undefined` member value

Input: `{ a: undefined }` (and likewise `[1, undefined]`)

Contract rule: **refuse** `value of type undefined has no canonical form`

Receipt rule: **refuse** code `receipt_value_absent`, message `receipt value is absent`

### Example 12 — the most negative safe integer

Input: `{ n: -9007199254740991 }`

Both rules:

```text
{"n":-9007199254740991}
```

```text
bytes 7b226e223a2d393030373139393235343734303939317d
```

### Example 13 — a `bigint`

Input: `{ n: 10n }`

Contract rule: **refuse** `value of type bigint has no canonical form`

Receipt rule: **refuse** code `receipt_value_malformed`, message `receipt value has unsupported type bigint`

### Example 14 — a key that needs escaping, and an empty key

Input: `{ "k\"\n": 1, "": 2 }`

Both rules:

```text
{"":2,"k\"\n":1}
```

```text
bytes 7b22223a322c226b5c225c6e223a317d
```

The empty key sorts first (empty byte sequence is a prefix of everything).

### Example 15 — a lone surrogate

Input: `{ s: "\ud83d" }`

Both rules:

```text
{"s":"\ud83d"}
```

```text
bytes 7b2273223a225c7564383364227d
```

### Example 16 — the effect shape the contract commits

Input: `{ args: { to: "GB-unlisted", amount: 40000 }, tool: "payments.send" }`

Both rules:

```text
{"args":{"amount":40000,"to":"GB-unlisted"},"tool":"payments.send"}
```

```text
bytes 7b2261726773223a7b22616d6f756e74223a34303030302c22746f223a2247422d756e6c6973746564227d2c22746f6f6c223a227061796d656e74732e73656e64227d
```

Tally: the contract rule has 16 worked cases above (9 renderings, 7
refusals); the receipt rule has 16 (13 renderings, 3 refusals). Every
boundary the brief named is covered: non-integer (5, 10), at `MAX_SAFE`
(3, 12), past it (4, 9), non-finite (6), nested ordering (1, 8, 16), and
string escaping (2, 14, 15).

## How this document was checked

A second implementation was written from the rule text above, in a
scratch directory outside the repository, using a hand-written UTF-8 byte
comparator and a hand-written string escaper (neither `Buffer.compare` nor
`JSON.stringify` on strings), then run side by side with the two product
functions on the 16 examples plus five extra inputs. All 21 agreed on both
output bytes and refusal text. That comparison is not part of the shipped
test suite; see the last section.

## What this document does not specify, and what would lift each gap

Every limitation below is paired with the condition under which it stops
being one. A limitation without such a condition would be a defect in this
document.

1. **The exact number rendering for non-integers in the receipt rule is
   defined by reference to ECMAScript `Number::toString`, not spelled out.**
   A second implementation in a language without that routine must
   reproduce shortest-round-trip formatting and ECMAScript's exponent
   thresholds. *Lifts when* a version 2 of this document carries a
   self-contained statement of that algorithm with a test vector set, or
   when the receipt rule is narrowed to integers (which would be a product
   change and a repin, and is outside this document's remit).

2. **Object-member enumeration is defined by JavaScript `Object.keys`.** For
   values produced by `JSON.parse` this is simply "every member"; for
   host objects (`Date`, `Map`, class instances with accessors) the
   behaviour follows JavaScript semantics and is not restated here. *Lifts
   when* a version 2 restricts the input domain to the JSON data model in
   the product code, or states the host-object cases explicitly.

3. **The kernel hand-off uses a third key order.** `contract/contract.cjs`
   passes `JSON.parse(canonical_effect_bytes).args` and the raw retry
   arguments to `contract/kernel-authorization.cjs`, whose worker calls
   `guardTarget` in `runtime/kernel/seal-config.js`; that function's
   `canonicalJson` sorts keys with JavaScript's default `sort()` (UTF-16
   code-unit order) and accepts non-integers. It is therefore not Rule A
   and not Rule B. The practical effect is bounded — both sides of the
   kernel comparison are rendered by the same function — but a set of
   argument keys that order differently under UTF-16 and UTF-8 (example 8)
   is rendered differently by the kernel fixture and by the contract. This
   document does not specify the kernel's rule. *Lifts when* the kernel's
   `guardTarget` rendering is either specified in its own frozen document
   or aligned with Rule A; either is a change to a pinned runtime and is
   reserved to the project owner.

4. **The comparison described above is not a shipped test.** Nothing in
   `test/` currently feeds the examples in this document to the product
   functions, so a future edit to either rule would not fail a test
   against this document. *Lifts when* a conformance test that reads the
   examples above and asserts the bytes is added to the product-suite
   roster.

5. **Nothing here says a second checker exists.** This document makes one
   *possible*; it does not make Seal's own checker any less of a copy. The
   honesty caveat in `checker/seal-receipt-check.mjs` stands unchanged.
   *Lifts when* someone other than Seal's authors publishes a checker
   written from this document and reports byte agreement on the worked
   examples and on real receipts.
