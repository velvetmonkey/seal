/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.Serialization
import SealV2.Crypto
import Seal.EffectCommitment
import Seal.EncodingInjective

namespace SealV2

abbrev SessionId := String
abbrev PublicKey := String
abbrev Signature := String
abbrev ManifestDigest := String
abbrev ToolVersion := String
abbrev Action := String
abbrev ToolName := String

/-- An absolute UTC timestamp: the number of whole seconds elapsed since the
    Unix epoch, 1970-01-01T00:00:00Z. Fractional seconds are discarded before
    constructing this value. This name is the normative unit/epoch contract
    shared by signed approvals, effect envelopes, and the trusted clock. -/
abbrev UnixSeconds := Nat

/-- The complete structurally validated `_meta` identity carried by V2.

    A present object is stored as the canonical JSON bytes produced by the
    same `Lean.Json` object representation used by the stage-1 guard target.
    This is deliberate: the V2 AST preserves object-member order, whereas
    stage 1 uses a `TreeMap`. Normalising here prevents the two identity
    layers from disagreeing merely because members were reordered. -/
inductive MetaValue where
  | absent
  | present (canonicalObject : CanonicalBytes)
  deriving Repr, BEq, DecidableEq, ReflBEq, LawfulBEq

namespace MetaValue

/-- The exact identity suffix shared with `Seal.ValidatedMeta.preimageParts`. -/
def preimageParts : MetaValue → List String
  | .absent => ["meta.absent", ""]
  | .present canonicalObject => ["meta.present", canonicalObject]

@[simp] theorem preimageParts_length (metadata : MetaValue) :
    metadata.preimageParts.length = 2 := by
  cases metadata <;> rfl

/-- Convert the stage-1 validated value without projection or reinterpretation. -/
def ofStage1 : Seal.ValidatedMeta → MetaValue
  | .absent => .absent
  | .present object => .present (Lean.Json.obj object).compress

/-- The V2 and stage-1 metadata preimages are definitionally identical. -/
theorem ofStage1_preimageParts (metadata : Seal.ValidatedMeta) :
    (ofStage1 metadata).preimageParts = metadata.preimageParts := by
  cases metadata <;> rfl

/-- Parse a V2 request `_meta` seat. Absence is first-class; a present value
    must be an object. Re-parsing the V2 canonical AST serialization through
    `Lean.Json` gives the same complete, order-normalized object value used by
    the stage-1 path. -/
def fromAst? : Option AST → Option MetaValue
  | none => some .absent
  | some (.object fields) =>
      match Lean.Json.parse (serializeAstValue (.object fields)) with
      | .ok (.obj object) => some (.present (Lean.Json.obj object).compress)
      | _ => none
  | some _ => none

/-- Proof-friendly signed-target representation. The discriminator is
    explicit, and the complete canonical present object is carried by value. -/
def signedAst : MetaValue → AST
  | .absent => .object [("presence", .string "absent")]
  | .present canonicalObject =>
      .object [
        ("presence", .string "present"),
        ("canonicalObject", .string canonicalObject)
      ]

/-- Structural inverse of `signedAst`. -/
def fromSignedAst? : AST → Option MetaValue
  | .object [("presence", .string "absent")] => some .absent
  | .object [
      ("presence", .string "present"),
      ("canonicalObject", .string canonicalObject)] =>
      match Lean.Json.parse canonicalObject with
      | .ok (.obj object) =>
          let normalized := (Lean.Json.obj object).compress
          if normalized == canonicalObject then some (.present normalized) else none
      | _ => none
  | _ => none

end MetaValue

/-! ## Multi-round-trip request identity

The V2 layer stores the same complete JSON values as Stage A, normalized
through `Lean.Json.compress` so object member order cannot make the two
layers disagree.  `requestState` remains one opaque value: no decoder,
projection, or member lookup exists below. -/

