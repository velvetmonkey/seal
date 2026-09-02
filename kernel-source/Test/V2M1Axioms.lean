/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.AxiomAllowlist

#print axioms SealV2.parse_total
#print axioms SealV2.parse_failure_has_no_ast

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.V2M1Axioms #[
    `SealV2.parse_total,
    `SealV2.parse_failure_has_no_ast
  ]
