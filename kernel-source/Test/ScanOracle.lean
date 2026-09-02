/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.PolicyScan

open Lean
open Seal.JsonUtil

private def optionalBool (json : Json) (key : String) : Except String Bool := do
  match ← getObjValOpt json key with
  | some value => value.getBool?
  | none => pure false

/-- Corpus-C projection only: every fixture carries an explicit MCP effect
    annotation. `readOnlyHint: true` wins exactly as it does in the JS scanner;
    all other corpus entries are annotated mutating. -/
private def parseEntry (json : Json) : Except String Seal.ManifestEntry := do
  let tool ← getObjString json "name"
  let annotations ← json.getObjVal? "annotations"
  let readonly ← optionalBool annotations "readOnlyHint"
  let arguments ← match ← getObjValOpt json "arguments" with
    | some value => pure value
    | none => pure (Json.mkObj [])
  pure {
    id := tool
    tool
    arguments
    effect := if readonly then .readonly else .mutating
  }

private def parseManifest (json : Json) : Except String (List Seal.ManifestEntry) := do
  let tools ← (← json.getObjVal? "tools").getArr?
  tools.toList.mapM parseEntry

private def parsePolicyEnvelope (json : Json) : Except String Seal.Policy := do
  let server ← getObjString json "server"
  let safety ← json.getObjVal? "safety"
  let approval ← safety.getObjVal? "approval"
  let tools ← safety.getObjVal? "tools"
  Seal.parsePolicyJson <| Json.mkObj [
    ("server", Json.str server),
    ("approval", approval),
    ("tools", tools)
  ]

private def runItem (json : Json) : Except String (String × Bool) := do
  let name ← getObjString json "name"
  let policy ← parsePolicyEnvelope (← json.getObjVal? "policy")
  let manifest ← parseManifest (← json.getObjVal? "manifest")
  pure (name, Seal.scanPass policy manifest)

def main (args : List String) : IO UInt32 := do
  match args with
  | [corpusPath] =>
      let text ← IO.FS.readFile corpusPath
      match Json.parse text >>= fun json => do
          let items ← (← json.getObjVal? "items").getArr?
          items.toList.mapM runItem with
      | .error error =>
          IO.eprintln s!"scan oracle malformed corpus: {error}"
          pure 2
      | .ok results =>
          for (name, verdict) in results do
            IO.println <| (Json.mkObj [
              ("name", Json.str name),
              ("scanPass", Json.bool verdict)
            ]).compress
          pure 0
  | _ =>
      IO.eprintln "usage: scan_oracle <scan-corpus.json>"
      pure 2
