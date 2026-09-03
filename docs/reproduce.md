# Seal reproduces post-import release kernels from their in-tree source builds

Run the release comparison on a Linux x86-64 machine with network access and at least 8 GiB free.
It requires Node 20 or newer, Git, Curl, Python 3, Bash, `awk`, `df`, `mv`, `sha256sum`, `stat`, a
system C compiler available as `cc`, and GNU `ld`. Install
[elan](https://lean-lang.org/install/) and ensure its `lake` executable is on `PATH`. The pinned
source recipe verifies and installs elan v4.2.3, selects the repository's
`leanprover/lean4:v4.28.0` toolchain, restores its Mathlib cache, and provisions the pinned
Emscripten 6.0.0 and patched Lean WASM source trees; those toolchain versions are not left to the
reader to choose.

The command requires a published GitHub release with its required assets and a checkout of that
exact tag. The tag tree must contain `kernel-source/`. Releases published before the kernel import
lack that directory and are no longer reproducible by this command. They refuse in plain words
instead of falling back to the former external repository.
The `seal reproduce` command refuses those pre-import tags rather than cloning an external source.

For a later release, check out the tag before running the comparison:

```bash
tag=vX.Y.Z
git checkout "$tag"
seal reproduce "$tag" --platform linux-x64
```

For a post-import published release with those assets and `kernel-source/`, the command checks only
`seal-<tag>-linux-x64`.
It downloads that artifact and `SHA256SUMS`, refuses before installation
when the declared byte count or SHA-256 does not match the downloaded asset, installs into a new
temporary prefix, and hashes the installed `runtime/kernel/wasm/seal.wasm`. Separately, it uses the
current checkout, builds `kernel-source/`, provisions the pinned toolchains, builds the Lean source
once through `lake`, runs the `kernel-reproduce` WASM recipe, and hashes that fresh output. It does
not clone or fetch kernel source. The two compared byte strings therefore come from the published
artifact and the checked-out source tree.

`lake` is the portable default. A machine that must serialize Lean builds can select an executable
launcher by name or path; the value is one executable, not a shell command with arguments:

```bash
SEAL_LEAN_LAUNCHER=/path/to/serializing-lake-wrapper \
  seal reproduce "$tag" --platform linux-x64
```

The launcher receives `update` or `build` as its argument. If neither `lake` nor the configured
launcher can be started, the script names the missing launcher and points to the elan installation
instead of reporting a bare spawn failure.

Standard output is one `seal.artifact-kernel-correspondence/v1` JSON object. Child-command progress and refusal
messages go to standard error. An `artifact-kernel-match` returns exit status 0; `artifact-kernel-mismatch` and `refused`
return nonzero. The asset object reports `name`, `declared_sha256`, `declared_bytes`,
`observed_sha256`, and `observed_bytes`. The top level also reports the published and rebuilt kernel
digests, selected `platform`, artifact-kernel `scope`, native-helper coverage, `result`, `authority`, and the claim limit.

`result` is `artifact-kernel-match`, `artifact-kernel-mismatch`, or `refused`. It does not collapse those outcomes into a
boolean or badge.

The native macOS helper is release-produced, not independently reproduced, and is not covered by this result. A `--platform darwin-arm64` or `--platform darwin-x64` question names that selected artifact and refuses before download; the tool never substitutes a Linux answer.

## Authority declaration

For a supported post-import release with the required assets, the default is `same-authority`:

```bash
seal reproduce "$tag" --platform linux-x64
```

An external rebuilder may make their execution context explicit:

```bash
seal reproduce "$tag" --platform linux-x64 \
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
