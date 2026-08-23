# Seal approval contract (`seal-rs1`) — frozen specification

| | |
|---|---|
| Version | 1 |
| Frozen at | 2026-08-23 |
| Source of truth | `contract/contract.cjs`, `contract/renderer.cjs`, `contract/canonical.cjs`, `contract/kernel-authorization.cjs`, `contract/kernel-authorization-worker.cjs`, `spine/store.cjs`, `spine/proxy.cjs` at commit `72d564f8` |
| Change policy | This document is frozen. A change to the handle format, the elicitation shape, a retry step, a refusal code, or a lifetime is published as version 2 with a new frozen-at date; version 1 is never edited in place. |
| Depends on | Rule A (the contract rule) in [canonicalization.md](canonicalization.md) |

This document describes the approval contract precisely enough that a
person who has never read Seal's code could write a client that drives it,
or a model of it that predicts every refusal, from this text alone. Every
statement comes from the implementation at the commit above. "Rule A"
means the contract canonicalization rule frozen in
[canonicalization.md](canonicalization.md); `sha256hex(s)` means SHA-256
over the UTF-8 bytes of `s` as 64 lowercase hex characters.

## 1. What the contract is

The contract sits inside the proxy between an MCP client and one
protected server. For a `tools/call` frame naming a guarded tool it does
one of two things:

- **begin** — on a first call (no `requestState` and no `inputResponses`
  in `params`), it refuses, or it issues an approval request: an
  `input_required` result carrying a rendered message and an opaque
  handle. Nothing is forwarded.
- **retry** — on a call that carries `requestState` and/or
  `inputResponses`, it judges the retry against its own record of the
  issued request and either refuses or consumes the approval and lets the
  proxy forward the call **once**.

The honest limit, stated by the code itself and repeated here: the
contract stops the **client** altering the continuation. It does **not**
prove a human clicked Accept. A client holding the correct handle can
fabricate an acceptance. Form elicitation places Claude Code inside the
trusted approval-origin boundary — a declared assumption, not an enforced
property. The allow evidence (§5) says this in so many words.

## 2. The handle

```text
seal-rs1.<64 lowercase hexadecimal characters>
```

- The 64 hex characters are 32 bytes from `crypto.randomBytes`.
- Accepted shape at retry: `/^seal-rs1\.[0-9a-f]{64}$/` — lowercase only,
  exactly 64 characters, nothing before or after.
- The raw handle exists in exactly two places: the `requestState` returned
  to the client, and the client. The server keeps only
  `sha256hex(handle)` as `handle_hash`; the raw handle is never journaled.
- The handle carries nothing: no tool, no arguments, no expiry, no nonce,
  no phase. An altered handle and a never-issued handle are therefore the
  same lookup miss (`unknown_state`). No state blob is signed or
  encrypted, because there is none.

## 3. begin: the elicitation shape

Input: `{ tool, args }` from the frame (`params.name`, `params.arguments ?? {}`).

### 3.1 Refusals at begin, in order

All begin refusals carry the single code **`unrenderable_effect`**; the
`detail` distinguishes them. The renderer runs first, then
canonicalization of the whole effect:

| Order | Condition | `detail` |
|---|---|---|
| 1 | `tool` is not a non-empty string | `tool name is not a non-empty string` |
| 2 | terminal width − 4 < 20 (i.e. width below 24) | `terminal width <w> leaves no usable message width` |
| 3 | an argument value has no Rule A rendering (e.g. `1.5`, `undefined`) | `arguments have no canonical rendering: <Rule A refusal text>` |
| 4 | any message line's display width exceeds width − 4 | `a line does not fit <usable> columns and truncation would hide the effect: <first 40 characters of the line>…` |
| 5 | the message needs more than 7 lines | `the complete effect, scope and outside-Seal line need <n> lines; the envelope shows 7 and hides the rest without any indicator` |
| 6 | the whole effect `{ args: args ?? {}, tool }` has no Rule A form | `effect has no canonical form: <Rule A refusal text>` |

