# One-repin execution runbook

This is the execution runbook for the Phase M `mcp-seal` repin. Its governing
rule is **one source-pin movement, with every derived and published artifact
prepared and verified as one exercise**. Do not land a source pin and return
later for a wasm, verifier, demo, receipt, or lock-file pin.

This does **not** mean moving all five Lake dependencies. The recorded
2026-07-24 decision in `seal-host/DECISIONS.md` is to move only `mcp-seal`;
the other four dependencies carry no security change needed by this repin.

The runbook distinguishes:

- **EVIDENCED** — a checked-in script, check, document, or past repin supports
  the command and expected result.
- **PROPOSED** — repository history does not record this exact operation. The
  step names the evidence required before it may be treated as established.

No operator may turn a **PROPOSED** step into an implicit convention. Record
the confirming run or automation in the repository first.

## Stop conditions

Stop without changing a pin if any of these is true:

1. A Phase M change that alters kernel, host, receipt, verifier, fixture, or
   demo shape is not merged.
2. Any required source or host CI job is red, skipped, unavailable, or was run
   without any credential its workflow configuration requires.
3. `node scripts/pins_gate.mjs --check` is red.
4. The selected `mcp-seal-dev` commit is not present on its authoritative
   remote.
5. The artifact ledger below is incomplete.
6. There is no clean-runner reproduction of the newly minted wasm.
7. A failure is not understood. Do not cure a red by moving another pin.

As measured on 2026-07-29, the checked-in `seal-host` main branch is **not
ready**: `node scripts/pins_gate.mjs --check` reports the `issuedAt /
expiresAt` PINS row as falsely `PINNED`. The command, rather than this dated
observation, is authoritative.

## Repositories and scratch state

The commands below assume sibling working copies. Set paths explicitly; do not
reuse shell variables such as `HOME`.

```sh
set -euo pipefail

export SEAL_ROOT=/path/to/seal
export HOST_ROOT=/path/to/seal-host
export KERNEL_ROOT=/path/to/mcp-seal-dev
export CHECK_ROOT=/path/to/seal-check
export KIT_ROOT=/path/to/seal-assurance-kit
export ACTION_ROOT=/path/to/seal-verify-action
export DEMO_ROOT=/path/to/seal-demo
export LIVE_ROOT=/path/to/seal-live-demo

export KERNEL_REV=<full-40-character-mcp-seal-dev-commit>
export REPIN_EVIDENCE_DIR=$(mktemp -d)
```

Use full 40-character commit IDs everywhere. Do not fill `KERNEL_REV` until
the preconditions below have selected the single Phase M commit.

## Artifact ledger

Create a checklist containing every applicable item before editing. A new
hash or commit may be written only after the immediately preceding
verification passes.

### Source and dependency resolution

- [ ] authoritative `mcp-seal-dev` commit, merged and remotely reachable
- [ ] `seal-host/lakefile.toml` `mcp-seal` `rev`
- [ ] `seal-host/lake-manifest.json` `mcp-seal` `rev` and `inputRev`
- [ ] resolved `.lake/packages/mcp-seal` checkout (generated, not committed)
- [ ] all affected factual rows in `seal-host/PINS.md`

### Native products

- [ ] `seal-host/.lake/build/lib/libsealffi.so` (generated, not committed)
- [ ] `seal-host/rust/target/debug/seal-host-rs` (generated, not committed)
- [ ] release host binaries exercised by `scripts/evidence.sh` (generated)
- [ ] FFI closure/module lists, if the new kernel added imports

Native hashes are calculated dynamically by the receipt producer. There is no
checked-in expected hash for these generated files, so successful clean
rebuild and test evidence is the pin.

### Local conformance wasm

- [ ] `seal-host/wasm-spike/verified/seal.wasm`
- [ ] `seal-host/wasm-spike/verified/seal.js`, if the generated glue changed
- [ ] `seal-host/wasm-spike/verified/PROVENANCE.txt`
- [ ] `seal-host/wasm-spike/verified/pin-history.json`
- [ ] `seal-host/rust/tests/three_way.rs` `PINNED_WASM_SHA256`
- [ ] `seal-host/test/test_rebased_pin_baseline.py` source and local-wasm pins
- [ ] conformance documentation containing an active source or wasm identity

`seal.js` is not automatically either changed or retained. Most older repins
moved it; commit `f247c049d7b864e9301704613f5640c2a2b43a4c` retained the old loader
only after the Node three-way lane exercised that loader against the new
module. Compare the generated glue, and verify whichever choice is made.

### Receipt-verifier and receipt identity

- [ ] `seal-host/receipt-verifier/wasm/seal.wasm`
- [ ] `seal-host/receipt-verifier/README.md`
- [ ] the verified-kernel constant in
      `seal-host/rust/src/authorization_decision.rs`
- [ ] receipt fixtures, signatures, signed approval vectors, golden outputs,
      and exact-byte twins whose committed identity or signed shape changed
- [ ] active expected hashes in release/scrub checks

The exact Phase M fixture list cannot be frozen before the remaining Phase M
changes land. That list is therefore discovered by the old-hash and
shape-diff sweep in step 7; omission is a stop condition.

### Fleet publication

- [ ] `seal-check/wasm/seal.wasm`
- [ ] `seal-assurance-kit/kernel/wasm/seal.wasm`
- [ ] `seal-verify-action/vendor/seal-assurance-kit/kernel/wasm/seal.wasm`
- [ ] `seal-demo/public/wasm/seal.wasm`
- [ ] `seal-live-demo/seal-gateway/wasm/seal.wasm`
- [ ] `seal-live-demo/pwa/wasm/seal.wasm`
- [ ] all constants, bundles, receipts, fixtures, signatures, and docs in
      those repositories that name or contain the old identity
- [ ] the Golden Path assurance-kit commit pinned by
      `seal-host/.github/workflows/golden-path.yml`
- [ ] `PHASE_B_KIT_REV` in all seven `seal-host/demo/golden_path_*.py` files
- [ ] `seal-host/release/fleet-lock.json`: new kernel hash and all five exact
      downstream commits
- [ ] `seal-host/wasm-spike/verified/pin-history.json`: new active fleet
      assurance-kit/hash pair and the prior entry superseded
- [ ] `seal-host/wasm-spike/verified/PROVENANCE.txt`: same history
- [ ] the full kit/hash history mirrored in
      `seal-host/demo/golden_path_filesystem.py`
- [ ] regenerated `seal-host/release/kernel-hash-footprint.json`

The six wasm paths and five repositories above come from the checked-in fleet
lock. The seven demo pin sites are guarded by
`test/test_rebased_pin_baseline.py`. Re-enumerate them during the exercise;
the checked-in footprint, not this prose, is authoritative if the fleet grows.

## Preconditions

### 1. Confirm repository identity and clean working copies — EVIDENCED

Run for all eight repositories:

```sh
for repo in \
  "$SEAL_ROOT" "$HOST_ROOT" "$KERNEL_ROOT" "$CHECK_ROOT" \
  "$KIT_ROOT" "$ACTION_ROOT" "$DEMO_ROOT" "$LIVE_ROOT"
do
  printf '%s %s\n' \
    "$(git -C "$repo" rev-parse --show-toplevel)" \
    "$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
  test -z "$(git -C "$repo" status --porcelain)"
done
printf '%s\n' "PASS clean repository preflight"
```

Expected final output:

```text
PASS clean repository preflight
```

The July 21 revert/re-land operated on coherent commits, not mixed working
trees. A dirty repository makes the abort boundary unknowable.

### 2. Confirm all repin-forcing Phase M work is merged — PROPOSED

Review `seal/docs/ROADMAP-KERNEL-OUTWARD.md` and record the merge commit for
every completed Phase M item that changes:

