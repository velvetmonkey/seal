/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Validation

namespace SealV2

/--
The public decision exposes only the emitted canonical bytes.
The validation witness remains internal to `decide`; `non_bypass` reconstructs it
from the `parse`/`validate` path rather than widening the runtime API.
-/
inductive Decision where
  | Block : Decision
  | Allow (out : CanonicalBytes) : Decision
  deriving Repr, BEq

def decide (raw : RawBytes) (state : ApprovalState) : Decision :=
  match parse raw with
  | none => .Block
  | some ast =>
      match validate ast state with
      | none => .Block
      | some checked => .Allow (serialize checked)

end SealV2
