/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Policy
import Seal.PolicyBundle
import Seal.PolicyLegacy

open Lean

/-!
# Layer-1 differential: codec parser vs pre-codec parser

Executable leg of the Layer-1 equivalence evidence (the proven leg is
`Seal/PolicyEquiv.lean`): feed the SAME wire bytes to the pre-codec parsers
(`Seal.PolicyLegacy`) and the codec parsers, and require IDENTICAL results —
verdict, parsed value (via `Repr`), and error text. Covers accept AND reject
cases across all 7 kernels plus the envelope rules, including the permissive
Safety interior and the parser-only refinements.

Extra corpora can be passed as file paths on the command line (e.g. seal-host
`config/*.example.json` payloads); each file must produce identical results
from both bundle parsers (whether accept or reject).
-/

private def diffOne {α : Type} [Repr α] (label : String)
    (oldP newP : Json → Except String α) (text : String) : IO Unit := do
  match Json.parse text with
  | .error e => throw <| IO.userError s!"{label}: corpus text is not JSON: {e}"
  | .ok j =>
      let oldR := reprStr (oldP j)
      let newR := reprStr (newP j)
      unless oldR == newR do
        throw <| IO.userError <|
          s!"{label}: DIFFERENTIAL MISMATCH\n  old: {oldR}\n  new: {newR}"

private def diffBundle (label text : String) : IO Unit :=
  diffOne label Seal.PolicyLegacy.parsePolicyBundle Seal.parsePolicyBundle text

private def diffPolicy (label text : String) : IO Unit :=
  diffOne label Seal.PolicyLegacy.parsePolicyJson Seal.parsePolicyJson text

private def safetyBlock : String :=
  "\"safety\":{\"approval\":{\"control_file\":\"/tmp/a.ndjson\",\"ttl_seconds\":60},\"tools\":[{\"name\":\"db.execute\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}]}]}"

private def withSection (section_ : String) : String :=
  "{\"epoch\":1," ++ safetyBlock ++ "," ++ section_ ++ "}"