- `mcp-seal-dev` source or proof surface;
- request/effect/receipt/signed-envelope shape;
- host projection or serialization;
- verifier parsing or fixtures;
- demos or Golden Path acceptance.

At minimum, M.1, M.2, M.3, M.4, and M.7 must have an explicit disposition
before the Phase M repin. The roadmap currently queues repin-forcing work
behind M.8, so “not started” is not evidence that it is safe to omit.

Confirmation required: check in a machine-readable Phase M merge ledger or a
script that compares the selected `KERNEL_REV` and host base with the roadmap
closure commits. No such check exists in the reconstructed history.

As measured on 2026-07-29, the two M.4 kernel commits are no longer missing:
`cd9ebba449bd2c0bd87a39eecdf1a58ee92a9ed7` and
`81b2114a40e7904fd68cee3698416c05817688b7` are on authoritative
`mcp-seal-dev` `main`. Host topic commit
`207e21c6ade85ae7ead4caaadb7d799e373527a1` is the second parent of merge
`6700282635e2aec38d622314718bb12c38377590`, which is on authoritative
`seal-host` `main`. This dated state is **EVIDENCED** by the two repository
histories and establishes a merged source disposition for M.4. It does not
remove the **PROPOSED** merge-ledger or final-selection requirements above,
does not perform the repin, and does not clear stop condition 1 for Phase M
work whose disposition remains open.

### 3. Confirm source and host gates are green — EVIDENCED locally;
clean-runner status PROPOSED

From the source repository:

```sh
cd "$KERNEL_ROOT"
bash c/build.sh
lake build
: > "$REPIN_EVIDENCE_DIR/source-axioms.txt"
lake exe axiom_check 2>&1 | tee -a "$REPIN_EVIDENCE_DIR/source-axioms.txt"
for exe in \
  v2_m1_axiom_check v2_m2_axiom_check v2_m3_parser_axiom_check \
  v2_m3_axiom_check v2_m4_axiom_check v2_m6_axiom_check
do
  lake exe "$exe" 2>&1 | tee -a "$REPIN_EVIDENCE_DIR/source-axioms.txt"
done
! grep -E 'sorryAx|Lean\.ofReduceBool' "$REPIN_EVIDENCE_DIR/source-axioms.txt"
printf '%s\n' "PASS source build and axiom gates"
```

Expected terminal line:

```text
PASS source build and axiom gates
```

From the host:

```sh
cd "$HOST_ROOT"
node scripts/pins_gate.mjs --check
python3 scripts/fleet_release_gate.py --validate-lock
node scripts/kernel_hash_footprint.mjs --check
python3 test/test_rebased_pin_baseline.py -v
python3 - <<'PY'
import hashlib, json, pathlib
fleet = json.loads(pathlib.Path("release/fleet-lock.json").read_text())["kernel_sha256"]
local = hashlib.sha256(pathlib.Path("wasm-spike/verified/seal.wasm").read_bytes()).hexdigest()
state = "fleet and local pins agree" if fleet == local else "local and fleet pins differ"
print(f"PIN STATE: fleet={fleet} local={local}: {state}")
PY
```

Expected terminal lines:

```text
PINS GATE PASS (<current row count> rows, <current SPEC-ONLY count> SPEC-ONLY names)
PASS fleet lock validation: <absolute path>/release/fleet-lock.json
PASS kernel hash footprint: <current repo count> repos, <current occurrence count> occurrences
PIN STATE: fleet=<full hash> local=<full hash>: <fleet and local pins agree|local and fleet pins differ>
```

Counts and hash prefixes are intentionally not frozen here. Exit status and
the semantic state are the checks. On 2026-07-29 the expected PINS line is not
obtainable on main; repair that independently and obtain green CI before
starting.

Clean-runner confirmation is **PROPOSED** because the repository has no
checked-in command that proves a particular GitHub run covered the required
commit. Confirmation required: a protected required-check set or a checked-in
CI-status verifier. Until then, record the exact commit and URLs for successful
source and host runs and verify that no required job was skipped.

### 4. Select one remotely reachable kernel commit — EVIDENCED check;
selection policy PROPOSED

```sh
test "$(git -C "$KERNEL_ROOT" rev-parse "$KERNEL_REV^{commit}")" = "$KERNEL_REV"

KERNEL_REMOTE=$(git -C "$KERNEL_ROOT" remote get-url origin)
git -C "$REPIN_EVIDENCE_DIR" init -q
git -C "$REPIN_EVIDENCE_DIR" fetch -q --depth=1 "$KERNEL_REMOTE" "$KERNEL_REV"
test "$(git -C "$REPIN_EVIDENCE_DIR" rev-parse FETCH_HEAD)" = "$KERNEL_REV"
printf 'PASS remote kernel %s\n' "$KERNEL_REV"
```

Expected:

```text
PASS remote kernel <the full KERNEL_REV>
```

Commit `a8acb89aedc6101f6d6e616994ebd430a6121cbf` recorded a local-only
kernel pin that a fresh machine could not resolve. A local object is
insufficient.

Which Phase M commit to select is **PROPOSED**. Confirmation required: the
Phase M merge ledger from precondition 2 and green source CI at that exact
commit.

### 5. Capture the old coherent state — EVIDENCED

```sh
cd "$HOST_ROOT"
OLD_SOURCE_REV=$(
  python3 -c 'import tomllib; rows=tomllib.load(open("lakefile.toml","rb"))["require"]; print(next(r["rev"] for r in rows if r["name"] == "mcp-seal"))'
)
OLD_LOCAL_WASM=$(sha256sum wasm-spike/verified/seal.wasm | awk '{print $1}')
OLD_FLEET_WASM=$(
  python3 -c 'import json; print(json.load(open("release/fleet-lock.json"))["kernel_sha256"])'
)
export OLD_SOURCE_REV OLD_LOCAL_WASM OLD_FLEET_WASM

printf 'source=%s\nlocal_wasm=%s\nfleet_wasm=%s\n' \
  "$OLD_SOURCE_REV" "$OLD_LOCAL_WASM" "$OLD_FLEET_WASM" |
  tee "$REPIN_EVIDENCE_DIR/baseline.txt"
sha256sum \
  wasm-spike/verified/seal.wasm \
  wasm-spike/verified/seal.js \
  receipt-verifier/wasm/seal.wasm |
  tee "$REPIN_EVIDENCE_DIR/baseline-artifacts.sha256"
```

Expected: three full SHA-256 values in `baseline.txt` and three successful
`sha256sum` rows. It is valid for local and fleet wasm to differ only if
`test_rebased_pin_baseline.py` explicitly reports “local ahead of fleet,
publish pending”; that is the state established by
`f247c049d7b864e9301704613f5640c2a2b43a4c`.

## Ordered execution

Every step is a gate for the next one. Keep source, host, and all downstream
work on dedicated branches until step 14.

### 1. Update the two source-pin declarations — artifact movement EVIDENCED;
exact edit and regeneration command PROPOSED

Change only the `mcp-seal` `rev` in `lakefile.toml`, then regenerate the Lake
manifest:

```sh
cd "$HOST_ROOT"
lake update mcp-seal
```

The expected state is:

```sh
python3 - "$KERNEL_REV" <<'PY'
import json, pathlib, sys, tomllib
want = sys.argv[1]
lakefile = tomllib.loads(pathlib.Path("lakefile.toml").read_text())
manifest = json.loads(pathlib.Path("lake-manifest.json").read_text())
require = next(r for r in lakefile["require"] if r["name"] == "mcp-seal")
assert require["rev"] == want, require
package = next(p for p in manifest["packages"] if p["name"] == "«mcp-seal»")
assert package["rev"] == want, package
assert package["inputRev"] == want, package
print(f"PASS source pin {want}")
PY
```

