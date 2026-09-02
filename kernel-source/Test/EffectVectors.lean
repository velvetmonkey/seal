/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.EffectCommitment
import Seal.JsonUtil

/-!
# Effect-commitment test-vector emitter (M.1 stage 1)

Emits the shared vector file consumed by the Lean side, the Stage-C Rust
byte twin, and the Stage-D assurance kit. Run:

    lake exe effect_vectors > test/vectors/effect_commitment_vectors.json

Every golden hex in the file is COMPUTED here by the compiled kernel
(`Seal.Effect.commitment`, real SHA-256) — never typed by hand. The emitter
also enforces the cross-vector properties (two tools over the same
arguments MUST differ; key order MUST NOT matter; `{}` vs `{"a":null}`
MUST differ) and fails loudly if the kernel ever violates them.

Rejection classes mirror the host gates exactly
(`Seal.Main.processHostLine` order): duplicate/escaped object key
(`wireKeysSafe`), pathological exponent (`wireNumbersSafe`), significant-
digit bound (`wireDigitsSafe`).
-/

open Lean Seal Seal.JsonUtil

private structure VectorInput where
  name : String
  server : String
  tool : String
  /-- RAW wire text of the arguments — duplicates and escapes intact. -/
  argumentsJson : String
  /-- RAW `_meta` object text. `none` is structural absence; `some "{}"` is
      present-empty and must not collide with it. -/
  metaJson : Option String := none

private def deepNested (depth : Nat) : String :=
  String.join ((List.range depth).map fun _ => "{\"l\":") ++ "1" ++
    String.join ((List.range depth).map fun _ => "}")

private def inputs : List VectorInput := [
  { name := "basic", server := "srv-a", tool := "db.execute",
    argumentsJson := "{\"database\":\"prod\",\"sql\":\"DROP TABLE users\"}" },
  { name := "empty-arguments", server := "srv-a", tool := "db.execute",
    argumentsJson := "{}" },
  { name := "null-arguments (tools/call with absent arguments parses to null)",
    server := "srv-a", tool := "db.execute", argumentsJson := "null" },
  { name := "same-arguments-tool-a", server := "srv-a", tool := "tool_a",
    argumentsJson := "{\"x\":1}" },
  { name := "same-arguments-tool-b", server := "srv-a", tool := "tool_b",
    argumentsJson := "{\"x\":1}" },
  { name := "same-arguments-server-2", server := "srv-b", tool := "tool_a",
    argumentsJson := "{\"x\":1}" },
  { name := "deep-nesting-12", server := "srv-a", tool := "deep.op",
    argumentsJson := deepNested 12 },
  { name := "unicode-raw-value", server := "srv-a", tool := "echo",
    argumentsJson := "{\"name\":\"héllo\"}" },
  { name := "unicode-escaped-value", server := "srv-a", tool := "echo",
    argumentsJson := "{\"name\":\"h\\u00e9llo\"}" },
  { name := "key-order-ba", server := "srv-a", tool := "echo",
    argumentsJson := "{\"b\":1,\"a\":2}" },
  { name := "key-order-ab", server := "srv-a", tool := "echo",
    argumentsJson := "{\"a\":2,\"b\":1}" },
  { name := "number-scientific", server := "srv-a", tool := "echo",
    argumentsJson := "{\"n\":1e2}" },
  { name := "number-plain-hundred", server := "srv-a", tool := "echo",
    argumentsJson := "{\"n\":100}" },
  { name := "number-float", server := "srv-a", tool := "echo",
    argumentsJson := "{\"n\":1.5}" },
  { name := "number-negative-and-bool", server := "srv-a", tool := "echo",
    argumentsJson := "{\"n\":-42,\"ok\":true}" },
  { name := "integer-18-digits-in-bound", server := "srv-a", tool := "echo",
    argumentsJson := "{\"n\":999999999999999999}" },
  { name := "explicit-null-vs-absent", server := "srv-a", tool := "db.execute",
    argumentsJson := "{\"a\":null}" },
  { name := "meta-present-empty", server := "srv-a", tool := "db.execute",
    argumentsJson := "{}", metaJson := some "{}" },
  { name := "meta-traceparent-a", server := "srv-a", tool := "db.execute",
    argumentsJson := "{}", metaJson := some
      "{\"traceparent\":\"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01\"}" },
  { name := "meta-traceparent-b", server := "srv-a", tool := "db.execute",
    argumentsJson := "{}", metaJson := some
      "{\"traceparent\":\"00-4bf92f3577b34da6a3ce929d0e0e4736-b7ad6b7169203331-01\"}" },
  { name := "meta-unknown-a", server := "srv-a", tool := "db.execute",
    argumentsJson := "{}", metaJson := some "{\"example.com/invocation\":\"a\"}" },
  { name := "meta-unknown-b", server := "srv-a", tool := "db.execute",
    argumentsJson := "{}", metaJson := some "{\"example.com/invocation\":\"b\"}" },
  -- hostile: rejected by the host gates
  { name := "duplicate-key", server := "srv-a", tool := "db.execute",
    argumentsJson := "{\"a\":1,\"a\":2}" },
  { name := "duplicate-key-nested", server := "srv-a", tool := "db.execute",
    argumentsJson := "{\"o\":{\"k\":1,\"k\":2}}" },
  { name := "escaped-object-key", server := "srv-a", tool := "db.execute",
    argumentsJson := "{\"\\u0061\":1}" },
  { name := "integer-19-digits-out-of-bound", server := "srv-a", tool := "echo",
    argumentsJson := "{\"n\":9999999999999999999}" },
  { name := "monster-exponent", server := "srv-a", tool := "echo",
    argumentsJson := "{\"n\":1e9999999}" }
]

