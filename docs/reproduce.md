# Compare a release kernel with a fresh pinned-source build

Run the release comparison from a Linux x86-64 machine with Node 20 or newer, Git, Curl, Python,
Emscripten prerequisites, and the repository's pinned Lean toolchain prerequisites available:

```bash
tag="v$(cat VERSION)"
node scripts/seal-reproduce.cjs "$tag" --platform linux-x64
```

The command checks only `seal-<tag>-linux-x64`. It downloads that artifact and `SHA256SUMS`, refuses before installation
when the declared byte count or SHA-256 does not match the downloaded asset, installs into a new
temporary prefix, and hashes the installed `runtime/kernel/wasm/seal.wasm`. Separately, it checks
out the release's pinned `seal-host` source commit, provisions the pinned toolchains, builds the
Lean source once through `/home/monkey/bin/leanbuild`, runs the `kernel-reproduce` WASM recipe, and
hashes that fresh output. The two compared byte strings therefore come from different origins.

Standard output is one `seal.artifact-kernel-correspondence/v1` JSON object. Child-command progress and refusal
messages go to standard error. An `artifact-kernel-match` returns exit status 0; `artifact-kernel-mismatch` and `refused`
return nonzero. The asset object reports `name`, `declared_sha256`, `declared_bytes`,
`observed_sha256`, and `observed_bytes`. The top level also reports the published and rebuilt kernel
digests, selected `platform`, artifact-kernel `scope`, native-helper coverage, `result`, `authority`, and the claim limit.

`result` is `artifact-kernel-match`, `artifact-kernel-mismatch`, or `refused`. It does not collapse those outcomes into a
boolean or badge.

The native macOS helper is release-produced, not independently reproduced, and is not covered by this result. A `--platform darwin-arm64` or `--platform darwin-x64` question names that selected artifact and refuses before download; the tool never substitutes a Linux answer.

## Authority declaration

The default is `same-authority`:

```bash
tag="v$(cat VERSION)"
node scripts/seal-reproduce.cjs "$tag" --platform linux-x64
```

An external rebuilder may make their execution context explicit:

```bash
tag="v$(cat VERSION)"
node scripts/seal-reproduce.cjs "$tag" --platform linux-x64 \
  --authority independent \
  --authority-name "Example Rebuild Lab"
```

The script does not infer who ran it. It reports `independent` only when both options are present;
requesting `independent` without a nonempty name refuses before any download. The caller is
responsible for the truth of that declaration.

The JSON always carries this limit:

> This result covers only the selected artifact's kernel bytes. It is not a proof that the rule is the right rule, and it does not establish independence when the rebuilder and the publisher are the same authority.

The comparison says nothing about whether the policy rule is desirable. A same-authority run also
does not supply the second authority required for an independent result.
