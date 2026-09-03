/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import SealCore.Event
import Seal.EffectCommitment
import Seal.Policy

namespace Seal

open Lean
open SealCore
open Seal.JsonUtil

inductive HostEvent where
  | event (event : Event) (targetText : String)
  deriving Repr

def HostEvent.toEvent : HostEvent → Event
  | .event e _ => e

def HostEvent.targetText : HostEvent → String
  | .event _ targetText => targetText

/-- Total (kernel-visible) match evaluation. `attach` threads the membership
    witness so the nested `all`/`any` recursion is accepted without `partial`;
    proofs about `classifyToolCall` may therefore unfold rule evaluation. -/
def matchSpec (spec : MatchSpec) (args : Json) : Bool :=
  match spec with
  | .always => true
  | .equals path expected =>
      (atPath args path >>= jsonScalarToString).any (· == expected)
  | .startsWith path prefixValue =>
      (atPath args path >>= jsonScalarToString).any (·.startsWith prefixValue)
  | .containsAnyCi path needles =>
      match atPath args path >>= jsonScalarToString with
      | some value => containsAnyCi value needles
      | none => false
  | .all specs => specs.attach.all (fun child => matchSpec child.val args)
  | .any specs => specs.attach.any (fun child => matchSpec child.val args)
termination_by sizeOf spec
decreasing_by
  all_goals
    have := List.sizeOf_lt_of_mem child.property
    simp only [MatchSpec.all.sizeOf_spec, MatchSpec.any.sizeOf_spec]
    omega

def matchRule (rule : ToolRule) (args : Json) : Bool :=
  matchSpec rule.matcher args

def evalTargetParts (parts : List TargetPart) (args : Json) : Option (List String) :=
  parts.mapM fun part =>
    match part with
    | .literal value => some value
    | .argPath path => atPath args path >>= jsonScalarToString
    | .fullArguments => some args.compress

def targetPrefix (policy : Policy) (toolName : String) : List String :=
  if policy.serverIdentity.isEmpty then [toolName]
  else [policy.serverIdentity, toolName]

/-- **PROPOSED** guard-target domain tag for the metadata-bearing target
    shape. The legacy target had no explicit domain tag. Changing this proposal
    later invalidates every target, approval, capability, and replay key that
    depends on it. MRTR extends this same still-unpinned Phase-M proposal rather
    than creating a second pre-repin target domain. -/
def guardTargetDomainTag : String := "seal.guard-target/v2-proposed-meta-all"

/-- The exact proposed Phase-M guarded-target preimage. Policy matching and
    target-part selection inspect arguments only. Complete metadata, opaque
    request state, and complete input responses are appended only after those
    decisions. -/
def guardTargetPartsWithContext (policy : Policy) (toolName : String)
    (resolvedParts : List String) (metadata : ValidatedMeta)
    (requestState : RequestState) (inputResponses : InputResponses) :
    List String :=
  [guardTargetDomainTag] ++ targetPrefix policy toolName ++ resolvedParts ++
    metadata.preimageParts ++ requestState.preimageParts ++
    inputResponses.preimageParts

def guardTargetWithContext (policy : Policy) (toolName : String)
    (resolvedParts : List String) (metadata : ValidatedMeta)
    (requestState : RequestState) (inputResponses : InputResponses) :
    TargetHash :=
  stableHashParts
    (guardTargetPartsWithContext policy toolName resolvedParts metadata
      requestState inputResponses)

/-- M.1 compatibility surface: metadata-bearing, MRTR-absent target. -/
def guardTargetParts (policy : Policy) (toolName : String)
    (resolvedParts : List String) (metadata : ValidatedMeta) : List String :=
  guardTargetPartsWithContext policy toolName resolvedParts metadata .absent .absent

/-- M.1 compatibility surface: metadata-bearing, MRTR-absent target. -/
def guardTarget (policy : Policy) (toolName : String)
    (resolvedParts : List String) (metadata : ValidatedMeta) : TargetHash :=
  guardTargetWithContext policy toolName resolvedParts metadata .absent .absent

