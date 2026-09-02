/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.ClassifyTransport

/-!
# STEP 0 enumerator + runnable SHOW control for the classify seam (K3/K4)

Runs the REAL classifier composition (`SealV2.ClassifyTransport.classifyWire`
over this repo's two raw-wire numeric guards / `Lean.Json.parse` /
`Seal.toolsCall?`) over a generated corpus plus an exhaustive 1-byte ASCII
sweep, and enforces, RED on failure (exit 1):

1. **Partition differential** — for every line, the router verdict
   (`classifyWire`) agrees with the byte-class trichotomy
   (`refusedClass` / `mediatedClass` / `escapesClass`), and exactly one
   class holds. A drift between the router and the class predicates is a
   modeling defect and must go RED.
2. **Non-vacuity (Normal-Form discipline)** — every cell of the
   characterisation is non-empty on the corpus: mediated, refused,
   escape∩lenient (the K4 hazard class), escape∖lenient (legitimate
   passthrough). An empty cell means the characterisation is vacuous and
   the run STOPS RED — that outcome is the deliverable, not something to
   dress up.
3. **Pinned canonical witnesses** — BOM-prefixed and case-variant calls
   remain in escape∩lenient; every top-level array shape (including `[]`)
   lands in R; the golden mediated line lands in S; and the monster-exponent
   line lands in R. Tampering with the strict matcher or the array refusal
   moves a witness out of its cell → RED.
4. **Positive twins** — ordinary object-shaped protocol traffic
   (`initialize`, `tools/list`, notifications, responses) remains
   passthrough in the same check that pins array refusal. Nested arrays are
   not confused with a top-level array.
-/

open SealV2.ClassifyTransport

/-- One corpus entry: label + wire line. -/
structure Entry where
  label : String
  line : String

/-- Witness lines come from the module under test
    (`SealV2.ClassifyTransport.mediatedWitness` etc.) — one definition, no
    drift between the `#guard` pins there and this runtime control. -/
def bom : String := "\uFEFF"
def emptyTopLevelArray : String := "[]"

def methods : List String :=
  ["tools/call", "TOOLS/CALL", "Tools/Call", "tools/list", "initialize",
   "notifications/initialized"]

def paramsShapes : List (String × String) :=
  [("name", ",\"params\":{\"name\":\"t\",\"arguments\":{}}"),
   ("noparams", ""),
   ("noname", ",\"params\":{}")]

def prefixes : List (String × String) :=
  [("plain", ""), ("bom", bom), ("space", " ")]

def wrap (body : String) : List (String × String) :=
  [("single", body),
   ("batch1", "[" ++ body ++ "]"),
   ("batch2", "[" ++ body ++ ",{\"method\":\"tools/list\"}]")]

def gridCorpus : List Entry := Id.run do
  let mut out : List Entry := []
  for (pl, p) in prefixes do
    for m in methods do
      for (sl, ps) in paramsShapes do
        let body := "{\"method\":\"" ++ m ++ "\"" ++ ps ++ "}"
        for (wl, w) in wrap body do
          out := out ++ [⟨s!"{pl}/{m}/{sl}/{wl}", p ++ w⟩]
  return out

def extraCorpus : List Entry :=
  [⟨"golden-mediated", mediatedWitness⟩,
   ⟨"bom-call", bomWitness⟩,
   ⟨"case-call", caseWitness⟩,
   ⟨"batch-call", batchWitness⟩,
   ⟨"empty-array", emptyTopLevelArray⟩,
   ⟨"multi-batch",
     "[{\"method\":\"tools/call\",\"params\":{\"name\":\"t\"}},{\"method\":\"tools/list\"}]"⟩,
   ⟨"singleton-noncall-array", "[{\"method\":\"tools/list\"}]"⟩,
   ⟨"nested-arguments-array",
     "{\"method\":\"tools/call\",\"params\":{\"name\":\"t\",\"arguments\":[]}}"⟩,
   ⟨"nested-params-array", "{\"method\":\"tools/list\",\"params\":[]}"⟩,
   ⟨"tools-list", listWitness⟩,
   ⟨"malformed", malformedWitness⟩,
   ⟨"monster", monsterWitness⟩,
   ⟨"agreement-unsafe", agreementUnsafeWitness⟩,
   ⟨"empty", ""⟩,
   ⟨"open-brace", "{"⟩,
   ⟨"open-bracket", "["⟩,
   ⟨"bare-string", "\"tools/call\""⟩,
   ⟨"null", "null"⟩,
   ⟨"number", "42"⟩,
   ⟨"method-not-string", "{\"method\":42}"⟩,
   ⟨"monster-in-call",
     "{\"method\":\"tools/call\",\"params\":{\"name\":\"x\",\"arguments\":{\"n\":1e9999999}}}"⟩]