Expected:

```text
PASS source pin <the full KERNEL_REV>
```

Both files moved together in every reconstructed source repin, and
`docs/POLICY-V2-PROMOTION.md` names `lake update mcp-seal`. However, the
historical commits do not record the exact command used for each manifest
rewrite. Treat the command as **PROPOSED** until a clean branch run produces
only the intended dependency delta and CI accepts it.

Immediately verify the resolved checkout:

```sh
test "$(git -C .lake/packages/mcp-seal rev-parse HEAD)" = "$KERNEL_REV"
git -C .lake/packages/mcp-seal status --porcelain
printf '%s\n' "PASS resolved package checkout"
```

Expected: an empty status line, then:

```text
PASS resolved package checkout
```

This explicit check closes a gap in `scripts/evidence.sh`: that script calls
`lake update` only when the package directory is absent, so an existing stale
checkout could otherwise survive.

### 2. Rebuild and verify the native layer — EVIDENCED

This step is order-sensitive. The Rust crate links `sealffi`, so the Lean
runtime closure and `.lake/build/lib/libsealffi.so` must exist before Cargo
links the host. `scripts/build_all.sh` records and enforces the order
`lake build +Ffi` → `scripts/build_ffi_so.sh` → Cargo. CI and
`scripts/evidence.sh` use the same ordering.

```sh
cd "$HOST_ROOT"
scripts/build_all.sh
test "$(git -C .lake/packages/mcp-seal rev-parse HEAD)" = "$KERNEL_REV"
test -s .lake/build/lib/libsealffi.so
test -f rust/Cargo.toml
test ! -e Cargo.toml
sha256sum .lake/build/lib/libsealffi.so rust/target/debug/seal-host-rs |
  tee "$REPIN_EVIDENCE_DIR/native.sha256"
```

Expected terminal line from the script:

```text
==> done: rust/target/debug/seal-host-rs
```

If Cargo is invoked separately after the shared object has been built, invoke
it from the crate directory, not the repository root:

```sh
cd "$HOST_ROOT"
test -s .lake/build/lib/libsealffi.so
cd rust
cargo build
```

`rust/build.rs` defaults `SEAL_FFI_LIB_DIR` to
`$HOST_ROOT/.lake/build/lib` relative to `rust/Cargo.toml` and emits both the
native link-search path and runtime rpath. That is the checked-in equivalent
of supplying an explicit `RUSTFLAGS=-L ...` and matching runtime library path;
CI relies on it. If the linker still reports `unable to find library
-lsealffi`, do not add Cargo retries or continue with cached products: verify
the shared object and `SEAL_FFI_LIB_DIR`, then return to the Lean/FFI build
above.

Then run the native portion of the integrated evidence chain, or the entire
chain at step 11. `scripts/build_ffi_so.sh` rebuilds the explicit object
closure and checks exports and unresolved dynamic symbols. This check is
required because the July 24 raw-wire work spent four days behind a stale
`.so` after its module closure ceased to link.

If a new import is missing from the FFI object closure, stop here. Repair and
review the build script as part of this one repin; do not test against the old
`.so`.

### 3. Mint the wasm twice before copying it — build sequence and clean
provisioning EVIDENCED; independent clean-runner reproduction PROPOSED

The checked-in provisioner recreates or verifies the ignored
`wasm-spike/emsdk/` and `wasm-spike/lean4-src/` trees. Run it before activating
Emscripten, including when those directories already exist:

```sh
cd "$HOST_ROOT/wasm-spike"
./provision_toolchain.sh
source ./emsdk/emsdk_env.sh

(cd .. && lake build)
./build_runtime_wasm.sh
./build_core.sh
./build_base.sh
./build_closure.sh
./build_wasm.sh strict

FIRST_WASM=$(sha256sum build-core/seal.wasm | awk '{print $1}')
FIRST_JS=$(sha256sum build-core/seal.js | awk '{print $1}')
./build_wasm.sh strict
SECOND_WASM=$(sha256sum build-core/seal.wasm | awk '{print $1}')
SECOND_JS=$(sha256sum build-core/seal.js | awk '{print $1}')
test "$FIRST_WASM" = "$SECOND_WASM"
test "$FIRST_JS" = "$SECOND_JS"
printf 'PASS same-machine wasm reproduction %s %s\n' \
  "$SECOND_WASM" "$SECOND_JS"
export SECOND_WASM SECOND_JS
```

Expected build lines include:

```text
[build_wasm] done: <byte count> bytes
PASS same-machine wasm reproduction <wasm sha256> <javascript sha256>
```

`build_runtime_wasm.sh`, `build_core.sh`, `build_base.sh`,
`build_closure.sh`, and strict `build_wasm.sh` are checked in. Commit
`f247c049d7b864e9301704613f5640c2a2b43a4c` records this sequence and a
same-machine repeat. Commit
`e996e437bf50e1570c7006b0b4c9be59833ca5ea` makes clean toolchain
provisioning **EVIDENCED**: it checks in `provision_toolchain.sh`, pins and
verifies Emscripten 6.0.0 and Lean v4.28.0, applies and verifies the recorded
Lean runtime patch, and records successful provisioning from an empty scratch
directory.

Independent artifact reproduction remains **PROPOSED**. No clean runner has
yet used the provisioned trees to mint and reproduce both `SECOND_WASM` and
`SECOND_JS`. Confirmation required: a clean-runner wasm-mint job that records
the exact host commit and provisioned source state and reproduces both hashes.

Do not copy the artifact if the two local links differ. The unresolved
`0d3536e5` versus `3d70637f` episode shows why same-source provenance is not
proof of byte identity.

### 4. Stage the local verified wasm and provenance — wasm copy EVIDENCED;
loader choice PROPOSED

```sh
cd "$HOST_ROOT/wasm-spike"
cp build-core/seal.wasm verified/seal.wasm
test "$(sha256sum verified/seal.wasm | awk '{print $1}')" = "$SECOND_WASM"
printf 'PASS staged verified wasm %s\n' "$SECOND_WASM"
```

Expected:

```text
PASS staged verified wasm <the new wasm sha256>
```

Compare the generated loader:

```sh
GENERATED_JS=$SECOND_JS
PINNED_JS=$(sha256sum verified/seal.js | awk '{print $1}')
printf 'generated_js=%s\npinned_js=%s\n' "$GENERATED_JS" "$PINNED_JS"
```

If the hashes differ, choosing either `cp build-core/seal.js
verified/seal.js` or retaining the existing loader is **PROPOSED**. Confirm
the choice by recording why the ABI is compatible and by passing both the
Node three-way test and `node scripts/conformance_bridge.mjs --wasm`.

Update `verified/PROVENANCE.txt` with:

- exact kernel and host commits;
- pinned Lean and Emscripten versions;
- wasm and loader hashes and sizes;
- every command just run;
- whether the loader was copied or retained;
- same-machine and independent clean-runner reproduction results;
- the superseded source/artifact pair and any unresolved discrepancy.

The fields are EVIDENCED by the existing provenance file. The repository has
no provenance generator, so the exact edit is **PROPOSED**. Confirmation is
the provenance tests in step 7 and human comparison with the captured command
log.

### 5. Verify local native/wasm/model agreement — EVIDENCED

Run before changing the receipt-verifier or any downstream:

```sh
cd "$HOST_ROOT"
cargo test --manifest-path rust/Cargo.toml --test three_way -- --nocapture
node scripts/conformance_bridge.mjs --wasm
```

Expected three-way result:

```text
RESULT        : <passed>/<total> cases byte-identical across native/wasm/model
```

Expected bridge result:

```text
 CONFORMANCE BRIDGE: PASS
```