Condition 6 is reachable in principle only for a failure the renderer did
not already catch; with a string tool and Rule-A-renderable values it does
not fire. The effect is **never truncated** to keep the dialog: a boundary
the terminal would hide is not offered.

### 3.2 The message

Six fixed lines plus one line per argument, joined by `\n`, in this order:

```text
Approval required
Tool: <tool>
Arguments:
  <key>: <value>          (one line per argument, keys in UTF-8 byte order)
Scope: this parsed call (key order and 1/1.0 match); at most one run; <ttl>.
Outside Seal: Bash, network, subprocesses, other tools and servers.
```

- With no arguments the single argument line is `  (none)`.
- `<value>` renders **bare** when it is a string matching
  `/^[A-Za-z0-9_.\/:@-]+$/`; otherwise it is the value's Rule A
  rendering (so a string with a space appears quoted and escaped, e.g.
  `line: "seal demo wrote this line"`).
- `<ttl>` is `<n> min` when the TTL in milliseconds is a multiple of
  60000, otherwise `<round(ms/1000)> s`. The shipped default (120000 ms)
  renders `2 min`.
- Display width counts printable ASCII (U+0020–U+007E) as 1 column and
  every other character as 2. Lines are measured against
  `terminalWidth − 4` (default terminal width 80, so 76 columns).
- The 7-line cap with 5 fixed lines means **at most two arguments** can
  ever be offered for approval; a third argument is refused under
  condition 5.
- When the caller needs to mark a change it **replaces** the first line
  (`firstLine` option, e.g. `CHANGED: …`); a line is never added.

### 3.3 The result

The `tools/call` result returned to the client:

```json
{
  "resultType": "input_required",
  "inputRequests": {
    "approval": {
      "method": "elicitation/create",
      "params": {
        "mode": "form",
        "message": "<the message of §3.2>",
        "requestedSchema": {
          "type": "object",
          "properties": { "approve": { "type": "boolean" } },
          "required": ["approve"]
        }
      }
    }
  },
  "requestState": "seal-rs1.<64 hex>"
}
```

The schema carries no titles on purpose: titles consume message lines
inside the measured envelope. The one input-request key is the literal
`approval`; the retry must echo exactly that key (§4 step 6).

### 3.4 What is recorded

A record keyed by `handle_hash`, with `status: "pending"`, `project_id`,
`server_id` (both default strings unless the proxy configures them),
`tool`, `canonical_effect_bytes` = Rule A of `{ args: args ?? {}, tool }`,
`connection_epoch` (§6), `input_request_key` = `"approval"`,
`created_at` = now (ms), `expires_at` = `created_at + ttlMs`, and
`approval_nonce` = 16 random bytes as hex. When a store is configured the
same fields (minus `status`) are appended as an `issued` event **before**
the result is returned.

## 4. retry: the steps, in order

Input: `{ tool, args, requestState, inputResponses }` from the frame
(`params.name`, `params.arguments ?? {}`, `params.requestState`,
`params.inputResponses`). Optional `projectId` / `serverId` default to the
contract's own, so in the shipped proxy they always match.

Every refusal is `{ kind: "refuse", refusal: <code>, detail: <text> }`.
The first failing step wins.

**Step 1 — look up the handle.**

- `requestState` is not a string or does not match the handle shape →
  **`state_malformed`** — *requestState is not a handle this contract ever issues*.
- No record under `sha256hex(requestState)` →
  **`unknown_state`** — *no continuation matches this handle; altered and never-issued are the same miss*.

**Step 2 — require pending and unexpired.** By the record's status:

- `consumed` → **`already_consumed`** — *this one-use approval has already been consumed*.
- `declined` → **`terminally_declined`** — *this request was declined; denial is terminal*.
- `cancelled` → **`cancelled`** — *this request was cancelled*.
- `restart_invalidated` → **`restart_invalidated`** — *this continuation predates a restart; send a fresh call*.
- `expired`, or `now() > expires_at` (strictly greater; a retry at exactly
  `expires_at` is still in time) → the status is journaled as `expired`
  if it was not already, then **`expired`** — *the approval window closed before the retry arrived*.

