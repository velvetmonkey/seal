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

```
HEAD is exactly tag v$VERSION  ->  product identity = $VERSION
anything else                  ->  product identity = $VERSION-dev.g<short-commit>
```

`scripts/product-identity.cjs` implements it and prints it:

```sh
node scripts/product-identity.cjs     # seal $VERSION-dev.g<short-commit>
```

A tree that cannot read its own commit at all reports `$VERSION-dev.gunknown`.
It never falls back to the bare release form: a build that cannot prove it is
the release must not be able to claim it by default.

## Where the identity is carried

In the **filename**: `seal-v$VERSION-dev.g<short-commit>-linux-x64`. The bare
`seal-v$VERSION-linux-x64` is legal only when built from the exact tag.

It is deliberately **not** carried in the payload bytes. This repository pins
the artifact digest in the release's `SHA256SUMS` asset. A digest that depended
on the commit could never be pinned by a commit: writing the pin would change
the commit, which would change the digest, which would need a new pin. So the payload is named by `VERSION`
alone and stays byte-identical across commits, and the pin means *the bytes
`v$VERSION` will publish*. Building at the tag reproduces exactly those bytes.

The consequence, stated plainly: a tree installed from a development artifact
still reports the bare `$VERSION` from `seal --version`, and the installer
still prints `installed seal $VERSION linux-x64`. The file it came from said
`-dev.g<short-commit>`; the installed tree does not. Closing that gap means
putting the commit inside the payload, which the pin forbids for the reason
above.

## The three checks, and why they are three

| check | question | needs origin |
| --- | --- | --- |
| `scripts/check-version-identity.cjs` | does `v$VERSION` already identify a *different* commit? | yes |
| `scripts/check-artifact-identity.cjs` | does this build wear the released name without being the release? | no |
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
`needs:` precisely so a tag-service outage cannot silence it.

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
this repository's to assume; `main` is protected, and the collision gate
already refuses the state this transition would prevent, so nothing here is
load-bearing while it stays unwired.
