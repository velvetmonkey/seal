/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.JsonUtil

/-!
# Fail-closed number guard — behaviour tests + a structural theorem

`Seal.JsonUtil.wireNumbersSafe` is the pre-parse guard that lets the host refuse
a wire line carrying a pathological numeric literal (a monster decimal exponent)
BEFORE `Lean.Json.parse` evaluates `10^exponent` and aborts (native + Lean
interpreter) or diverges (emscripten wasm) — the Lane C native-vs-wasm
divergence the three-way differential found.

The concrete behaviours are `#guard`s: the compiler evaluates the string state
machine end-to-end at elaboration time (a failing guard fails the build). They
are TESTS, not kernel theorems, and introduce NO axiom — `wireNumbersSafe` is a
`String.foldl`, and evaluating a `String` function in kernel whnf blows the
recursion budget (the same reason `Host/CanonicalL0Liveness.lean` uses `#guard`
for its wire lines). The one general THEOREM below needs no string evaluation
and is axiom-pinned in `Test.Axioms`; the fail-closed ROUTING theorem (a
pathological line never forwards) lives with `classifyLine` in seal-host.
-/

namespace Seal.JsonUtil

-- The exact `tools/call` the Lane C three-way differential aborted on
-- (`1e9999999999` in an argument value) is REFUSED — it never reaches parse.
#guard wireNumbersSafe
    "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"t\",\"arguments\":{\"v\":1e9999999999}}}"
    = false

-- A negative monster exponent is refused too (it drives `toString` to blow up
-- even when the parse itself survives).
#guard wireNumbersSafe "{\"v\":1e-9999999999}" = false

-- Legitimate JSON numbers are SAFE: the f64-range maximum, and the documented
-- `1e999999` overflow case (6 exponent digits, the boundary the bound keeps).
#guard wireNumbersSafe "{\"v\":1e308}" = true
#guard wireNumbersSafe "{\"v\":1e999999}" = true
#guard wireNumbersSafe "{\"v\":-1e9999}" = true
#guard wireNumbersSafe "{\"v\":9007199254740993}" = true

-- A monster exponent INSIDE a string value is inert — NOT over-refused: a quoted
-- `"1e9999999999"` never drives the parser's `10^exponent`.
#guard wireNumbersSafe "{\"v\":\"1e9999999999\"}" = true

-- `true`/`false` carry an unquoted `e` with no trailing digits — a zero-length
-- exponent run, so they never trip the bound.
#guard wireNumbersSafe "{\"a\":true,\"b\":false}" = true

-- The agreement guard is independent of the exponent-cost guard.  All four
-- literals below pass `wireNumbersSafe`; only the values that survive a
-- shortest binary64 decimal round-trip pass the new predicate.
#guard firstAgreementUnsafeNumber? "{\"v\":-1e9999}" = some "-1e9999"
#guard wireNumbersAgreementSafe "{\"v\":1e308}" = true
#guard wireNumbersAgreementSafe "{\"v\":9007199254740991}" = true
#guard firstAgreementUnsafeNumber? "{\"v\":9007199254740993}" =
  some "9007199254740993"
#guard firstAgreementUnsafeNumber? "{\"v\":90071992547409910}" =
  some "90071992547409910"
#guard firstAgreementUnsafeNumber? "{\"v\":999999999999999000}" =
  some "999999999999999000"
#guard firstAgreementUnsafeNumber? "{\"v\":1e9999999}" = some "1e9999999"

-- Quoted numeric text is inert.
#guard wireNumbersAgreementSafe "{\"v\":\"-1e9999\"}" = true

/-- A non-digit character never raises the worst-seen exponent run: `worst` is
    only ever set to the length of a digit run. This is the structural invariant
    the behaviour rests on — proven without evaluating any concrete string, so
    it is a clean kernel theorem (axiom-pinned in `Test.Axioms`). -/
theorem numberScanStep_worst_le_of_no_digit
    (st : NumberScan) (c : Char) (hc : c.isDigit = false) :
    (numberScanStep st c).worst = st.worst := by
  unfold numberScanStep
  simp only [hc, Bool.false_eq_true, if_false]
  repeat (first | rfl | split)
  all_goals rfl

end Seal.JsonUtil