The three-way corpus is a regression oracle, not an exhaustive equivalence
proof. The pathological-number and raw-wire episodes were discovered because
specific adversarial cases were added. Add Phase M cases for every changed
shape before accepting green.

If the wasm accepts an input that the newly built native/model pair rejects,
stop. The wasm is stale or built from the wrong source. Return to step 3; do
not update a constant to bless its hash.

### 6. Move the local identity cluster — files EVIDENCED; manual edit
procedure PROPOSED

Set:

```sh
export NEW_WASM=$(sha256sum "$HOST_ROOT/wasm-spike/verified/seal.wasm" | awk '{print $1}')
test "$NEW_WASM" = "$SECOND_WASM"
```

Update every applicable local-conformance item in the artifact ledger,
including `rust/tests/three_way.rs`,
`test/test_rebased_pin_baseline.py`, `PINS.md`, active conformance docs, and
`verified/pin-history.json`. Do not change the fleet baseline yet unless the
new artifact is already present in all six downstream paths at the exact
commits named by the candidate fleet lock.

There is no checked-in identity-update script, so the edits are **PROPOSED**.
Confirmation required: introduce such a script, or record a reviewed diff
plus all of these checks:

```sh
cd "$HOST_ROOT"
python3 test/test_rebased_pin_baseline.py -v
python3 -m unittest discover -s test -p 'test_*provenance*.py' -v
node scripts/pins_gate.mjs --check
```

Expected:

```text
PIN STATE: fleet=<full old hash> local=<full new hash>: local ahead of fleet, publish pending
PINS GATE PASS (<current row count> rows, <current SPEC-ONLY count> SPEC-ONLY names)
```

All provenance tests must report `OK`.

### 7. Sweep the entire footprint and signed-shape delta — footprint command
EVIDENCED; Phase M fixture classification PROPOSED

Search all eight repositories for the old source, local, and fleet hashes:

```sh
for repo in \
  "$SEAL_ROOT" "$HOST_ROOT" "$KERNEL_ROOT" "$CHECK_ROOT" \
  "$KIT_ROOT" "$ACTION_ROOT" "$DEMO_ROOT" "$LIVE_ROOT"
do
  printf '\n== %s ==\n' "$repo"
  git -C "$repo" grep -n -E \
    "$OLD_SOURCE_REV|$OLD_LOCAL_WASM|$OLD_FLEET_WASM" || true
done | tee "$REPIN_EVIDENCE_DIR/old-identity-footprint.txt"
```

Classify every match as one of:

- active and must move now;
- historical and must remain, with explicit provenance/history context;
- unrelated data that happens to contain the bytes.

Do not blindly replace historical provenance. `release_policy_gate.py` has
previously treated historical hashes as stale, so it is not sufficient as the
sole classifier.

Then inspect all Phase M diffs from the last published source/host pair:

```sh
git -C "$KERNEL_ROOT" diff --stat "$OLD_SOURCE_REV..$KERNEL_REV"
git -C "$KERNEL_ROOT" diff "$OLD_SOURCE_REV..$KERNEL_REV" -- \
  '*.lean' '*.json' '*.py' '*.js' '*.c' '*.h'
```

Identify every exact-byte fixture, signature, approval target, receipt,
golden output, and schema vector affected by the new shapes. The classification
is **PROPOSED** because no checked-in dependency graph maps Phase M source
fields to all signed artifacts. Confirmation required: a checked-in generator
or completeness test. Until then, two-person review of this classification is
a stop condition.

### 8. Obtain independent review of the frozen Phase M contract — EVIDENCED

Run the freeze gate before approving or refreezing any changed contract:

```sh
cd "$HOST_ROOT"
python3 scripts/contract_freeze_gate.py
```

Any `REVIEW` row is a stop, even when the contract diff is purely additive.
The gate hashes the contract view of the whole file; it intentionally does not
infer that additions are harmless. A human reviewer must inspect every
reported contract diff and update the corresponding digest in
`scripts/contract_freeze_gate.py` `REVIEWED_HASHES` by hand.

The Phase M review must specifically exclude **dual-accept**: staging a second
envelope shape must not create a host path that accepts both the old and Phase
M signed shapes under the unchanged domain tag. The reviewer must establish
that the pre-repin encoder remains the sole active shape until the coordinated
cutover, and that the cutover selects only the reviewed Phase M shape. A
compatibility path that admits both is a review failure, not a migration
convenience.

Only after that human review and hand edit, update the writable manifest and
rerun the ordinary gate:

```sh
cd "$HOST_ROOT"
python3 scripts/contract_freeze_gate.py --refreeze
python3 scripts/contract_freeze_gate.py
```

Expected final line:

```text
PASS  <current count> frozen V2.3 contract files match docs/effect-envelope-v23.freeze.json; independent review baseline and golden anchors agree
```

`--refreeze` is explicitly not a substitute for review: the script checks
`REVIEWED_HASHES` before writing the manifest and refuses to change that
independent baseline. Confirmation is the reviewed contract diff, the
reviewer's hand-updated baseline, an explicit dual-accept disposition, and the
green ordinary gate.

As measured on 2026-07-29 at host topic commit `207e21c`, now contained by
`main` merge `6700282635e2aec38d622314718bb12c38377590`, the gate reports
`rust/src/envelope_v23.rs` changing from reviewed digest `6374ef4e…` to
`15edd4a0…`; the default-branch diff is 165 insertions and zero deletions. The
same run also reports a changed `docs/EFFECT-ENVELOPE-V23.md`. This is
**EVIDENCED** by the gate output and Git diff, and neither additive shape nor
merged source status waives the review.

### 9. Prepare the receipt verifier and all six fleet copies — copy topology
EVIDENCED; cross-repository edit commands PROPOSED

Copy the already verified `NEW_WASM` into:

```text
seal-host/receipt-verifier/wasm/seal.wasm
seal-check/wasm/seal.wasm
seal-assurance-kit/kernel/wasm/seal.wasm
seal-verify-action/vendor/seal-assurance-kit/kernel/wasm/seal.wasm
seal-demo/public/wasm/seal.wasm
seal-live-demo/seal-gateway/wasm/seal.wasm
seal-live-demo/pwa/wasm/seal.wasm
```

The exact candidate copy commands are:

```sh
cp "$HOST_ROOT/wasm-spike/verified/seal.wasm" \
  "$HOST_ROOT/receipt-verifier/wasm/seal.wasm"
cp "$HOST_ROOT/wasm-spike/verified/seal.wasm" \
  "$CHECK_ROOT/wasm/seal.wasm"
cp "$HOST_ROOT/wasm-spike/verified/seal.wasm" \
  "$KIT_ROOT/kernel/wasm/seal.wasm"
cp "$HOST_ROOT/wasm-spike/verified/seal.wasm" \
  "$ACTION_ROOT/vendor/seal-assurance-kit/kernel/wasm/seal.wasm"
cp "$HOST_ROOT/wasm-spike/verified/seal.wasm" \
  "$DEMO_ROOT/public/wasm/seal.wasm"
cp "$HOST_ROOT/wasm-spike/verified/seal.wasm" \
  "$LIVE_ROOT/seal-gateway/wasm/seal.wasm"
cp "$HOST_ROOT/wasm-spike/verified/seal.wasm" \
  "$LIVE_ROOT/pwa/wasm/seal.wasm"
```

Then update the applicable receipt constants, fixtures, bundles, signatures,
and docs found in step 7. The locations are EVIDENCED by
`release/fleet-lock.json` and past fleet commits; the repository has no
orchestrator for these copies, so the copying and dependent edits are
**PROPOSED**. Confirmation required: a checked-in fleet-staging script that
hash-checks every destination and runs each downstream suite.

Before running any suite:

