/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import Seal.Policy
import Seal.JsonUtil
import Seal.PolicyWire

/-!
# The 7-kernel policy bundle — the policy-v2 DX surface

The live gate is seven proven AND-composed kernels (S/T/C/V/K/L/B), but until
this module the verified policy-v2 vocabulary (`Seal.Policy`,
`parsePolicyJson`) expressed only Safety; the six other kernel sections were
parsed by ad-hoc, theorem-free parsers on the host side. This module makes the
whole 7-kernel configuration part of the verified policy language:

* one declarative structure per kernel section, mirroring the wire schema the
  host already documents (`seal-host/CONFIG.md`) — wire key names are frozen
  so every existing signed payload keeps parsing;
* a uniform `enabled` flag per optional section (default `true`;
  `enabled := false` collapses the section to absent via the `effective*`
  functions BEFORE any host mapping, so "disabled" and "absent" are
  indistinguishable downstream). Calibration is the deliberate exception: its
  `enabled` default stays `false` (EXPERIMENTAL, opt-in twice) and a present
  `enabled := false` section stays *present-but-disabled* — a distinct,
  theorem-pinned state on the host side (`calibration_registered_iff`);
* hard errors on unknown keys at the payload, section, and entry levels
  (`Seal.JsonUtil.expectObjKeys`) — parser-boundary discipline: a typo such
  as `temporral` must not silently leave a kernel off.

Since the codec refactor, every section is a schema-carrying `WireCodec`
(`Seal/PolicyWire.lean`): the field list of each `ObjSpec` drives the parse,
the strict-key allowlist, AND the JSON-Schema properties, so
`parsePolicyBundle` and `policyBundleSchema` are projections of the same
specs and physically cannot drift. Layer-1 equivalence with the pre-codec
parsers is proven in `Seal/PolicyEquiv.lean`.

Safety (S) and Temporal (T) are registered unconditionally by the host
(`safety_always_registered` / `temporal_always_registered`); they are
configurable but not de-registrable, so `safety` carries no `enabled` key and
a disabled/absent `temporal` section merely leaves T vacuous (empty policy
list), never unregistered.

The host wires `PolicyBundle` into the proven kernel registry
(`seal-host/Host/Config.lean` `ofBundle` and the `bundle_*_registered_iff`
tripwires in `FfiSpec.lean`).
-/

namespace Seal

open Lean
open Seal.JsonUtil

/-- One temporal LTL safety rule: after any `trigger` tool executes, every
    `forbidden` tool is denied for the rest of the session (`no_after`). -/
structure TemporalRule where
  name : String
  trigger : List String
  forbidden : List String
  deriving Repr, BEq

structure TemporalSection where
  enabled : Bool := true
  policies : List TemporalRule
  deriving Repr, BEq

structure ConsensusSection where
  enabled : Bool := true
  roster : List Nat
  votesFile : String
  highStakes : List String
  deriving Repr, BEq

/-- A replicated-store tool gated by the Convergence kernel; `opArg` is the
    dotted argument path resolving the CRDT operation name. -/
structure ConvergentTool where
  tool : String
  opArg : List String
  deriving Repr, BEq

structure ConvergenceSection where
  enabled : Bool := true
  tools : List ConvergentTool
  deriving Repr, BEq

/-- EXPERIMENTAL. `enabled` defaults to `false`: calibration must be opted
    into twice (present AND enabled), preserving the host's existing
    double-gate semantics. -/
structure CalibrationSection where
  enabled : Bool := false
  deltaNum : Nat
  deltaDen : Nat
  minSamples : Nat
  recordsFile : String
  gatedTools : List String
  deriving Repr, BEq

structure LinearGrantTool where
  tool : String
  capArg : List String
  deriving Repr, BEq

structure LinearSection where
  enabled : Bool := true
  grantsFile : String
  tools : List LinearGrantTool
  deriving Repr, BEq

structure BudgetRule where
  name : String
  cap : Nat
  tools : List String
  costArg : Option (List String) := none
  deriving Repr, BEq

structure BudgetSection where
  enabled : Bool := true
  budgets : List BudgetRule
  deriving Repr, BEq

