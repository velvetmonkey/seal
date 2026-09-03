/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import Seal.JsonUtil
import Seal.PolicyWire

namespace Seal

open Lean
open Seal.JsonUtil

inductive MatchSpec where
  | always
  | equals (argPath : List String) (value : String)
  | startsWith (argPath : List String) (prefixValue : String)
  | containsAnyCi (argPath : List String) (needles : List String)
  | all (specs : List MatchSpec)
  | any (specs : List MatchSpec)
  deriving Repr

inductive TargetPart where
  | literal (value : String)
  | argPath (path : List String)
  | fullArguments
  deriving Repr

inductive ToolMode where
  | allow
  | guarded
  | deny
  deriving Repr, BEq

structure ToolRule where
  name : String
  mode : ToolMode
  matcher : MatchSpec := .always
  target : List TargetPart := []
  deriving Repr

structure Policy where
  /-- Approval lifetime in MILLISECONDS, capped at 300s, used to stamp an
      absolute expiry deadline (`now + approvalTtlMs`) when an approval is
      ingested. -/
  approvalTtlMs : Nat
  approvalFile : System.FilePath
  /-- Stable server identity prepended to new policy-v2 targets. Empty keeps
      the legacy target pre-image for backwards-compatible policies. -/
  serverIdentity : String := ""
  tools : List ToolRule
  deriving Repr

private def asciiLowerChar (c : Char) : Char :=
  if 'A' ≤ c ∧ c ≤ 'Z' then
    Char.ofNat (c.val.toNat + 32)
  else
    c

def asciiLower (s : String) : String :=
  s.map asciiLowerChar

def containsAnyCi (haystack : String) (needles : List String) : Bool :=
  let h := asciiLower haystack
  needles.any fun needle => h.contains (asciiLower needle)

/-- Match parser, VERBATIM the pre-codec function. It is `partial` (recursive
    through `all`/`any`), which makes it kernel-opaque: the codec reuses this
    exact constant as its parse projection (`matchCodec`), so match acceptance
    is identical BY CONSTRUCTION, not by theorem. The adjacent
    `matchSchemaDef` is the one hand-assembled schema island — every variant
    is exercised by the anti-drift gate. Interior stays permissive: unknown
    keys are tolerated (init tooling stores `_comment` / `_seal_scaffold`). -/
partial def parseMatch (json : Json) : Except String MatchSpec := do
  let kind ← getObjString json "type"
  match kind with
  | "always" => pure .always
  | "equals" =>
      pure (.equals (splitPath (← getObjString json "arg")) (← getObjString json "value"))
  | "starts_with" =>
      pure (.startsWith (splitPath (← getObjString json "arg")) (← getObjString json "value"))
  | "contains_any_ci" =>
      let argPath ← getObjString json "arg"
      let needlesJson ← (← json.getObjVal? "needles").getArr?
      let needles ← needlesJson.toList.mapM (fun j => j.getStr?)
      pure (.containsAnyCi (splitPath argPath) needles)
  | "all" =>
      let specs ← (← json.getObjVal? "matches").getArr?
      pure (.all (← specs.toList.mapM parseMatch))
  | "any" =>
      let specs ← (← json.getObjVal? "matches").getArr?
      pure (.any (← specs.toList.mapM parseMatch))
  | other => throw s!"unsupported match type: {other}"

/-- Target-part parser, VERBATIM the pre-codec function: literal-first
    precedence, then exactly one of `arg` / `full_arguments`. Total but
    control-flow-shaped rather than field-list-shaped, so the codec shares
    this constant (acceptance identity by construction) with the adjacent
    `targetPartSchema` expressing the precedence as `anyOf`. Permissive on
    unknown keys. -/
def parseTargetPart (json : Json) : Except String TargetPart := do
  match ← getObjValOpt json "literal" with
  | some value => pure (.literal (← value.getStr?))
  | none =>
      match ← getObjValOpt json "arg", ← getObjValOpt json "full_arguments" with
      | some value, none => pure (.argPath (splitPath (← value.getStr?)))
      | none, some value =>
          if ← value.getBool? then pure .fullArguments
          else throw "full_arguments must be true"
      | _, _ => throw "target part must contain exactly one of literal, arg, full_arguments"