/-- Exhaustive 1-byte ASCII sweep: every single-character line 0–127. -/
def asciiSweep : List Entry :=
  (List.range 128).map fun n =>
    ⟨s!"ascii-{n}", String.ofList [Char.ofNat n]⟩

inductive Cell where
  | mediated | refused | escapeLenient | escapePlain
  deriving BEq, Repr

def cellOf (line : String) : Except String Cell := do
  let r := refusedClass line
  let s := mediatedClass line
  let e := escapesClass line
  -- trichotomy: exactly one of R / S / escape
  let count := (if r then 1 else 0) + (if s then 1 else 0) + (if e then 1 else 0)
  if count != 1 then
    throw s!"trichotomy violated (R={r} S={s} E={e})"
  -- differential: router verdict must match the byte classes
  match classifyWire line with
  | .refuse => if !r then throw "router refuses outside R" else pure .refused
  | .act _ _ => if !s then throw "router mediates outside S" else pure .mediated
  | .passthrough =>
      if !e then throw "router forwards outside escape class" else
      if lenientClass line then pure .escapeLenient else pure .escapePlain

def cellName : Cell → String
  | .mediated => "mediated(S)"
  | .refused => "refused(R)"
  | .escapeLenient => "ESCAPE∩LENIENT"
  | .escapePlain => "escape-plain"

def main : IO UInt32 := do
  let corpus := gridCorpus ++ extraCorpus ++ asciiSweep
  let mut counts : List (Cell × Nat) :=
    [(.mediated, 0), (.refused, 0), (.escapeLenient, 0), (.escapePlain, 0)]
  let mut firstOf : List (Cell × String) := []
  let mut red := false
  for e in corpus do
    match cellOf e.line with
    | .error msg =>
        IO.eprintln s!"RED [{e.label}] {msg} : {e.line}"
        red := true
    | .ok c =>
        counts := counts.map fun (k, n) => if k == c then (k, n + 1) else (k, n)
        if (firstOf.find? (fun (k, _) => k == c)).isNone then
          firstOf := firstOf ++ [(c, s!"[{e.label}] {e.line}")]
  IO.println s!"corpus size: {corpus.length}"
  for (k, n) in counts do
    IO.println s!"  {cellName k}: {n}"
  for (k, w) in firstOf do
    IO.println s!"  first {cellName k}: {w}"
  -- Non-vacuity: every cell inhabited, or the characterisation is vacuous.
  for (k, n) in counts do
    if n == 0 then
      IO.eprintln s!"RED vacuous cell: {cellName k} is EMPTY on the corpus"
      red := true
  -- Pinned canonical witnesses.
  let expect (label : String) (line : String) (want : Cell) : IO Bool := do
    match cellOf line with
    | .error msg => IO.eprintln s!"RED [{label}] {msg}"; pure true
    | .ok c =>
        if c != want then
          IO.eprintln
            s!"RED [{label}] expected {cellName want}, got {cellName c}: {line}"
          pure true
        else pure false
  let checks : List (String × String × Cell) :=
    [("golden-mediated", mediatedWitness, .mediated),
     ("monster-refused", monsterWitness, .refused),
     ("agreement-unsafe-refused", agreementUnsafeWitness, .refused),
     ("monster-in-call-refused",
       "{\"method\":\"tools/call\",\"params\":{\"name\":\"x\",\"arguments\":{\"n\":1e9999999}}}",
       .refused),
     ("bom-call-escapes-lenient", bomWitness, .escapeLenient),
     ("case-call-escapes-lenient", caseWitness, .escapeLenient),
     ("singleton-batch-refused", batchWitness, .refused),
     ("empty-array-refused", emptyTopLevelArray, .refused),
     ("multi-batch-refused",
       "[{\"method\":\"tools/call\",\"params\":{\"name\":\"t\"}},{\"method\":\"tools/list\"}]",
       .refused),
     ("singleton-noncall-array-refused", "[{\"method\":\"tools/list\"}]", .refused),
     ("nested-arguments-array-mediated",
       "{\"method\":\"tools/call\",\"params\":{\"name\":\"t\",\"arguments\":[]}}",
       .mediated),
     ("nested-params-array-passthrough",
       "{\"method\":\"tools/list\",\"params\":[]}", .escapePlain),
     ("initialize-positive-twin", "{\"method\":\"initialize\",\"params\":{}}", .escapePlain),
     ("tools-list-escape-plain", listWitness, .escapePlain),
     ("notification-positive-twin",
       "{\"method\":\"notifications/initialized\",\"params\":{}}", .escapePlain),
     ("response-positive-twin",
       "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}", .escapePlain),
     ("malformed-escape-plain", malformedWitness, .escapePlain)]
  for (l, s, w) in checks do
    if ← expect l s w then red := true
  if red then
    IO.eprintln "STEP 0: RED"
    pure 1
  else
    IO.println "STEP 0: all cells inhabited, router ≡ byte classes, witnesses pinned — GREEN"
    pure 0