/-- One registered principal: the operator-pinned (id, Ed25519 verifying-key
    hex) pair. The registry lives INSIDE the signed config — key→principal
    binding is out-of-band trust, never a request field. -/
structure PrincipalKeyEntry where
  id : String
  pubkey : String
  deriving Repr, BEq

/-- The V2.1 principals section: the key registry plus per-principal budget
    specs (each budget enforced separately per authenticated principal —
    state keyed (principal id, budget name) on the host side). -/
structure PrincipalsSection where
  enabled : Bool := true
  keys : List PrincipalKeyEntry
  budgets : List BudgetRule
  deriving Repr, BEq

/-- The 7-kernel policy bundle: the policy-v2 DX surface. Safety is the
    existing verified `Policy`; the six kernel sections are declarative and
    optional. `principals` (V2.1) adds the signed-envelope principal registry
    and per-principal budgets. -/
structure PolicyBundle where
  epoch : Nat
  safety : Policy
  temporal : Option TemporalSection := none
  consensus : Option ConsensusSection := none
  convergence : Option ConvergenceSection := none
  calibration : Option CalibrationSection := none
  linear : Option LinearSection := none
  budget : Option BudgetSection := none
  principals : Option PrincipalsSection := none
  deriving Repr

/-! ## Effective sections

`enabled := false` collapses to absent BEFORE any host mapping. Calibration is
deliberately NOT collapsed: present-but-disabled is a distinct state the host
pins with its own theorem (`calibration_registered_iff` double gate). -/

def PolicyBundle.effectiveTemporal (b : PolicyBundle) : List TemporalRule :=
  match b.temporal with
  | some s => if s.enabled then s.policies else []
  | none => []

def PolicyBundle.effectiveConsensus (b : PolicyBundle) : Option ConsensusSection :=
  match b.consensus with
  | some s => if s.enabled then some s else none
  | none => none

def PolicyBundle.effectiveConvergence (b : PolicyBundle) : List ConvergentTool :=
  match b.convergence with
  | some s => if s.enabled then s.tools else []
  | none => []

def PolicyBundle.effectiveLinear (b : PolicyBundle) : Option LinearSection :=
  match b.linear with
  | some s => if s.enabled then some s else none
  | none => none

def PolicyBundle.effectiveBudget (b : PolicyBundle) : List BudgetRule :=
  match b.budget with
  | some s => if s.enabled then s.budgets else []
  | none => []

def PolicyBundle.effectivePrincipals (b : PolicyBundle) : Option PrincipalsSection :=
  match b.principals with
  | some s => if s.enabled then some s else none
  | none => none

/-! ## Enablement lemmas

Executable-twin statements for the host-side registration tripwires: the
`effective*` view is exactly "section present and enabled". -/

theorem effectiveConsensus_isSome_iff (b : PolicyBundle) :
    b.effectiveConsensus.isSome ↔ ∃ s, b.consensus = some s ∧ s.enabled = true := by
  cases h : b.consensus with
  | none => simp [PolicyBundle.effectiveConsensus, h]
  | some s =>
      cases he : s.enabled <;>
        simp [PolicyBundle.effectiveConsensus, h, he]

theorem effectiveLinear_isSome_iff (b : PolicyBundle) :
    b.effectiveLinear.isSome ↔ ∃ s, b.linear = some s ∧ s.enabled = true := by
  cases h : b.linear with
  | none => simp [PolicyBundle.effectiveLinear, h]
  | some s =>
      cases he : s.enabled <;>
        simp [PolicyBundle.effectiveLinear, h, he]

theorem effectiveTemporal_nil_of_disabled (b : PolicyBundle) (s : TemporalSection)
    (h : b.temporal = some s) (hd : s.enabled = false) :
    b.effectiveTemporal = [] := by
  simp [PolicyBundle.effectiveTemporal, h, hd]

theorem effectiveConvergence_ne_nil_iff (b : PolicyBundle) :
    b.effectiveConvergence ≠ [] ↔
      ∃ s, b.convergence = some s ∧ s.enabled = true ∧ s.tools ≠ [] := by
  cases h : b.convergence with
  | none => simp [PolicyBundle.effectiveConvergence, h]
  | some s =>
      cases he : s.enabled <;>
        simp [PolicyBundle.effectiveConvergence, h, he]

