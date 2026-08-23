# Seal receipt seal (`seal.spine/v1` + `seal.receipt-seal/v1`) — frozen specification

| | |
|---|---|
| Version | 1 |
| Frozen at | 2026-08-23 |
| Source of truth | `spine/receipts.cjs`, `spine/receipt-seal.cjs`, `spine/proxy.cjs`, `checker/seal-receipt-check.mjs`, `spine/protection.cjs` at commit `72d564f8` |
| Change policy | This document is frozen. A change to the receipt shape, a commitment preimage, the domain separator, or a checker step is published as version 2 with a new frozen-at date; version 1 is never edited in place. |
| Depends on | Rule B (the receipt rule) in [canonicalization.md](canonicalization.md) |

This document lets someone who has never read Seal's code write a receipt
checker of their own and have it agree, verdict for verdict and refusal
code for refusal code, with `checker/seal-receipt-check.mjs`. Every
statement comes from the implementation at the commit above. "Rule B"
below always means the receipt canonicalization rule as frozen in
[canonicalization.md](canonicalization.md); `sha256hex(s)` always means
SHA-256 over the UTF-8 bytes of the string `s`, as 64 lowercase hex
characters.

## 1. What a receipt is, and how it reaches disk

A receipt is one JSON file per decision, written by the proxy
(`spine/proxy.cjs` → `spine/receipts.cjs`). It is a **claim by the
process that wrote it** about what that process decided and observed.
Nothing in this document makes a receipt a proof that the decision
happened; see section 8.

File facts (from `spine/receipts.cjs`):

- Directory: the configured receipts directory, created `0700` if absent.
- Filename: `receipt-<at>-<pid>-<sequence>-<decision>.json`, where
  `<at>` is `Date.now()` in milliseconds, `<pid>` the writer's process id,
  `<sequence>` a per-process counter starting at `0001`, zero-padded to
  four digits, and `<decision>` the decision string. Example:
  `receipt-1786796243578-3115472-0002-ALLOW.json`.
- Opened with `wx` (exclusive create) at mode `0600`; written as
  `JSON.stringify(body, null, 2) + "\n"` — two-space indented, trailing
  newline — then `fsync`ed, then closed.
- The body is sealed (section 4) **before** writing when the proxy was
  given a signer. Both shipped proxy paths (`seal demo` and the protected
  path started by `spine/proxy-cli.cjs`) always supply a signer; the
  `createProxy` API itself allows `signer` to be absent, in which case the
  file has no `seal` member and the checker refuses it as `unsealed`.

Formatting is not part of the claim: the checker parses the file and
recomputes everything from the parsed value, so a receipt re-serialised
with different whitespace or member order is still accepted. The `ACCEPT`
line says so.

## 2. The receipt schema, field by field

Two markings are used:

- **COMMITTED** — the field has its own SHA-256 commitment inside `seal`,
  *and* is inside the signed message. A change to it is named by field in
  the refusal.
- **EVIDENCE** — the field has **no** per-field commitment but **is inside
  the signed message**. A change to it is detected only by the signature
  backstop (step 5 in section 6), and the checker cannot name which field
  changed.

Every field of the receipt body is covered by the signature. **There is no
field of a sealed receipt that is outside the signature except
`seal.sig` itself.** The distinction between the two markings is whether a
mutation can be *attributed* to a field, not whether it is *detected*.

| Field | Type | Present when | Marking | Source |
|---|---|---|---|---|
| `receipt` | string, always `"seal.spine/v1"` | always | EVIDENCE (also checked literally, section 6 step 0) | `spine/receipts.cjs` adds it first |
| `at` | integer, milliseconds since the Unix epoch | always | EVIDENCE | `Date.now()` in `spine/proxy.cjs` `emitReceipt` |
| `decision` | string: `"ALLOW"`, `"BLOCK"` or `"INPUT_REQUIRED"` | always | **COMMITTED** (`decision_sha256`) | `spine/proxy.cjs` |
| `tool` | string, the `params.name` of the guarded `tools/call` frame | always for a guarded call | **COMMITTED** (`tool_sha256`, and inside `effect_sha256`) | `frame.params?.name` |
| `arguments` | the frame's `params.arguments`, or `{}` if absent | always | **COMMITTED** (`args_sha256`, and inside `effect_sha256`) | `frame.params?.arguments ?? {}` |
| `child` | object `{ "argv": [string, …] }` — the protected server command | always | EVIDENCE | the proxy's child argv |
| `refusal` | string, a refusal code | `decision` is `"BLOCK"` | EVIDENCE | the contract's or proxy's refusal |
| `detail` | string, human-readable refusal detail | `decision` is `"BLOCK"` | EVIDENCE | same |
| `approvalRequest` | object `{ "correlation": "seal-receipt-correlation/v1.<64 lowercase hex>" }` | the `INPUT_REQUIRED` receipt; and any retry receipt (`ALLOW` or `BLOCK`) whose handle the proxy still correlates | EVIDENCE | minted by the proxy per `requestState`, 32 random bytes |
| `evidence` | object, the contract's allow evidence (see [approval-contract-rs1.md](approval-contract-rs1.md) §5) | `decision` is `"ALLOW"` | EVIDENCE | `decision.evidence` from the contract |
| `seal` | object, section 4 | whenever a signer was supplied | its members other than `sig` are inside the signed message | `spine/receipt-seal.cjs` |