private def emitOne (v : VectorInput) : Except String Json := do
  let base : List (String × Json) :=
    [("name", Json.str v.name),
     ("server", Json.str v.server),
     ("tool", Json.str v.tool),
     ("arguments_json", Json.str v.argumentsJson),
     ("meta_json", v.metaJson.map Json.str |>.getD Json.null)]
  if !wireKeysSafe v.argumentsJson then
    return Json.mkObj <| base ++
      [("expect", Json.str "rejected"),
       ("reason", Json.str "duplicate or escaped object key")]
  if !wireNumbersSafe v.argumentsJson then
    return Json.mkObj <| base ++
      [("expect", Json.str "rejected"),
       ("reason", Json.str "unsafe numeric literal (exponent digits > 6)")]
  if !wireDigitsSafe v.argumentsJson then
    return Json.mkObj <| base ++
      [("expect", Json.str "rejected"),
       ("reason", Json.str "number exceeds significant-digit bound (18)")]
  let metadata ← match v.metaJson with
    | none => pure ValidatedMeta.absent
    | some raw =>
        if !wireKeysSafe raw then
          throw s!"vector '{v.name}': metadata contains a duplicate or escaped object key"
        if !wireNumbersSafe raw || !wireDigitsSafe raw then
          throw s!"vector '{v.name}': metadata contains an unsafe numeric literal"
        match Json.parse raw with
        | .ok (.obj object) => pure (.present object)
        | .ok _ => throw s!"vector '{v.name}': metadata is not an object"
        | .error e => throw s!"vector '{v.name}': metadata is not JSON: {e}"
  match Json.parse v.argumentsJson with
  | .error e => throw s!"vector '{v.name}': arguments are not JSON: {e}"
  | .ok args =>
      let effect : Effect :=
        { server := v.server, tool := v.tool, arguments := args, metadata }
      return Json.mkObj <| base ++
        [("expect", Json.str "commitment"),
         ("canonical_arguments", Json.str args.compress),
         ("canonical_meta", metadata.toJson?.getD Json.null),
         ("effect_commitment", Json.str effect.commitment)]