theorem effectiveBudget_ne_nil_iff (b : PolicyBundle) :
    b.effectiveBudget ≠ [] ↔
      ∃ s, b.budget = some s ∧ s.enabled = true ∧ s.budgets ≠ [] := by
  cases h : b.budget with
  | none => simp [PolicyBundle.effectiveBudget, h]
  | some s =>
      cases he : s.enabled <;>
        simp [PolicyBundle.effectiveBudget, h, he]

theorem effectivePrincipals_isSome_iff (b : PolicyBundle) :
    b.effectivePrincipals.isSome ↔
      ∃ s, b.principals = some s ∧ s.enabled = true := by
  cases h : b.principals with
  | none => simp [PolicyBundle.effectivePrincipals, h]
  | some s =>
      cases he : s.enabled <;>
        simp [PolicyBundle.effectivePrincipals, h, he]

/-! ## Section codecs

One `ObjSpec` per section/entry: field list ⇒ parse ⇒ allowlist ⇒ schema.
Field-chain order equals the pre-codec parse order (error priority is part of
the preserved behavior). -/

/-- The temporal rule discriminator: only `no_after` exists. -/
def noAfterCodec : WireCodec Unit :=
  ⟨fun j => do
    let kind ← j.getStr?
    if kind != "no_after" then
      throw s!"unsupported temporal policy type: {kind}",
   Json.mkObj [("const", Json.str "no_after")]⟩

def temporalRuleSpec : ObjSpec TemporalRule :=
  ObjSpec.start
    |>.field "name" strCodec
    |>.field "type" noAfterCodec
    |>.field "trigger" (arrCodec strCodec)
    |>.field "forbidden" (arrCodec strCodec)
    |>.emit fun ((((_, name), _), trigger), forbidden) =>
        { name, trigger, forbidden }

def temporalRuleCodec : WireCodec TemporalRule :=
  .strictObj "temporal policy" temporalRuleSpec

def temporalSectionSpec : ObjSpec TemporalSection :=
  ObjSpec.start
    |>.fieldD "enabled" boolCodec true
    |>.field "policies" (arrCodec temporalRuleCodec)
    |>.emit fun ((_, enabled), policies) => { enabled, policies }

def temporalSectionCodec : WireCodec TemporalSection :=
  .strictObj "temporal section" temporalSectionSpec

def consensusSectionSpec : ObjSpec ConsensusSection :=
  ObjSpec.start
    |>.fieldD "enabled" boolCodec true
    |>.field "roster" (arrCodec natCodec)
    |>.field "votes_file" strCodec
    |>.field "high_stakes" (arrCodec strCodec)
    |>.emit fun ((((_, enabled), roster), votesFile), highStakes) =>
        { enabled, roster, votesFile, highStakes }

def consensusSectionCodec : WireCodec ConsensusSection :=
  .strictObj "consensus section" consensusSectionSpec

def convergentToolSpec : ObjSpec ConvergentTool :=
  ObjSpec.start
    |>.field "tool" strCodec
    |>.field "op_arg" pathCodec
    |>.emit fun ((_, tool), opArg) => { tool, opArg }

def convergentToolCodec : WireCodec ConvergentTool :=
  .strictObj "convergence tool" convergentToolSpec

def convergenceSectionSpec : ObjSpec ConvergenceSection :=
  ObjSpec.start
    |>.fieldD "enabled" boolCodec true
    |>.field "tools" (arrCodec convergentToolCodec)
    |>.emit fun ((_, enabled), tools) => { enabled, tools }

def convergenceSectionCodec : WireCodec ConvergenceSection :=
  .strictObj "convergence section" convergenceSectionSpec