inductive RequestState where
  | absent
  | present (canonicalValue : CanonicalBytes)
  deriving Repr, BEq, DecidableEq, ReflBEq, LawfulBEq

namespace RequestState

def preimageParts : RequestState → List String
  | .absent => ["requestState.absent", ""]
  | .present canonicalValue => ["requestState.present", canonicalValue]

@[simp] theorem preimageParts_length (state : RequestState) :
    state.preimageParts.length = 2 := by
  cases state <;> rfl

def ofStage1 : Seal.RequestState → RequestState
  | .absent => .absent
  | .present value => .present value.compress

theorem ofStage1_preimageParts (state : Seal.RequestState) :
    (ofStage1 state).preimageParts = state.preimageParts := by
  cases state <;> rfl

/-- Cross-layer correspondence: Stage A and V2 give the same answer to
    whether opaque request state changed identity. -/
theorem ofStage1_preimageParts_ne_iff
    (left right : Seal.RequestState) :
    left.preimageParts ≠ right.preimageParts ↔
      (ofStage1 left).preimageParts ≠ (ofStage1 right).preimageParts := by
  rw [ofStage1_preimageParts, ofStage1_preimageParts]

def fromAst? : Option AST → Option RequestState
  | none => some .absent
  | some value =>
      match Lean.Json.parse (serializeAstValue value) with
      | .ok parsed => some (.present parsed.compress)
      | .error _ => none

def signedAst : CanonicalBytes → AST :=
  fun canonicalValue =>
    .object [("canonicalValue", .string canonicalValue)]

def fromSignedAst? : AST → Option RequestState
  | .object [("canonicalValue", .string canonicalValue)] =>
      match Lean.Json.parse canonicalValue with
      | .ok parsed =>
          let normalized := parsed.compress
          if normalized == canonicalValue then some (.present normalized) else none
      | .error _ => none
  | _ => none

theorem preimageParts_injective : Function.Injective preimageParts := by
  intro left right h
  cases left <;> cases right <;> simp [preimageParts] at h ⊢
  assumption

end RequestState

inductive InputResponses where
  | absent
  | present (canonicalValue : CanonicalBytes)
  deriving Repr, BEq, DecidableEq, ReflBEq, LawfulBEq

namespace InputResponses

def preimageParts : InputResponses → List String
  | .absent => ["inputResponses.absent", ""]
  | .present canonicalValue => ["inputResponses.present", canonicalValue]

@[simp] theorem preimageParts_length (responses : InputResponses) :
    responses.preimageParts.length = 2 := by
  cases responses <;> rfl

def ofStage1 : Seal.InputResponses → InputResponses
  | .absent => .absent
  | .present value => .present value.compress

theorem ofStage1_preimageParts (responses : Seal.InputResponses) :
    (ofStage1 responses).preimageParts = responses.preimageParts := by
  cases responses <;> rfl

/-- Cross-layer correspondence: Stage A and V2 give the same answer to
    whether complete input responses changed identity. -/
theorem ofStage1_preimageParts_ne_iff
    (left right : Seal.InputResponses) :
    left.preimageParts ≠ right.preimageParts ↔
      (ofStage1 left).preimageParts ≠ (ofStage1 right).preimageParts := by
  rw [ofStage1_preimageParts, ofStage1_preimageParts]

def fromAst? : Option AST → Option InputResponses
  | none => some .absent
  | some value =>
      match Lean.Json.parse (serializeAstValue value) with
      | .ok parsed => some (.present parsed.compress)
      | .error _ => none

def signedAst : CanonicalBytes → AST :=
  fun canonicalValue =>
    .object [("canonicalValue", .string canonicalValue)]

def fromSignedAst? : AST → Option InputResponses
  | .object [("canonicalValue", .string canonicalValue)] =>
      match Lean.Json.parse canonicalValue with
      | .ok parsed =>
          let normalized := parsed.compress
          if normalized == canonicalValue then some (.present normalized) else none
      | .error _ => none
  | _ => none