```sh
sha256sum \
  "$HOST_ROOT/receipt-verifier/wasm/seal.wasm" \
  "$CHECK_ROOT/wasm/seal.wasm" \
  "$KIT_ROOT/kernel/wasm/seal.wasm" \
  "$ACTION_ROOT/vendor/seal-assurance-kit/kernel/wasm/seal.wasm" \
  "$DEMO_ROOT/public/wasm/seal.wasm" \
  "$LIVE_ROOT/seal-gateway/wasm/seal.wasm" \
  "$LIVE_ROOT/pwa/wasm/seal.wasm"
```

Expected: seven rows, each beginning with exactly `NEW_WASM`.

Do not update only the claimed hash. The stale `seal-check` incident emitted
`kernelShaMatch:false` because its shipped wasm did not match the current
kernel. The July 21 Golden Path failure likewise printed different local and
claimed prefixes.

### 10. Commit candidate branches and construct the candidate fleet lock —
commit topology EVIDENCED; exact staging order PROPOSED

Create reviewed commits in all changed downstream repositories. Do not merge
them to their default branches yet. Update the candidate
`release/fleet-lock.json` with:

- `kernel_sha256 = NEW_WASM`;
- the exact full commit for each of the five downstream repositories;
- the existing six wasm paths, unless an intentional reviewed topology change
  added another path.

Update the Golden Path assurance-kit checkout ref and all seven
`PHASE_B_KIT_REV` sites to the exact new Golden Path kit commit. That commit
may differ from the assurance-kit commit in the fleet lock, as it does in the
current baseline, but both must contain `NEW_WASM`. Update pin history and
provenance with the fleet-lock assurance-kit commit and `NEW_WASM`. Update
the separate fleet and Golden Path kit constants in
`test/test_rebased_pin_baseline.py`. Mirror every history pair in both
`verified/PROVENANCE.txt` and `demo/golden_path_filesystem.py`, as required by
`test/test_provenance_history.py`.

Past repins establish that these items must agree, but there is no atomic
cross-repository transaction or checked-in staging command. This step is
**PROPOSED**. Confirmation required: an orchestration script or a recorded
clean-runner rehearsal against remotely reachable candidate commits.

Verify all candidate commits are exact and locally reachable:

```sh
python3 "$HOST_ROOT/scripts/fleet_release_gate.py" --validate-lock
node "$HOST_ROOT/scripts/kernel_hash_footprint.mjs" --write \
  "--repo-root=seal-check=$CHECK_ROOT" \
  "--repo-root=seal-assurance-kit=$KIT_ROOT" \
  "--repo-root=seal-verify-action=$ACTION_ROOT" \
  "--repo-root=seal-demo=$DEMO_ROOT" \
  "--repo-root=seal-live-demo=$LIVE_ROOT"
node "$HOST_ROOT/scripts/kernel_hash_footprint.mjs" --check \
  "--repo-root=seal-check=$CHECK_ROOT" \
  "--repo-root=seal-assurance-kit=$KIT_ROOT" \
  "--repo-root=seal-verify-action=$ACTION_ROOT" \
  "--repo-root=seal-demo=$DEMO_ROOT" \
  "--repo-root=seal-live-demo=$LIVE_ROOT"
python3 "$HOST_ROOT/test/test_rebased_pin_baseline.py" -v
python3 - <<'PY'
import hashlib, json, pathlib
root = pathlib.Path(__import__("os").environ["HOST_ROOT"])
fleet = json.loads((root / "release/fleet-lock.json").read_text())["kernel_sha256"]
local = hashlib.sha256((root / "wasm-spike/verified/seal.wasm").read_bytes()).hexdigest()
assert fleet == local, (fleet, local)
print(f"PIN STATE: fleet={fleet} local={local}: fleet and local pins agree")
PY
```

Expected:

```text
PASS fleet lock validation: <absolute path>/release/fleet-lock.json
PASS kernel hash footprint: <current repo count> repos, <current occurrence count> occurrences
PIN STATE: fleet=<full new hash> local=<full new hash>: fleet and local pins agree
```

Review the generated footprint diff. A falling occurrence count is not
automatically an improvement; it may mean a pin surface disappeared.

### 11. Run the integrated host and downstream evidence — EVIDENCED

With the candidate repositories as siblings:

```sh
cd "$HOST_ROOT"
scripts/evidence.sh
```

Expected terminal line:

```text
EVIDENCE: PASS
```

The script builds source axioms, host Lean and native FFI, Rust tests and
release binaries, wasm conformance, `seal-check`, and `seal-assurance-kit`.
Re-check `.lake/packages/mcp-seal` immediately afterward:

```sh
test "$(git -C "$HOST_ROOT/.lake/packages/mcp-seal" rev-parse HEAD)" = "$KERNEL_REV"
printf '%s\n' "PASS evidence used selected kernel"
```

Expected:

```text
PASS evidence used selected kernel
```

Also run the locked fleet gate from a parent directory containing the
candidate repositories:

```sh
SEAL_FLEET_LOCAL_ROOT=$(dirname "$HOST_ROOT") \
  python3 "$HOST_ROOT/scripts/fleet_release_gate.py"
```

Expected final line:

```text
PASS locked fleet release gate
```

That gate checks out the commits in the candidate lock, verifies all six
wasm copies, and runs their recorded suites. It will fail if the lock names an
uncommitted or wrong commit.

### 12. Obtain green clean-runner evidence for every candidate — requirement
EVIDENCED; query procedure PROPOSED

Push candidate branches without merging them, then require green CI at the
exact commits for:

- `mcp-seal-dev`;
- `seal-host`, including Golden Path, pin gate, footprint gate, contract
  freeze, conformance, release evidence, audit, and SBOM jobs;
- all five fleet repositories.

The 2026-07-20 ruling and July 21 revert establish that local green is not a
substitute for the clean runner. The exact branch-push and CI-query procedure
is **PROPOSED** because no checked-in release controller binds all eight
commit statuses. Confirmation required: a machine-readable manifest of exact
commits and successful required checks, produced by a checked-in verifier.

In particular, the independent wasm mint must reproduce `NEW_WASM` and the
selected loader hash. A clean runner that merely tests the committed wasm is
not reproduction evidence.

### 13. Approve and stage replay-namespace transition — hazard EVIDENCED;
remedy RULED; procedure UNDESIGNED

Do not publish the host cutover until the replay-state transition has an
approved executable procedure. M.4 stage 2 changed
`SealV2.serializeTargetKey` from NUL-intercalated fields to
`Seal.encodeParts Target.keyParts` and added the two MRTR presence/value
parts.

**Correction, 2026-07-29 — the preceding runbook version described the wrong
live store.** It said that a live consumed nonce was persisted under
`replayNamespace` / the serialized target key and could therefore look fresh
after the target-key reshape. That is the Lean kernel model:
`mcp-seal-dev/SealV2/Validation.lean:281-299` gives `ConsumedNonce` an `ns :
ReplayNamespace`, `:564-573,633-637` puts `serializeTargetKey target` in that
namespace, and `:777-782` defines `listReplayStore` as an in-memory reference
store. `mcp-seal-dev/ASSURANCE_CASE.md:38` likewise describes that
`listReplayStore` path as in-memory.

It is **not** the shipped SQLite schema. The host creates
`nonces(nonce TEXT PRIMARY KEY, issued_at INTEGER, expiry_at INTEGER)` at
`seal-host/rust/src/replay_store.rs:72-76` and burns through
`insert_returning_is_new` at `:103-115` by nonce string alone. It persists no
target, replay namespace, namespace-encoding version, schema version, or
target preimage. Therefore the same nonce string remains burned across a
`serializeTargetKey` reshape; the reshape does not by itself make that nonce
fresh in the shipped store.

