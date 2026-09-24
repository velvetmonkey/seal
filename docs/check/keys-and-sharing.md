# Keys and safe sharing

Keep three things separate: the receipt-signer public key, a policy/config-signer public-key pin, and private signing credentials. Protect and Spine use the first; principal/config authority checks use the second where their profile supports it. Neither public value proves whose key it is merely by being included beside a receipt.

Use an independently provisioned key for a real relying-party decision. A key copied from the same untrusted message as its receipt can demonstrate consistency but cannot authenticate the sender as your operator. Never upload a private seed or signing key.

Receipts may contain sensitive arguments and principal context. Inspect contents before sharing. Editing a signed receipt to redact it invalidates its bindings; provide a clearly labelled redacted diagnostic separately and retain original bytes privately. Begin tutorials with public fixtures.

Deep links can carry receipt contents in their fragment. Fragments can remain in browser history or be copied into chat, even when not sent as an HTTP query. Do not put user receipt contents in documentation search, analytics or query strings. Link to the empty checker for private work.

[Local serving](run-locally.md) separates asset delivery from local checking. It does not remove trust in the delivered code, browser, bundled kernel or supplied keys.

Previous: [Receipt formats and compatibility](formats.md).
Up: [Check receipts](README.md).
Next: [Run the checker locally](run-locally.md).
