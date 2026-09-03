/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.PolicyBundle

open Lean

/-! End-to-end tests for the 7-kernel policy bundle parser: roundtrip of every
    section, unknown-key hard errors at every level, `enabled` defaults and
    collapse semantics, and the preserved envelope rules (epoch, server
    conflict/enrichment). Every positive assertion first checks the section is
    present/non-empty — no vacuous passes. -/

private def parseBundle (text : String) : Except String Seal.PolicyBundle :=
  Json.parse text >>= Seal.parsePolicyBundle

private def expectOk (label text : String) : IO Seal.PolicyBundle := do
  match parseBundle text with
  | .ok b => pure b
  | .error e => throw <| IO.userError s!"{label}: expected parse, got error: {e}"

private def expectErrContaining (label text needle : String) : IO Unit := do
  match parseBundle text with
  | .ok _ => throw <| IO.userError s!"{label}: expected rejection ({needle}), parsed"
  | .error e =>
      unless (e.splitOn needle).length > 1 do
        throw <| IO.userError s!"{label}: error missing '{needle}': {e}"

/-- 64 hex chars — a syntactically valid Ed25519 verifying-key hex. -/
private def testPubkeyHex : String :=
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

private def safetyBlock : String :=
  "\"safety\":{\"approval\":{\"control_file\":\"/tmp/approvals.ndjson\",\"ttl_seconds\":60},\"tools\":[{\"name\":\"db.execute\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}]}]}"

/-- A payload with every kernel section present. -/
private def fullPayload : String :=
  "{\"epoch\":3,\"server\":\"srv-1\"," ++ safetyBlock ++ "," ++
  "\"temporal\":{\"policies\":[{\"name\":\"freeze\",\"type\":\"no_after\",\"trigger\":[\"revoke\"],\"forbidden\":[\"write_item\"]}]}," ++
  "\"consensus\":{\"roster\":[1,2,3],\"votes_file\":\"/tmp/votes.ndjson\",\"high_stakes\":[\"deploy\"]}," ++
  "\"convergence\":{\"tools\":[{\"tool\":\"store.update\",\"op_arg\":\"operation.kind\"}]}," ++
  "\"calibration\":{\"enabled\":true,\"delta_num\":1,\"delta_den\":20,\"min_samples\":10,\"records_file\":\"/tmp/forecasts.ndjson\",\"gated_tools\":[\"auto_publish\"]}," ++
  "\"linear\":{\"grants_file\":\"/tmp/grants.ndjson\",\"tools\":[{\"tool\":\"spend\",\"cap_arg\":\"capability.id\"}]}," ++
  "\"budget\":{\"budgets\":[{\"name\":\"write-units\",\"cap\":100,\"tools\":[\"write_item\"],\"cost_arg\":\"usage.units\"}]}," ++
  "\"principals\":{\"keys\":[{\"id\":\"alice\",\"pubkey\":\"" ++ testPubkeyHex ++ "\"}],\"budgets\":[{\"name\":\"alice-writes\",\"cap\":10,\"tools\":[\"write_item\"]}]}}"

private def minimalPayload : String :=
  "{\"epoch\":1," ++ safetyBlock ++ "}"

private def withSection (section_ : String) : String :=
  "{\"epoch\":1," ++ safetyBlock ++ "," ++ section_ ++ "}"