The shipped hazard is instead that there is no persisted preimage from which
a new target key can be recomputed and no version marker on which a candidate
make an upgrade decision. **Option B, recompute under the new target key, is
REJECTED AS NOT WELL-DEFINED.** This is a verified fact, not a preference: the
shipped store retains no target preimage to re-key from, as shown by
`seal-host/rust/src/replay_store.rs:72-76` and `:103-115`. This correction does
not establish a safe cutover and removes none of the confirmations below.

**Council record:** Council `db8f1180-92ae-48a5-aafe-53c86c4f17d5`,
2026-07-29, closed PARTIAL, topology harmonic, parse rate 0.5. Codex
(`gpt-5.6-sol`, confidence 0.88) and Grok (`grok-4.5`, confidence 0.86) both
selected C independently from checked source. Gemini completed with no
structured verdict parsed. Claude timed out as a straggler. Accepted by Ben
2026-07-29 11:57.

**RULED, Ben 2026-07-29 11:57: option C, refuse startup on a stale or
format-mismatched replay store.** This ruling is on the design. It is not
implementation evidence and it is not an executable procedure. Rotation
(Option A) is not the default cutover: it survives only as an explicit operator
act performed after the refusal gate, never as automatic boot-time acceptance
of a foreign encoding.

**Ruled critical-path prerequisite:** before the repin, first ship a guard
release that retains the old codec and creates and checks `schema_version`,
`namespace_encoding_version`, and `ledger_generation` against authority-signed
configuration. A store-minted generation is not a trust anchor. Candidate-only
startup refusal cannot control an older unguarded binary that ignores the
markers, so the guard release ships before the candidate repin. Once guarded
store state is activated, rollback to any unguarded binary is forbidden; only
roll-forward is safe.

The remedy and its guard-release prerequisite are **RULED DESIGN, NOT
IMPLEMENTATION EVIDENCE OR PROCEDURE**. No checked-in rotation, migration,
drain, or mixed-version deployment procedure has been designed or exercised,
so this runbook does not invent commands for one.
Confirmation required before publication is:

1. a reviewed, checked-in procedure that names the persisted replay-store
   schema and chooses rotation, migration, or a safe drain explicitly;
2. an automated upgrade test that consumes a nonce for an MRTR-absent request
   under the exact pre-change host, preserves that live replay state, starts
   the exact candidate host, and proves the same logical request, public key,
   session, policy version, and nonce is still rejected as consumed;
3. mixed-version, interrupted-cutover, and rollback tests proving that no
   ordering window reopens a live consumed nonce; and
4. a positive control proving a genuinely distinct MRTR value receives its
   intended distinct new namespace.

**Named anti-pattern — REFUSAL-ONLY FALSE GREEN.** “candidate refuses a v1
store” passes even if the candidate refuses every request. That result alone
is not transition evidence and cannot satisfy the confirmations above; the
eventual upgrade evidence must include a non-vacuity control that distinguishes
the intended stale-store refusal from an always-refuse candidate. The exact
procedure remains undesigned.

Record the reviewed procedure, exact old and candidate commits, replay-store
fixture, and green test logs in `REPIN_EVIDENCE_DIR`. Until all four
confirmations exist, stop here.

### 14. Publish once — policy EVIDENCED; cross-repository order PROPOSED

Only after steps 1–13 are green:

1. freeze the exact candidate commit ledger;
2. make the selected kernel source commit reachable on its authoritative
   default branch;
3. publish the verifier/downstream commits and the host repin as one
   coordinated maintenance action;
4. merge the fleet lock only when every commit it names is remotely
   reachable;
5. run the locked fleet gate again from remote state;
6. require default-branch CI green everywhere.

Do not mint or select a second kernel/wasm pair to fix publication mistakes.
Revert the coherent repin if necessary, repair the staging process, and
re-land the same reviewed pair.

The “green before repin; pin dance once” policy is EVIDENCED by the
2026-07-20 maintainer ruling and the July 21 revert/re-land. The precise
multi-repository merge order above is **PROPOSED**. Repository history has no
atomic publication mechanism, and any sequential order creates a transient
old/new verification window. Confirmation required: a tested release
controller or an explicitly approved maintenance-window protocol with a
measured compatibility result for both directions.

### 15. Verify published state — EVIDENCED

From fresh clones of the default branches, run:

```sh
cd <fresh-seal-host-clone>
node scripts/pins_gate.mjs --check
python3 scripts/fleet_release_gate.py --validate-lock
node scripts/kernel_hash_footprint.mjs --check
python3 test/test_rebased_pin_baseline.py -v
python3 - <<'PY'
import hashlib, json, pathlib
fleet = json.loads(pathlib.Path("release/fleet-lock.json").read_text())["kernel_sha256"]
local = hashlib.sha256(pathlib.Path("wasm-spike/verified/seal.wasm").read_bytes()).hexdigest()
assert fleet == local, (fleet, local)
print(f"PIN STATE: fleet={fleet} local={local}: fleet and local pins agree")
PY
python3 scripts/fleet_release_gate.py
scripts/evidence.sh
```

Expected terminal results:

```text
PINS GATE PASS (<current row count> rows, <current SPEC-ONLY count> SPEC-ONLY names)
PASS fleet lock validation: <absolute path>/release/fleet-lock.json
PASS kernel hash footprint: <current repo count> repos, <current occurrence count> occurrences
PIN STATE: fleet=<full new hash> local=<full new hash>: fleet and local pins agree
PASS locked fleet release gate
EVIDENCE: PASS
```

Archive the commit ledger, hashes, CI run URLs, build logs, footprint diff,
and old-identity classification. The historical repository has reports, but
no checked-in command for this archive; archiving is **PROPOSED** until the
release controller writes it deterministically.

## Failure modes and recovery

### A source pin resolves locally but not remotely

**Historical evidence:** `a8acb89aedc6101f6d6e616994ebd430a6121cbf`
recorded that the selected `mcp-seal-dev` commit was local-only and a fresh
machine could not resolve it.

**Symptom:** `lake update`, clean CI, or the isolated fetch in precondition 4
fails even though the operator's kernel checkout contains the object.

**Recovery:** stop before artifact minting. Publish and review the source
through the normal kernel workflow, select its final immutable commit, rerun
all preconditions, and still perform only one repin. Do not pin an unpublished
object.

### The checked-in wasm is not the fleet wasm

**Historical evidence:** `e887626e5f6ae90a390a8707b967385c94520813`
found `a6a73fa5…` in `wasm-spike/verified`; that artifact had never been the
fleet pin, so differential CI had been testing a non-fleet binary.

**Symptom:** local conformance is green but `test_rebased_pin_baseline.py`,
the fleet lock, or downstream hashes identify a different binary.

**Recovery:** stop and decide explicitly whether the artifact is
“local ahead, publish pending” or the published fleet identity. Never call
local conformance fleet evidence. Step 10 must pass against the lock before
publication.

### Stale wasm fails open relative to the current native/model pair

**Historical evidence:** `457850c691c7e059247de037730d4d6369a67a53`
found a pathological exponent that native/model rejected while stale wasm
passed through. The July 24–26 raw-wire work found the same class: rebuilt
native/model rejected guard-target inputs while old artifacts accepted them;
the measured lane had 37 of 39 divergences.

**Symptom:** three-way conformance reports wasm `ALLOW` or passthrough while
native/model block, or the rebuilt `.so` differs from the old `.so`.

**Recovery:** discard the candidate wasm and rebuild native and wasm from the
verified resolved checkout. Add the failing input to the corpus. Do not
change expected output to accept the old artifact.

### `seal-check` ships a bundle for yesterday's kernel

**Historical evidence:** the Gate 0A incident shipped stale
`ebd17c14…`; the current kernel rejected its tool mode and verification
reported `"kernelShaMatch":false`. The repaired `seal-check` commit was
`400079cb5ac5d86908095a6f0d26a4ba2d7b0d01`.

