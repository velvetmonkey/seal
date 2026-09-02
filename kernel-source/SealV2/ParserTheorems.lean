/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Parser

namespace SealV2

theorem parse_total (raw : RawBytes) :
    ∃ result, parse raw = result := by
  exact ⟨parse raw, rfl⟩

theorem parse_failure_has_no_ast (raw : RawBytes) :
    parse raw = none → ¬ ∃ ast, parse raw = some ast := by
  intro h hAst
  rcases hAst with ⟨ast, hSome⟩
  rw [h] at hSome
  contradiction

end SealV2