**Step 3 — connection currency.** Context match
(`projectId === record.project_id && serverId === record.server_id`) is
computed here but judged at the end. If `record.connection_epoch` is not
the running contract's epoch → **`restart_invalidated`** with the same
detail as in step 2. (With a store, step 2 already catches this case
because loading the store re-labels foreign-epoch pendings; see §6.)

**Steps 4–5 — the exact effect.** `toolMatches = tool === record.tool`.
`canonicalEffect = Rule A({ args: args ?? {}, tool })`; if Rule A refuses →
**`arguments_altered`** — *retry arguments have no canonical form: <Rule A refusal text>*.
`argumentsMatch = canonicalEffect === record.canonical_effect_bytes`
(string equality of the bytes; because `tool` is inside the effect, an
altered tool also makes `argumentsMatch` false). Nothing is refused yet.

**Step 6 — exactly the expected answer.**

- `inputResponses` is `null` or not an object → **`response_malformed`** — *inputResponses is not an object*.
- Its keys are not exactly `["approval"]` → **`response_malformed`** — *inputResponses must carry exactly the "approval" entry*.
- `inputResponses.approval` is falsy or its `action` is not a string → **`response_malformed`** — *the approval answer has no readable action*.
- `action === "decline"` → status journaled `declined`, then **`declined`** — *the answer was decline; denial is terminal for this request*.
- `action === "cancel"` → status journaled `cancelled`, then **`cancelled`** — *the answer was cancel*.
- `action !== "accept"` or `content.approve !== true` → **`response_malformed`** — *the answer is neither accept, decline, nor cancel with a readable approve value*.

So an accepted answer is exactly
`{ "approval": { "action": "accept", "content": { "approve": true } } }`
(extra members inside `approval` are ignored; extra top-level keys are
not).

**Authorization — Node and kernel must agree.**
`nodeAuthorized = contextMatches && toolMatches && argumentsMatch`.

- If a lease fence is configured and reports not-ok →
  **`lease_generation_mismatch`** — the fence's detail, or
  *this proxy no longer owns the active lease generation*.
- The kernel adapter is asked:
  `{ epoch: 1, issuedTool: record.tool, issuedArgs: JSON.parse(record.canonical_effect_bytes).args, retryTool: tool, retryArgs: args ?? {}, accepted: nodeAuthorized, now: floor(now()/1000) }`.
  If it throws an error carrying a string `code`, the refusal is
  **that code** with detail *<message>; Node authorization did not override the kernel refusal*.
  The adapter's own codes, with the condition for each:
  - **`kernel_manifest_refused`** — `runtime-manifest.json` cannot be read, or has no 64-hex pin at `files["kernel/wasm/seal.wasm"]`.
  - **`kernel_integrity_refused`** — `runtime/kernel/wasm/seal.wasm` cannot be hashed, or its SHA-256 differs from the pin (*no JavaScript fallback exists*).
  - **`kernel_execution_refused`** — the worker exceeded its 5000 ms deadline, could not start, or exited non-zero. An error without a string code is also reported under this name.
  - **`kernel_output_refused`** — the worker's stdout is not JSON, or its `verdict` is neither `"ALLOW"` nor `"BLOCK"`.
- `kernelAuthorized = verdict === "ALLOW"`. If it differs from
  `nodeAuthorized` → **`authorization_disagreement`** —
  *<side> refused while <other side> allowed; authorization disagreement fails closed*, where `<side>` is `kernel` when Node allowed and `Node` when the kernel allowed.
- If both refused, the reason is named in this priority:
  - not `contextMatches` → **`context_mismatch`** — *Node and kernel refused: retry context differs from the issue-time binding*
  - not `toolMatches` → **`tool_altered`** — *Node and kernel refused: retry tool differs from the issue-time tool*
  - otherwise → **`arguments_altered`** — *Node and kernel refused: retry effect differs from the exact issue-time effect*

**Step 7 — consume atomically.** The lease fence (if any) is checked
again → **`lease_generation_mismatch`**. Then the status `consumed` is
appended to the journal and `fsync`ed **before** the in-memory transition
and before the proxy may forward. A crash between journal and forward
loses an approval; it never gains a call.