**Symptom:** receipt verification contains
`"kernelShaMatch":false`, or `seal-check` rejects a mode accepted by the
current source/native host.

**Recovery:** stop publication. Put the exact verified wasm in
`seal-check/wasm/seal.wasm`, regenerate dependent receipts/signatures, run
its receipt-format, receipt-harness, and cross-receipt tests, then rerun the
locked fleet gate. Do not edit only the claimed kernel hash.

### Golden Path verifies a new receipt with an old assurance kit

**Historical evidence:** the July 21 first landing at
`23f92d86bd22f16f43bb58db4b39b5bf6cb0ceef` failed:

```text
FAIL  kernel binary matches receipt   (local a37901811df4 / claimed d7d81e277ba0)
```

The repin was reverted by
`2a97b84d0f2a06140bfe4ded6b9f45c6036e6ca5`, reapplied by
`a83168232b6a671703d3b665b30af4aff852a742`, and the assurance-kit,
workflow/demo refs, pin history, and provenance were moved by
`ffc485130b5d8f8c1bf0c26100fee521f5151b45` before the coordinated
re-land `5b1a8f1a3ff617d4d0ed15b3607876562dc5ed7d`.

**Symptom:** Golden Path prints differing local and claimed prefixes, or its
assurance-kit checkout differs from the kit commit in fleet history.

**Recovery:** before merge, repair the candidate kit, all seven demo refs,
the workflow ref, fleet lock, pin history, and provenance as a single
candidate and rerun clean CI. If default-branch main is red, use the proven
single-merge revert boundary described under Abort; do not perform a second
repin.

### The fleet lock claims a fleet that does not exist

**Historical evidence:** on July 23 the lock claimed `d7d81e27…` while four
of five repositories still served `a3790181…`. Commit
`c6c3cc679199c1350a56956af537e15c3f52b1ec` later repaired the downstream
commit set. Commit `6bb14dfa95869773c296d43dea2018ebedb38347`
also incorrectly advanced the fleet lock to an unpublished local artifact;
it was superseded, and
`f247c049d7b864e9301704613f5640c2a2b43a4c` preserved the local/fleet split.

**Symptom:** lock validation or the full fleet gate finds a wrong hash,
unreachable commit, or mismatched downstream path.

**Recovery:** do not make the lock “true” by weakening the gate. Before
merge, point it only at exact tested candidate commits. After publication
starts, stop and follow the abort rules; cross-fleet rollback is untested.

### An ignored source tree carries an unrecorded local modification

**Hazard status: EVIDENCED; byte-effect diagnosis: PROPOSED.**

**Historical evidence:** `build_runtime_wasm.sh` compiles every
`lean4-src/src/runtime/*.cpp`, including `interrupt.cpp`, into the runtime
archive consumed by the final link. Commit
`e996e437bf50e1570c7006b0b4c9be59833ca5ea` records that the Lean v4.28.0
tree used for the checked-in build was not pristine: it changed
`std::uncaught_exception()` to `std::uncaught_exceptions()` in
`src/runtime/interrupt.cpp`. The exact checked-in patch has SHA-256
`e79761006e0e7d9e7cd4024b038a7182cf1c56a31dd8dc4672892a7ec24b4d8a`.

The July 26 history contains two sibling mints from host parent
`4b0845e5d16ba058ef5b3503ffac334a144d8541`, both pinned to
`mcp-seal-dev` `6c74b61382f8b7057cfb332a44a45e9e1b04e2b4`.
Commit `6bb14dfa95869773c296d43dea2018ebedb38347` recorded
`5c9dab764007e48685c4784a8cdeac377fb30535d55ad4e07854c74554d4d24e`
(5,701,288 bytes); its follow-up
`b92aed329e7c7376d837d2f310e736feadea2b2e` remains on
`fix/wasm-repin-wire-guards`. Later,
`f247c049d7b864e9301704613f5640c2a2b43a4c` recorded
`70bee4b9ce4bed005429cb62515d6de7c61cb151a16b28c680399534d187cabf`
(5,701,292 bytes), and merge
`bc692053155d58f448fd4468552c349e38b5c865` carried that artifact to
`main`.

Neither mint commit, the abandoned branch follow-up, nor the merge named the
`interrupt.cpp` modification. The first checked-in mention is `e996e43`.
The later record implicates the patch as an input to the current artifact, but
does not show that the patch caused the four-byte difference. The sibling
records also differ in their account of empty object directories, the closure
script changed between the two mint commits, and there is no immutable
historical toolchain snapshot or build log for both runs. Until controlled
evidence exists, the difference is unexplained.

**Symptom:** a provisioner or clean runner reports a source diff not named in
provenance, or nominally identical source pins produce a different wasm hash
or size.

**Recovery:** abort the repin. Preserve the complete source diff, object-state
inventory, toolchain identity, logs, and artifacts. Reproduce the historical
recipes on clean runners, then perform a patched-versus-pristine A/B mint with
every other input fixed. That diagnosis is **PROPOSED** until recorded; do not
attribute the byte change to the patch or select either artifact without it.

### Same claimed source produces a different wasm

**Historical evidence:** `cdb9447e445070a900d5851608e524a13cbfd717`
committed `0d3536e5…` claiming source `1d35669…`; clean rebuild commit
`188d9185d9c1ec112d4225e72849996027b8019d` produced `3d70637f…` from
the same claimed source. `PROVENANCE.txt` says whether the first was stale or
the build is nondeterministic remains unresolved.

**Symptom:** the second local link or independent clean runner produces a
different wasm or loader hash from the first.

**Recovery:** abort. Preserve both logs and artifacts for diagnosis. Do not
select whichever hash makes existing tests green. There is no evidenced
recovery beyond obtaining a reproducible mint.

### A factual pin ledger or consistency assertion lags the pin

**Historical evidence:** source commit
`7f9e111f3aa4fbe04cfd989d5c99e40385e7e892` landed on July 26; the
`PINS.md` row followed in
`d572ee6b101da81dade115fb24827805c9b964b4`. A stale
`SOURCE_KIT_REV` assertion survived until the consistency gate was wired by
`769ec581127d5b186e6ca7c1eef1a5cd8f53504e`. The current 2026-07-29
PINS gate is red on another factual row.

**Symptom:** `pins_gate`, `test_rebased_pin_baseline.py`, or the footprint
gate identifies an old source, kit, or semantic claim.

**Recovery:** abort the repin until the factual defect is repaired and green
independently. A correct check that is not invoked in CI is not a gate.

### A build silently reuses a stale native object or package checkout

**Historical evidence:** `TEST-BASELINE.md` records a four-day-stale
`libsealffi.so` after the Unicode/module closure stopped linking.
`scripts/evidence.sh` updates Lake only if its package directory is absent.

**Symptom:** resolved checkout differs from `KERNEL_REV`, build output is
older than source, missing modules appear only on a clean runner, or rebuilt
native behavior changes while an old binary had remained green.

**Recovery:** stop at the failing layer. Repair the checked-in closure/build
logic, verify the resolved checkout, rebuild that layer, and repeat every
later step. Do not delete a generated artifact merely to make a test skip.

## Abort procedure

### Before any default-branch merge

1. Stop at the first failed verification.
2. Do not update later artifacts, the fleet lock, or claimed hash.
3. Preserve the candidate branches, captured hashes, logs, and the first
   failing input.
4. Return every repository used for ordinary work to its unchanged
   default-branch commit; do not merge or push the candidate as a release.
5. Diagnose on the candidate branch. Restart from the last verified step only
   if the failed layer and all derived later artifacts are rebuilt.

Using dedicated branches/worktrees and leaving failed candidates intact is
**PROPOSED** operational hygiene; historical commits establish the need for a
coherent boundary but do not record a standard worktree command.

