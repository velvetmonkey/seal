/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.AxiomAllowlist

#print axioms SealV2.guardCanonicalResult_returns_canonical
#print axioms SealV2.guardCanonicalStringResult_returns_canonical
#print axioms SealV2.parseStringChars_preserves_canonical
#print axioms SealV2.parseNumber_returns_canonical
#print axioms SealV2.parseArrayFuel_returns_canonical
#print axioms SealV2.parseObjectFuel_returns_canonical
#print axioms SealV2.parse_returns_canonical

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.V2M3ParserAxioms #[
    `SealV2.guardCanonicalResult_returns_canonical,
    `SealV2.guardCanonicalStringResult_returns_canonical,
    `SealV2.parseStringChars_preserves_canonical,
    `SealV2.parseNumber_returns_canonical,
    `SealV2.parseArrayFuel_returns_canonical,
    `SealV2.parseObjectFuel_returns_canonical,
    `SealV2.parse_returns_canonical
  ]