/-- Approvals may not outlive this many seconds, mirroring SealV2's
    `maxApprovalTtl`. Longer configured TTLs are clamped down (fail-safe:
    a shorter lifetime is strictly more restrictive). -/
def maxApprovalTtlSeconds : Nat := 300

/-- Stage-A guard-target restriction: the ONLY target a guarded rule may
    carry is exactly `[{"full_arguments": true}]`. Anything else (`literal`
    parts, `arg` paths, the empty list) binds the approval to less than the
    full canonical arguments and is rejected at parse time — same hard-error
    class as the unknown-key rejections. Shared verbatim by the codec and the
    `PolicyLegacy` equivalence spec. -/
def isFullArgumentsTarget : List TargetPart → Bool
  | [.fullArguments] => true
  | _ => false

/-- The parse-time hard error for a guarded rule whose target is not exactly
    `[{"full_arguments": true}]`. One constant, shared by codec and legacy
    spec, so the equivalence theorem aligns the throw sites syntactically. -/
def guardTargetErrorText : String :=
  "guard mode requires target [{\"full_arguments\": true}]"

/-- The Stage-A guard-target refinement as ONE shared constant (the
    `parseMatch` / `parseTargetPart` sharing discipline): the codec's
    `ObjSpec.check` and the legacy spec both run THIS function, so the
    Layer-1 equivalence proof treats it as an atomic effect instead of
    re-relating two if-trees. -/
def guardCheck (mode : ToolMode) (target : List TargetPart) : Except String Unit :=
  if mode == ToolMode.guarded && !isFullArgumentsTarget target then
    throw guardTargetErrorText
  else pure ()

/-! ## Codecs

`parse` and `schema` are projections of the same values. The two interior
islands (`matchCodec`, `targetPartCodec`) share the verbatim parser constants
above; everything else derives from `ObjSpec` field lists. -/

/-- The recursive `$defs` body for match specs: one `anyOf` branch per
    variant, discriminated by the `type` const, `additionalProperties`
    deliberately open (permissive interior). Hand-assembled island paired
    with `parseMatch` inside `matchCodec` — kept adjacent on purpose. -/
def matchSchemaDef : Json :=
  let variant (ty : String) (extra : List (String × Json)) : Json :=
    Json.mkObj
      [("type", Json.str "object"),
       ("properties", Json.mkObj (("type", Json.mkObj [("const", Json.str ty)]) :: extra)),
       ("required", Json.arr (("type" :: extra.map (·.1)).map Json.str).toArray)]
  Json.mkObj
    [("anyOf", Json.arr #[
      variant "always" [],
      variant "equals" [("arg", pathCodec.schema), ("value", strCodec.schema)],
      variant "starts_with" [("arg", pathCodec.schema), ("value", strCodec.schema)],
      variant "contains_any_ci"
        [("arg", pathCodec.schema), ("needles", (arrCodec strCodec).schema)],
      variant "all"
        [("matches", Json.mkObj
          [("type", Json.str "array"),
           ("items", Json.mkObj [("$ref", Json.str "#/$defs/match")])])],
      variant "any"
        [("matches", Json.mkObj
          [("type", Json.str "array"),
           ("items", Json.mkObj [("$ref", Json.str "#/$defs/match")])])]])]

def matchCodec : WireCodec MatchSpec :=
  ⟨parseMatch, Json.mkObj [("$ref", Json.str "#/$defs/match")]⟩

/-- Literal-first precedence as `anyOf`: a present `literal` wins regardless
    of other keys; otherwise exactly one of `arg` / `full_arguments := true`.
    Paired with the verbatim `parseTargetPart` inside `targetPartCodec`. -/
