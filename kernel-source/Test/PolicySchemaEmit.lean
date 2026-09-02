/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.PolicyBundle

/-!
Prints the policy-bundle JSON Schema — the schema projection of
`Seal.policyBundleCodec` (the same value whose parse projection is
`parsePolicyBundle`). The anti-drift gate byte-compares this output against
the checked-in `docs/policy-bundle.schema.json`; a stale artifact fails CI.
-/

def main : IO Unit :=
  IO.println Seal.policyBundleSchema.pretty
