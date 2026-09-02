/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json
import Seal.Hash

/-!
# The effect commitment — pinned preimage, injectivity under named assumptions

Stage A of the effect-commitment plan. The current stage-1 proposal:

    effect_commitment =
      SHA256(encodeParts
        (["seal.effect/v4-proposed-meta-all", server, tool, args.compress] ++
          metadata.preimageParts ++ requestState.preimageParts ++
          inputResponses.preimageParts))
                        → lowercase hex, 64 chars

The metadata suffix is exactly `["meta.absent", ""]` or
`["meta.present", compress(object)]`.  The explicit presence discriminator
makes absence distinct from a present empty object.

The MRTR suffixes use the same explicit-presence construction. A present
`requestState` is committed opaquely as the complete JSON value: the kernel
canonicalises that value but never parses or projects its interior. A present
`inputResponses` likewise commits the complete canonical JSON value. Thus
absence, present `{}`, and present `null` are three different preimages.

* `encodeParts` is REUSED (netstring framing, `Seal.Hash`): its injectivity
  obligation is already discharged in seal-host `Host/CapabilityAdequacy`;
  no new framing, no second obligation.
* `server` and `tool` are INSIDE the preimage: identical arguments under a
  different tool (or server) must never share a commitment.
* The PROPOSED version tag is INSIDE the digest: a later commitment shape is
  distinguishable from this one, and the effect preimage cannot collide
  with the approval preimage over the same alphabet.  This tag and layout are
  deliberately not presented as the final cross-language byte specification:
  changing either invalidates every dependent effect vector, target, approval,
  signature, replay namespace, golden, artifact pin, and provenance record.
* `kernel_identity` is NOT here — it belongs to the approval preimage only.
  Kernels repin; commitments and stored approvals must survive that.
* Lowercase hex everywhere: the digest never exists as raw bytes outside
  the hash function; every consumer takes the 64-char hex string.

## Named assumptions

The theorems below are conditional on FOUR named assumptions, stated as
`Prop`-valued definitions and taken as hypotheses (never as axioms — the
axiom gate stays `propext`/`Classical.choice`/`Quot.sound`):

* `A-CR` (`AssumptionCR`): an IDEALISATION — perfect injectivity of the
  digest pipeline, stated at the lowercase-hex surface the system consumes.
  This is deliberately NOT computational collision resistance and is
  strictly stronger than it: collision resistance says a collision is
  infeasible to FIND; this premise says no collision EXISTS, which no
  fixed-output hash over unbounded inputs can satisfy (pigeonhole), so
  real SHA-256 does not satisfy it. Theorems conditional on A-CR hold in
  the idealised collision-free model only and do NOT instantiate as
  theorems about real SHA-256; the deployed guarantee is a TRUST
  assumption (no SHA-256 collision is known or findable for the inputs
  Seal hashes) that Lean does not and cannot prove. What the structure
  buys, honestly: the cryptographic trust is isolated to this one named
  leaf hypothesis. Stating it at the hex level avoids a separate (true
  but loop-shaped) `toHex` injectivity proof over the runtime encoder.
  See `docs/ASSUMPTIONS.md`.
* `A-ENC` (`AssumptionEncInjective`): `encodeParts` is injective over
  `List String`. True (netstring frames are self-delimiting) and since K5
  PROVED in this repo — `Seal.Encoding.assumptionEncInjective_holds`
  (`Seal/EncodingInjective.lean`, which also proves injectivity of the UTF-8
  bytes the hash consumes). Kept in the hypothesis list so the statements
  below are unchanged; use
  `Seal.Encoding.effect_commitment_injective_of_cr_compress` for the
  discharged form.
* `A-COMPRESS` (`AssumptionCompressInjective`): `Lean.Json.compress` is
  injective. This is what "the commitment binds the JSON value, not a
  string" costs: two distinct `Json` values must not share canonical bytes.
  (Strictly, `Json` values that differ only in `RBNode` balance share a
  compress image; those are semantically the same object, and the
  assumption identifies the value with its canonical bytes.)
