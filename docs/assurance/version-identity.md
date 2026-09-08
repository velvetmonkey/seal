# Version identity

`VERSION` was doing three jobs at once:

1. naming the **next intended release**,
2. identifying an **arbitrary development build**,
3. identifying **immutable published bytes**.

Jobs 2 and 3 are not the same job. While `v$VERSION` is unpublished, every
commit on `main` carrying that `VERSION` wears the name of bytes nobody has
released — for as long as the release takes. That is how a moving branch comes
to answer to an immutable name.

## The rule

```text
HEAD is exactly tag v$VERSION  ->  product identity = $VERSION
anything else                  ->  product identity = $VERSION-dev.g<short-commit>
```

`scripts/product-identity.cjs` implements it and prints it:

```bash
$ node scripts/product-identity.cjs     # seal $VERSION-dev.g<short-commit>
```

A tree that cannot read its own commit at all reports `$VERSION-dev.gunknown`.
It never falls back to the bare release form: a build that cannot prove it is
the release must not be able to claim it by default.

## Where the identity is carried

In the **filename**. Every artifact, published or not, is named by one grammar.
`scripts/product-identity.cjs` composes it (`artifactName`) and
`scripts/build-dist.cjs` writes the file under that name:

```text
seal-v<identity>-<platform>-<arch>

<identity>         $VERSION                       only when HEAD is exactly tag v$VERSION
                   $VERSION-dev.g<short-commit>   anything else
<platform>-<arch>  linux-x64 | darwin-x64 | darwin-arm64
```

Those three suffixes are the whole supported set: `scripts/build-dist.cjs`
refuses any other platform, using the set `spine/integrity.cjs` declares, and
`release.yml` builds and publishes exactly one artifact per suffix, so a release
carries three artifacts and its `SHA256SUMS` asset names all three. The product treats the suffix as one
platform token, so `darwin-arm64` is the platform, not `darwin` plus `arm64`.
For `darwin-arm64` the two legal shapes are:

```text
seal-v$VERSION-darwin-arm64                       built from the exact tag; this is the published name
seal-v$VERSION-dev.g<short-commit>-darwin-arm64   built from any other commit; never published
```

The bare `seal-v$VERSION-<platform>-<arch>` is legal only when built from the
exact tag, and that rule is the same on every platform. A name whose suffix is
not one of the three, or whose identity is neither shape, is not a seal
artifact name.

The identity is deliberately **not** carried in the payload bytes. This
repository pins each artifact's digest in the release's `SHA256SUMS` asset. A
digest that depended on the commit could never be pinned by a commit: writing
the pin would change the commit, which would change the digest, which would
need a new pin. So the payload is named by `VERSION` alone and stays
byte-identical across commits, and the pin means *the bytes `v$VERSION` will
publish*. For `linux-x64`, building at the tag reproduces exactly those bytes,
and `scripts/seal-reproduce.cjs` checks only that artifact. The two Darwin
payloads also carry the native process-start helper compiled on the release
runner; the release manifest records that helper as release-produced, not
independently reproduced, so the Darwin digests are pinned but their bytes are
not claimed reproducible from source.

The consequence, stated plainly: a tree installed from a development artifact
still reports the bare `$VERSION` from `seal --version`, and the installer
still prints `installed seal $VERSION <platform>-<arch>`, naming the
artifact's platform and never its commit (`scripts/install.cjs` prints the
payload manifest's `version` and `platform`). On this repository's Linux host,
the published `linux-x64` artifact's installer printed
`installed seal $VERSION linux-x64` and the installed command then printed the
bare `$VERSION`; a Darwin install prints the same lines with its own suffix.
The file it came from said `-dev.g<short-commit>`; the installed tree does not.
Closing that gap means putting the commit inside the payload, which the pin
forbids for the reason above.

## The three checks, and why they are three

| check | question | needs origin |
| --- | --- | --- |
| `scripts/check-version-identity.cjs` | does a *newly claimed* `v$VERSION` already identify a different commit? | yes |
| `scripts/check-artifact-identity.cjs` | does this `linux-x64` build wear the released name without being the release? | no |
| `release.yml` tag step | does the tag identify this exact commit? | no |

The first is the **collision gate**. It is the brake on reusing a published
version, and it reaches `origin` for release tags. Because it reaches the
network it runs **once**, in the dedicated `version-identity` job, not twice
inside the Node matrix: a tag-service outage should fail one job by name, not
redden two otherwise unrelated product suites. The product suites consume that
job's result via `needs:`.

The second is the **bare-version refusal**. It answers offline and it answers
before any tag exists, so it fires on the case the collision gate cannot see: a
version that has never been released, worn by an untagged build. It carries no
`needs:` precisely so a tag-service outage cannot silence it. It reads only the
`linux-x64` name: `check-artifact-identity.cjs` selects files ending
`-linux-x64` and never sees a Darwin name, so a Darwin artifact wearing the
bare name in an untagged tree passes it unexamined. `macos.yml` checks each
Darwin build's filename against the product identity at build time, which
holds `build-dist.cjs` to the grammar, but nothing refuses a Darwin artifact
renamed after it was built.

Publishing fails closed on both: `release.yml` runs the collision gate before
it builds, and the bare-version refusal after.

## Not wired: the post-release transition

After `v$VERSION` is published, `main` should stop naming it. The mechanical
form is small:

1. the release workflow finishes publishing the tag;
2. a branch is opened from the released commit with `VERSION` set to the next
   intended release and `scripts/sync-version.cjs` run; the release workflow
   will generate the artifact pin from the bytes it publishes;
3. that branch is proposed as a pull request against `main`.

Step 3 is a proposal, never a push. **This is written down and left unwired on
purpose.** Automation that moves `main` by itself is Ben's ruling to make, not
this repository's to assume; `main` is protected, so nothing here moves without
a reviewed pull request.

The collision gate does **not** stand in for this transition. It refuses a
*newly introduced* claim: a commit whose `VERSION` differs from the version at
every merge base with `origin/main`, naming a tag that already identifies a
different commit. `main` continuing to wear `v$VERSION` after that version is
published introduces nothing, so the gate reports `version identity inherited`
and exits 0. That is deliberate — the earlier reading refused every branch in
the repository for carrying a version it had merely inherited — but it means
the state this transition would end is a state the gate accepts. Until the
transition is wired, nothing mechanical retires a published version from `main`.

Previous: [Distribution](distribution.md).
Up: [Assurance](README.md).
Next: [Claude Code evidence](claude-code-evidence.md).