### After the host repin merge, before fleet-wide publication completes

The only executed rollback in the reconstructed record is the July 21
single-host-merge round trip:

```text
23f92d8  first repin merge
2a97b84  revert that merge
a831682  reapply the same repin
ffc4851  move assurance-kit/workflow/history surfaces
5b1a8f1  coordinated re-land
```

If the same shape recurs and main is red, revert the whole repin merge before
fix-forward. The likely Git command is:

```sh
git revert -m 1 <repin-merge-commit>
```

That exact command is **PROPOSED**: the history proves the resulting revert
commit but does not record the invocation or mainline argument. Confirm it by
reviewing the candidate revert diff and showing that it restores the exact
pre-repin source, local wasm, receipt wasm, constants, lock, history, and
workflow/demo refs before merging the revert.

**Rollback outside this July 21 single-merge shape is untested in this
repository history.**

### After downstream default branches move

Stop publication and announce the precise mixed state. Run the hash/commit
ledger against every repository. Do not rewrite the fleet lock to describe a
fleet that has not been tested.

**Cross-repository rollback after downstream publication is untested.** No
history establishes a safe inverse order, and old/new verifier compatibility
may be asymmetric. Require a maintainer decision based on the measured mixed
state. The available evidenced choices are only:

- restore the last fully coherent published fleet through reviewed commits
  and the full locked-fleet gate; or
- complete publication of the already reviewed, reproducible candidate.

Neither choice authorizes minting a second kernel artifact. A second artifact
is a second repin.

## Historical reconstruction

The source pin sequence was reconstructed with `git log -S` over
`lakefile.toml` and `lake-manifest.json`; the wasm sequence came from
`git log --follow -- wasm-spike/verified/seal.wasm`,
`receipt-verifier/wasm/seal.wasm`, commit diffs, and
`verified/PROVENANCE.txt`.

### `PINS.md` row audit

`PINS.md` was introduced only on 2026-07-24 (identical originating commits
`f52964f8af71622cd5f5e5f2e6b7dcf78ba74ad2` and
`4cd92b2071f2f0b892efd0b40b645433fd22fa2c`). It therefore cannot provide
contemporaneous row history for earlier repins. Its complete later movement is:

| Current row | When it moved and why |
|---|---|
| `issuedAt` / `expiresAt` epoch and unit | Introduced as `PINNED`; never edited. On 2026-07-29 the source-backed gate says that claim is false because only Unix-epoch milliseconds is live. |
| `effectMessage` 10-field `seal.effect/v2` envelope | Introduced incorrectly as an 18-field tuple; corrected by `0b8f54a07138233d58d2cbf2c923799d7558bf66` after parsing the pinned kernel source. |
| duplicate object keys on the raw wire | Introduced as `PINNED`; ledger text never moved. The underlying guard arrived with the raw-wire source repin `bf3bbf34657fd9bd865f94746a0dfa1ce836ee34`. |
| significant-digit bound | Introduced as `PINNED`; ledger text never moved. The source pin later advanced for numeric agreement in `7f9e111f3aa4fbe04cfd989d5c99e40385e7e892`. |
| pathological exponent guard | Introduced as `PINNED`; ledger text never moved. The underlying fail-closed repin was `457850c691c7e059247de037730d4d6369a67a53`. |
| `ledgerGeneration` information-flow class | Introduced as `PINNED`; never edited. No repin-specific row movement is recorded. |
| Lean `seal_host_classify` integer encoding | Introduced as `UNPINNED`; moved to `PINNED-BY-TEST` by `448c3d0cb178382a4e609bcce5885201246a8f56` after adding three build-gated real-input guards. |
| Rust `route_of_classify` mapping | Introduced as `PINNED-BY-TEST`; never edited. |
| Lean panic default on the classify seam | Introduced as `PINNED`; never edited. |
| canonical-equivalent duplicate keys | Introduced as `PINNED`; never edited. |
| `effect_message` Rust/Lean byte twin | Introduced as `FROZEN-EXPECTATION`; activated as `PINNED-BY-TEST` by `7b901336beb4e25b7896e788ffd308c2ca8942a1`; its named source pin was then updated by `80584d489a078af27fa00678c27d5f05e354bdcf` and, late, by `d572ee6b101da81dade115fb24827805c9b964b4`. |
| trim versus forwarded bytes | Introduced as `CHARACTERISED`; never edited. |
| Rust/`sealAdapter` byte-level refinement | Introduced as `TCB`; never edited. |
| classify-passthrough path in the adapter model | Introduced as `TCB`; never edited. |
| nonce durable-consume versus decision ordering | Introduced as `CHARACTERISED`; never edited. |
| specification-only names | The complete group was introduced as `SPEC-ONLY`; no member has moved. If Phase M implements one, it must become its own row in the same repin. |

“Never edited” is not evidence that a row stayed true. Commits `0b8f54a`,
`d572ee6`, and the current red gate show that ledger lag is a recurring
failure mode. Every row must be revalidated after the source pin changes, even
when the textual row does not need a diff.

| Date | Host commit(s) | What moved; observed result |
|---|---|---|
| 2026-07-05 | `7917f99`, `b46e242` | Early source repins through `e36fc98…` and `872ac50…`; source pin pair moved. Detailed execution order and failures were not recoverable. |
| 2026-07-12 | `d4198c4` | Gate 0A source/native/receipt work. A stale `seal-check` bundle later exposed the cross-repository gap with `kernelShaMatch:false`; `seal-check` `400079cb5ac5d86908095a6f0d26a4ba2d7b0d01` repaired it. |
| 2026-07-15 | `e887626` | Request-commitment repin moved source and both wasm surfaces. It discovered conformance had used `a6a73fa5…`, a binary that had never been the fleet pin. |
| 2026-07-16 | `457850c` | Pathological-number repin moved source, native FFI, both host wasm copies, glue, constants, docs, and provenance. Three-way testing caught stale wasm fail-open. |
| 2026-07-17 | `0998cde` | Seven-kernel repin moved local host artifacts. Assurance-kit/Golden Path pins were deliberately left as follow-up, demonstrating the later failure boundary. |
| 2026-07-19 | `a8acb89` | Codec source was pinned before it was remotely resolvable; fresh machines could not fetch it. |
| 2026-07-19 | `cdb9447`, `188d918`, `49e601a` | Principal and V2.2 builds. A clean build changed `0d3536e5…` to `3d70637f…` for the same claimed source; cause remains unresolved. |
| 2026-07-21 | `df6684d`, `4c6684e`, `23f92d8` | Source, then wasm/identity surfaces, then merge. Golden Path detected stale assurance-kit pin by local/claimed hash mismatch. |
| 2026-07-21 | `2a97b84`, `a831682`, `ffc4851`, `5b1a8f1` | Whole repin reverted, the same pair reapplied, kit/workflow/demo/history surfaces moved, and clean re-land succeeded. This is the recorded round trip. |
| 2026-07-24–26 | `bf3bbf3`, `6bb14df`, `b92aed3`, `f247c04`, `c6c3cc6` | Raw-wire source repin exposed stale native/wasm behavior. Two candidate publication commits were superseded; the accepted local conformance pin preserved the fleet/local split, then the published `d7d81e27…` fleet was repaired. |
| 2026-07-26–28 | `7f9e111`, `d572ee6`, `769ec58`, `6be71cb` | Numeric source pin landed before its PINS row and a consistency assertion stayed stale until the checks were wired and credentialed in CI. |

The record does not reveal a complete command transcript for any historical
repin, a clean bootstrap for the wasm toolchain, an atomic multi-repository
publish procedure, or a tested cross-fleet rollback. Those gaps are preserved
as **PROPOSED** steps above rather than filled from memory.