/-- Equal arguments and all equal context except `requestState` cannot share a
    proved guard target in the named collision-free model. -/
theorem guard_target_separates_requestState
    (hcr : AssumptionCR) (henc : AssumptionEncInjective)
    (hcompress : AssumptionCompressInjective)
    (policy : Policy) (toolName : String) (resolvedParts : List String)
    (metadata : ValidatedMeta) (inputResponses : InputResponses)
    (left right : RequestState) (hne : left ≠ right) :
    guardTargetWithContext policy toolName resolvedParts metadata left inputResponses ≠
      guardTargetWithContext policy toolName resolvedParts metadata right
        inputResponses := by
  intro htarget
  have hhex := congrArg (fun target : TargetHash => target.toHex) htarget
  have hstr :
      encodeParts
          (guardTargetPartsWithContext policy toolName resolvedParts metadata left
            inputResponses) =
        encodeParts
          (guardTargetPartsWithContext policy toolName resolvedParts metadata right
            inputResponses) := by
    exact hcr _ _ (by simpa [guardTargetWithContext, stableHashParts] using hhex)
  have hparts := henc _ _ hstr
  simp only [guardTargetPartsWithContext] at hparts
  have hwithoutResponses := List.append_cancel_right hparts
  have hstateParts : left.preimageParts = right.preimageParts :=
    List.append_cancel_left hwithoutResponses
  exact hne (RequestState.preimageParts_injective hcompress hstateParts)

/-- Equal arguments and all equal context except `inputResponses` cannot share
    a proved guard target in the named collision-free model. -/
theorem guard_target_separates_inputResponses
    (hcr : AssumptionCR) (henc : AssumptionEncInjective)
    (hcompress : AssumptionCompressInjective)
    (policy : Policy) (toolName : String) (resolvedParts : List String)
    (metadata : ValidatedMeta) (requestState : RequestState)
    (left right : InputResponses) (hne : left ≠ right) :
    guardTargetWithContext policy toolName resolvedParts metadata requestState left ≠
      guardTargetWithContext policy toolName resolvedParts metadata requestState
        right := by
  intro htarget
  have hhex := congrArg (fun target : TargetHash => target.toHex) htarget
  have hstr :
      encodeParts
          (guardTargetPartsWithContext policy toolName resolvedParts metadata
            requestState left) =
        encodeParts
          (guardTargetPartsWithContext policy toolName resolvedParts metadata
            requestState right) := by
    exact hcr _ _ (by simpa [guardTargetWithContext, stableHashParts] using hhex)
  have hparts := henc _ _ hstr
  simp only [guardTargetPartsWithContext] at hparts
  have hresponsesParts : left.preimageParts = right.preimageParts :=
    List.append_cancel_left hparts
  exact hne
    (InputResponses.preimageParts_injective hcompress hresponsesParts)

/-- Structural absence is distinct from every present request-state value,
    including `{}` and JSON `null`; no sentinel can collapse them. -/
theorem guard_target_requestState_absent_ne_present
    (hcr : AssumptionCR) (henc : AssumptionEncInjective)
    (hcompress : AssumptionCompressInjective)
    (policy : Policy) (toolName : String) (resolvedParts : List String)
    (metadata : ValidatedMeta) (inputResponses : InputResponses)
    (value : Json) :
    guardTargetWithContext policy toolName resolvedParts metadata .absent
        inputResponses ≠
      guardTargetWithContext policy toolName resolvedParts metadata
        (.present value) inputResponses :=
  guard_target_separates_requestState hcr henc hcompress policy toolName
    resolvedParts metadata inputResponses .absent (.present value) (by
      intro h
      cases h)

/-- Structural absence is distinct from every present input-responses value,
    including `{}` and JSON `null`; no sentinel can collapse them. -/