/-- Bundle corpus: accepts and rejects for the envelope + all sections. -/
private def bundleCorpus : List (String × String) := [
  -- envelope
  ("minimal", "{\"epoch\":1," ++ safetyBlock ++ "}"),
  ("epoch zero", "{\"epoch\":0," ++ safetyBlock ++ "}"),
  ("epoch missing", "{" ++ safetyBlock ++ "}"),
  ("epoch wrong type", "{\"epoch\":\"3\"," ++ safetyBlock ++ "}"),
  ("epoch negative", "{\"epoch\":-1," ++ safetyBlock ++ "}"),
  ("epoch fractional", "{\"epoch\":1.5," ++ safetyBlock ++ "}"),
  ("safety missing", "{\"epoch\":1}"),
  ("top-level unknown key", "{\"epoch\":1," ++ safetyBlock ++ ",\"temporral\":{}}"),
  ("top-level not object", "[1,2]"),
  ("outer server enrichment", "{\"epoch\":1,\"server\":\"srv\"," ++ safetyBlock ++ "}"),
  ("server conflict",
   "{\"epoch\":1,\"server\":\"outer\",\"safety\":{\"server\":\"inner\",\"approval\":{\"control_file\":\"c\"},\"tools\":[]}}"),
  ("matching servers",
   "{\"epoch\":1,\"server\":\"same\",\"safety\":{\"server\":\"same\",\"approval\":{\"control_file\":\"c\"},\"tools\":[]}}"),
  ("server wrong type", "{\"epoch\":1,\"server\":7," ++ safetyBlock ++ "}"),
  ("empty server accepted", "{\"epoch\":1,\"server\":\"\"," ++ safetyBlock ++ "}"),
  -- safety shallow strictness
  ("unknown safety key",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[],\"enabled\":true}}"),
  ("unknown approval key",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"ttl\":9},\"tools\":[]}}"),
  ("replay_store allowlisted",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"replay_store\":{\"sqlite_path\":\"/tmp/r.db\"}},\"tools\":[]}}"),
  ("approval missing", "{\"epoch\":1,\"safety\":{\"tools\":[]}}"),
  ("approval not object", "{\"epoch\":1,\"safety\":{\"approval\":3,\"tools\":[]}}"),
  ("control_file missing", "{\"epoch\":1,\"safety\":{\"approval\":{\"ttl_seconds\":9},\"tools\":[]}}"),
  ("ttl default", "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[]}}"),
  ("ttl clamp", "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"ttl_seconds\":9999},\"tools\":[]}}"),
  ("ttl exact max", "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"ttl_seconds\":300},\"tools\":[]}}"),
  ("ttl zero", "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"ttl_seconds\":0},\"tools\":[]}}"),
  ("ttl wrong type", "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"ttl_seconds\":\"60\"},\"tools\":[]}}"),
  -- safety interior: PERMISSIVE (unknown keys tolerated in rules/matchers/targets)
  ("rule scaffold keys tolerated",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"allow\",\"_comment\":\"x\",\"_seal_scaffold\":true}]}}"),
  ("matcher unknown keys tolerated",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"always\",\"note\":\"x\"}}]}}"),
  ("target unknown keys tolerated",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true,\"junk\":1}]}]}}"),
  -- tool rules
  ("mode alias guard/guarded",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"a\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}]},{\"name\":\"b\",\"mode\":\"guarded\",\"target\":[{\"full_arguments\":true}]}]}}"),
  ("mode deny/allow",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"a\",\"mode\":\"deny\"},{\"name\":\"b\",\"mode\":\"allow\"}]}}"),
  ("mode unsupported",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"a\",\"mode\":\"block\"}]}}"),
  ("rule name missing",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"mode\":\"allow\"}]}}"),
  ("empty rule name accepted (signer is stricter)",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"\",\"mode\":\"allow\"}]}}"),
  ("tools not array", "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":{}}}"),
  -- matchers, every variant + nesting
  ("match equals",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"equals\",\"arg\":\"a.b\",\"value\":\"v\"}}]}}"),
  ("match starts_with",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"starts_with\",\"arg\":\"a\",\"value\":\"p\"}}]}}"),
  ("match contains_any_ci",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"contains_any_ci\",\"arg\":\"q\",\"needles\":[\"DROP\",\"delete\"]}}]}}"),
  ("match all nested any",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"all\",\"matches\":[{\"type\":\"always\"},{\"type\":\"any\",\"matches\":[{\"type\":\"equals\",\"arg\":\"x\",\"value\":\"1\"}]}]}}]}}"),
  ("match empty all/any accepted (signer is stricter)",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"all\",\"matches\":[]}}]}}"),
  ("match unsupported type",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"regex\",\"arg\":\"a\"}}]}}"),
  ("match type missing",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{}}]}}"),
  ("match needles non-string",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"contains_any_ci\",\"arg\":\"q\",\"needles\":[\"a\",7]}}]}}"),
  ("match empty arg path accepted (signer is stricter)",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"equals\",\"arg\":\"\",\"value\":\"v\"}}]}}"),
  ("match degenerate dotted path",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"equals\",\"arg\":\"a..b.\",\"value\":\"v\"}}]}}"),
  -- targets: literal-first precedence + exactly-one rule
  ("target literal under guard rejected (Stage A: guard requires full_arguments)",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"literal\":\"x\",\"arg\":\"a\"}]}]}}"),
  ("target arg under guard rejected (Stage A: guard requires full_arguments)",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"arg\":\"a.b\"}]}]}}"),
  ("target ambiguous arg+full_arguments",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"arg\":\"a\",\"full_arguments\":true}]}]}}"),
  ("target empty object",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{}]}]}}"),
  ("target full_arguments false",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":false}]}]}}"),
  ("target not array",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":{}}]}}"),
  ("guard absent target rejected (Stage A)",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\"}]}}"),
  ("target empty array under guard rejected (Stage A: guard requires full_arguments)",
   "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[{\"name\":\"t\",\"mode\":\"guard\",\"target\":[]}]}}"),
  -- temporal (T)
  ("temporal roundtrip",
   withSection "\"temporal\":{\"policies\":[{\"name\":\"freeze\",\"type\":\"no_after\",\"trigger\":[\"revoke\"],\"forbidden\":[\"write\"]}]}"),
  ("temporal disabled",
   withSection "\"temporal\":{\"enabled\":false,\"policies\":[]}"),
  ("temporal unknown section key", withSection "\"temporal\":{\"policies\":[],\"window\":9}"),
  ("temporal unknown rule key",
   withSection "\"temporal\":{\"policies\":[{\"name\":\"n\",\"type\":\"no_after\",\"trigger\":[],\"forbidden\":[],\"after\":1}]}"),
  ("temporal bad type",
   withSection "\"temporal\":{\"policies\":[{\"name\":\"n\",\"type\":\"eventually\",\"trigger\":[],\"forbidden\":[]}]}"),
  ("temporal missing forbidden",
   withSection "\"temporal\":{\"policies\":[{\"name\":\"n\",\"type\":\"no_after\",\"trigger\":[]}]}"),
  ("temporal trigger non-string", withSection "\"temporal\":{\"policies\":[{\"name\":\"n\",\"type\":\"no_after\",\"trigger\":[1],\"forbidden\":[]}]}"),
  ("temporal policies wrong type", withSection "\"temporal\":{\"policies\":{}}"),
  ("temporal enabled wrong type", withSection "\"temporal\":{\"enabled\":\"yes\",\"policies\":[]}"),
  ("temporal empty policies", withSection "\"temporal\":{\"policies\":[]}"),
  -- consensus (C)
  ("consensus roundtrip",
   withSection "\"consensus\":{\"roster\":[1,2,3],\"votes_file\":\"/tmp/v\",\"high_stakes\":[\"deploy\"]}"),
  ("consensus unknown key",
   withSection "\"consensus\":{\"roster\":[1],\"votes_file\":\"v\",\"high_stakes\":[],\"quorum\":2}"),
  ("consensus roster non-nat",
   withSection "\"consensus\":{\"roster\":[\"a\"],\"votes_file\":\"v\",\"high_stakes\":[]}"),
  ("consensus missing votes_file", withSection "\"consensus\":{\"roster\":[1],\"high_stakes\":[]}"),
  ("consensus empty roster accepted", withSection "\"consensus\":{\"roster\":[],\"votes_file\":\"v\",\"high_stakes\":[]}"),
  ("consensus disabled", withSection "\"consensus\":{\"enabled\":false,\"roster\":[1],\"votes_file\":\"v\",\"high_stakes\":[]}"),
  -- convergence (V)
  ("convergence roundtrip", withSection "\"convergence\":{\"tools\":[{\"tool\":\"s.update\",\"op_arg\":\"operation.kind\"}]}"),
  ("convergence unknown entry key", withSection "\"convergence\":{\"tools\":[{\"tool\":\"t\",\"op_arg\":\"o\",\"op\":\"x\"}]}"),
  ("convergence op_arg wrong type", withSection "\"convergence\":{\"tools\":[{\"tool\":\"t\",\"op_arg\":7}]}"),
  ("convergence degenerate op_arg", withSection "\"convergence\":{\"tools\":[{\"tool\":\"t\",\"op_arg\":\"..\"}]}"),
  ("convergence missing tool", withSection "\"convergence\":{\"tools\":[{\"op_arg\":\"o\"}]}"),
  ("convergence empty tools", withSection "\"convergence\":{\"tools\":[]}"),
  -- calibration (K)
  ("calibration roundtrip",
   withSection "\"calibration\":{\"enabled\":true,\"delta_num\":1,\"delta_den\":20,\"min_samples\":10,\"records_file\":\"r\",\"gated_tools\":[\"p\"]}"),
  ("calibration default disabled",
   withSection "\"calibration\":{\"delta_num\":1,\"delta_den\":20,\"min_samples\":5,\"records_file\":\"r\",\"gated_tools\":[]}"),
  ("calibration delta zero num",
   withSection "\"calibration\":{\"delta_num\":0,\"delta_den\":2,\"min_samples\":1,\"records_file\":\"r\",\"gated_tools\":[]}"),
  ("calibration delta ge one",
   withSection "\"calibration\":{\"delta_num\":3,\"delta_den\":2,\"min_samples\":1,\"records_file\":\"r\",\"gated_tools\":[]}"),
  ("calibration delta equal",
   withSection "\"calibration\":{\"delta_num\":2,\"delta_den\":2,\"min_samples\":1,\"records_file\":\"r\",\"gated_tools\":[]}"),
  ("calibration unknown key",
   withSection "\"calibration\":{\"delta_num\":1,\"delta_den\":2,\"min_samples\":1,\"records_file\":\"r\",\"gated_tools\":[],\"delta\":0.5}"),
  ("calibration missing min_samples",
   withSection "\"calibration\":{\"delta_num\":1,\"delta_den\":2,\"records_file\":\"r\",\"gated_tools\":[]}"),
  -- linear (L)
  ("linear roundtrip", withSection "\"linear\":{\"grants_file\":\"/tmp/g\",\"tools\":[{\"tool\":\"spend\",\"cap_arg\":\"capability.id\"}]}"),
  ("linear unknown entry key", withSection "\"linear\":{\"grants_file\":\"g\",\"tools\":[{\"tool\":\"t\",\"cap_arg\":\"c\",\"cap\":1}]}"),
  ("linear missing grants_file", withSection "\"linear\":{\"tools\":[]}"),
  ("linear cap_arg wrong type", withSection "\"linear\":{\"grants_file\":\"g\",\"tools\":[{\"tool\":\"t\",\"cap_arg\":[]}]}"),
  ("linear degenerate cap_arg", withSection "\"linear\":{\"grants_file\":\"g\",\"tools\":[{\"tool\":\"t\",\"cap_arg\":\".\"}]}"),
  ("linear disabled", withSection "\"linear\":{\"enabled\":false,\"grants_file\":\"g\",\"tools\":[]}"),
  -- budget (B)
  ("budget roundtrip", withSection "\"budget\":{\"budgets\":[{\"name\":\"w\",\"cap\":100,\"tools\":[\"write\"],\"cost_arg\":\"usage.units\"}]}"),
  ("budget no cost_arg", withSection "\"budget\":{\"budgets\":[{\"name\":\"r\",\"cap\":5,\"tools\":[\"t\"]}]}"),
  ("budget unknown spec key", withSection "\"budget\":{\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[],\"costs\":1}]}"),
  ("budget cap wrong type", withSection "\"budget\":{\"budgets\":[{\"name\":\"n\",\"cap\":\"1\",\"tools\":[]}]}"),
  ("budget missing cap", withSection "\"budget\":{\"budgets\":[{\"name\":\"n\",\"tools\":[]}]}"),
  ("budget zero cap accepted", withSection "\"budget\":{\"budgets\":[{\"name\":\"n\",\"cap\":0,\"tools\":[]}]}"),
  ("budget duplicate names accepted by parser (host rejects conflicting caps)",
   withSection "\"budget\":{\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[]},{\"name\":\"n\",\"cap\":2,\"tools\":[]}]}"),
  ("budget cost_arg wrong type", withSection "\"budget\":{\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[],\"cost_arg\":9}]}"),
  ("budget disabled", withSection "\"budget\":{\"enabled\":false,\"budgets\":[]}"),
  -- principals (V2.1 Layer-2 delta: both spec and codec now carry the section)
  ("principals roundtrip",
   withSection "\"principals\":{\"keys\":[{\"id\":\"alice\",\"pubkey\":\"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff\"}],\"budgets\":[{\"name\":\"a\",\"cap\":10,\"tools\":[\"w\"]}]}"),
  ("principals unknown section key", withSection "\"principals\":{\"keys\":[],\"budgets\":[],\"registry\":[]}"),
  ("principals unknown entry key",
   withSection "\"principals\":{\"keys\":[{\"id\":\"a\",\"pubkey\":\"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff\",\"role\":\"x\"}],\"budgets\":[]}"),
  ("principals empty id", withSection "\"principals\":{\"keys\":[{\"id\":\"\",\"pubkey\":\"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff\"}],\"budgets\":[]}"),
  ("principals short pubkey", withSection "\"principals\":{\"keys\":[{\"id\":\"a\",\"pubkey\":\"deadbeef\"}],\"budgets\":[]}"),
  ("principals non-hex pubkey", withSection "\"principals\":{\"keys\":[{\"id\":\"a\",\"pubkey\":\"zz112233445566778899aabbccddeeff00112233445566778899aabbccddeeff\"}],\"budgets\":[]}"),
  ("principals disabled", withSection "\"principals\":{\"enabled\":false,\"keys\":[],\"budgets\":[]}"),
  ("principals missing budgets", withSection "\"principals\":{\"keys\":[]}"),
  ("principals budget dup names accepted by parser",
   withSection "\"principals\":{\"keys\":[],\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[]},{\"name\":\"n\",\"cap\":2,\"tools\":[]}]}"),
  -- duplicate JSON keys (Lean Json object semantics — inherited identically)
  ("duplicate epoch key", "{\"epoch\":1,\"epoch\":2," ++ safetyBlock ++ "}"),
  ("duplicate section key",
   withSection "\"budget\":{\"budgets\":[]},\"budget\":{\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[]}]}"),
  -- everything at once
  ("full payload",
   "{\"epoch\":3,\"server\":\"srv-1\"," ++ safetyBlock ++ "," ++
   "\"temporal\":{\"policies\":[{\"name\":\"f\",\"type\":\"no_after\",\"trigger\":[\"r\"],\"forbidden\":[\"w\"]}]}," ++
   "\"consensus\":{\"roster\":[1,2,3],\"votes_file\":\"v\",\"high_stakes\":[\"d\"]}," ++
   "\"convergence\":{\"tools\":[{\"tool\":\"s\",\"op_arg\":\"o.k\"}]}," ++
   "\"calibration\":{\"enabled\":true,\"delta_num\":1,\"delta_den\":20,\"min_samples\":10,\"records_file\":\"r\",\"gated_tools\":[\"p\"]}," ++
   "\"linear\":{\"grants_file\":\"g\",\"tools\":[{\"tool\":\"s\",\"cap_arg\":\"c.i\"}]}," ++
   "\"budget\":{\"budgets\":[{\"name\":\"w\",\"cap\":100,\"tools\":[\"w\"],\"cost_arg\":\"u.u\"}]}}")
]

