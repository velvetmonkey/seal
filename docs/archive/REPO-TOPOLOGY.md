# Repository topology and deployment model

Decided 2026-07-25 and retained as historical design rationale. Its private-source
publication model was superseded when all nine Seal-family repositories became
public; `witness-check` remains the one private, proprietary exception.

## The decision

**Merge `mcp-seal-dev` and `seal-host` into this repository.** Keep
`seal-verify-action` separate. Publish through the existing signed export rather
than by making the source repository public.

## Why: a receipt should be able to name what produced it

The kernel is Lean, the host is Rust, and today they live in separate
repositories with the host pinning the kernel by revision.

That pin is not cited anywhere. As of 2026-07-25 the pinned kernel revision
appears in no decision receipt, no claims document, and no receipt schema, and
nothing in CI checks that the pin is current. So the boundary costs us and buys
us nothing we actually use.

Worse, it lets the two sides disagree silently. On 2026-07-25 the kernel had
moved its effect-envelope domain tag from `seal.effect/v1` to `seal.effect/v2`
five days earlier; the host still emitted v1, still advertised v1 to clients,
and every test stayed green. Separately, the host's shipped example config and
one shipped profile carried policy shapes the pinned kernel rejects at parse
time, so a user following our own documentation got a hard error.

Both are the same failure: **a correspondence across a repository boundary with
nothing enforcing it.**

In one repository, a single commit SHA identifies the kernel, the host, the
fixtures and the shipped examples together. That is precisely what a receipt
wants to cite. For a product whose entire claim is attestable correspondence,
that is not housekeeping, it is the product.

## Why this does NOT force everything public

The concern with a monorepo is that visibility becomes all-or-nothing.

It does not, because the publication mechanism already exists and is better than
a visibility flag: `seal-host`'s `public-export.yml`, "Signed public source
export", runs the export twice independently and compares the deterministic
payloads across separate runs before publishing.

The proposed model was: **one private source of truth, one reproducible signed export.**
The export decides what is public, and proves it did so deterministically. A
monorepo suits that better than several repositories each needing its own
decision.

## What stays separate, and why

**`seal-verify-action` must remain its own repository.** GitHub Actions consumed
by external repositories are referenced as `uses: velvetmonkey/seal-verify-action@v1`,
and `seal-host`'s `release.yml` pins its tag by `git ls-remote refs/tags/v1`.
Folding it into a monorepo breaks every consumer. This is a hard external
constraint, not a preference.

**Demo repositories stay separate.** They are meant to be cloned standalone as
worked examples. Burying them in a subdirectory of a large tree makes them worse
at the one job they have.

## What a monorepo does NOT fix

Stated so nobody oversells it later. Of the defects found on 2026-07-25, a
monorepo would have prevented roughly half:

Prevented: kernel/host envelope-version skew; fixtures pre-dating a kernel rule;
shipped example configs the kernel rejects; two hosts with different wire guards.

NOT prevented, because they were intra-repository: a four-day-stale
`libsealffi.so` that could not be relinked; a byte-twin guard comparing two
frozen local artifacts to each other; a differential test asserting a superseded
contract; a pin ledger that went stale the day it was written.

Those need build hygiene and executable ledgers. Merging repositories does
nothing for them.

## Sequencing

Do not migrate onto an untrustworthy signal. In order:

1. Suite genuinely green, with the reasons understood rather than suppressed.
2. A `release-evidence` CI job that fails unless every security-relevant job
   returned success. At the time, a missing private-access token made CI skip the Lean
   build, axiom checks, host tests, conformance and the three-way differential,
   and still report green. Migrating before this fixes nothing and moves an
   unreliable green into the repository we want to be the trustworthy one.
3. External oracles (Wycheproof, JSONTestSuite) wired into required CI.
4. Merge the branches carrying real work; abandon the badly stale ones.
5. Then migrate, with `git subtree` preserving history rather than a rewrite.

## What would falsify this

- If the kernel acquires independent consumers outside this product, a separately
  citable kernel repository becomes worth its cost again.
- If the signed export proves unable to carve a coherent public subset out of a
  merged tree, the visibility argument returns and this should be revisited.