theorem preimageParts_injective : Function.Injective preimageParts := by
  intro left right h
  cases left <;> cases right <;> simp [preimageParts] at h ⊢
  assumption

end InputResponses

structure CapabilityRequest where
  tool : ToolName
  action : Action
  arguments : AST
  metadata : MetaValue
  requestState : RequestState := .absent
  inputResponses : InputResponses := .absent
  deriving Repr, BEq

structure ToolSpec where
  tool : ToolName
  version : ToolVersion
  actions : List Action
  deriving Repr, BEq

structure Target where
  tool : ToolName
  action : Action
  toolVersion : ToolVersion
  manifestDigest : ManifestDigest
  arguments : AST
  metadata : MetaValue
  requestState : RequestState := .absent
  inputResponses : InputResponses := .absent
  deriving Repr, BEq

/-- A nonce is a fixed-width 32-byte value rendered as exactly 64 lowercase hex characters. -/
def isLowerHexChar (c : Char) : Bool :=
  ('0'.toNat ≤ c.toNat && c.toNat ≤ '9'.toNat) ||
  ('a'.toNat ≤ c.toNat && c.toNat ≤ 'f'.toNat)

def isCanonicalNonceString (s : String) : Bool :=
  s.toList.length == 64 && s.toList.all isLowerHexChar

/-- A canonical nonce carries the proof that its string form is exactly 64 lowercase hex chars. -/
structure Nonce where
  value : String
  canonical : isCanonicalNonceString value = true

instance : BEq Nonce where
  beq a b := a.value == b.value

instance : Repr Nonce where
  reprPrec n p := reprPrec n.value p

structure SignedMessage where
  target : Target
  session : SessionId
  issuedAt : UnixSeconds
  expiry : UnixSeconds
  nonce : Nonce
  deriving Repr, BEq

structure Approval where
  target : Target
  session : SessionId
  issuedAt : UnixSeconds
  expiresAt : UnixSeconds
  consumed : Bool
  signedMessageRaw : RawBytes
  signature : Signature
  nonce : Nonce
  deriving Repr, BEq

/-- The namespace a consumed nonce lives in: a replay is only a replay within the
    same public key, target, session, and policy version. The target is held as its
    canonical string key (`serializeTargetKey`) rather than the structured `Target`, so
    `ReplayNamespace` equality is over `String`s only — decidable, reducible, and with a
    lawful `BEq` (the structured `AST` arguments do not leak a non-reducing derived BEq
    onto the replay-detection path). -/
structure ReplayNamespace where
  publicKey : PublicKey
  targetKey : String
  session : SessionId
  policyVersion : String
  deriving Repr, BEq

/-- A spent nonce, bound to its namespace, with the time it may be pruned after. -/
structure ConsumedNonce where
  ns : ReplayNamespace
  nonce : Nonce
  expiresAt : UnixSeconds
  deriving Repr, BEq

structure ApprovalState where
  session : SessionId
  /-- Trusted host clock in the same Unix-seconds domain as every signed time. -/
  now : UnixSeconds
  publicKey : PublicKey
  manifestDigest : ManifestDigest
  tools : List ToolSpec
  approvals : List Approval
  policyVersion : String := ""
  maxApprovalTtl : Nat := 300
  consumedNonces : List ConsumedNonce := []
  /-- The ledger generation the SIGNED CONFIG endorses (nonce-ledger lane,
      council `1e92b551`). Same pattern as `policyVersion`: lives in the
      signed config, MANDATORY nonzero at the gate
      (`SealV2.Effect.Ledger.generationGate`), so the default `0` means
      "unconfigured" and FAILS CLOSED — never a sentinel bypass. Rotating
      the store requires re-signing the config at N+1: a deliberate
      authority act. The store cannot mint this value (a store-minted epoch
      is theatre: whoever can reset the store can mint the epoch).

      Information-flow warrant (`9a4c972`): this field is HIGH in the base
      model — before this note its declaration was its only occurrence in
      this file, and it is absent from `SealV2/Decide.lean`, so `authView`
      and `decide` are ledger-blind. Do NOT transport that result to the
      ledgered path: `effectStepLedgered` copies the value into three
      returned fences. `SealV2/NonceLedger.lean` on
      `feat/ledgered-ni-classification` makes that declassification explicit
      in `ledgered_generation_declassified` and its negative controls. -/
  ledgerGeneration : Nat := 0
  deriving Repr, BEq

