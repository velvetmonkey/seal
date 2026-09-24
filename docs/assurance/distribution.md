# Distribution (roadmap 3D)

Seal v0.5.1.
Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.
Windows, Linux ARM and other platforms are not supported.
It ships **three** installable artifacts, for **Linux x86-64**, **macOS x64**, and **macOS arm64**.

## The artifacts

`scripts/build-dist.cjs` writes one of the three installable artifacts per
run, `dist/seal-v<identity>-<platform>`, for `linux-x64` (the default) or, via
`--platform`, `darwin-x64` or `darwin-arm64`; a Darwin build also needs the
matching release runner's `--macos-helper`. The identity is the bare
`<version>` only when HEAD is exactly tag `v<version>` and otherwise
`<version>-dev.g<commit>` — see [VERSION-IDENTITY.md](version-identity.md).
Each file is the installer and the payload. The published pins live in the
`SHA256SUMS` release asset alongside the artifacts (digest and byte length). The repository
root intentionally has no hand-maintained copy. `test/dist-pin.test.cjs`
refuses a root entry for an artifact that is not a published release, while
an absent or empty root file is the defined between-releases state.

There is no signing-key ceremony. Download the binary and the `SHA256SUMS`
asset attached to the same release, independently compare their bytes with the
published pins, then supply `--sha256` and `--bytes` to the installer. The
installer's self-check is additional to the shell gate below.

## Install

Copy the whole POSIX command, including its backslashes and `&&` operators.
A failed comparison skips both `chmod` and execution.

```bash
SEAL_VERSION=v0.5.1
artifact_name="seal-v0.5.1-linux-x64" \
&& artifact_sha256="f69b97677b131ff2df26d4a8af04ddf1f6d511c86445d83d44b98d9365361b78" \
&& artifact_bytes=6363710 \
&& sums_name="SHA256SUMS" \
&& sums_sha256="ca8660caf11faccb149a4e5e685181fbf90d902eaa65420b003cd2042d663008" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$sums_name" \
&& curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/$artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then sums_actual="$(shasum -a 256 "$sums_name")"; else sums_actual="$(sha256sum "$sums_name")"; fi \
&& test "${sums_actual%% *}" = "$sums_sha256" \
&& expected_record="$(awk -v name="$artifact_name" '$3 == name { print $1, $2, $3 }' "$sums_name")" \
&& test "$expected_record" = "$artifact_sha256 $artifact_bytes $artifact_name" \
&& if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$artifact_name")"; else actual_digest="$(sha256sum "$artifact_name")"; fi \
&& test "${actual_digest%% *}" = "$artifact_sha256" \
&& actual_bytes="$(wc -c < "$artifact_name")" \
&& test "$actual_bytes" -eq "$artifact_bytes" \
&& chmod +x "$artifact_name" \
&& ./"$artifact_name" --sha256 "$artifact_sha256" --bytes "$artifact_bytes" --prefix ~/.local
```

On any other platform the installer prints `UNSUPPORTED PLATFORM` and
changes no files.

## After install

`prefix/bin/seal` is a launcher. It re-hashes `prefix/lib/seal/store/<tree>/`
against `prefix/lib/seal/install.json` before it executes anything from
the store. A later write that changes a stored byte is a named refusal
(`artifact_digest_mismatch`). Replacing the launcher itself is equivalent
to not running this install; that case needs an operator-pinned key, which
this release does not mint.

`--version` prints the `VERSION` file from the installed tree. It must
equal the version in the artifact name and in the install record.

The payload is the current product: `bin/seal`, the mediation and
receipt components (including the receipt-sealing module used by both
the demo and protected paths), and the approval contract.
It also includes the pinned vendored kernel and the fail-closed Node adapter
that invokes it. The state machine is
TESTED. The adapter uses an in-worker generated Ed25519 key to sign the config
accepted by `seal_init`; this is demo-grade self-authorization, not a
production config-signing trust root. Corrupt or unpinned WASM refuses and has
no JavaScript authorization fallback. Each kernel worker invocation has a
30000ms product-enforced deadline and is killed if it exceeds that deadline; the
guarded call refuses as `kernel_execution_refused` and does not fall back to
Node authorization.
The current install payload includes `seal-receipt-v2.mjs`. Download the sibling
[`seal-receipt-v2.mjs` release asset](https://github.com/velvetmonkey/seal/releases/download/v0.5.1/seal-receipt-v2.mjs)
to verify its digest against the `SHA256SUMS` asset attached to that same release.
The sibling is not standalone: it imports the kernel decision runner from the
Seal tree. Run `node checker/seal-receipt-v2.mjs RECEIPT` from the installed
store at `prefix/lib/seal/store/<tree>/`; the checker is at
`checker/seal-receipt-v2.mjs` within that tree. Its presence establishes neither
authority nor event occurrence.
The launcher never searches `PATH` for another `seal`.
The checker implements receipt canonicalisation and signature checking itself
with the same Node crypto platform as the producer, but imports Seal's kernel
decision runner for decision replay. It detects mutation of the receipt's canonical parsed value
under a trusted supplied key; semantically irrelevant JSON formatting
differences are not distinguished. It does not detect defects in those
shared implementation choices.

For `seal protect`, MCP discovery has a 30000ms deadline per phase by
default. Slow but legitimate servers can use
`seal protect --timeout-ms MILLISECONDS SERVER TOOL`; timeout refusals name
that flag, and the selected deadline is retained for the activation re-check.

## Release approval and recovery

Cut and push the release tag for the exact commit that passed default-branch CI.
The tag must match `VERSION`.
The Release workflow builds the three platform artifacts and creates a draft.
It then rebuilds the pinned kernel and verifies the downloaded draft on Linux
x64, macOS arm64, and macOS x64.
The `publish` job then waits for approval in the `release-publish` environment.
The owner account, `velvetmonkey`, reads all three `verify-draft` job logs.
The owner approves only after this review.
Only then does the job make the release public.
The `release-docs` job follows publication.

Open the waiting run from
[the Release workflow](https://github.com/velvetmonkey/seal/actions/workflows/release.yml).
Select **Review deployments**, select `release-publish`, then select
**Approve and deploy**.
To approve from the terminal, set `RUN_ID` to that run's numeric ID.
Run these commands as the owner after reading the evidence:

```bash
ENVIRONMENT_ID=$(gh api repos/velvetmonkey/seal/environments/release-publish --jq .id)
gh api --method POST "repos/velvetmonkey/seal/actions/runs/$RUN_ID/pending_deployments" \
  -F "environment_ids[]=$ENVIRONMENT_ID" \
  -f state=approved -f comment='Reviewed all three verify-draft jobs'
```

If `rebuild-kernel` fails after draft creation, select **Re-run failed jobs**.
The terminal command is `gh run rerun "$RUN_ID" --failed --repo velvetmonkey/seal`.
GitHub retries the failed job and its dependent jobs.
The successful `build-artifacts` and `release` jobs do not rerun.
The three `verify-draft` jobs run after the kernel rebuild succeeds.
Publication still requires approval.
Do not delete the draft or tag for this retry.

A full workflow retry also keeps the same tag.
The `release` job adopts an existing draft only if each existing asset has the
same SHA-256 digest as its local candidate.
It uploads only missing assets.
It refuses a different digest, an unreadable release state, or a published release.
The shell execution tests in `test/release-publish-gate.test.cjs` test these paths
with a local GitHub substitute.
They do not publish a release or test a live approval.

Previous: [Architecture](architecture.md).
Up: [Assurance](README.md).
Next: [Version identity](version-identity.md).
