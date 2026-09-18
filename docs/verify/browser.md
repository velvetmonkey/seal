# Browser receipt checks

[seal-check](https://github.com/velvetmonkey/seal-check) inspects one decision
receipt at a time, entirely in your browser, at
<https://velvetmonkey.github.io/seal-check/>. No install, no account.

## Sequence

1. Open <https://velvetmonkey.github.io/seal-check/> (or a receipt deep link
   the page documents).
2. Paste the receipt JSON, or use the shipped example
   ([`examples/allow.receipt.json`](https://github.com/velvetmonkey/seal-check/blob/master/examples/allow.receipt.json))
   to see a passing check without needing a receipt of your own.
3. Where the receipt format supports it, supply a separately obtained public
   key (an `expected-config-pubkey`, from your own deploy trust file or CI
   configuration — never copied out of the receipt itself) to check operator
   authority rather than signature validity alone.
4. Read every reported result, not just the top-line verdict. Each row
   answers a distinct question:

   | Result | Question it answers |
   | --- | --- |
   | `signature_valid` | Was the config signed by the holder of the stated public key? Not who that key belongs to. |
   | `kernel_replay_consistent` | Does the kernel, re-run over the receipt's own recorded inputs, reproduce the recorded verdict? |
   | `authority_trusted` | Does the signing key match a public key **you** independently pinned? Only meaningful once you supply that pin. |

Signature validity, replay consistency and operator authority are different
questions. A receipt can be signed by *someone*, internally consistent, and
still not be signed by an authority you trust — that is what
`authority_trusted: UNPINNED` means.

**Older Spine-format receipts do not support kernel replay.** Where the format
predates the v2 kernel-replay path, seal-check reports what it can (signature,
shape) and does not claim a replay result it cannot produce.

## Privacy

Receipt checking runs in the browser rather than a verification backend: there
is no server-side upload of what you paste. This is narrower than a blanket
"nothing can leave your browser" guarantee. seal-check's own current
explanation documents real exceptions: cross-origin content and connections
are blocked, and the policy declares WebRTC blocked, but Chromium does not
enforce that directive and may still send WebRTC traffic; and top-level
navigation remains possible, so `window.open`, links, and meta refresh could
send data in a URL to another site. Read
[seal-check's current privacy notice](https://velvetmonkey.github.io/seal-check/)
for the exact, current wording before pasting anything sensitive. This page
does not strengthen or restate that guarantee beyond what seal-check itself
publishes.

Previous: [Choose a checking tool](README.md).
Up: [Choose a checking tool](README.md).
Next: [CLI assurance checks](cli.md).