def signedMessage (approval : Approval) : SignedMessage :=
  { target := approval.target, session := approval.session,
    issuedAt := approval.issuedAt, expiry := approval.expiresAt, nonce := approval.nonce }

private def signedRequestStateField : RequestState → List (String × AST)
  | .absent => []
  | .present canonicalValue =>
      [("requestState", RequestState.signedAst canonicalValue)]

private def signedInputResponsesField : InputResponses → List (String × AST)
  | .absent => []
  | .present canonicalValue =>
      [("inputResponses", InputResponses.signedAst canonicalValue)]

def signedTargetFields (target : Target) : List (String × AST) :=
  [
    ("tool", .string target.tool),
    ("action", .string target.action),
    ("toolVersion", .string target.toolVersion),
    ("manifestDigest", .string target.manifestDigest),
    ("arguments", target.arguments),
    ("metadata", target.metadata.signedAst)
  ] ++ signedRequestStateField target.requestState ++
    signedInputResponsesField target.inputResponses

def signedMessageAst (message : SignedMessage) : AST :=
  .object [
    ("target", .object (signedTargetFields message.target)),
    ("session", .string message.session),
    ("issuedAt", .number { negative := false, intDigits := toString message.issuedAt, fracDigits := none }),
    ("expiry", .number { negative := false, intDigits := toString message.expiry, fracDigits := none }),
    ("nonce", .string message.nonce.value)
  ]

theorem signedTargetFields_separates_requestState (base : Target)
    (left right : RequestState) (hne : left ≠ right) :
    signedTargetFields { base with requestState := left } ≠
      signedTargetFields { base with requestState := right } := by
  intro h
  apply hne
  cases left <;> cases right <;>
    simp [signedTargetFields, signedRequestStateField,
      signedInputResponsesField, RequestState.signedAst] at h ⊢
  assumption

theorem signedTargetFields_separates_inputResponses (base : Target)
    (left right : InputResponses) (hne : left ≠ right) :
    signedTargetFields { base with inputResponses := left } ≠
      signedTargetFields { base with inputResponses := right } := by
  intro h
  apply hne
  cases left <;> cases right <;>
    simp [signedTargetFields, signedRequestStateField,
      signedInputResponsesField, InputResponses.signedAst] at h ⊢
  assumption

private def signedTargetFieldsFromMessageAst : AST → List (String × AST)
  | .object (("target", .object fields) :: _) => fields
  | _ => []

theorem signedMessageAst_separates_requestState (base : SignedMessage)
    (left right : RequestState) (hne : left ≠ right) :
    signedMessageAst { base with target.requestState := left } ≠
      signedMessageAst { base with target.requestState := right } := by
  intro h
  apply signedTargetFields_separates_requestState base.target left right hne
  exact congrArg signedTargetFieldsFromMessageAst h

theorem signedMessageAst_separates_inputResponses (base : SignedMessage)
    (left right : InputResponses) (hne : left ≠ right) :
    signedMessageAst { base with target.inputResponses := left } ≠
      signedMessageAst { base with target.inputResponses := right } := by
  intro h
  apply signedTargetFields_separates_inputResponses base.target left right hne
  exact congrArg signedTargetFieldsFromMessageAst h

/-- Recover a non-negative integer from a canonical decimal AST node. -/
def astNat? : AST → Option Nat
  | .number d => if d.negative then none else (if d.fracDigits.isSome then none else d.intDigits.toNat?)
  | _ => none