theorem guard_target_inputResponses_absent_ne_present
    (hcr : AssumptionCR) (henc : AssumptionEncInjective)
    (hcompress : AssumptionCompressInjective)
    (policy : Policy) (toolName : String) (resolvedParts : List String)
    (metadata : ValidatedMeta) (requestState : RequestState) (value : Json) :
    guardTargetWithContext policy toolName resolvedParts metadata requestState
        .absent ≠
      guardTargetWithContext policy toolName resolvedParts metadata requestState
        (.present value) :=
  guard_target_separates_inputResponses hcr henc hcompress policy toolName
    resolvedParts metadata requestState .absent (.present value) (by
      intro h
      cases h)

inductive RuleDecision where
  | allow
  | guard (target : TargetHash) (targetText : String)
  | deny (reason : String)
  | invalid (reason : String)
  deriving Repr, BEq

def evaluateRuleWithContext (policy : Policy) (toolName : String) (args : Json)
    (metadata : ValidatedMeta) (requestState : RequestState)
    (inputResponses : InputResponses)
    (rule : ToolRule) : Option RuleDecision :=
  if rule.name != toolName || !matchRule rule args then none
  else match rule.mode with
    | .allow => some .allow
    | .deny => some (.deny s!"flat deny: {toolName}")
    | .guarded =>
        match evalTargetParts rule.target args with
        | some parts =>
            let target :=
              guardTargetWithContext policy toolName parts metadata requestState
                inputResponses
            some (.guard target target.toHex)
        | none => some (.invalid s!"missing target field: {toolName}")

/-- M.1 compatibility surface: explicit metadata with both MRTR fields
    structurally absent. -/
def evaluateRuleWithMeta (policy : Policy) (toolName : String) (args : Json)
    (metadata : ValidatedMeta)
    (rule : ToolRule) : Option RuleDecision :=
  evaluateRuleWithContext policy toolName args metadata .absent .absent rule

/-- Legacy-era convenience surface: absence is represented explicitly and is
    therefore distinct from a call carrying `_meta: {}`. -/
def evaluateRule (policy : Policy) (toolName : String) (args : Json)
    (rule : ToolRule) : Option RuleDecision :=
  evaluateRuleWithMeta policy toolName args .absent rule

def firstBlocking? : List RuleDecision → Option String
  | [] => none
  | .deny reason :: _ => some reason
  | .invalid reason :: _ => some reason
  | _ :: rest => firstBlocking? rest

def guardDecisions (decisions : List RuleDecision) : List (TargetHash × String) :=
  decisions.filterMap fun decision => match decision with
    | .guard target text => some (target, text)
    | _ => none

def hasExplicitAllow (decisions : List RuleDecision) : Bool :=
  decisions.any (· == .allow)

def sameGuardTarget (first : TargetHash × String) (rest : List (TargetHash × String)) : Bool :=
  rest.all (fun next => next.1 == first.1)

def resolveRuleDecisions (decisions : List RuleDecision) : HostEvent :=
  match firstBlocking? decisions with
  | some reason => .event .defaultDeny reason
  | none =>
      match guardDecisions decisions with
      | first :: rest =>
          if sameGuardTarget first rest then .event (.guarded first.1) first.2
          else .event .defaultDeny "ambiguous guard target"
      | [] =>
          if hasExplicitAllow decisions then .event .benign "explicit policy allow"
          else .event .defaultDeny "no matching policy rule"

def classifyToolCallWithContext (policy : Policy) (toolName : String) (args : Json)
    (metadata : ValidatedMeta) (requestState : RequestState)
    (inputResponses : InputResponses) : HostEvent :=
  resolveRuleDecisions
    (policy.tools.filterMap
      (evaluateRuleWithContext policy toolName args metadata requestState
        inputResponses))

/-- M.1 compatibility surface: explicit metadata with both MRTR fields
    structurally absent. -/
def classifyToolCallWithMeta (policy : Policy) (toolName : String) (args : Json)
    (metadata : ValidatedMeta) : HostEvent :=
  classifyToolCallWithContext policy toolName args metadata .absent .absent

