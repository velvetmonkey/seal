/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import Seal.JsonUtil

/-!
# Schema-carrying wire codecs — the single-source policy surface

One codec value carries BOTH the parser and the JSON-Schema fragment for a
wire construct; `parse` and `schema` are two projections of the same value, so
they physically cannot drift. Object shapes are described once as an
`ObjSpec`: the field list drives the parse do-block, the schema
`properties`/`required`, and the strict-key allowlist. There is no independent
field list, hand-written schema, or separate allowed-key list anywhere a spec
exists.

Proof discipline: every combinator here is a plain transparent `def` whose
`parse` projection unfolds to exactly the code the pre-codec parsers ran, so
the Layer-1 equivalence theorems (`Seal/PolicyEquiv.lean`) close by
`funext` + monad-law normalization + `rfl`. Do not add `partial`, `opaque`,
or well-founded recursion here — it would make the equivalence unprovable.
-/

namespace Seal

open Lean
open Seal.JsonUtil

/-- A wire construct: how to parse it and what JSON Schema it satisfies. The
    two fields are projections of one value — the drift-proofing is physical. -/
structure WireCodec (α : Type) where
  parse  : Json → Except String α
  schema : Json

/-! ## Leaf codecs -/

def strCodec : WireCodec String :=
  ⟨fun j => j.getStr?, Json.mkObj [("type", Json.str "string")]⟩

def natCodec : WireCodec Nat :=
  ⟨fun j => j.getNat?,
   Json.mkObj [("type", Json.str "integer"), ("minimum", Json.num 0)]⟩

def boolCodec : WireCodec Bool :=
  ⟨fun j => j.getBool?, Json.mkObj [("type", Json.str "boolean")]⟩

/-- A dotted argument path on the wire: a string, split on `.` with empty
    components dropped (`Seal.JsonUtil.splitPath`). -/
def pathCodec : WireCodec (List String) :=
  ⟨fun j => do pure (splitPath (← j.getStr?)),
   Json.mkObj [("type", Json.str "string"),
               ("description", Json.str "dotted argument path")]⟩

/-- A JSON array of `item`s, accessed via `Json.getArr?` (the parser the
    pre-codec code used for every list field). -/
def arrCodec (item : WireCodec α) : WireCodec (List α) :=
  ⟨fun j => do (← j.getArr?).toList.mapM item.parse,
   Json.mkObj [("type", Json.str "array"), ("items", item.schema)]⟩

/-! ## Object specs

An `ObjSpec γ` accumulates fields left-to-right into a nested tuple `γ`; the
final `emit` maps the tuple onto the target structure. Parse order equals
chain order equals the strict-key allowlist order, mirroring the pre-codec
parsers exactly (including which error fires first). -/

structure FieldDef where
  key : String
  required : Bool
  schema : Json

structure ObjSpec (γ : Type) where
  parse : Json → Except String γ
  fields : List FieldDef
  extraKeys : List String := []

namespace ObjSpec

def start : ObjSpec Unit := ⟨fun _ => pure (), [], []⟩

/-- Required field: `(← json.getObjVal? key)` then the value codec. -/
def field (s : ObjSpec γ) (key : String) (vc : WireCodec β) : ObjSpec (γ × β) :=
  { parse := fun j => do
      let g ← s.parse j
      let b ← vc.parse (← j.getObjVal? key)
      pure (g, b)
    fields := s.fields ++ [⟨key, true, vc.schema⟩]
    extraKeys := s.extraKeys }

/-- Optional field with a default, mirroring the `getObjValOpt` pattern the
    pre-codec parsers used (`getObjNatD`, `parseEnabled`, optional `match`). -/
def fieldD (s : ObjSpec γ) (key : String) (vc : WireCodec β) (d : β) :
    ObjSpec (γ × β) :=
  { parse := fun j => do
      let g ← s.parse j
      let b ← match ← getObjValOpt j key with
        | some v => vc.parse v
        | none => pure d
      pure (g, b)
    fields := s.fields ++ [⟨key, false, vc.schema⟩]
    extraKeys := s.extraKeys }

/-- Optional field parsed to `Option`, mirroring the `cost_arg` / `server`
    pattern. -/
def fieldOpt (s : ObjSpec γ) (key : String) (vc : WireCodec β) :
    ObjSpec (γ × Option β) :=
  { parse := fun j => do
      let g ← s.parse j
      let b ← match ← getObjValOpt j key with
        | some v => pure (some (← vc.parse v))
        | none => pure none
      pure (g, b)
    fields := s.fields ++ [⟨key, false, vc.schema⟩]
    extraKeys := s.extraKeys }

/-- Cross-field refinement, positioned mid-chain exactly where the pre-codec
    parser checked (error priority is part of the preserved behavior). Schema
    side: parser-only refinement unless a fragment is attached at the object
    level by the caller. -/
def check (s : ObjSpec γ) (f : γ → Except String Unit) : ObjSpec γ :=
  { parse := fun j => do
      let g ← s.parse j
      f g
      pure g
    fields := s.fields
    extraKeys := s.extraKeys }

/-- Allow a key the Lean parser does not consume (e.g. `replay_store`, whose
    interior the host reads). It joins the strict-key allowlist and appears in
    the schema as an unconstrained property. -/
def allowKey (s : ObjSpec γ) (key : String) : ObjSpec γ :=
  { s with extraKeys := s.extraKeys ++ [key] }

/-- Map the accumulated tuple onto the target structure. -/
def emit (s : ObjSpec γ) (f : γ → α) : ObjSpec α :=
  { parse := fun j => do pure (f (← s.parse j))
    fields := s.fields
    extraKeys := s.extraKeys }

/-- The strict-key allowlist this spec induces: field keys in chain order,
    then the allowed-but-unparsed extras. -/
def keys (s : ObjSpec γ) : List String :=
  s.fields.map (·.key) ++ s.extraKeys

/-- Schema `properties`: one entry per field, extras unconstrained (`true`). -/
def props (s : ObjSpec γ) : List (String × Json) :=
  s.fields.map (fun f => (f.key, f.schema)) ++
    s.extraKeys.map (fun k => (k, Json.bool true))

def requiredKeys (s : ObjSpec γ) : List String :=
  (s.fields.filter (·.required)).map (·.key)

/-- Object schema from the spec; `strict := true` ⇒
    `additionalProperties: false` (the `expectObjKeys` projection). -/
def objSchema (s : ObjSpec γ) (strict : Bool) : Json :=
  Json.mkObj <|
    [("type", Json.str "object"),
     ("properties", Json.mkObj s.props),
     ("required", Json.arr (s.requiredKeys.map Json.str).toArray)] ++
    (if strict then [("additionalProperties", Json.bool false)] else [])

end ObjSpec

/-- Strict object codec: unknown keys are hard errors
    (`expectObjKeys`-with-derived-allowlist projection of the same spec that
    yields the schema). -/
def WireCodec.strictObj (ctx : String) (s : ObjSpec α) : WireCodec α :=
  ⟨fun j => do
      expectObjKeys j s.keys ctx
      s.parse j,
   s.objSchema true⟩

/-- Permissive object codec: unknown keys tolerated (the Safety interior —
    init tooling stores `_comment` / `_seal_scaffold` inside rules). -/
def WireCodec.openObj (s : ObjSpec α) : WireCodec α :=
  ⟨s.parse, s.objSchema false⟩

end Seal