* `A-PARSE` (`AssumptionParse`): re-parsing canonical bytes lands on a
  value with the SAME canonical bytes (`compress ∘ parse ∘ compress =
  compress`). `Json.parse` is a `partial def` with no equational lemmas, so
  this is not provable in-kernel; it is exactly what the host
  re-derivation theorem (`commitment_rederivation_stable`) buys with it —
  nothing else below uses it.

BINDER DISCIPLINE: no theorem here hypothesises `enc a ≠ enc b`,
`compress a ≠ compress b`, or `sha256 _ ≠ sha256 _` about the two objects
under discussion. The assumptions are global injectivity statements; the
theorems bind the semantic `Effect`.
-/

namespace Seal

open Lean SealCore

/-- **PROPOSED** domain tag, part 0 of the stage-1 preimage.

    The old `seal.effect/v3` tag cannot be retained after adding `_meta`:
    otherwise an old four-part preimage and a changed-shape preimage would
    inhabit the same domain. MRTR extends this still-unpinned Phase-M proposal
    before the one later repin; it deliberately does not mint a second proposed
    version. The final tag is a later representation ruling; changing this
    proposal invalidates all dependent hashes and vectors. -/
def effectDomainTag : String := "seal.effect/v4-proposed-meta-all"

/-- A structurally validated request `_meta`.

    `present` can contain every legal or unknown key because it stores the
    complete JSON object map, not a selected projection.  Field-level MCP
    validation happens before construction at the protocol boundary; this
    kernel type enforces the stage-1 shape fact that a present value is an
    object. -/
inductive ValidatedMeta where
  | absent
  | present (object : Std.TreeMap.Raw String Json compare)

namespace ValidatedMeta

/-- The complete present object as a JSON value. -/
def toJson? : ValidatedMeta → Option Json
  | .absent => none
  | .present object => some (.obj object)

/-- **PROPOSED** explicit metadata framing.  The second part is deliberately
    empty for absence; the first part is the collision-proof discriminator. -/
def preimageParts : ValidatedMeta → List String
  | .absent => ["meta.absent", ""]
  | .present object => ["meta.present", (Json.obj object).compress]

@[simp] theorem preimageParts_length (metadata : ValidatedMeta) :
    metadata.preimageParts.length = 2 := by
  cases metadata <;> rfl

/-- Re-parse relation used by host re-derivation.  It preserves absence and,
    for a present object, parses its complete canonical JSON bytes back to a
    present object. -/
def ReparsedFrom : ValidatedMeta → ValidatedMeta → Prop
  | .absent, .absent => True
  | .present source, .present reparsed =>
      Json.parse (Json.obj source).compress = .ok (Json.obj reparsed)
  | _, _ => False

end ValidatedMeta

/-! ## Multi-round-trip request identity -/

/-- The optional MCP `requestState` value.

    The present payload is deliberately an uninterpreted `Json` value. The
    kernel neither decodes a token nor projects any member from it; it commits
    exactly the value supplied at the protocol boundary. -/
inductive RequestState where
  | absent
  | present (value : Json)

namespace RequestState

/-- Recover the complete present value without inventing a sentinel for
    absence. -/
def toJson? : RequestState → Option Json
  | .absent => none
  | .present value => some value

/-- **PROPOSED** explicit opaque-state framing under the shared Phase-M v4
    effect tag. -/
def preimageParts : RequestState → List String
  | .absent => ["requestState.absent", ""]
  | .present value => ["requestState.present", value.compress]

@[simp] theorem preimageParts_length (state : RequestState) :
    state.preimageParts.length = 2 := by
  cases state <;> rfl

/-- Re-parse relation used only by host re-derivation. It preserves structural
    absence and the complete canonical bytes of a present value. -/
def ReparsedFrom : RequestState → RequestState → Prop
  | .absent, .absent => True
  | .present source, .present reparsed =>
      Json.parse source.compress = .ok reparsed
  | _, _ => False

end RequestState

/-- The optional complete MCP `inputResponses` JSON value. No response key or
    response payload is projected away in the kernel target. -/
inductive InputResponses where
  | absent
  | present (value : Json)

namespace InputResponses