/-- Standalone Safety-policy corpus (`parsePolicyJson` boundary: PERMISSIVE
    top level — no strict keys at all outside a bundle). -/
private def policyCorpus : List (String × String) := [
  ("standalone minimal", "{\"approval\":{\"control_file\":\"c\"},\"tools\":[]}"),
  ("standalone unknown top-level key tolerated",
   "{\"approval\":{\"control_file\":\"c\"},\"tools\":[],\"junk\":1}"),
  ("standalone unknown approval key tolerated",
   "{\"approval\":{\"control_file\":\"c\",\"anything\":true},\"tools\":[]}"),
  ("standalone server", "{\"approval\":{\"control_file\":\"c\"},\"tools\":[],\"server\":\"s\"}"),
  ("standalone server wrong type", "{\"approval\":{\"control_file\":\"c\"},\"tools\":[],\"server\":1}"),
  ("standalone missing approval", "{\"tools\":[]}"),
  ("standalone missing tools", "{\"approval\":{\"control_file\":\"c\"}}"),
  ("standalone not object", "\"policy\""),
  ("standalone ttl clamp", "{\"approval\":{\"control_file\":\"c\",\"ttl_seconds\":301},\"tools\":[]}")
]

def main (args : List String) : IO Unit := do
  for (label, text) in bundleCorpus do
    diffBundle label text
  for (label, text) in policyCorpus do
    diffPolicy label text
  for path in args do
    let text ← IO.FS.readFile path
    diffBundle s!"file:{path}" text
  IO.println s!"POLICY DIFFERENTIAL PASS ({bundleCorpus.length} bundle + {policyCorpus.length} policy cases{if args.isEmpty then "" else s!" + {args.length} files"})"