def main : IO Unit := do
  -- roundtrip: all seven sections parse and every field survives
  let b ← expectOk "full roundtrip" fullPayload
  unless b.epoch == 3 do throw <| IO.userError "epoch lost"
  unless b.safety.serverIdentity == "srv-1" do
    throw <| IO.userError s!"outer server did not reach safety: {b.safety.serverIdentity}"
  unless b.safety.tools.length == 1 do throw <| IO.userError "safety tools lost"
  match b.temporal with
  | some t =>
      unless t.enabled do throw <| IO.userError "temporal enabled default not true"
      unless t.policies == [{ name := "freeze", trigger := ["revoke"],
                              forbidden := ["write_item"] }] do
        throw <| IO.userError s!"temporal fields lost: {repr t}"
  | none => throw <| IO.userError "temporal section lost"
  match b.consensus with
  | some c =>
      unless c == { enabled := true, roster := [1, 2, 3],
                    votesFile := "/tmp/votes.ndjson", highStakes := ["deploy"] } do
        throw <| IO.userError s!"consensus fields lost: {repr c}"
  | none => throw <| IO.userError "consensus section lost"
  match b.convergence with
  | some v =>
      unless v.tools == [{ tool := "store.update", opArg := ["operation", "kind"] }] do
        throw <| IO.userError s!"convergence op_arg not split: {repr v}"
  | none => throw <| IO.userError "convergence section lost"
  match b.calibration with
  | some k =>
      unless k == { enabled := true, deltaNum := 1, deltaDen := 20, minSamples := 10,
                    recordsFile := "/tmp/forecasts.ndjson",
                    gatedTools := ["auto_publish"] } do
        throw <| IO.userError s!"calibration fields lost: {repr k}"
  | none => throw <| IO.userError "calibration section lost"
  match b.linear with
  | some l =>
      unless l.tools == [{ tool := "spend", capArg := ["capability", "id"] }] do
        throw <| IO.userError s!"linear cap_arg not split: {repr l}"
  | none => throw <| IO.userError "linear section lost"
  match b.budget with
  | some bg =>
      unless bg.budgets == [{ name := "write-units", cap := 100,
                              tools := ["write_item"],
                              costArg := some ["usage", "units"] }] do
        throw <| IO.userError s!"budget fields lost: {repr bg}"
  | none => throw <| IO.userError "budget section lost"
  match b.principals with
  | some p =>
      unless p.enabled do throw <| IO.userError "principals enabled default not true"
      unless p.keys == [{ id := "alice", pubkey := testPubkeyHex }] do
        throw <| IO.userError s!"principal keys lost: {repr p}"
      unless p.budgets == [{ name := "alice-writes", cap := 10,
                             tools := ["write_item"], costArg := none }] do
        throw <| IO.userError s!"principal budgets lost: {repr p}"
  | none => throw <| IO.userError "principals section lost"

  -- minimal payload: optional sections absent, all effective views empty
  let m ← expectOk "minimal payload" minimalPayload
  unless m.temporal.isNone && m.consensus.isNone && m.convergence.isNone
      && m.calibration.isNone && m.linear.isNone && m.budget.isNone
      && m.principals.isNone do
    throw <| IO.userError "absent sections did not stay absent"
  unless m.effectiveTemporal.isEmpty && m.effectiveConsensus.isNone
      && m.effectiveConvergence.isEmpty && m.effectiveLinear.isNone
      && m.effectiveBudget.isEmpty && m.effectivePrincipals.isNone do
    throw <| IO.userError "effective views of absent sections not empty"

  -- unknown keys: hard errors at every level
  expectErrContaining "top-level typo"
    ("{\"epoch\":1," ++ safetyBlock ++ ",\"temporral\":{}}")
    "unknown key 'temporral'"
  expectErrContaining "unknown temporal key"
    (withSection "\"temporal\":{\"policies\":[],\"window\":9}") "unknown key 'window'"
  expectErrContaining "unknown consensus key"
    (withSection "\"consensus\":{\"roster\":[1],\"votes_file\":\"v\",\"high_stakes\":[],\"quorum\":2}")
    "unknown key 'quorum'"
  expectErrContaining "unknown convergence key"
    (withSection "\"convergence\":{\"tools\":[],\"ops\":[]}") "unknown key 'ops'"
  expectErrContaining "unknown calibration key"
    (withSection "\"calibration\":{\"delta_num\":1,\"delta_den\":2,\"min_samples\":1,\"records_file\":\"r\",\"gated_tools\":[],\"delta\":0.5}")
    "unknown key 'delta'"
  expectErrContaining "unknown linear key"
    (withSection "\"linear\":{\"grants_file\":\"g\",\"tools\":[],\"caps\":[]}")
    "unknown key 'caps'"
  expectErrContaining "unknown budget key"
    (withSection "\"budget\":{\"budgets\":[],\"cap\":1}") "unknown key 'cap'"
  expectErrContaining "unknown budget spec key"
    (withSection "\"budget\":{\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[],\"costs\":1}]}")
    "unknown key 'costs'"
  expectErrContaining "unknown principals key"
    (withSection ("\"principals\":{\"keys\":[],\"budgets\":[],\"registry\":[]}"))
    "unknown key 'registry'"
  expectErrContaining "unknown principal key entry key"
    (withSection ("\"principals\":{\"keys\":[{\"id\":\"a\",\"pubkey\":\"" ++ testPubkeyHex ++ "\",\"role\":\"admin\"}],\"budgets\":[]}"))
    "unknown key 'role'"
  expectErrContaining "unknown principal budget spec key"
    (withSection "\"principals\":{\"keys\":[],\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[],\"costs\":1}]}")
    "unknown key 'costs'"
  expectErrContaining "unknown temporal rule key"
    (withSection "\"temporal\":{\"policies\":[{\"name\":\"n\",\"type\":\"no_after\",\"trigger\":[],\"forbidden\":[],\"after\":\"x\"}]}")
    "unknown key 'after'"
  expectErrContaining "unknown convergence tool key"
    (withSection "\"convergence\":{\"tools\":[{\"tool\":\"t\",\"op_arg\":\"o\",\"op\":\"x\"}]}")
    "unknown key 'op'"
  expectErrContaining "unknown linear tool key"
    (withSection "\"linear\":{\"grants_file\":\"g\",\"tools\":[{\"tool\":\"t\",\"cap_arg\":\"c\",\"cap\":1}]}")
    "unknown key 'cap'"
  expectErrContaining "unknown safety key"
    ("{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[],\"enabled\":true}}")
    "unknown key 'enabled'"
  expectErrContaining "unknown approval key"
    ("{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"ttl\":9},\"tools\":[]}}")
    "unknown key 'ttl'"

  -- replay_store is the documented host-layer approval key: accepted
  let _ ← expectOk "replay_store allowlisted"
    ("{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"replay_store\":{\"sqlite_path\":\"/tmp/r.db\"}},\"tools\":[]}}")

  -- enabled: defaults true (except calibration), false collapses effective view
  let td ← expectOk "temporal disabled"
    (withSection "\"temporal\":{\"enabled\":false,\"policies\":[{\"name\":\"n\",\"type\":\"no_after\",\"trigger\":[\"a\"],\"forbidden\":[\"b\"]}]}")
  unless td.temporal.isSome do throw <| IO.userError "disabled temporal lost"
  unless td.effectiveTemporal.isEmpty do
    throw <| IO.userError "disabled temporal still effective"
  let cd ← expectOk "consensus disabled"
    (withSection "\"consensus\":{\"enabled\":false,\"roster\":[1],\"votes_file\":\"v\",\"high_stakes\":[\"deploy\"]}")
  unless cd.consensus.isSome do throw <| IO.userError "disabled consensus lost"
  unless cd.effectiveConsensus.isNone do
    throw <| IO.userError "disabled consensus still effective"
  let vd ← expectOk "convergence disabled"
    (withSection "\"convergence\":{\"enabled\":false,\"tools\":[{\"tool\":\"t\",\"op_arg\":\"o\"}]}")
  unless vd.effectiveConvergence.isEmpty do
    throw <| IO.userError "disabled convergence still effective"
  let ld ← expectOk "linear disabled"
    (withSection "\"linear\":{\"enabled\":false,\"grants_file\":\"g\",\"tools\":[{\"tool\":\"t\",\"cap_arg\":\"c\"}]}")
  unless ld.effectiveLinear.isNone do
    throw <| IO.userError "disabled linear still effective"
  let bd ← expectOk "budget disabled"
    (withSection "\"budget\":{\"enabled\":false,\"budgets\":[{\"name\":\"n\",\"cap\":1,\"tools\":[\"t\"]}]}")
  unless bd.effectiveBudget.isEmpty do
    throw <| IO.userError "disabled budget still effective"
  let pd ← expectOk "principals disabled"
    (withSection ("\"principals\":{\"enabled\":false,\"keys\":[{\"id\":\"a\",\"pubkey\":\"" ++ testPubkeyHex ++ "\"}],\"budgets\":[]}"))
  unless pd.principals.isSome do throw <| IO.userError "disabled principals lost"
  unless pd.effectivePrincipals.isNone do
    throw <| IO.userError "disabled principals still effective"

  -- principals: parse-time fail-closed lints (V2.1 acceptance-set DELTA over
  -- Layer 1: pre-V2.1 the whole 'principals' key was "unknown key" — see the
  -- PolicyLegacy lockstep note)
  expectErrContaining "empty principal id"
    (withSection ("\"principals\":{\"keys\":[{\"id\":\"\",\"pubkey\":\"" ++ testPubkeyHex ++ "\"}],\"budgets\":[]}"))
    "principal id must be non-empty"
  expectErrContaining "short principal pubkey"
    (withSection "\"principals\":{\"keys\":[{\"id\":\"a\",\"pubkey\":\"deadbeef\"}],\"budgets\":[]}")
    "must be 64 hex chars"
  expectErrContaining "non-hex principal pubkey"
    (withSection ("\"principals\":{\"keys\":[{\"id\":\"a\",\"pubkey\":\"zz112233445566778899aabbccddeeff00112233445566778899aabbccddeeff\"}],\"budgets\":[]}"))
    "must be 64 hex chars"

  -- calibration: EXPERIMENTAL default is DISABLED; present-but-disabled stays present
  let kDefault ← expectOk "calibration default"
    (withSection "\"calibration\":{\"delta_num\":1,\"delta_den\":20,\"min_samples\":5,\"records_file\":\"r\",\"gated_tools\":[\"t\"]}")
  match kDefault.calibration with
  | some k =>
      unless k.enabled == false do
        throw <| IO.userError "calibration enabled did not default to false"
  | none => throw <| IO.userError "calibration section lost"
  let kOff ← expectOk "calibration disabled still present"
    (withSection "\"calibration\":{\"enabled\":false,\"delta_num\":1,\"delta_den\":20,\"min_samples\":5,\"records_file\":\"r\",\"gated_tools\":[\"t\"]}")
  unless kOff.calibration.isSome do
    throw <| IO.userError "disabled calibration must stay present (double gate)"

  -- envelope rules preserved
  expectErrContaining "epoch zero" ("{\"epoch\":0," ++ safetyBlock ++ "}")
    "config epoch must be ≥ 1"
  expectErrContaining "server conflict"
    "{\"epoch\":1,\"server\":\"outer\",\"safety\":{\"server\":\"inner\",\"approval\":{\"control_file\":\"c\"},\"tools\":[]}}"
    "server identity conflicts"
  let enrich ← expectOk "outer server enrichment"
    ("{\"epoch\":1,\"server\":\"only-outer\"," ++ safetyBlock ++ "}")
  unless enrich.safety.serverIdentity == "only-outer" do
    throw <| IO.userError "outer server did not enrich safety policy"
  let inner ← expectOk "matching servers"
    "{\"epoch\":1,\"server\":\"same\",\"safety\":{\"server\":\"same\",\"approval\":{\"control_file\":\"c\"},\"tools\":[]}}"
  unless inner.safety.serverIdentity == "same" do
    throw <| IO.userError "matching inner server lost"

  -- cost_arg optional; bad temporal type; bad calibration delta
  let noCost ← expectOk "budget without cost_arg"
    (withSection "\"budget\":{\"budgets\":[{\"name\":\"rate\",\"cap\":5,\"tools\":[\"t\"]}]}")
  match noCost.budget with
  | some bg =>
      unless bg.budgets.length == 1 && (bg.budgets.head?.map (·.costArg)).join.isNone do
        throw <| IO.userError "absent cost_arg must parse as none"
  | none => throw <| IO.userError "budget section lost (no cost_arg)"
  expectErrContaining "bad temporal type"
    (withSection "\"temporal\":{\"policies\":[{\"name\":\"n\",\"type\":\"eventually\",\"trigger\":[],\"forbidden\":[]}]}")
    "unsupported temporal policy type"
  expectErrContaining "bad calibration delta"
    (withSection "\"calibration\":{\"delta_num\":3,\"delta_den\":2,\"min_samples\":1,\"records_file\":\"r\",\"gated_tools\":[]}")
    "calibration delta must satisfy"

  -- ── Layer-1 parity backfill: Safety interior semantics pinned as fixtures ──

  let safetyWith (tools : String) : String :=
    "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[" ++ tools ++ "]}}"

  -- TTL: default 120 s, clamp at 300 s, stored in MILLISECONDS
  let ttlDefault ← expectOk "ttl default"
    "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\"},\"tools\":[]}}"
  unless ttlDefault.safety.approvalTtlMs == 120000 do
    throw <| IO.userError s!"ttl default must be 120000 ms: {ttlDefault.safety.approvalTtlMs}"
  let ttlClamped ← expectOk "ttl clamp"
    "{\"epoch\":1,\"safety\":{\"approval\":{\"control_file\":\"c\",\"ttl_seconds\":9999},\"tools\":[]}}"
  unless ttlClamped.safety.approvalTtlMs == 300000 do
    throw <| IO.userError s!"ttl must clamp to 300000 ms: {ttlClamped.safety.approvalTtlMs}"

  -- mode alias: guard and guarded parse to the same mode (both must carry
  -- the full-argument target after Stage A)
  let aliases ← expectOk "mode aliases"
    (safetyWith "{\"name\":\"a\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}]},{\"name\":\"b\",\"mode\":\"guarded\",\"target\":[{\"full_arguments\":true}]}")
  match aliases.safety.tools with
  | [ra, rb] =>
      unless ra.mode == Seal.ToolMode.guarded && rb.mode == Seal.ToolMode.guarded do
        throw <| IO.userError "guard/guarded alias broken"
  | _ => throw <| IO.userError "alias rules lost"

  -- defaults: absent match ⇒ .always, absent target ⇒ []
  let defaults ← expectOk "matcher/target defaults"
    (safetyWith "{\"name\":\"t\",\"mode\":\"allow\"}")
  match defaults.safety.tools with
  | [r] =>
      (match r.matcher with
       | .always => pure ()
       | m => throw <| IO.userError s!"default matcher must be always: {repr m}")
      unless r.target.isEmpty do
        throw <| IO.userError "default target must be []"
  | _ => throw <| IO.userError "default rule lost"

  -- matcher variants + dotted-path split (empty components dropped)
  let variants ← expectOk "matcher variants"
    (safetyWith
      ("{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":true}],\"match\":{\"type\":\"all\",\"matches\":[" ++
       "{\"type\":\"equals\",\"arg\":\"a..b.\",\"value\":\"v\"}," ++
       "{\"type\":\"starts_with\",\"arg\":\"p\",\"value\":\"pre\"}," ++
       "{\"type\":\"contains_any_ci\",\"arg\":\"q\",\"needles\":[\"DROP\"]}," ++
       "{\"type\":\"any\",\"matches\":[{\"type\":\"always\"}]}]}}"))
  match variants.safety.tools with
  | [r] =>
      match r.matcher with
      | .all [.equals p v, .startsWith _ pre, .containsAnyCi _ needles, .any [.always]] =>
          unless p == ["a", "b"] && v == "v" && pre == "pre" && needles == ["DROP"] do
            throw <| IO.userError "matcher variant fields wrong"
      | m => throw <| IO.userError s!"matcher variant shape wrong: {repr m}"
  | _ => throw <| IO.userError "variant rule lost"

  -- Stage A: a MIXED guarded target is a HARD PARSE ERROR (this fixture
  -- previously asserted a successful parse — the flip is the check that
  -- guard mode was actually restricted, not just theorem-ed about)
  expectErrContaining "mixed guarded target rejected"
    (safetyWith
      "{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"literal\":\"x\",\"arg\":\"ignored\"},{\"arg\":\"a.b\"},{\"full_arguments\":true}]}")
    "guard mode requires target"

  -- target-part parsing itself is unchanged: literal-first precedence and
  -- dotted-path split still resolve — witnessed on an allow rule, where a
  -- target never binds an approval
  let targets ← expectOk "target resolution (allow rule)"
    (safetyWith
      "{\"name\":\"t\",\"mode\":\"allow\",\"target\":[{\"literal\":\"x\",\"arg\":\"ignored\"},{\"arg\":\"a.b\"},{\"full_arguments\":true}]}")
  match targets.safety.tools with
  | [r] =>
      match r.target with
      | [.literal "x", .argPath ["a", "b"], .fullArguments] => pure ()
      | t => throw <| IO.userError s!"target resolution wrong: {repr t}"
  | _ => throw <| IO.userError "target rule lost"

  -- permissive interior: nested unknown keys tolerated in rule/matcher/target
  -- (the guarded target part may carry unknown keys as long as it PARSES to
  -- full_arguments)
  let _ ← expectOk "permissive interior"
    (safetyWith
      "{\"name\":\"t\",\"mode\":\"guard\",\"_comment\":\"c\",\"_seal_scaffold\":true,\"match\":{\"type\":\"always\",\"note\":1},\"target\":[{\"full_arguments\":true,\"junk\":[]}]}")

  -- rejects the interior DOES enforce
  expectErrContaining "guard arg target rejected" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"arg\":\"sql\"}]}")
    "guard mode requires target"
  expectErrContaining "guard literal target rejected" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"literal\":\"x\"}]}")
    "guard mode requires target"
  expectErrContaining "guard absent target rejected" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\"}")
    "guard mode requires target"
  expectErrContaining "guard empty target rejected" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"target\":[]}")
    "guard mode requires target"
  expectErrContaining "guard starts_with target part rejected" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"starts_with\":\"DROP\"}]}")
    "exactly one of"
  expectErrContaining "full_arguments false" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"full_arguments\":false}]}")
    "full_arguments must be true"
  expectErrContaining "ambiguous target part" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"target\":[{\"arg\":\"a\",\"full_arguments\":true}]}")
    "exactly one of"
  expectErrContaining "target not array" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"target\":{}}")
    "target must be an array"
  expectErrContaining "unsupported match type" (safetyWith
    "{\"name\":\"t\",\"mode\":\"guard\",\"match\":{\"type\":\"regex\"}}")
    "unsupported match type"
  expectErrContaining "unsupported mode" (safetyWith
    "{\"name\":\"t\",\"mode\":\"block\"}")
    "unsupported tool mode"

  -- schema projection sanity: the codec carries the derived schema
  unless Seal.policyBundleSchema == Seal.policyBundleCodec.schema do
    throw <| IO.userError "policyBundleSchema must be the codec schema projection"

  IO.println "POLICY-BUNDLE TESTS PASS"