**Step 8 — allow.** `{ kind: "allow", evidence }` (§5). Every refusal above
leaves the child untouched.

### 4.1 The proxy around the contract

`spine/proxy.cjs` adds three refusals of its own and one shape:

- Before `begin`: if the proxy already correlates 1024 open approvals
  (the default `receiptCorrelationCapacity`) → **`receipt_correlation_capacity_exceeded`** — *receipt correlation capacity 1024 is full; answer an existing approval before opening another*.
- After `retry` returns **allow** for a handle-shaped `requestState` the
  proxy has **no** correlation for (for example, a proxy restarted
  without its journal) → **`receipt_correlation_missing`** — *no receipt correlation matches this continuation; retry refused before forwarding*. Note the contract has already consumed the approval in this case; the refusal is final for that handle.
- Before forwarding an allowed call: a child that failed to start →
  `protected_server_missing` / `protected_server_failed`; a
  `beforeForward` check that is not ok → its code, or **`forward_refused`**.
- Every refusal is returned to the client as a `tools/call` result
  `{ "content": [{ "type": "text", "text": "approval refused: <code> — <detail>" }], "isError": true }`
  and a `BLOCK` receipt is written.
- The forwarded frame is rebuilt as
  `{ jsonrpc: "2.0", id, method, params: { name, arguments } }` —
  `requestState` and `inputResponses` never reach the child.

## 5. The allow evidence

```json
{
  "handle_returned_unaltered": true,
  "effect_matches_bound_bytes": true,
  "within_expiry": true,
  "same_connection_epoch": true,
  "one_use_consumed_now": true,
  "approval_nonce": "<32 hex>",
  "authorization_rule": "PROVED",
  "state_machine": "TESTED",
  "kernel": {
    "verdict": "ALLOW",
    "raw": "<the kernel worker's raw result>",
    "issued_target": "<the kernel's issue-time target digest>",
    "wasm_sha256": "<the vendored wasm's SHA-256>"
  },
  "human_present": "unknown",
  "human_present_detail": "a client holding the correct handle can fabricate an acceptance; form elicitation places the client inside the trusted approval-origin boundary — a declared assumption, not an enforced property"
}
```

The five booleans are always `true` in an allow (each was a precondition
of reaching step 8). `authorization_rule: "PROVED"` and
`state_machine: "TESTED"` are the contract's labels for its own
assurance level and are reproduced here as emitted, not endorsed by this
document. This object is written into the `ALLOW` receipt's `evidence`
member and is signed but not per-field committed
([receipt-seal-spine-v1.md](receipt-seal-spine-v1.md) §2).

## 6. The two lifetimes

### 6.1 A pending continuation — does not survive a restart

Begins when `begin` returns `input_required`. It ends on the first of:

| Ends by | Resulting status | Journaled? | Later retry refuses with |
|---|---|---|---|
| an accepted retry that passes every step | `consumed` | yes, before the transition | `already_consumed` |
| a `decline` answer | `declined` | yes | `terminally_declined` |
| a `cancel` answer | `cancelled` | yes | `cancelled` |
| a retry arriving after `expires_at` (`created_at + ttlMs`, default 120000 ms) | `expired` | yes, lazily, at that retry | `expired` |
| a restart — precisely, the next time the contract loads its store and finds this record pending under a `connection_epoch` other than its own | `restart_invalidated` | yes, at load time | `restart_invalidated` |

Expiry is **lazy**: nothing marks a record expired until a retry asks
about it. The `connection_epoch` is 8 random bytes as hex, drawn once per
contract construction; every proxy start is a new epoch.

### 6.2 A consumed approval — survives a restart

Begins at step 7. It never ends: the `consumed` status is an append-only
journal event, `fsync`ed before the in-memory transition, and replayed
whenever the store is loaded. A replay of the same handle after any number
of restarts is `already_consumed`. One use that forgets is not one use.

### 6.3 The journal

`spine/store.cjs`. Append-only NDJSON, one event per line:

- `{"type":"issued", "handle_hash", "project_id", "server_id", "tool", "canonical_effect_bytes", "connection_epoch", "input_request_key", "created_at", "expires_at", "approval_nonce"}`
- `{"type":"status", "handle_hash", "status", "at"}`

Each append opens the file in append mode at `0600`, writes the line,
`fsync`s, closes. Every `begin` and `retry` runs under a lock file
(`<journal>.lock`, exclusive create, holding the owner pid and a process
start witness; a dead owner's lock is removed) and **re-reads the journal
from disk** before acting, so two proxies sharing a journal see each
other's consumptions.

Silence fails: an **absent** journal is a refusal, not an empty store —
creation is a separate deliberate act. An unreadable journal, a line that
is not JSON, a line without a string `type`, a `status` event for an
unknown hash, or an unknown event type all throw, and the proxy exits
non-zero without approving anything.

## 7. Every refusal code, with where it is raised

| Code | Raised by |
|---|---|
| `unrenderable_effect` | begin, §3.1 |
| `state_malformed` | retry step 1 |
| `unknown_state` | retry step 1 |
| `already_consumed` | retry step 2 |
| `terminally_declined` | retry step 2 |
| `cancelled` | retry step 2 (prior cancel) and step 6 (a cancel answer) |
| `expired` | retry step 2 |
| `restart_invalidated` | retry step 2 and step 3 |
| `response_malformed` | retry step 6 |
| `declined` | retry step 6 |
| `lease_generation_mismatch` | before the kernel and again before consumption |
| `kernel_manifest_refused`, `kernel_integrity_refused`, `kernel_execution_refused`, `kernel_output_refused` | the kernel adapter |
| `authorization_disagreement` | Node/kernel comparison |
| `context_mismatch`, `tool_altered`, `arguments_altered` | the both-refused naming (and `arguments_altered` when Rule A refuses the retry effect) |
| `receipt_correlation_capacity_exceeded`, `receipt_correlation_missing`, `forward_refused`, `protected_server_missing`, `protected_server_failed` | the proxy, §4.1 |

## 8. What this document does not specify, and what would lift each gap

1. **The kernel's own decision rule.** This document states what Node
   sends to the kernel adapter and what codes come back; it does not state
   how `runtime/kernel` computes `ALLOW`/`BLOCK`, nor the `guardTarget`
   digest, whose key ordering differs from Rule A (see
   [canonicalization.md](canonicalization.md), gap 3). *Lifts when* the
   kernel runtime ships its own frozen specification, which is a change to
   a pinned artifact reserved to the project owner.

2. **`project_id` / `server_id` binding is nominal in the shipped proxy.**
   The proxy never passes a retry-time project or server, so
   `contextMatches` is always true and `context_mismatch` is unreachable
   through the product. This document records the check as implemented
   and does not claim it protects anything today. *Lifts when* the proxy
   supplies retry-time context from the connection, at which point the
   binding becomes a real check and this section is rewritten.

3. **Human presence.** Not specified because not established. *Lifts
   when* the approval origin is something the contract can verify rather
   than assume — an out-of-band confirmation channel, or a client
   attestation the contract checks — which is a product change outside
   this document.

4. **Multi-proxy sharing of one journal.** §6.3 describes the lock and the
   re-read; this document does not claim a proof that two proxies can
   never both consume one handle, only that the lock serialises the
   read-judge-append sequence. *Lifts when* a test in the product-suite
   roster drives two proxies against one journal concurrently and asserts
   a single consumption.

5. **Step ordering and side effects.** The source comment says steps 1–6
   reject "without any caller-visible side effect"; as implemented, step
   2 journals `expired` and step 6 journals `declined`/`cancelled`. This
   document follows the code. *Lifts when* the comment is corrected or
   the code is changed to match it; either way version 2 of this document
   states the result.

6. **Nothing here is a shipped conformance test against this text.** The
   refusal codes and messages were matched by hand against the source at
   the commit above. *Lifts when* a test reads this document's code table
   and asserts each name exists in `contract/contract.cjs` and
   `spine/proxy.cjs`.