The three `decision` values and when each is emitted
(`spine/proxy.cjs` `decideGuarded`):

- `INPUT_REQUIRED` — a first call for a guarded tool was offered for
  approval. The receipt carries `approvalRequest.correlation`.
- `ALLOW` — a retry was accepted and the call was forwarded to the child.
  The receipt carries `evidence` and (when correlated) `approvalRequest`.
  The contract has already journaled the one-use consumption before this
  receipt is written.
- `BLOCK` — a refusal at any stage: a contract refusal at issue or retry,
  `receipt_correlation_capacity_exceeded`, `receipt_correlation_missing`,
  or a forwarding refusal (`forward_refused`, `protected_server_missing`,
  `protected_server_failed`). The receipt carries `refusal` and `detail`.

The `correlation` value joins receipts from one approval (the
`INPUT_REQUIRED` receipt and its retry receipts). It is not the
`requestState` handle and cannot be used to retry.

## 3. The example used below

A real receipt, sealed by `spine/receipt-seal.cjs` with a throwaway key
whose public half is:

```text
0b81ac6c1fd0bee534e7f33f3d8fffc5a41568f26dcfb2bf087af3601c499a43
```

```json
{
  "receipt": "seal.spine/v1",
  "at": 1786796243578,
  "decision": "ALLOW",
  "tool": "demo.mutate",
  "arguments": {
    "line": "seal demo wrote this line"
  },
  "child": {
    "argv": [
      "node",
      "demo-server.cjs"
    ]
  },
  "evidence": {
    "handle_returned_unaltered": true,
    "human_present": "unknown"
  },
  "approvalRequest": {
    "correlation": "seal-receipt-correlation/v1.abababababababababababababababababababababababababababababababab"
  },
  "seal": {
    "alg": "ed25519",
    "decision_sha256": "25a2778c67ba986882a577479bff5aa3a854b34635d6647cdf11e08550169503",
    "tool_sha256": "b062f030d5c12e5eb6e8ae7bf085758df7e4a5b2ddb5c3d517d0725e16cc71f7",
    "args_sha256": "45377eab0d80b38e554d8beb5501a14b83b6c38fd270221f8a1a6775ae46810a",
    "effect_sha256": "271e80a001f0e1f863305ae1bdc7202d038920eaae0c1451f7637f08da8c522e",
    "sig": "92fdac9703734346f7b507915b8966ba806da1e997a4baf06d12b55dcda318a8a4da652ebee7986fbdb51a7f57a452a3dab74b3ec3852ad16f369442884b3303"
  }
}
```

The `evidence` object is abbreviated relative to what the product writes
(the full shape is in [approval-contract-rs1.md](approval-contract-rs1.md)
§5); the seal is over exactly the body shown. A second checker given this
file and the public key above must print `ACCEPT`.

## 4. The seal: four commitments plus a signature

`sealReceipt(signer, body)` in `spine/receipt-seal.cjs` computes, in this
order:

| Member | Preimage (the string hashed, UTF-8) |
|---|---|
| `decision_sha256` | `String(body.decision)` — the decision coerced to a string |
| `tool_sha256` | `String(body.tool)` |
| `args_sha256` | `canonicalB(body.arguments ?? {})` |
| `effect_sha256` | `canonicalB({ args: body.arguments ?? {}, tool: String(body.tool) })` — by Rule B's key order this is always `{"args":…,"tool":"…"}` |

For the example: `sha256hex("ALLOW")` =
`25a2778c…9503`; `sha256hex("demo.mutate")` = `b062f030…71f7`;
`sha256hex('{"line":"seal demo wrote this line"}')` = `45377eab…810a`;
`sha256hex('{"args":{"line":"seal demo wrote this line"},"tool":"demo.mutate"}')`
= `271e80a0…522e`.