def calibrationSectionSpec : ObjSpec CalibrationSection :=
  ObjSpec.start
    |>.fieldD "enabled" boolCodec false
    |>.field "delta_num" natCodec
    |>.field "delta_den" natCodec
    |>.check (fun (((_, _), deltaNum), deltaDen) =>
        if deltaNum == 0 || deltaDen ≤ deltaNum then
          throw "calibration delta must satisfy 0 < delta < 1"
        else pure ())
    |>.field "min_samples" natCodec
    |>.field "records_file" strCodec
    |>.field "gated_tools" (arrCodec strCodec)
    |>.emit fun ((((((_, enabled), deltaNum), deltaDen), minSamples),
                  recordsFile), gatedTools) =>
        { enabled, deltaNum, deltaDen, minSamples, recordsFile, gatedTools }

def calibrationSectionCodec : WireCodec CalibrationSection :=
  .strictObj "calibration section" calibrationSectionSpec

def linearToolSpec : ObjSpec LinearGrantTool :=
  ObjSpec.start
    |>.field "tool" strCodec
    |>.field "cap_arg" pathCodec
    |>.emit fun ((_, tool), capArg) => { tool, capArg }

def linearToolCodec : WireCodec LinearGrantTool :=
  .strictObj "linear tool" linearToolSpec

def linearSectionSpec : ObjSpec LinearSection :=
  ObjSpec.start
    |>.fieldD "enabled" boolCodec true
    |>.field "grants_file" strCodec
    |>.field "tools" (arrCodec linearToolCodec)
    |>.emit fun (((_, enabled), grantsFile), tools) =>
        { enabled, grantsFile, tools }

def linearSectionCodec : WireCodec LinearSection :=
  .strictObj "linear section" linearSectionSpec

def budgetRuleSpec : ObjSpec BudgetRule :=
  ObjSpec.start
    |>.field "name" strCodec
    |>.field "cap" natCodec
    |>.field "tools" (arrCodec strCodec)
    |>.fieldOpt "cost_arg" pathCodec
    |>.emit fun ((((_, name), cap), tools), costArg) =>
        { name, cap, tools, costArg }

def budgetRuleCodec : WireCodec BudgetRule :=
  .strictObj "budget spec" budgetRuleSpec

def budgetSectionSpec : ObjSpec BudgetSection :=
  ObjSpec.start
    |>.fieldD "enabled" boolCodec true
    |>.field "budgets" (arrCodec budgetRuleCodec)
    |>.emit fun ((_, enabled), budgets) => { enabled, budgets }

def budgetSectionCodec : WireCodec BudgetSection :=
  .strictObj "budget section" budgetSectionSpec

private def isHexChar (c : Char) : Bool :=
  c.isDigit || ('a' ≤ c && c ≤ 'f') || ('A' ≤ c && c ≤ 'F')

/-- Principal id on the wire: a string the section-level check requires
    non-empty (schema states `minLength: 1`; parse projection is plain
    `getStr?` so the check fires in the pre-codec order). -/
def principalIdCodec : WireCodec String :=
  ⟨strCodec.parse,
   Json.mkObj [("type", Json.str "string"), ("minLength", Json.num 1)]⟩

/-- Principal pubkey on the wire: 64 hex chars (an Ed25519 verifying key);
    the schema pattern states the same lint the parse-time check enforces. -/
def principalPubkeyCodec : WireCodec String :=
  ⟨strCodec.parse,
   Json.mkObj [("type", Json.str "string"),
               ("pattern", Json.str "^[0-9a-fA-F]{64}$")]⟩

/-- V2.1 principal key entry. Parse-time fail-closed lints: non-empty ids
    and 64-hex-char pubkeys. The host's `verifyEnvelope` re-checks the
    decoded key length (32 bytes) at use — the lint here fails malformed
    registries at signing/load time instead of turning every envelope into a
    silent deny. -/
def principalKeySpec : ObjSpec PrincipalKeyEntry :=
  ObjSpec.start
    |>.field "id" principalIdCodec
    |>.field "pubkey" principalPubkeyCodec
    |>.check (fun ((_, id), pubkey) => do
        if id.isEmpty then
          throw "principal id must be non-empty"
        if pubkey.length != 64 || !(pubkey.toList.all isHexChar) then
          throw s!"principal pubkey must be 64 hex chars: {id}")
    |>.emit fun ((_, id), pubkey) => { id, pubkey }

