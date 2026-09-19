# Authorization correspondence release gate

Status: **incomplete; no release claim is earned by this draft**. The v2 publisher
rejects v1 evidence. Separate source, adapter, and child PASS results are
insufficient: release eligibility requires joined transcript bytes, a definiens
digest and extract map, and the live mutation controls. The current orchestrator
does not yet produce all of those inputs and therefore cannot qualify a release.

The shipped observation policy is `runtime/observation-guard.json`. The harness
runs the installed protection implementation to create `seal.protect/v1` state;
it does not write protection state itself. A harness-side Claude route registrar
models local registration only. The installed proxy receives real elicitation
responses. The worker wrapper executes the installed worker unchanged and a
harness-only preload observes `seal_decide` calls, loaded selections, and TTL.
These observers are an explicit trusted computing base and are not shipped.

Guarded correspondence is claimed only for tools in
`runtime/observation-guard.json`. Other operator lists, third-party client wire
identity, and human approval origin are outside this gate. The unguarded forward
is retained as `residual:unguarded-forward`. Wall-clock expiry is not a ninth
live control: `residual:wall-clock-not-in-ninth`. No production clock hook is
introduced. Existing direct-contract clock checks are diagnostics, not live
ninth-control evidence.

## v2 transcript encoding

The encoding identifier is `seal-json-utf16-sorted-finite-binary64/v1`: JSON
objects sorted by UTF-16 code-unit key order, array order retained, finite
binary64 numbers rendered with ECMAScript JSON number spelling. This encoding
is used for the transcript root and the second, injectivity-only hash. The
second hash covers **all** child `params` keys. It is never a theorem target.

Each row retains eight `{bytes, sha256}` hops in the specified order: inbound
line, Lean kernel wire, oracle effect/route/target, actual kernel wire, raw
kernel result, child line, child effect, full-params digest. Missing bytes are
`null`, hashed as the four UTF-8 bytes `null`; present bytes are UTF-8 strings.
The eighth hop's bytes are the hexadecimal SHA-256 of the ordered full params
object; the hop hash also binds that digest string. Line terminators are excluded.

The row references the independently retained inbound/child inventories by
index; an absent child has `child_index: null`. The verifier requires complete
inventory coverage, deep effect equality, kernel/oracle wire equality, route
iff child reception, target equality, injectivity, the unguarded residual, and
corpus coverage. The generator that joins all live corpus observations into this
schema remains unfinished; synthetic verifier controls do not fill that gap.

## Publication

The workflow requires repository immutable releases to be enabled. The release
publish environment must provide `RELEASE_IMMUTABILITY_READ_TOKEN` with repository
Administration read permission for that settings endpoint; the ordinary Actions
contents token does not supply it. Missing credentials refuse publication. No
credential was installed by this draft. The workflow resolves
the tag with `refs/tags/$TAG^{}`, downloads every draft asset body, re-extracts
WASM and the observation pack, checks tree/source/definiens bindings, and
re-verifies transcript assertions before flipping the draft. It then downloads
public bodies, compares every body with its draft counterpart, and attests those
public downloads. A post-flip verification or attestation failure attempts to
delete the release and emits an error advisory; a failed deletion is a failed
yank, not a successful withdrawal. No release was published to exercise this
flow in the current development run.

The full passing-release claim remains conditional on the completed gate. This
work does not claim equivalence with `SealV2.decide`, project/server identity as
a kernel theorem, compiler/toolchain/runtime/IO/crypto correctness, or a human
Accept click. `composed_non_bypass` may enter a future claim only after its
spelled subject is demonstrated in the compiled extract.