/-- Recover the complete present value without inventing a sentinel for
    absence. -/
def toJson? : InputResponses → Option Json
  | .absent => none
  | .present value => some value

/-- **PROPOSED** explicit complete-response framing under the shared Phase-M
    v4 effect tag. -/
def preimageParts : InputResponses → List String
  | .absent => ["inputResponses.absent", ""]
  | .present value => ["inputResponses.present", value.compress]

@[simp] theorem preimageParts_length (responses : InputResponses) :
    responses.preimageParts.length = 2 := by
  cases responses <;> rfl

/-- Re-parse relation used only by host re-derivation. It preserves structural
    absence and the complete canonical bytes of a present value. -/
def ReparsedFrom : InputResponses → InputResponses → Prop
  | .absent, .absent => True
  | .present source, .present reparsed =>
      Json.parse source.compress = .ok reparsed
  | _, _ => False

end InputResponses

/-- The semantic object a commitment binds: which server, which tool, which
    (post-parse, canonical) argument value, and which complete structurally
    validated `_meta` presence/value, opaque MRTR state, and complete MRTR
    responses. NO kernel identity — that lives in the approval preimage only. -/
structure Effect where
  server : String
  tool : String
  arguments : Json
  metadata : ValidatedMeta
  requestState : RequestState := .absent
  inputResponses : InputResponses := .absent

/-- The stage-1 proposed preimage, in explicit order. -/
def Effect.preimageParts (e : Effect) : List String :=
  [effectDomainTag, e.server, e.tool, e.arguments.compress] ++
    e.metadata.preimageParts ++ e.requestState.preimageParts ++
    e.inputResponses.preimageParts

/-- THE effect commitment: netstring-framed preimage, SHA-256, lowercase
    64-char hex. Reuses `stableHashParts` (= `sha256Digest ∘ String.toUTF8 ∘
    encodeParts`) and the existing `Digest256.toHex`. -/
def Effect.commitment (e : Effect) : String :=
  (stableHashParts e.preimageParts).toHex

/-- Structural pin for the frisk: the preimage is exactly the proposed new
    tag, server, tool, canonical arguments, then the explicit complete metadata
    presence/value suffix. `kernel_identity` remains nowhere. -/
theorem preimage_shape (e : Effect) :
    e.preimageParts =
      ["seal.effect/v4-proposed-meta-all", e.server, e.tool, e.arguments.compress] ++
        e.metadata.preimageParts ++ e.requestState.preimageParts ++
        e.inputResponses.preimageParts := rfl

/-- The exact absent shape. -/
theorem preimage_shape_absent (server tool : String) (arguments : Json) :
    Effect.preimageParts
        { server, tool, arguments, metadata := .absent,
          requestState := .absent, inputResponses := .absent } =
      ["seal.effect/v4-proposed-meta-all", server, tool, arguments.compress,
        "meta.absent", "", "requestState.absent", "",
        "inputResponses.absent", ""] := rfl

/-- The exact metadata-present, MRTR-absent shape, including the complete
    canonical metadata object. -/
theorem preimage_shape_present (server tool : String) (arguments : Json)
    (object : Std.TreeMap.Raw String Json compare) :
    Effect.preimageParts
        { server, tool, arguments, metadata := .present object,
          requestState := .absent, inputResponses := .absent } =
      ["seal.effect/v4-proposed-meta-all", server, tool, arguments.compress,
        "meta.present", (Json.obj object).compress, "requestState.absent", "",
        "inputResponses.absent", ""] := rfl

/-- The complete exact proposed shape when both MRTR values are present. -/
theorem preimage_shape_mrtr_present (server tool : String) (arguments : Json)
    (metadata : ValidatedMeta) (requestState inputResponses : Json) :
    Effect.preimageParts
        { server, tool, arguments, metadata,
          requestState := .present requestState,
          inputResponses := .present inputResponses } =
      ["seal.effect/v4-proposed-meta-all", server, tool, arguments.compress] ++
        metadata.preimageParts ++
        ["requestState.present", requestState.compress,
         "inputResponses.present", inputResponses.compress] := by
  simp [Effect.preimageParts, effectDomainTag, RequestState.preimageParts,
    InputResponses.preimageParts]