def principalKeyCodec : WireCodec PrincipalKeyEntry :=
  .strictObj "principal key" principalKeySpec

def principalsSectionSpec : ObjSpec PrincipalsSection :=
  ObjSpec.start
    |>.fieldD "enabled" boolCodec true
    |>.field "keys" (arrCodec principalKeyCodec)
    |>.field "budgets" (arrCodec budgetRuleCodec)
    |>.emit fun (((_, enabled), keys), budgets) => { enabled, keys, budgets }

def principalsSectionCodec : WireCodec PrincipalsSection :=
  .strictObj "principals section" principalsSectionSpec

/-! ## Compatibility parser names (thin projections of the codecs) -/

def parseTemporalSection : Json → Except String TemporalSection :=
  temporalSectionCodec.parse

def parseConsensusSection : Json → Except String ConsensusSection :=
  consensusSectionCodec.parse

def parseConvergenceSection : Json → Except String ConvergenceSection :=
  convergenceSectionCodec.parse

def parseCalibrationSection : Json → Except String CalibrationSection :=
  calibrationSectionCodec.parse

def parseLinearSection : Json → Except String LinearSection :=
  linearSectionCodec.parse

def parseBudgetSection : Json → Except String BudgetSection :=
  budgetSectionCodec.parse

def parsePrincipalsSection : Json → Except String PrincipalsSection :=
  principalsSectionCodec.parse

def parseOptSection {α : Type} (json : Json) (key : String)
    (parse : Json → Except String α) : Except String (Option α) := do
  match ← getObjValOpt json key with
  | none => pure none
  | some section_ => pure (some (← parse section_))

/-! ## Bundle envelope: derived key lists and schema -/

/-- Epoch: a positive counter (`epoch == 0` is rejected by the parser; the
    schema states the same bound as `minimum: 1`). -/
def epochSchema : Json :=
  Json.mkObj [("type", Json.str "integer"), ("minimum", Json.num 1)]

/-- The safety section's schema inside a BUNDLE: the same `policySpecWith`
    spec the parser runs, projected strict (`additionalProperties: false`
    at the section and approval levels — the `expectObjKeys` overlays
    `parsePolicyBundle` applies before delegating to `parsePolicyJson`). -/
def safetySectionSchema : Json :=
  (policySpecWith ⟨(WireCodec.openObj approvalSpec).parse,
                   approvalSpec.objSchema true⟩).objSchema true

