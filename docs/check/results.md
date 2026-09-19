# Read receipt results

A check has a scope, not just a color. Preserve the reported rows and the tool name when sharing a result.

| Surface or result | Meaning | Next action |
|---|---|---|
| Protect signature/bindings pass | The supplied signer key and committed receipt contents agree. | Establish whether that key is trusted separately. |
| Protect replay passes | The verifier's local kernel reproduced the recorded verdict and reason. | Do not infer producer binary identity or occurrence. |
| Product VERIFY UNVERIFIED | Reported checks may pass while authority/occurrence remain outside the evidence. | Read the individual rows, even after exit 0. |
| Kit PASS VERIFIED (bundled self-check; not independent verification) | The kit's applicable checks passed using its bundled dependencies. | Preserve the qualification; it does not establish deployment security. |
| Browser UNPINNED | Decision evidence is consistent without independently established operator authority. | Provision a trust anchor in a verifier profile that supports it. |
| REDUCED SCOPE | Available evidence cannot support full replay or required authority attribution. | Keep this distinct from success and from tamper. |
| NOT MEDIATED | The receipt reports a bypass rather than mediated execution. | Investigate the route. |
| Refused or unsupported | An integrity/shape check failed, or this format is outside support. | Keep the original bytes and diagnostic; check format and key. |

BLOCK can be the correct recorded decision in a successfully checked receipt. It is different from a receipt refused because its signed content was changed.

The kit's verification process uses exits 0 (pass), 1 (failed check), 2 (usage), 3 (internal error), and 4 (reduced scope). These are not the checker's browser states or every other kit command's exit contract. See [the kit reference](../assure/reference/README.md).

Previous: [From a Seal demo to the browser](from-seal.md).
Up: [Check receipts](README.md).
Next: [Receipt formats and compatibility](formats.md).