private def mrtrFromSignedFields? :
    List (String × AST) → Option (RequestState × InputResponses)
  | [] => some (.absent, .absent)
  | [("requestState", stateAst)] => do
      let state ← RequestState.fromSignedAst? stateAst
      some (state, .absent)
  | [("inputResponses", responsesAst)] => do
      let responses ← InputResponses.fromSignedAst? responsesAst
      some (.absent, responses)
  | [("requestState", stateAst), ("inputResponses", responsesAst)] => do
      let state ← RequestState.fromSignedAst? stateAst
      let responses ← InputResponses.fromSignedAst? responsesAst
      some (state, responses)
  | _ => none

/-- Structural inverse of `signedMessageAst`. Requires the trailing nonce field to be
    a `.string` satisfying `isCanonicalNonceString`; rejects everything else. This is
    where nonce canonicality is enforced on the parsed signed-message path. -/
def signedMessageFromAst? (ast : AST) : Option SignedMessage :=
  match ast with
  | .object [
      ("target", .object (
        ("tool", .string tool) ::
        ("action", .string action) ::
        ("toolVersion", .string toolVersion) ::
        ("manifestDigest", .string manifestDigest) ::
        ("arguments", arguments) ::
        ("metadata", metadataAst) :: mrtrFields)),
      ("session", .string session),
      ("issuedAt", issuedAtAst),
      ("expiry", expiryAst),
      ("nonce", .string nonceStr)] =>
    match astNat? issuedAtAst, astNat? expiryAst, MetaValue.fromSignedAst? metadataAst,
        mrtrFromSignedFields? mrtrFields with
    | some issuedAt, some expiry, some metadata, some (requestState, inputResponses) =>
        if h : isCanonicalNonceString nonceStr = true then
          some {
            target := {
              tool, action, toolVersion, manifestDigest, arguments, metadata,
              requestState, inputResponses
            },
            session := session,
            issuedAt := issuedAt,
            expiry := expiry,
            nonce := { value := nonceStr, canonical := h }
          }
        else
          none
    | _, _, _, _ => none
  | _ => none