private def commitmentOf (doc : List Json) (name : String) : IO String := do
  match doc.find? (fun j => (j.getObjValAs? String "name").toOption == some name) with
  | none => throw <| IO.userError s!"vector '{name}' missing"
  | some j =>
      match j.getObjValAs? String "effect_commitment" with
      | .ok c => pure c
      | .error _ => throw <| IO.userError s!"vector '{name}' has no commitment"

def main : IO Unit := do
  let vectors ← inputs.mapM fun v =>
    match emitOne v with
    | .ok j => pure j
    | .error e => throw <| IO.userError e
  -- cross-vector properties: fail loudly, never emit a file that lies
  let toolA ← commitmentOf vectors "same-arguments-tool-a"
  let toolB ← commitmentOf vectors "same-arguments-tool-b"
  if toolA == toolB then
    throw <| IO.userError "same arguments under two tools must differ"
  let serverB ← commitmentOf vectors "same-arguments-server-2"
  if toolA == serverB then
    throw <| IO.userError "same arguments under two servers must differ"
  let orderBA ← commitmentOf vectors "key-order-ba"
  let orderAB ← commitmentOf vectors "key-order-ab"
  if orderBA != orderAB then
    throw <| IO.userError "key order must not change the commitment"
  let empty ← commitmentOf vectors "empty-arguments"
  let explicitNull ← commitmentOf vectors "explicit-null-vs-absent"
  if empty == explicitNull then
    throw <| IO.userError "{} and {\"a\":null} must differ"
  let metaEmpty ← commitmentOf vectors "meta-present-empty"
  if empty == metaEmpty then
    throw <| IO.userError "absent _meta and present-empty _meta must differ"
  let traceA ← commitmentOf vectors "meta-traceparent-a"
  let traceB ← commitmentOf vectors "meta-traceparent-b"
  if traceA == traceB then
    throw <| IO.userError "changing only traceparent must change the commitment"
  let unknownA ← commitmentOf vectors "meta-unknown-a"
  let unknownB ← commitmentOf vectors "meta-unknown-b"
  if unknownA == unknownB then
    throw <| IO.userError "changing only an unknown _meta key must change the commitment"
  for c in [toolA, toolB, serverB, orderBA, empty, explicitNull, metaEmpty,
      traceA, traceB, unknownA, unknownB] do
    unless c.length == 64 &&
        c.toList.all (fun ch => ch.isDigit || ('a' ≤ ch && ch ≤ 'f')) do
      throw <| IO.userError s!"commitment not 64-char lowercase hex: {c}"
  let doc := Json.mkObj [
    ("version", Json.str Seal.effectDomainTag),
    ("preimage",
     Json.str "PROPOSED: SHA256(encodeParts ([\"seal.effect/v4-proposed-meta-all\", server, tool, compress(arguments)] ++ [meta-presence, compress(meta-object)-or-empty])) -> lowercase hex (64 chars)"),
    ("encoding",
     Json.str "encodeParts: netstring framing — each part becomes '<charCount>:<part>', frames concatenated; hash input is the UTF-8 bytes of that string"),
    ("kernel_identity", Json.str "NOT part of the effect preimage (approval preimage only)"),
    ("integer_bound", Json.mkObj [
      ("max_significant_digits", Json.num 18),
      ("max_exponent_digits", Json.num 6),
      ("rule", Json.str "an unquoted JSON number in guarded-call arguments carries at most 18 significant mantissa digits (10^18 < 2^63: fits i64 in the Stage-C twin) and at most 6 exponent digits; longer literals are rejected before hashing")]),
    ("duplicate_keys",
     Json.str "a duplicate object key (raw text) or an escape sequence inside an object key anywhere in a tools/call line is a hard rejection before parsing"),
    ("absent_vs_null",
     Json.str "a tools/call with no arguments member hashes arguments = null (the 'null-arguments' vector); {} and {\"a\":null} are distinct effects"),
    ("meta_presence",
     Json.str "_meta absence is framed as [\"meta.absent\", \"\"]; a present object is framed as [\"meta.present\", compress(object)], so absent and present-empty are distinct"),
    ("vectors", Json.arr vectors.toArray)]
  IO.println doc.pretty