/-! ## Named assumptions -/

/-- A-CR: idealised perfect injectivity of the digest pipeline over UTF-8
    strings, at the lowercase-hex surface
    (`(stableHashString ·).toHex = sha256HexStr ·`). Strictly stronger than
    SHA-256 collision resistance: it asserts no collision EXISTS, which a
    fixed-output hash over unbounded inputs cannot satisfy, so real SHA-256
    does not satisfy this Prop. It is consumed only as a hypothesis — never
    proved, never axiomatised — and theorems conditional on it hold in the
    idealised collision-free model, not for real SHA-256. See the module
    docstring and `docs/ASSUMPTIONS.md`. -/
def AssumptionCR : Prop :=
  ∀ a b : String, (stableHashString a).toHex = (stableHashString b).toHex → a = b

/-- A-ENC: injectivity of the netstring part framing. No longer an
    assumption in substance: `Seal.Encoding.assumptionEncInjective_holds`
    (K5, `Seal/EncodingInjective.lean`) proves it in-repo, and
    `Seal.Encoding.effect_commitment_injective_of_cr_compress` consumes the
    theorems below with this hypothesis discharged. The `Prop` stays named so
    existing statements and the seal-host discharge remain valid. -/
def AssumptionEncInjective : Prop :=
  ∀ a b : List String, encodeParts a = encodeParts b → a = b

/-- A-COMPRESS: canonical serialization is injective on `Json`. -/
def AssumptionCompressInjective : Prop :=
  ∀ a b : Json, a.compress = b.compress → a = b

/-- A-PARSE: canonical bytes are a fixed point of parse-then-compress. What
    it buys (only): `commitment_rederivation_stable` — a host that re-parses
    the canonical argument bytes recovers the same commitment. -/