/-- Legacy-era convenience surface with explicit metadata absence. -/
def classifyToolCall (policy : Policy) (toolName : String) (args : Json) : HostEvent :=
  classifyToolCallWithMeta policy toolName args .absent

/-- Compatibility equation for legacy-era proofs: the explicit-absence
    wrapper is definitionally the original rule-resolution shape. -/
theorem classifyToolCall_eq_resolve (policy : Policy) (toolName : String)
    (args : Json) :
    classifyToolCall policy toolName args =
      resolveRuleDecisions (policy.tools.filterMap (evaluateRule policy toolName args)) :=
  rfl

def toolsCall? (json : Json) : Option (String × Json) := do
  let methodJson ← (json.getObjVal? "method").toOption
  let method ← methodJson.getStr?.toOption
  if method != "tools/call" then
    none
  else
    let params ← (json.getObjVal? "params").toOption
    let nameJson ← (params.getObjVal? "name").toOption
    let name ← nameJson.getStr?.toOption
    let args := (params.getObjVal? "arguments").toOption.getD Json.null
    some (name, args)

/-- Extract a complete structurally validated `_meta` object from tool-call
    params. Absence remains a first-class value. Present null, array, scalar,
    or boolean metadata is rejected rather than collapsed into absence. Known
    field type/format and revision validation is a later protocol-boundary
    obligation; no key, including an unknown key, is projected away here. -/
def validatedMetaFromParams (params : Json) : Except String ValidatedMeta := do
  let object ← params.getObj?
  match object.get? "_meta" with
  | none => pure .absent
  | some (.obj metaObject) => pure (.present metaObject)
  | some _ => throw "`params._meta` must be an object"

/-- Extract `requestState` without interpreting it. Structural absence is a
    constructor; every present JSON value, including `null` and `{}`, remains
    present and is committed exactly as a value. -/
def requestStateFromParams (params : Json) : Except String RequestState := do
  let object ← params.getObj?
  match object.get? "requestState" with
  | none => pure .absent
  | some value => pure (.present value)

/-- Extract the complete `inputResponses` JSON value. Shape validation belongs
    to the protocol-validation stage; this identity stage projects nothing. -/
def inputResponsesFromParams (params : Json) : Except String InputResponses := do
  let object ← params.getObj?
  match object.get? "inputResponses" with
  | none => pure .absent
  | some value => pure (.present value)

/-- Complete identity-bearing tool-call extraction for the live V1 classifier.
    `none` means a non-`tools/call`; `.error` is a malformed tool call that
    must fail closed before authority classification. -/
def toolsCallWithContext? (json : Json) :
    Except String
      (Option
        (String × Json × ValidatedMeta × RequestState × InputResponses)) := do
  match toolsCall? json with
  | none => pure none
  | some (name, args) =>
      let params ← json.getObjVal? "params"
      let metadata ← validatedMetaFromParams params
      let requestState ← requestStateFromParams params
      let inputResponses ← inputResponsesFromParams params
      pure (some (name, args, metadata, requestState, inputResponses))

/-- Metadata-aware tool-call extraction for the live V1 classifier. `none`
    still means a non-`tools/call`. This M.1 compatibility projection is not
    used by the live host now that MRTR fields enter identity. -/
def toolsCallWithMeta? (json : Json) :
    Except String (Option (String × Json × ValidatedMeta)) := do
  match ← toolsCallWithContext? json with
  | none => pure none
  | some (name, args, metadata, _, _) => pure (some (name, args, metadata))

/-- Whether a successfully parsed wire message is a top-level JSON array.
    MCP revisions 2025-06-18 and 2026-07-28 do not admit JSON-RPC batching,
    so host classifiers use this shape predicate as a fail-closed refusal
    boundary. Arrays nested inside an object are deliberately unaffected. -/
def isTopLevelArray : Json → Bool
  | .arr _ => true
  | _ => false

end Seal