def signedMessageCanonical? (message : SignedMessage) : Option {ast // IsCanonical ast} :=
  let ast := signedMessageAst message
  if h : IsCanonical ast then
    some ⟨ast, h⟩
  else
    none

def signedParse (raw : RawBytes) : Option {ast // IsCanonical ast} :=
  match parse raw with
  | none => none
  | some ast =>
      if h : IsCanonical ast then
        if raw == serializeAst ⟨ast, h⟩ then
          some ⟨ast, h⟩
        else
          none
      else
        none

def signedMessageRawFor (message : SignedMessage) : RawBytes :=
  match signedMessageCanonical? message with
  | some ast => serializeAst ast
  | none => "<noncanonical>"

def verifySignature (publicKey : PublicKey) (approval : Approval) : Bool :=
  match signedParse approval.signedMessageRaw with
  | some ast =>
      (signedMessageFromAst? ast.val == some (signedMessage approval)) &&
        ast.val == signedMessageAst (signedMessage approval) &&
        -- M5: real Ed25519 over EXACTLY the canonical signed-message bytes
        -- (`signedMessageRaw`, pinned canonical by `signed_parse_canonical`). The
        -- public key and signature are hex; fail-closed if either is malformed.
        -- Crypto correctness is the TCB(A3) assumption — see SealV2/Crypto.lean.
        (match hexDecode? publicKey, hexDecode? approval.signature with
         | some pkBytes, some sigBytes =>
             ed25519Verify pkBytes approval.signedMessageRaw.toUTF8 sigBytes
         | _, _ => false)
  | none => false

structure SignatureVerified (publicKey : PublicKey) (approval : Approval) : Prop where
  verified : verifySignature publicKey approval = true
  signed_message_is_target_session_expiry :
    signedMessage approval =
      { target := approval.target, session := approval.session,
        issuedAt := approval.issuedAt, expiry := approval.expiresAt, nonce := approval.nonce }

def lookupObj (key : String) (fields : List (String × AST)) : Option AST :=
  match fields with
  | [] => none
  | (k, v) :: rest => if k == key then some v else lookupObj key rest

def astString? : AST → Option String
  | .string value => some value
  | _ => none

def requestFromAst (ast : AST) : Option CapabilityRequest :=
  match ast with
  | .object fields => do
      let method ← lookupObj "method" fields >>= astString?
      if method != "tools/call" then
        none
      else
        match lookupObj "params" fields with
        | some (.object params) =>
            let tool ← lookupObj "name" params >>= astString?
            let action ← lookupObj "action" params >>= astString?
            let arguments ← lookupObj "arguments" params
            let metadata ← MetaValue.fromAst? (lookupObj "_meta" params)
            let requestState ← RequestState.fromAst? (lookupObj "requestState" params)
            let inputResponses ←
              InputResponses.fromAst? (lookupObj "inputResponses" params)
            some {
              tool, action, arguments, metadata, requestState, inputResponses
            }
        | _ => none
  | _ => none

def findToolSpec (state : ApprovalState) (request : CapabilityRequest) : Option ToolSpec :=
  state.tools.find? fun spec => spec.tool == request.tool && spec.actions.any (fun action => action == request.action)

def targetFor (state : ApprovalState) (request : CapabilityRequest) (spec : ToolSpec) : Target :=
  {
    tool := request.tool,
    action := request.action,
    toolVersion := spec.version,
    manifestDigest := state.manifestDigest,
    arguments := request.arguments,
    metadata := request.metadata,
    requestState := request.requestState,
    inputResponses := request.inputResponses
  }

/-- The default ceiling on an approval's lifetime, in seconds. -/
def defaultMaxApprovalTtl : Nat := 300

/-- Drop consumed-nonce entries whose pruning time has passed. Kept entries are
    those still live at `now`. -/
def pruneConsumedNonces (now : Nat) (entries : List ConsumedNonce) : List ConsumedNonce :=
  entries.filter (fun e => now <= e.expiresAt)

/-- The exact typed-target key parts. The three optional values use the same
    explicit absent/present suffixes as Stage A. -/
def Target.keyParts (target : Target) : List String :=
  [target.tool, target.action, target.toolVersion, target.manifestDigest,
    serializeAstValue target.arguments] ++ target.metadata.preimageParts ++
    target.requestState.preimageParts ++ target.inputResponses.preimageParts

/-- A total, injectively framed canonical string key for a target. -/
def serializeTargetKey (target : Target) : String :=
  Seal.encodeParts target.keyParts

theorem target_separates_requestState (base : Target)
    (left right : RequestState) (hne : left ≠ right) :
    { base with requestState := left } ≠ { base with requestState := right } := by
  intro h
  exact hne (congrArg Target.requestState h)

theorem target_separates_inputResponses (base : Target)
    (left right : InputResponses) (hne : left ≠ right) :
    { base with inputResponses := left } ≠ { base with inputResponses := right } := by
  intro h
  exact hne (congrArg Target.inputResponses h)

theorem targetKey_separates_requestState (base : Target)
    (left right : RequestState) (hne : left ≠ right) :
    serializeTargetKey { base with requestState := left } ≠
      serializeTargetKey { base with requestState := right } := by
  intro h
  have hparts := Seal.Encoding.encodeParts_injective h
  have hrs := congrArg (fun parts => (parts.drop 7).take 2) hparts
  have : left.preimageParts = right.preimageParts := by
    simpa [Target.keyParts] using hrs
  exact hne (RequestState.preimageParts_injective this)

theorem targetKey_separates_inputResponses (base : Target)
    (left right : InputResponses) (hne : left ≠ right) :
    serializeTargetKey { base with inputResponses := left } ≠
      serializeTargetKey { base with inputResponses := right } := by
  intro h
  have hparts := Seal.Encoding.encodeParts_injective h
  have hir := congrArg (fun parts => (parts.drop 7).drop 2) hparts
  have : left.preimageParts = right.preimageParts := by
    simpa [Target.keyParts] using hir
  exact hne (InputResponses.preimageParts_injective this)

theorem target_requestState_absent_ne_present (base : Target)
    (canonicalValue : CanonicalBytes) :
    { base with requestState := .absent } ≠
      { base with requestState := .present canonicalValue } :=
  target_separates_requestState base _ _ (by simp)

theorem target_inputResponses_absent_ne_present (base : Target)
    (canonicalValue : CanonicalBytes) :
    { base with inputResponses := .absent } ≠
      { base with inputResponses := .present canonicalValue } :=
  target_separates_inputResponses base _ _ (by simp)

theorem targetKey_requestState_absent_ne_present (base : Target)
    (canonicalValue : CanonicalBytes) :
    serializeTargetKey { base with requestState := .absent } ≠
      serializeTargetKey { base with requestState := .present canonicalValue } :=
  targetKey_separates_requestState base _ _ (by simp)

theorem targetKey_inputResponses_absent_ne_present (base : Target)
    (canonicalValue : CanonicalBytes) :
    serializeTargetKey { base with inputResponses := .absent } ≠
      serializeTargetKey { base with inputResponses := .present canonicalValue } :=
  targetKey_separates_inputResponses base _ _ (by simp)

def replayNamespace (state : ApprovalState) (target : Target) : ReplayNamespace :=
  { publicKey := state.publicKey,
    targetKey := serializeTargetKey target,
    session := state.session,
    policyVersion := state.policyVersion }

/-- True iff this approval's nonce has already been spent in the same pruned namespace. -/
def nonceConsumed (state : ApprovalState) (target : Target) (approval : Approval) : Bool :=
  let ns := replayNamespace state target
  let pruned := pruneConsumedNonces state.now state.consumedNonces
  pruned.any (fun e => e.ns == ns && e.nonce == approval.nonce)

/-- True iff the approval's claimed lifetime is well-formed and within the state's cap. -/
def ttlWithinCap (state : ApprovalState) (approval : Approval) : Bool :=
  approval.issuedAt <= approval.expiresAt &&
    (approval.expiresAt - approval.issuedAt) <= state.maxApprovalTtl

def approvalLiveFor (state : ApprovalState) (target : Target) (approval : Approval) : Bool :=
  approval.target == target &&
    approval.session == state.session &&
    approval.consumed == false &&
    state.now <= approval.expiresAt &&
    ttlWithinCap state approval &&
    !nonceConsumed state target approval &&
    verifySignature state.publicKey approval

def findApproval (state : ApprovalState) (target : Target) : Option Approval :=
  state.approvals.find? (approvalLiveFor state target)

structure ValidApproval (ast : AST) (state : ApprovalState) where
  ast_canonical : IsCanonical ast
  request : CapabilityRequest
  request_from_ast : requestFromAst ast = some request
  toolSpec : ToolSpec
  tool_spec_in_state : state.tools.contains toolSpec = true
  action_allowed : toolSpec.actions.contains request.action = true
  target : Target
  target_matches : target = targetFor state request toolSpec
  approval : Approval
  approval_in_state : state.approvals.contains approval = true
  approval_target_matches : (approval.target == target) = true
  approval_session_matches : approval.session = state.session
  approval_unused : approval.consumed = false
  approval_unexpired : state.now <= approval.expiresAt
  signature_verified : SignatureVerified state.publicKey approval

def validate (ast : AST) (state : ApprovalState) : Option (Σ checkedAst, ValidApproval checkedAst state) :=
  if hCanonical : IsCanonical ast then
    match hReq : requestFromAst ast with
    | none => none
    | some request =>
        match findToolSpec state request with
        | none => none
        | some spec =>
            let target := targetFor state request spec
            match findApproval state target with
            | none => none
            | some approval =>
                if hSig : verifySignature state.publicKey approval then
                  if hTools : state.tools.contains spec then
                    if hAction : spec.actions.contains request.action then
                      if hApprovals : state.approvals.contains approval then
                        if hTarget : approval.target == target then
                          if hSession : approval.session = state.session then
                            if hUnused : approval.consumed = false then
                              if hExpiry : state.now <= approval.expiresAt then
                                some ⟨ast, {
                                  ast_canonical := hCanonical,
                                  request := request,
                                  request_from_ast := hReq,
                                  toolSpec := spec,
                                  tool_spec_in_state := hTools,
                                  action_allowed := hAction,
                                  target := target,
                                  target_matches := rfl,
                                  approval := approval,
                                  approval_in_state := hApprovals,
                                  approval_target_matches := hTarget,
                                  approval_session_matches := hSession,
                                  approval_unused := hUnused,
                                  approval_unexpired := hExpiry,
                                  signature_verified := {
                                    verified := hSig,
                                    signed_message_is_target_session_expiry := rfl
                                  }
                                }⟩
                              else none
                            else none
                          else none
                        else none
                      else none
                    else none
                  else none
                else none
  else
    none

def serialize {state : ApprovalState} (checked : Σ ast, ValidApproval ast state) : CanonicalBytes :=
  serializeAst ⟨checked.fst, checked.snd.ast_canonical⟩

/-- Errors a host-side replay store may report. Any error is treated as a denial. -/
inductive ReplayStoreError where
  | conflict
  | backend (message : String)
  deriving Repr, BEq

/-- The host-provided, durable replay store seam.

    Contract (fail-closed): a successful approval requires the approval's nonce to be
    persisted atomically *before* the validation witness is returned. Any store error,
    or a `contains?` hit, denies the request. `validateAndConsumeWithStore` is the only
    sanctioned path; it never returns a witness without a successful `insertConsumed`. -/
structure ReplayStoreOps (σ : Type) where
  contains? : σ → ReplayNamespace → Nonce → Except ReplayStoreError Bool
  insertConsumed : σ → ConsumedNonce → Except ReplayStoreError σ
  pruneExpired : σ → Nat → Except ReplayStoreError σ

/-- Validate, then consume the nonce against a durable store. Fail-closed: validation
    failure, any store error, or a replay hit all return `none` (deny). On success the
    nonce is persisted before the witness is handed back, and the updated store is
    returned alongside it. -/
def validateAndConsumeWithStore {σ : Type}
    (ops : ReplayStoreOps σ) (store : σ)
    (ast : AST) (state : ApprovalState) :
    Option (σ × Σ checkedAst, ValidApproval checkedAst state) :=
  match validate ast state with
  | none => none
  | some checked =>
      let approval := checked.snd.approval
      let target := checked.snd.target
      let ns := replayNamespace state target
      match ops.pruneExpired store state.now with
      | .error _ => none
      | .ok pruned =>
          match ops.contains? pruned ns approval.nonce with
          | .error _ => none
          | .ok true => none
          | .ok false =>
              let entry : ConsumedNonce :=
                { ns := ns, nonce := approval.nonce, expiresAt := approval.expiresAt }
              match ops.insertConsumed pruned entry with
              | .error _ => none
              | .ok store' => some (store', checked)

/-- In-memory `List ConsumedNonce` replay store, for tests and reference. -/
def listReplayStore : ReplayStoreOps (List ConsumedNonce) where
  contains? entries ns nonce :=
    .ok (entries.any (fun e => e.ns == ns && e.nonce == nonce))
  insertConsumed entries entry := .ok (entry :: entries)
  pruneExpired entries now := .ok (pruneConsumedNonces now entries)

end SealV2