/-- The shallow keys of the `safety` section, derived from the SAME spec
    `parsePolicyJson` runs. The interior of `tools` rules stays the
    permissive `parsePolicyJson` boundary (its strictness is the authoring
    signer's job). -/
def safetyShallowKeys : List String :=
  (policySpecWith (.openObj approvalSpec)).keys

/-- The `approval` keys, derived from `approvalSpec`: the parsed fields plus
    `replay_store`, the documented host-layer replay-store pointer whose
    interior the host consumes. -/
def approvalKeys : List String := approvalSpec.keys

/-- Head properties of the bundle payload (parsed by the bespoke envelope
    code below), then one property per kernel-section codec. This single
    table drives BOTH the top-level allowlist and the schema properties. -/
def bundleHeadProps : List (String × Json) :=
  [("epoch", epochSchema),
   ("server", strCodec.schema),
   ("safety", safetySectionSchema)]

def bundleSectionProps : List (String × Json) :=
  [("temporal", temporalSectionCodec.schema),
   ("consensus", consensusSectionCodec.schema),
   ("convergence", convergenceSectionCodec.schema),
   ("calibration", calibrationSectionCodec.schema),
   ("linear", linearSectionCodec.schema),
   ("budget", budgetSectionCodec.schema),
   ("principals", principalsSectionCodec.schema)]

/-- The keys a bundle payload may carry at the top level (derived from the
    property table — no independent list). -/
def bundleTopLevelKeys : List String :=
  (bundleHeadProps ++ bundleSectionProps).map (·.1)

/-- The bundle payload's JSON Schema: a projection of the same specs
    `parsePolicyBundle` parses with. Parser-only refinements that JSON Schema
    cannot express (outer/inner `server` conflict, `delta_den > delta_num`,
    the TTL clamp semantics, dropped empty dotted-path components) are
    documented in seal-host `CONFIG.md`; `seal validate` runs the Lean parser
    AND this schema in the same invocation, so the gap is gated, not trusted. -/
def policyBundleSchemaJson : Json :=
  Json.mkObj
    [("$schema", Json.str "https://json-schema.org/draft/2020-12/schema"),
     ("title", Json.str "Seal policy-v2 bundle payload"),
     ("type", Json.str "object"),
     ("properties", Json.mkObj (bundleHeadProps ++ bundleSectionProps)),
     ("required", Json.arr #[Json.str "epoch", Json.str "safety"]),
     ("additionalProperties", Json.bool false),
     ("$defs", Json.mkObj [("match", matchSchemaDef)])]

/-- Top-level bundle parser: the whole 7-kernel policy-v2 config surface.

    Strict keys at the payload, section, and entry levels — every allowlist
    and section parse is a projection of the codecs above. Safety's interior
    is parsed by the existing verified `parsePolicyJson`; a top-level `server`
    is copied into the safety policy when the safety section carries none, and
    a conflict between the two is a hard error (identical semantics to the
    host enrichment this parser replaces). -/
def parsePolicyBundle (json : Json) : Except String PolicyBundle := do
  expectObjKeys json bundleTopLevelKeys "policy bundle"
  let epoch ← (← json.getObjVal? "epoch").getNat?
  if epoch == 0 then
    throw "config epoch must be ≥ 1"
  let safetyJson ← json.getObjVal? "safety"
  expectObjKeys safetyJson safetyShallowKeys "safety section"
  expectObjKeys (← safetyJson.getObjVal? "approval") approvalKeys "safety approval"
  let outerServer ← match ← getObjValOpt json "server" with
    | some value => pure (some (← value.getStr?))
    | none => pure none
  let innerServer ← match ← getObjValOpt safetyJson "server" with
    | some value => pure (some (← value.getStr?))
    | none => pure none
  if outerServer.isSome && innerServer.isSome && outerServer != innerServer then
    throw "server identity conflicts between trusted config and safety policy"
  let safetyJson := match outerServer, innerServer with
    | some server, none => safetyJson.setObjVal! "server" (.str server)
    | _, _ => safetyJson
  let safety ← parsePolicyJson safetyJson
  let temporal ← parseOptSection json "temporal" parseTemporalSection
  let consensus ← parseOptSection json "consensus" parseConsensusSection
  let convergence ← parseOptSection json "convergence" parseConvergenceSection
  let calibration ← parseOptSection json "calibration" parseCalibrationSection
  let linear ← parseOptSection json "linear" parseLinearSection
  let budget ← parseOptSection json "budget" parseBudgetSection
  let principals ← parseOptSection json "principals" parsePrincipalsSection
  pure { epoch, safety, temporal, consensus, convergence, calibration, linear,
         budget, principals }

/-- THE bundle codec: `parsePolicyBundle` and `policyBundleSchemaJson` bound
    into one value — the single source `seal schema` / `seal validate`
    project from. -/
def policyBundleCodec : WireCodec PolicyBundle :=
  ⟨parsePolicyBundle, policyBundleSchemaJson⟩

def policyBundleSchema : Json := policyBundleCodec.schema

/-! ## Axiom pins -/

/-- info: 'Seal.effectiveConsensus_isSome_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effectiveConsensus_isSome_iff

/-- info: 'Seal.effectiveLinear_isSome_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effectiveLinear_isSome_iff

/-- info: 'Seal.effectiveTemporal_nil_of_disabled' depends on axioms: [propext] -/
#guard_msgs in
#print axioms effectiveTemporal_nil_of_disabled

/-- info: 'Seal.effectiveConvergence_ne_nil_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effectiveConvergence_ne_nil_iff

/-- info: 'Seal.effectiveBudget_ne_nil_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effectiveBudget_ne_nil_iff

/-- info: 'Seal.effectivePrincipals_isSome_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms effectivePrincipals_isSome_iff

end Seal