Then the **committed body** is built: every member of `body`, plus a
`seal` member equal to
`{ "alg": "ed25519", "decision_sha256": …, "tool_sha256": …, "args_sha256": …, "effect_sha256": … }`
— **without** `sig`. The signed message is:

```text
message = UTF-8( "seal.receipt-seal/v1\n" + canonicalB(committedBody) )
```

The **domain separator** is the 21 bytes
`73 65 61 6c 2e 72 65 63 65 69 70 74 2d 73 65 61 6c 2f 76 31 0a` —
the ASCII text `seal.receipt-seal/v1` followed by one line feed. It is
prepended as raw text; it is not a JSON member.

The signature is **Ed25519** as implemented by Node's
`crypto.sign(null, message, privateKey)`: pure Ed25519 (RFC 8032), no
pre-hash, no context string. `seal.sig` is the 64-byte signature as 128
lowercase hex characters, added to `seal` after signing. `seal.alg` is
the literal string `"ed25519"`.

Because `canonicalB` sorts keys, the position of `seal` in the file and
the order of members inside it do not affect the message.

**Public key representation.** A 32-byte raw Ed25519 public key as 64
lowercase hex characters. The sealer obtains it as the last 32 bytes of
the SPKI DER export; a checker reconstructs SPKI DER by prepending the
fixed 12-byte prefix `30 2a 30 05 06 03 2b 65 70 03 21 00`.

## 5. Where the verifying key comes from

The checker takes the key **only** from its `--pubkey` argument — never
from inside the receipt — so that someone who can edit a receipt cannot
also swap the key it is checked against.

- `seal demo` generates a fresh keypair per run and writes the public hex,
  plus a newline, to `receipt-signer.pub` in the demo's working directory
  (`spine/demo.cjs`). Checking a demo receipt against that file proves
  self-consistency only: the signer and the key came from the same run.
- The protected path loads or creates a durable machine key
  (`spine/protection.cjs` `loadReceiptSigner`): directory
  `$XDG_DATA_HOME/seal/keys` (default `~/.local/share/seal/keys`), which
  must be mode `0700`; private key `receipt-ed25519` (PKCS#8 PEM, mode
  `0600`); public key `receipt-ed25519.pub` (64 lowercase hex plus a
  newline, mode `0644`). When the key is first created the proxy prints
  `SEAL RECEIPT SIGNING KEY CREATED` with the public hex and asks the
  operator to record it somewhere the machine cannot rewrite. Both files
  must exist or both must be absent; any other state is a named refusal
  (`receipt_key_*` codes in `spine/protection.cjs`, not specified here).

A check is exactly as meaningful as the provenance of the key supplied.
With the sealer's own key it establishes that the file is the one that
sealer signed — nothing about whether that sealer was honest.

## 6. The checker's verification steps, in order

`checkReceipt(receipt, pubKeyHex, receiptText)` in
`checker/seal-receipt-check.mjs`. `receipt` is the `JSON.parse` of the
file; `receiptText` is the raw file text (used only for line-finding,
section 7). The first failing step wins; later steps are not evaluated.
Each refusal is shown as `code` — *message*.

**Step 0 — shape.**

1. `receipt` is `null` or not an object → `not_a_receipt` — *input is not a JSON object*.
2. `receipt.receipt !== "seal.spine/v1"` → `unknown_format` — *unknown receipt format: `<value>`*.
3. `receipt.seal` is absent, falsy, or not an object → `unsealed` — *receipt carries no seal; it cannot be checked*.
4. `receipt.seal.alg !== "ed25519"` → `unknown_algorithm` — *unknown seal algorithm: `<value>`*.
5. For each of `decision`, `tool`, `arguments` in that order: the key is
   not present on `receipt` (`in` test, so a present-but-null member
   passes) → `incomplete_receipt` — *receipt has no `<field>` field to check*.

**Step 1 — decision commitment.**
`sha256hex(String(receipt.decision)) !== seal.decision_sha256` →
`decision_binding_mismatch`. Message per section 7.

**Step 2 — tool commitment.**
`sha256hex(String(receipt.tool)) !== seal.tool_sha256` →
`tool_binding_mismatch`. Message per section 7.

**Step 3 — arguments commitment.**
`sha256hex(canonicalB′(receipt.arguments)) !== seal.args_sha256` →
`arguments_binding_mismatch`. Message per section 7. Note the checker
canonicalises `receipt.arguments` **as found** (the sealer used
`?? {}`); for a receipt the proxy wrote these are the same value because
the proxy already substituted `{}`.