def targetPartSchema : Json :=
  Json.mkObj
    [("anyOf", Json.arr #[
      Json.mkObj
        [("type", Json.str "object"),
         ("properties", Json.mkObj [("literal", strCodec.schema)]),
         ("required", Json.arr #[Json.str "literal"])],
      Json.mkObj
        [("type", Json.str "object"),
         ("properties", Json.mkObj [("arg", pathCodec.schema)]),
         ("required", Json.arr #[Json.str "arg"]),
         ("not", Json.mkObj [("anyOf", Json.arr #[
           Json.mkObj [("required", Json.arr #[Json.str "literal"])],
           Json.mkObj [("required", Json.arr #[Json.str "full_arguments"])]])])],
      Json.mkObj
        [("type", Json.str "object"),
         ("properties", Json.mkObj
           [("full_arguments", Json.mkObj [("const", Json.bool true)])]),
         ("required", Json.arr #[Json.str "full_arguments"]),
         ("not", Json.mkObj [("anyOf", Json.arr #[
           Json.mkObj [("required", Json.arr #[Json.str "literal"])],
           Json.mkObj [("required", Json.arr #[Json.str "arg"])]])])]])]

def targetPartCodec : WireCodec TargetPart :=
  ⟨parseTargetPart, targetPartSchema⟩

/-- A rule's `target` list: bespoke array access preserving the pre-codec
    error text ("target must be an array"). -/
def targetListCodec : WireCodec (List TargetPart) :=
  ⟨fun j => match j with
    | .arr parts => parts.toList.mapM parseTargetPart
    | _ => throw "target must be an array",
   Json.mkObj [("type", Json.str "array"), ("items", targetPartCodec.schema)]⟩

def modeCodec : WireCodec ToolMode :=
  ⟨fun j => do
    let modeText ← j.getStr?
    match modeText with
    | "allow" => pure ToolMode.allow
    | "guard" => pure ToolMode.guarded
    | "guarded" => pure ToolMode.guarded
    | "deny" => pure ToolMode.deny
    | other => throw s!"unsupported tool mode: {other}",
   Json.mkObj [("enum", Json.arr #[Json.str "allow", Json.str "guard",
                                   Json.str "guarded", Json.str "deny"])]⟩

def toolRuleSpec : ObjSpec ToolRule :=
  ObjSpec.start
    |>.field "name" strCodec
    |>.field "mode" modeCodec
    |>.fieldD "match" matchCodec .always
    |>.fieldD "target" targetListCodec []
    |>.check (fun ((((_, _name), mode), _matcher), target) =>
        guardCheck mode target)
    |>.emit fun ((((_, name), mode), matcher), target) =>
        { name, mode, matcher, target }

/-- Tool rules are a PERMISSIVE interior (no unknown-key rejection). -/
def toolRuleCodec : WireCodec ToolRule := .openObj toolRuleSpec

/-- The `approval` section: TTL default 120 s clamped at
    `maxApprovalTtlSeconds`, mandatory control file. `replay_store` is the
    documented host-layer key the Lean parser does not consume. -/
def approvalSpec : ObjSpec (Nat × System.FilePath) :=
  ObjSpec.start
    |>.fieldD "ttl_seconds" natCodec 120
    |>.field "control_file" strCodec
    |>.allowKey "replay_store"
    |>.emit fun ((_, ttlSeconds), controlFile) =>
        ((min ttlSeconds maxApprovalTtlSeconds) * 1000,
         System.FilePath.mk controlFile)

/-- The Safety policy spec, parameterized by the approval codec so the bundle
    can project a strict-schema variant of the SAME spec. -/
def policySpecWith (approvalC : WireCodec (Nat × System.FilePath)) : ObjSpec Policy :=
  ObjSpec.start
    |>.field "approval" approvalC
    |>.fieldD "server" strCodec ""
    |>.field "tools" (arrCodec toolRuleCodec)
    |>.emit fun (((_, (approvalTtlMs, approvalFile)), serverIdentity), tools) =>
        { approvalTtlMs, approvalFile, serverIdentity, tools }

/-- Standalone Safety policy codec: permissive at every level, exactly the
    pre-codec `parsePolicyJson` boundary. -/
def policyCodec : WireCodec Policy :=
  .openObj (policySpecWith (.openObj approvalSpec))

def parsePolicyJson : Json → Except String Policy :=
  policyCodec.parse

def loadPolicy (path : System.FilePath) : IO Policy := do
  let text ← IO.FS.readFile path
  match Json.parse text >>= parsePolicyJson with
  | .ok policy => pure policy
  | .error err => throw <| IO.userError s!"policy parse error: {err}"

end Seal