def AssumptionParse : Prop :=
  ∀ (a a' : Json), Json.parse a.compress = .ok a' → a'.compress = a.compress

/-! ## Theorems -/

theorem ValidatedMeta.preimageParts_injective
    (hcompress : AssumptionCompressInjective) :
    Function.Injective ValidatedMeta.preimageParts := by
  intro a b h
  cases a with
  | absent =>
      cases b with
      | absent => rfl
      | present value => simp [ValidatedMeta.preimageParts] at h
  | present left =>
      cases b with
      | absent => simp [ValidatedMeta.preimageParts] at h
      | present right =>
          have hc : (Json.obj left).compress = (Json.obj right).compress := by
            simpa [ValidatedMeta.preimageParts] using h
          have hj : Json.obj left = Json.obj right := hcompress _ _ hc
          cases Json.obj.inj hj
          rfl

theorem RequestState.preimageParts_injective
    (hcompress : AssumptionCompressInjective) :
    Function.Injective RequestState.preimageParts := by
  intro a b h
  cases a with
  | absent =>
      cases b with
      | absent => rfl
      | present value => simp [RequestState.preimageParts] at h
  | present left =>
      cases b with
      | absent => simp [RequestState.preimageParts] at h
      | present right =>
          have hc : left.compress = right.compress := by
            simpa [RequestState.preimageParts] using h
          cases hcompress _ _ hc
          rfl

theorem InputResponses.preimageParts_injective
    (hcompress : AssumptionCompressInjective) :
    Function.Injective InputResponses.preimageParts := by
  intro a b h
  cases a with
  | absent =>
      cases b with
      | absent => rfl
      | present value => simp [InputResponses.preimageParts] at h
  | present left =>
      cases b with
      | absent => simp [InputResponses.preimageParts] at h
      | present right =>
          have hc : left.compress = right.compress := by
            simpa [InputResponses.preimageParts] using h
          cases hcompress _ _ hc
          rfl

/-- **Injectivity of the effect commitment**, bound at the semantic
    `Effect`, conditional on A-CR + A-ENC + A-COMPRESS. Equal commitments
    force equality of the complete semantic target, including metadata and
    both MRTR presence/value fields. -/
theorem effect_commitment_injective
    (hcr : AssumptionCR) (henc : AssumptionEncInjective)
    (hcompress : AssumptionCompressInjective)
    (e₁ e₂ : Effect) (h : e₁.commitment = e₂.commitment) : e₁ = e₂ := by
  have hstr : encodeParts e₁.preimageParts = encodeParts e₂.preimageParts :=
    hcr _ _ h
  have hparts : e₁.preimageParts = e₂.preimageParts := henc _ _ hstr
  have hs : e₁.server = e₂.server := by
    have hi := congrArg (fun parts : List String => parts[1]?) hparts
    simpa [Effect.preimageParts] using hi
  have ht : e₁.tool = e₂.tool := by
    have hi := congrArg (fun parts : List String => parts[2]?) hparts
    simpa [Effect.preimageParts] using hi
  have hc : e₁.arguments.compress = e₂.arguments.compress := by
    have hi := congrArg (fun parts : List String => parts[3]?) hparts
    simpa [Effect.preimageParts] using hi
  have hmParts : e₁.metadata.preimageParts = e₂.metadata.preimageParts := by
    have hi := congrArg (fun parts : List String => (parts.drop 4).take 2) hparts
    simpa [Effect.preimageParts] using hi
  have hrsParts :
      e₁.requestState.preimageParts = e₂.requestState.preimageParts := by
    have hi := congrArg (fun parts : List String => (parts.drop 6).take 2) hparts
    simpa [Effect.preimageParts] using hi
  have htail :
      e₁.metadata.preimageParts ++ e₁.requestState.preimageParts ++
          e₁.inputResponses.preimageParts =
        e₂.metadata.preimageParts ++ e₂.requestState.preimageParts ++
          e₂.inputResponses.preimageParts := by
    simpa [Effect.preimageParts, hs, ht, hc] using hparts
  have hirParts :
      e₁.inputResponses.preimageParts = e₂.inputResponses.preimageParts := by
    rw [hmParts, hrsParts] at htail
    exact List.append_cancel_left htail
  have ha : e₁.arguments = e₂.arguments := hcompress _ _ hc
  have hm : e₁.metadata = e₂.metadata :=
    ValidatedMeta.preimageParts_injective hcompress hmParts
  have hrs : e₁.requestState = e₂.requestState :=
    RequestState.preimageParts_injective hcompress hrsParts
  have hir : e₁.inputResponses = e₂.inputResponses :=
    InputResponses.preimageParts_injective hcompress hirParts
  cases e₁
  cases e₂
  simp_all

/-- **The commitment check.** The host's re-derivation agrees with the
    kernel's value iff they are talking about the same effect. -/
theorem commitment_check_iff
    (hcr : AssumptionCR) (henc : AssumptionEncInjective)
    (hcompress : AssumptionCompressInjective)
    (kernel host : Effect) :
    kernel.commitment = host.commitment ↔ kernel = host :=
  ⟨effect_commitment_injective hcr henc hcompress kernel host,
   fun h => h ▸ rfl⟩

theorem ValidatedMeta.preimageParts_eq_of_reparsed
    (hparse : AssumptionParse) {source reparsed : ValidatedMeta}
    (h : ValidatedMeta.ReparsedFrom source reparsed) :
    reparsed.preimageParts = source.preimageParts := by
  cases source <;> cases reparsed <;>
    simp_all [ValidatedMeta.ReparsedFrom, ValidatedMeta.preimageParts]
  exact hparse _ _ h

theorem RequestState.preimageParts_eq_of_reparsed
    (hparse : AssumptionParse) {source reparsed : RequestState}
    (h : RequestState.ReparsedFrom source reparsed) :
    reparsed.preimageParts = source.preimageParts := by
  cases source <;> cases reparsed <;>
    simp_all [RequestState.ReparsedFrom, RequestState.preimageParts]
  exact hparse _ _ h

theorem InputResponses.preimageParts_eq_of_reparsed
    (hparse : AssumptionParse) {source reparsed : InputResponses}
    (h : InputResponses.ReparsedFrom source reparsed) :
    reparsed.preimageParts = source.preimageParts := by
  cases source <;> cases reparsed <;>
    simp_all [InputResponses.ReparsedFrom, InputResponses.preimageParts]
  exact hparse _ _ h

/-- **Host re-derivation stability** (the A-PARSE theorem): a consumer that
    holds and re-parses every canonical JSON part gets the same commitment.
    For request state this is byte preservation only, never interpretation. -/
theorem commitment_rederivation_stable
    (hparse : AssumptionParse) (e : Effect) (args' : Json)
    (metadata' : ValidatedMeta) (requestState' : RequestState)
    (inputResponses' : InputResponses)
    (hargs : Json.parse e.arguments.compress = .ok args')
    (hmeta : ValidatedMeta.ReparsedFrom e.metadata metadata')
    (hrequestState : RequestState.ReparsedFrom e.requestState requestState')
    (hinputResponses :
      InputResponses.ReparsedFrom e.inputResponses inputResponses') :
    Effect.commitment
        { server := e.server, tool := e.tool, arguments := args',
          metadata := metadata', requestState := requestState',
          inputResponses := inputResponses' } =
      e.commitment := by
  have hargsCompress : args'.compress = e.arguments.compress :=
    hparse _ _ hargs
  have hmetaParts : metadata'.preimageParts = e.metadata.preimageParts :=
    ValidatedMeta.preimageParts_eq_of_reparsed hparse hmeta
  have hrequestStateParts :
      requestState'.preimageParts = e.requestState.preimageParts :=
    RequestState.preimageParts_eq_of_reparsed hparse hrequestState
  have hinputResponsesParts :
      inputResponses'.preimageParts = e.inputResponses.preimageParts :=
    InputResponses.preimageParts_eq_of_reparsed hparse hinputResponses
  apply congrArg (fun parts => (stableHashParts parts).toHex)
  simp only [Effect.preimageParts, hargsCompress, hmetaParts,
    hrequestStateParts, hinputResponsesParts]

/-! ## Non-vacuity at the preimage level (no hash evaluation needed) -/

/-- Same arguments under two different tools have different preimages —
    the envelope is not decorative. (The hash level is pinned by the
    emitted vector file and the `#eval` pin below.) -/
theorem preimage_separates_tools (server : String) (args : Json)
    (metadata : ValidatedMeta) (t₁ t₂ : String) (h : t₁ ≠ t₂) :
    Effect.preimageParts
        { server, tool := t₁, arguments := args, metadata,
          requestState := .absent, inputResponses := .absent } ≠
      Effect.preimageParts
        { server, tool := t₂, arguments := args, metadata,
          requestState := .absent, inputResponses := .absent } := by
  intro hparts
  have hi := congrArg (fun parts : List String => parts[2]?) hparts
  simp [Effect.preimageParts] at hi
  exact h hi

/-- Same tool under two different servers: different preimages. -/
theorem preimage_separates_servers (tool : String) (args : Json)
    (metadata : ValidatedMeta) (s₁ s₂ : String) (h : s₁ ≠ s₂) :
    Effect.preimageParts
        { server := s₁, tool, arguments := args, metadata,
          requestState := .absent, inputResponses := .absent } ≠
      Effect.preimageParts
        { server := s₂, tool, arguments := args, metadata,
          requestState := .absent, inputResponses := .absent } := by
  intro hparts
  have hi := congrArg (fun parts : List String => parts[1]?) hparts
  simp [Effect.preimageParts] at hi
  exact h hi

/-! ## Compiled-evaluation pins (real SHA-256, build-gated) -/

/-- info: true -/
#guard_msgs in #eval
  Effect.commitment
      { server := "srv", tool := "tool_a", arguments := Json.mkObj [],
        metadata := .absent } !=
    Effect.commitment
      { server := "srv", tool := "tool_b", arguments := Json.mkObj [],
        metadata := .absent }

/-- info: true -/
#guard_msgs in #eval
  let c := Effect.commitment
    { server := "srv", tool := "tool_a", arguments := Json.mkObj [],
      metadata := .absent }
  c.length == 64 && c.toList.all fun ch => ch.isDigit || ('a' ≤ ch && ch ≤ 'f')

end Seal
