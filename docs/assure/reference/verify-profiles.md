# Verification profiles

Profiles describe a verifier's use case. They do not rank a whole deployment as secure.

| Profile | Intended surface | Authority behavior |
|---|---|---|
| P-REF | Kit reference-kernel receipts | Parseable non-principal receipts can pass without operator authority; principal attribution requires its independent pin or yields reduced scope |
| P-ENFORCE | Production decision-receipt surfaces | Requires signed configuration binding and independent authority for the top result; unpinned remains distinct |
| P-SELFAUDIT | Producer's own self-audit | Self-consistency, never independent authority |

Those decision-family distinctions must not be blindly applied to Protect or Spine. Their signer and replay boundaries are described in [formats](../../check/formats.md).

A malformed or tampered receipt must not pass simply because another profile is less strict about authority. Reduced scope is an explicit result, not a synonym for a hard signature failure. The kit maps full/reduced/failed verification to exits 0/4/1, with separate usage and internal-error exits.

The [pinned owner contract](https://github.com/velvetmonkey/seal-assurance-kit/blob/1ae0df58b3ffd68bef86bc5853e6dad67eef1968/docs/VERIFY-PROFILES.md) defines the complete input-class matrix and declared verifier copies. Agreement is useful but shared kernel and format dependencies can also share defects.

Previous: [Policy, tools and labels](schemas.md).
Up: [Assurance CLI](../README.md).
Next: [Concepts](../../concepts/README.md).