**Step 4 — combined effect commitment.**
`sha256hex(canonicalB′({ args: receipt.arguments, tool: receipt.tool })) !== seal.effect_sha256`
→ `effect_binding_mismatch`. The message is always the structured-value
form (section 7) because the value is an object. This step is defence in
depth: it cannot fail when steps 2 and 3 passed and the sealer was this
implementation, but a second sealer that commits fields and effect
inconsistently is caught here.

**Step 5 — signature backstop.**

1. Split `seal` into `sig` and the rest. `sig` is not a string or does not
   match `/^[0-9a-f]{128}$/` → `signature_malformed` — *the seal signature is missing or malformed*.
2. Rebuild the committed body: every member of `receipt`, with `seal`
   replaced by `seal` minus `sig` (any extra members the file put inside
   `seal` stay in — they were either signed or they break the signature).
3. `message = UTF-8("seal.receipt-seal/v1\n" + canonicalB′(committed))`.
4. Reconstruct the public key from the hex (section 4). If that, or the
   Ed25519 verify call, throws → `pubkey_invalid` — *the supplied public key is unusable: `<error>`*. A key file whose trimmed content is not exactly 64 lowercase hex characters fails here with *public key must be 32-byte hex* (a command-line argument that is not 64 lowercase hex characters is treated as a file path, §6.1).
5. Verification returns false → `signature_invalid` — *cannot identify one changed receipt line: every direct field commitment matched, but the signature does not verify. The changed byte may be the signature or any signed field without a direct commitment.*

**Accept.** Returns `{ accepted: true, decision, tool, checks: ["decision", "tool", "arguments", "effect", "signature"] }`.

A missing commitment member (for example no `seal.args_sha256`) is not a
distinct refusal: the comparison against `undefined` fails and the
corresponding `*_binding_mismatch` is reported.

### 6.1 The command line

```text
node seal-receipt-check.mjs RECEIPT.json --pubkey (HEX | FILE)
```

- No receipt path, no `--pubkey`, or no value after it → usage line on
  stderr, **exit 2**.
- The file cannot be read or is not JSON → stdout
  `REFUSE unreadable_receipt: <error>`, **exit 1**.
- `--pubkey` value: if it matches `/^[0-9a-f]{64}$/` it is the key;
  otherwise it is read as a file and trimmed. Unreadable →
  `REFUSE pubkey_missing: --pubkey must be 32-byte hex or a readable file: <value>`, exit 1.
  (The file's *content* is not validated until step 5.4, where a bad
  content becomes `pubkey_invalid`.)
- A refusal from section 6 → stdout `REFUSE <code>: <message>`, **exit 1**.
- Any other thrown error → stdout `REFUSE checker_error: <message>`, exit 1.
- Success → stdout, **exit 0**:

```text
ACCEPT <decision> <tool> — decision, tool, arguments and signature all match the sealed commitments. This shows the receipt has the same canonical parsed value that this key signed. Semantically irrelevant JSON formatting differences are not distinguished. It does not show the decision happened: anyone who could use that machine's Seal key could have signed a different story.
```

Observed on the example receipt of section 3 and four mutations of it:

| Input | Exit | First line of output |
|---|---|---|
| unmodified | 0 | `ACCEPT ALLOW demo.mutate — …` |
| same receipt re-serialised compact | 0 | `ACCEPT ALLOW demo.mutate — …` |
| `"decision": "ALLOW"` → `"BLOCK"` | 1 | `REFUSE decision_binding_mismatch: receipt line 4, field decision: recorded value "BLOCK" does not match its sealed commitment (committed value withheld)` |
| `"human_present": "unknown"` → `"yes"` (inside `evidence`) | 1 | `REFUSE signature_invalid: cannot identify one changed receipt line: every direct field commitment matched, but the signature does not verify. …` |
| one word inside `arguments.line` | 1 | `REFUSE arguments_binding_mismatch: cannot identify one changed receipt line: the arguments commitment covers a structured value, so it establishes that the value changed but not which nested line changed (committed value withheld)` |

The third row shows what EVIDENCE marking means in practice: the change
is refused, and not attributed.

## 7. The line-finding convention

For `decision_binding_mismatch`, `tool_binding_mismatch` and
`arguments_binding_mismatch` the message depends on the **recorded**
value's type (`fieldMismatch`):

