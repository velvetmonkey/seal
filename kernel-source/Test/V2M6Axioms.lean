/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2
import Test.AxiomAllowlist

/-- info: 'SealV2.consume_records_nonce' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.consume_records_nonce

/-- info: 'SealV2.replay_denied' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.replay_denied

/-- info: 'SealV2.consume_preserves_live' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.consume_preserves_live

/-- info: 'SealV2.consume_only_unexpired' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.consume_only_unexpired

/-- info: 'SealV2.live_within_ttl_cap' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms SealV2.live_within_ttl_cap

def main : IO UInt32 :=
  Test.AxiomAllowlist.check `Test.V2M6Axioms #[
    `SealV2.consume_records_nonce,
    `SealV2.replay_denied,
    `SealV2.consume_preserves_live,
    `SealV2.consume_only_unexpired,
    `SealV2.live_within_ttl_cap
  ]
