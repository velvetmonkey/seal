/- SPDX-License-Identifier: Apache-2.0 -/

import SealCore.Sha256

namespace SealCore

abbrev Hash := UInt64
abbrev TargetHash := Sha256.TargetHash

inductive Event where
  | approval (target : TargetHash) (deadline : Nat)
  | guarded (target : TargetHash)
  | benign
  | defaultDeny
  deriving Repr, BEq, DecidableEq

inductive Decision where
  | allow
  | block
  deriving Repr, BEq, DecidableEq

def Decision.isAllow : Decision → Bool
  | .allow => true
  | .block => false

end SealCore