- If the recorded value is a non-null object (including arrays): the
  message is
  *cannot identify one changed receipt line: the `<field>` commitment covers a structured value, so it establishes that the value changed but not which nested line changed (committed value withheld)*.
  No line number is ever offered for a structured value, because the
  commitment says only that the value as a whole differs.
- Otherwise (string, number, boolean, null): the checker tries to find
  the field's source line (`lineForDirectField`). If found:
  *receipt line `<n>`, field `<field>`: recorded value `<shown>` does not match its sealed commitment (committed value withheld)*.
  If not found (or when `receiptText` was not supplied, as with the
  exported `checkReceipt` API):
  *field `<field>` (source line unavailable): recorded value `<shown>` does not match its sealed commitment (committed value withheld)*.
  `<shown>` is `JSON.stringify` of a string, or `canonicalB′` of any other
  scalar, cut to 240 characters with `...` if longer.

`lineForDirectField(text, field)` scans the raw text character by
character:

1. `{` increments a depth counter and `}` decrements it. Square brackets
   are not tracked.
2. A `"` starts a string; the scan skips to its closing `"`, treating any
   `\` as escaping the next character, so braces and quotes inside strings
   are not seen by rule 1.
3. After a string closes, whitespace is skipped. If the depth is exactly
   1, the next character is `:`, and the string's `JSON.parse` equals
   `field`, the answer is the number of line feeds in the text before the
   string's opening `"`, plus one.
4. First match wins. `null` if there is none.

The committed value is deliberately never reconstructed or printed: a
commitment is a digest, and the checker does not guess preimages.

## 8. What an `ACCEPT` establishes, and what it does not

Establishes: the parsed receipt has exactly the canonical value (Rule B)
that the holder of the private key corresponding to `--pubkey` signed,
with the decision, tool and arguments it says.

Does not establish: that the decision happened, that the child was or was
not called, that a human was present, or that the signer was honest.
Anyone able to use the machine's private key could have signed a
different story. The `evidence` block is the contract's own account and
carries `human_present: "unknown"` for that reason.

For a particular receipt, this limitation lifts only when a separately
specified verification system supplies a separately authenticated record
bound to that receipt's `effect_sha256` and to the particular fact at issue:
a decision record, a child execution record, a human-presence attestation, or
a signer-custody attestation. That additional record establishes only the fact
it states; the receipt and its `evidence` block alone do not.

## 9. What this document does not specify, and what would lift each gap

1. **Non-JSON inputs to the checker's canonicalizer.** The checker's copy
   omits Rule B's refusal branches; the difference is unreachable from a
   parsed file and is tabulated in [canonicalization.md](canonicalization.md)
   (Rule B′). *Lifts when* the checker adopts Rule B verbatim (a
   product-side edit to the checker copy) or when a version 2 of this
   document is written against a checker that does.

2. **`arguments: null` and non-string `tool`/`decision`.** The sealer
   commits `canonicalB(arguments ?? {})` and `String(tool)`; the checker
   recomputes from the raw members. For a `null` `arguments` or a
   non-string `tool` the two can disagree. The proxy never writes such a
   receipt (it substitutes `{}` and only guards named string tools), so
   the case is unreachable through the product, and this document does
   not define a verdict for a hand-made receipt of that shape. *Lifts
   when* the sealer and checker are made to agree on those inputs, or a
   version 2 declares such receipts malformed by name.

3. **The `evidence` object's schema is not frozen here.** Its members are
   the contract's allow evidence and are listed in
   [approval-contract-rs1.md](approval-contract-rs1.md) §5 as of this
   commit, but the receipt seal treats `evidence` as opaque EVIDENCE and a
   second checker need not parse it. *Lifts when* a consumer needs to
   interpret it, at which point it gets its own frozen document.

4. **The `receipt_key_*` refusals and key rotation are outside this
   document.** Section 5 names the key files; the exact refusal codes for
   a wrong mode, an incomplete pair, or a mismatched pair live in
   `spine/protection.cjs` and are not restated. *Lifts when* a version 2
   includes the key-custody state machine, or when those codes are
   documented elsewhere and linked.

5. **Receipts written without a signer.** `createProxy` permits it; the two
   shipped paths do not use that option. This document does not say what,
   if anything, an unsealed receipt is good for. *Lifts when* the unsigned
   path is either removed or given its own stated purpose.

6. **Nothing here is a shipped test.** The observed table in §6.1 came from
   running the checker by hand on the example. *Lifts when* the example
   receipt and its mutations become fixtures asserted by a test in the
   product-suite roster.
