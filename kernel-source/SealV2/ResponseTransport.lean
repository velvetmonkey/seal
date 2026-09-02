/- SPDX-License-Identifier: Apache-2.0 -/

import SealV2.ResponseNI

/-!
# P6 on a byte-carrier transport model — refutations re-witnessed, fail-closed
# and relay-integrity proven over inspectable bytes

The previous revision of this file enriched `ResponseNI` with framing
outcomes, but the `.complete` payload was a `String` stand-in that no theorem
ever inspected. That left the original P6 defect standing: seal-host's relay
carries raw `Vec<u8>` frames, and a model that cannot express arbitrary bytes
— non-UTF-8 content, the 1 MiB bound, the terminator convention — proves
nothing about the carrier it claims to describe. This revision makes the
carrier bytes.

What changed:

* **Carrier is `List UInt8`.** A response event now holds the raw bytes one
  relay read observes (`ChildRead.chunk`), not a framing verdict. `ByteArray`
  was the other candidate; it is the same information (`ByteArray` wraps
  `Array UInt8`) with strictly worse proof ergonomics — this is a
  specification model, so structural induction and the core `List` lemma
  library decide it. Every byte value 0–255 is expressible, including
  sequences that are not valid UTF-8.
* **Framing is COMPUTED from the bytes**, not chosen by the event. `framingOf`
  mirrors `read_bounded_frame` (seal-host `rust/src/limits.rs:27-69`): the
  frame runs through its first `\n` INCLUSIVE, and the 1 MiB bound
  (`MAX_WIRE_MESSAGE_BYTES`, `limits.rs:7`) counts that terminator
  (`limits.rs:47-58`; boundary test `limits.rs:174-189`). Complete iff the
  terminated frame fits; a terminated frame one byte over is Oversized; a
  stream that ends without a terminator is Unterminated (Oversized if it
  already blew the bound); an empty stream is Eof.
* **The relayed egress is observable.** seal-host forwards every complete
  child frame to client stdout byte-for-byte (`rust/src/main.rs:1141-1148`)
  with NO UTF-8 check on that path — the UTF-8 refusal at `main.rs:1219-1228`
  guards the client→child direction only. The model now emits `.relayed`
  observations carrying those bytes, so theorems can quantify over payload
  content instead of ignoring it.

Results on the byte model:

* `transport_p6_refuted` / `transport_p6_insertion_refuted` — **still
  refuted**, and the witness is now a genuine byte object: a one-byte,
  unterminated child read, killed by `framingOf` rather than by constructor
  fiat.
* `benign_response_changes_trace` — with egress observable, purge
  non-interference fails even WITHOUT the kill story: an in-bound frame is
  relayed, and deleting the event deletes the relayed observation.
* `p6_fail_closed` — **survives**: the Allow outputs of any run are a prefix
  of the Allow outputs of the response-purged run. Child bytes can truncate
  the Allow stream (by killing the session); they cannot create, alter, or
  reorder an Allow.
* `response_approval_invariant` — **survives**: no response bytes touch the
  approval plane.
* `relay_verbatim` — new: the relayed frames of any run are a prefix of the
  complete frames the child emitted, in order and byte-identical. The relay
  never invents, reorders, or rewrites egress bytes; its only liberty is
  truncation at transport death.
* `framingOf_exact_limit` / `framingOf_one_over_limit` — the 1 MiB boundary,
  terminator included, for every newline-free byte payload satisfying the
  stated exact-length side condition.
* `non_utf8_relayed_verbatim` — a frame that is not valid UTF-8 is relayed
  byte-identically and does not kill the transport.

Modeling conventions, stated so they can be frisked:

* One `ChildRead.chunk bytes` event is ONE `read_bounded_frame` call; `bytes`
  is the stream that call observes. Bytes past the first `\n` belong to the
  next read and are out of this event's scope (`read_bounded_frame` consumes
  only through the terminator, `limits.rs:47-61`). `fill_buf` chunking inside
  one call is not modeled; `framingOf` is its per-call denotation.
* `ChildRead.ioError` covers the read-error arm (`main.rs:1170-1178`) AND a
  failed enqueue of a complete frame (`main.rs:1143-1148`), as in the
  previous revision. A frame lost to enqueue failure is therefore modeled as
  never having been complete; `relay_verbatim`'s prefix form absorbs this.
* Every transport death is answered with `.seamError` on the next request.
  In seal-host, enqueue-failure death breaks SILENTLY (`output.has_failed()`,
  `main.rs:1209-1212`) while downstream death emits SEAM_ERROR_RESPONSE
  (`main.rs:1213-1216`); the collapse is safe for every theorem here because
  neither arm produces an Allow or a relayed frame.

**Honesty boundary.** Still a hand-written abstraction, NOT a refinement
proof from the compiled Rust; no theorem here transfers to the deployed
binary. NOTE ALSO: every `request` event in THIS file is decided
(`reqDecision` is total) — the deployed seal-host router instead classifies
each wire line first and forwards non-`tools/call` lines to the child with
NO decision. That classify seam, and exactly which byte class escapes
undecided, is modeled and characterised in `SealV2/ClassifyTransport.lean`;
theorems here must not be read as covering it. Unmodeled after this round: the 64-slot output queue's backpressure
and interleaving (`rust/src/output.rs` — next gap), seal-host's multi-kernel
state and registry, the A3 host-owned inputs, the client-side stdin framing
outcomes (an oversized CLIENT request draws RESOURCE_LIMIT_RESPONSE and the
loop continues, `main.rs:1193-1207`; request events here carry pre-framed
`RawBytes`), the possibility that a seam-error frame itself fails to reach
the client (`main.rs:1214`, result discarded), and the stderr audit channel.
-/

namespace SealV2.ResponseTransport

open SealV2

/-- seal-host's wire-frame bound: `MAX_WIRE_MESSAGE_BYTES = 1024 * 1024`
    (`rust/src/limits.rs:7`). The bound counts the frame INCLUDING its
    newline terminator (`limits.rs:47-58`). -/
def maxWireMessageBytes : Nat := 1024 * 1024

/-- The frame terminator `read_bounded_frame` scans for (`limits.rs:49`). -/
def newline : UInt8 := 10

/-- `0xFF` never occurs in valid UTF-8; used as the payload byte of the
    boundary and non-UTF-8 witnesses. -/
def junk : UInt8 := 0xFF

/-- Framing outcome of one child-response read: `limits.rs:16-22`
    (`FrameStatus`), with `complete` carrying the frame bytes the relay will
    forward. The `io::Result` error arm lives in `ChildRead`, not here,
    because it is not a framing verdict. -/
inductive Framing where
  | complete (frame : List UInt8)
  | eof
  | unterminated
  | oversized

/-- The denotation of one `read_bounded_frame` call (`limits.rs:27-69`) on
    the byte stream it observes:
    * a first `\n` at index `i` with `i + 1 ≤ 1 MiB` → `complete`, frame =
      everything through the terminator;
    * a first `\n` whose frame exceeds the bound → `oversized`;
    * no `\n`: empty stream → `eof`; within bound → `unterminated`;
      past bound → `oversized` (the EOF return at `limits.rs:38-44` reports
      `Oversized` over `Unterminated`). -/
def framingOf (chunk : List UInt8) : Framing :=
  match chunk.findIdx? (· == newline) with
  | some i =>
      if i + 1 ≤ maxWireMessageBytes then .complete (chunk.take (i + 1))
      else .oversized
  | none =>
      if chunk.isEmpty then .eof
      else if chunk.length ≤ maxWireMessageBytes then .unterminated
      else .oversized

/-- One relay read: the bytes it observed, or the read/enqueue failure arm
    (`main.rs:1170-1178`; a failed enqueue of a complete frame,
    `main.rs:1143-1148`, is modeled here too — see the header). -/
inductive ChildRead where
  | chunk (bytes : List UInt8)
  | ioError

/-- Which framing outcomes kill the transport: every arm except a complete
    frame (`main.rs:1150-1179`). -/
def framingKills : Framing → Bool
  | .complete _ => false
  | _ => true

/-- Whether a relay read kills the transport (`main.rs:1141-1179`). -/
def readKills : ChildRead → Bool
  | .chunk bytes => framingKills (framingOf bytes)
  | .ioError => true

/-- The frame a relay read forwards to client stdout, if any: exactly the
    bytes of a complete frame (`main.rs:1142-1143`), untouched. -/
def relayedFrame? : ChildRead → Option (List UInt8)
  | .chunk bytes =>
      match framingOf bytes with
      | .complete f => some f
      | _ => none
  | .ioError => none

/-- Session state: the approval plane of `ResponseNI`, plus transport death
    (seal-host's `downstream_dead` + readiness, collapsed). -/
structure HostState where
  approval : Option ApprovalState
  dead : Bool

/-- Host-boundary events. `init`/`approve`/`request` are as in `ResponseNI`;
    `response` now carries the raw bytes (or error) of one relay read. -/
inductive HostEvent where
  | init (cfg : ApprovalState)
  | approve (rawSigned : String) (sigHex : String)
  | request (raw : RawBytes) (now : Nat)
  | response (r : ChildRead)

def isResponse : HostEvent → Bool
  | .response _ => true
  | _ => false

/-- Transition: the approval plane steps exactly as `ResponseNI.stepState`;
    a response touches ONLY the dead flag (monotonically), and whether it
    kills is computed from its bytes. -/
def stepState (s : HostState) : HostEvent → HostState
  | .init cfg => { s with approval := ResponseNI.stepState s.approval (.init cfg) }
  | .approve r sig => { s with approval := ResponseNI.stepState s.approval (.approve r sig) }
  | .request raw now => { s with approval := ResponseNI.stepState s.approval (.request raw now) }
  | .response r => { s with dead := s.dead || readKills r }

/-- The decision a live request yields — exactly `ResponseNI`'s request
    observation (always `some`; `.Block` default is unreachable). -/
def reqDecision (a : Option ApprovalState) (raw : RawBytes) (now : Nat) : Decision :=
  (ResponseNI.observeDecision a (.request raw now)).getD .Block

/-- What the client observes per event: an authorization decision, the
    seam-error frame for a request that finds the transport dead
    (`main.rs:1213-1216`), or a relayed child frame — raw bytes, forwarded
    without inspection (`main.rs:1142-1143`). -/
inductive Obs where
  | decision (d : Decision)
  | seamError
  | relayed (frame : List UInt8)

/-- The observations one relay read produces: a dead transport reads nothing
    (the relay loop has broken, `main.rs:1147-1177`); a live one forwards
    exactly its complete frame, if it has one. -/
def responseObs (s : HostState) (r : ChildRead) : List Obs :=
  if s.dead then []
  else
    match relayedFrame? r with
    | some f => [.relayed f]
    | none => []

/-- Observable trace. A request that finds the transport dead yields
    `.seamError` and TERMINATES the run (seal-host breaks its request loop
    and kills the child); everything after the break does not happen. -/
def runTrace (s : HostState) : List HostEvent → List Obs
  | [] => []
  | .init cfg :: t => runTrace (stepState s (.init cfg)) t
  | .approve r sig :: t => runTrace (stepState s (.approve r sig)) t
  | .response r :: t => responseObs s r ++ runTrace (stepState s (.response r)) t
  | .request raw now :: t =>
      if s.dead then [.seamError]
      else .decision (reqDecision s.approval raw now)
        :: runTrace (stepState s (.request raw now)) t

/-- Drop every response event (same purge as `ResponseNI`). -/
def purgeResponses (t : List HostEvent) : List HostEvent :=
  t.filter (fun ev => !isResponse ev)

/-! ## The framing function on terminated frames

`framingOf` is defined on raw bytes, so the 1 MiB boundary — terminator
included — is now a theorem about byte lists, not a constructor choice. -/

private theorem findIdx?_append_newline {l : List UInt8}
    (h : newline ∉ l) : (l ++ [newline]).findIdx? (· == newline) = some l.length := by
  induction l with
  | nil => simp [List.findIdx?_cons]
  | cons a l ih =>
      have ha : (a == newline) = false := by
        have : a ≠ newline := fun e => h (by simp [e])
        simpa using this
      have hm : newline ∉ l := fun m => h (List.mem_cons_of_mem _ m)
      simp [List.findIdx?_cons, ha, ih hm]

/-- `read_bounded_frame` on a terminated frame with no interior newline:
    Complete iff the frame, INCLUDING its terminator, fits in
    `maxWireMessageBytes`; Oversized otherwise. Mirrors `limits.rs:47-58`
    (`take` counts the newline) and the boundary test `limits.rs:174-189`. -/
theorem framingOf_terminated {l : List UInt8} (h : newline ∉ l) :
    framingOf (l ++ [newline]) =
      if l.length + 1 ≤ maxWireMessageBytes then .complete (l ++ [newline])
      else .oversized := by
  unfold framingOf
  rw [findIdx?_append_newline h]
  simp only
  by_cases hle : l.length + 1 ≤ maxWireMessageBytes
  · rw [if_pos hle, if_pos hle, List.take_of_length_le (by simp)]
  · rw [if_neg hle, if_neg hle]

/-- A terminated frame whose explicit length premise puts it exactly at the
    wire bound is Complete and forwarded whole. -/
theorem framingOf_exact_limit {payload : List UInt8}
    (hNewline : newline ∉ payload)
    (hLength : payload.length + 1 = maxWireMessageBytes) :
    framingOf (payload ++ [newline]) = .complete (payload ++ [newline]) := by
  rw [framingOf_terminated hNewline, if_pos (Nat.le_of_eq hLength)]

/-- A terminated frame whose explicit length premise puts it exactly one byte
    past the wire bound is Oversized. -/
theorem framingOf_one_over_limit {payload : List UInt8}
    (hNewline : newline ∉ payload)
    (hLength : payload.length + 1 = maxWireMessageBytes + 1) :
    framingOf (payload ++ [newline]) = .oversized := by
  rw [framingOf_terminated hNewline, if_neg]
  omega

/-- A terminated frame of exactly 1 MiB (terminator included, payload
    non-UTF-8): 1048575 payload bytes + `\n`. -/
def frameAtLimit : List UInt8 :=
  List.replicate (maxWireMessageBytes - 1) junk ++ [newline]

/-- A terminated frame of exactly 1 MiB + 1 bytes: one over the bound. -/
def frameOverLimit : List UInt8 :=
  List.replicate maxWireMessageBytes junk ++ [newline]

/-- A two-byte frame whose payload is not valid UTF-8 is Complete: the relay
    is content-oblivious. -/
theorem tiny_non_utf8_complete :
    framingOf [junk, newline] = .complete [junk, newline] := by
  show framingOf ([junk] ++ [newline]) = .complete [junk, newline]
  rw [framingOf_terminated (by decide), if_pos (by decide)]
  rfl

/-- **Non-UTF-8 egress is relayed byte-identically** and leaves the
    transport alive: no theorem of this file may pretend child output is
    text (`main.rs:1141-1148` performs no UTF-8 check child→client). -/
theorem non_utf8_relayed_verbatim :
    runTrace ⟨none, false⟩ [.response (.chunk [junk, newline])]
      = [.relayed [junk, newline]] := by
  simp [runTrace, responseObs, relayedFrame?, tiny_non_utf8_complete]

/-! ## Refutation: the P6 purge property fails on the byte model

The kill witness is now a genuine byte object: a child read containing one
non-UTF-8 byte with no terminator. The relay classifies it Unterminated,
sets `downstream_dead`, and the next client request is answered with a seam
error instead of being decided. -/

/-- The witness run: one unterminated child response, then one client request. -/
def killRun : List HostEvent := [.response (.chunk [junk]), .request "" 0]

/-- Purged, the request is decided (here: `.Block` — empty raw, no session). -/
theorem killRun_purged_decides :
    runTrace ⟨none, false⟩ (purgeResponses killRun) = [.decision .Block] := rfl

/-- Unpurged, the unterminated response kills the transport and the same request
    is answered with the seam error; the session terminates. -/
theorem killRun_seam_errors :
    runTrace ⟨none, false⟩ killRun = [.seamError] := by
  simp [killRun, runTrace, responseObs, relayedFrame?, stepState, readKills,
    framingKills, framingOf, newline, junk, maxWireMessageBytes]

/-- **The P6 purge property is FALSE on the byte model.**
    Deleting a response event changes the observable trace. -/
theorem transport_p6_refuted :
    ∃ (s : HostState) (t : List HostEvent),
      runTrace s (purgeResponses t) ≠ runTrace s t := by
  refine ⟨⟨none, false⟩, killRun, ?_⟩
  rw [killRun_purged_decides, killRun_seam_errors]
  intro h
  exact Obs.noConfusion (List.cons.inj h).1

/-- **The P6 insertion property is FALSE too:** inserting an unterminated
    response before a request changes what the request observes. -/
theorem transport_p6_insertion_refuted :
    ∃ (s : HostState) (t₁ t₂ : List HostEvent) (r : ChildRead),
      runTrace s (t₁ ++ .response r :: t₂) ≠ runTrace s (t₁ ++ t₂) := by
  refine ⟨⟨none, false⟩, [], [.request "" 0], .chunk [junk], ?_⟩
  intro h
  rw [show ([] ++ HostEvent.response (.chunk [junk]) :: [.request "" 0])
        = killRun from rfl] at h
  rw [killRun_seam_errors] at h
  exact Obs.noConfusion (List.cons.inj h).1

/-- With egress observable, purge non-interference fails even WITHOUT the
    kill story: a benign in-bound frame is relayed, and deleting the event
    deletes the relayed observation. -/
theorem benign_response_changes_trace :
    runTrace ⟨none, false⟩ [.response (.chunk [junk, newline])]
      ≠ runTrace ⟨none, false⟩ (purgeResponses [.response (.chunk [junk, newline])]) := by
  rw [non_utf8_relayed_verbatim]
  intro h
  simp [purgeResponses, isResponse, runTrace] at h

/-! ## The surviving properties: fail-closed, and relay integrity

Responses never touch the approval plane; their influence on the trace is
their own relayed bytes plus truncation at a seam error. The Allow outputs
of any run form a prefix of the Allow outputs of the response-purged run,
and the relayed frames form a prefix of the child's complete frames,
byte-identical and in order. -/

/-- A response event never touches the approval plane — only `dead` —
    whatever its bytes. -/
theorem response_approval_invariant (s : HostState) (r : ChildRead) :
    (stepState s (.response r)).approval = s.approval := rfl

/-- Transport death is monotone: no event revives a dead transport. -/
theorem dead_is_terminal (s : HostState) (ev : HostEvent) (h : s.dead = true) :
    (stepState s ev).dead = true := by
  cases ev <;> simp [stepState, h]

/-- The Allow outputs of a trace, in order. Relayed frames and seam errors
    are not Allows. -/
def allowsOf : List Obs → List CanonicalBytes
  | [] => []
  | .decision (.Allow out) :: t => out :: allowsOf t
  | .decision .Block :: t => allowsOf t
  | .seamError :: t => allowsOf t
  | .relayed _ :: t => allowsOf t

/-- The relayed frames of a trace, in order. -/
def relayedOf : List Obs → List (List UInt8)
  | [] => []
  | .relayed f :: t => f :: relayedOf t
  | .decision _ :: t => relayedOf t
  | .seamError :: t => relayedOf t

/-- The complete frames a child emission sequence carries, in order. -/
def completesOf : List HostEvent → List (List UInt8)
  | [] => []
  | .response r :: t =>
      match relayedFrame? r with
      | some f => f :: completesOf t
      | none => completesOf t
  | .init _ :: t => completesOf t
  | .approve _ _ :: t => completesOf t
  | .request _ _ :: t => completesOf t

private theorem prefix_refl (l : List CanonicalBytes) : l <+: l :=
  ⟨[], List.append_nil l⟩

private theorem nil_prefix (l : List CanonicalBytes) : [] <+: l :=
  ⟨l, rfl⟩

private theorem prefix_cons (a : CanonicalBytes) {l₁ l₂ : List CanonicalBytes}
    (h : l₁ <+: l₂) : a :: l₁ <+: a :: l₂ := by
  obtain ⟨u, hu⟩ := h
  exact ⟨u, by rw [List.cons_append, hu]⟩

private theorem allowsOf_responseObs (s : HostState) (r : ChildRead)
    (l : List Obs) : allowsOf (responseObs s r ++ l) = allowsOf l := by
  unfold responseObs
  by_cases h : s.dead
  · simp [h]
  · simp only [h, if_false, Bool.false_eq_true]
    cases relayedFrame? r <;> simp [allowsOf]

/-- A dead transport allows nothing: it reads no child frames, the first
    request seam-errors, and the run terminates. -/
theorem dead_no_allows :
    ∀ (t : List HostEvent) (s : HostState), s.dead = true →
      allowsOf (runTrace s t) = [] := by
  intro t
  induction t with
  | nil => intro s _; rfl
  | cons ev t ih =>
      intro s h
      cases ev with
      | init cfg => exact ih _ (by simp [stepState, h])
      | approve r sig => exact ih _ (by simp [stepState, h])
      | response r =>
          simp only [runTrace, responseObs, h, if_true]
          simpa using ih _ (by simp [stepState, h])
      | request raw now => simp [runTrace, h, allowsOf]

/-- A dead transport relays nothing either. -/
theorem dead_no_relays :
    ∀ (t : List HostEvent) (s : HostState), s.dead = true →
      relayedOf (runTrace s t) = [] := by
  intro t
  induction t with
  | nil => intro s _; rfl
  | cons ev t ih =>
      intro s h
      cases ev with
      | init cfg => exact ih _ (by simp [stepState, h])
      | approve r sig => exact ih _ (by simp [stepState, h])
      | response r =>
          simp only [runTrace, responseObs, h, if_true]
          simpa using ih _ (by simp [stepState, h])
      | request raw now => simp [runTrace, h, relayedOf]

/-- **Fail-closed: the surviving P6 residue, now over inspectable bytes.**
    For ANY start state and ANY event sequence — any child bytes whatsoever —
    the Allow outputs of the run form a prefix of the Allow outputs of the
    response-purged run. Child bytes can only truncate the Allow stream (by
    killing the session); they cannot create an Allow the purged run would
    not have produced, nor change or reorder one. -/
theorem p6_fail_closed :
    ∀ (t : List HostEvent) (s : HostState),
      allowsOf (runTrace s t) <+: allowsOf (runTrace s (purgeResponses t)) := by
  intro t
  induction t with
  | nil => intro s; exact prefix_refl _
  | cons ev t ih =>
      intro s
      cases ev with
      | init cfg =>
          have hp : purgeResponses (HostEvent.init cfg :: t)
              = .init cfg :: purgeResponses t := by
            simp [purgeResponses, isResponse]
          rw [hp]
          simp only [runTrace]
          exact ih _
      | approve r sig =>
          have hp : purgeResponses (HostEvent.approve r sig :: t)
              = .approve r sig :: purgeResponses t := by
            simp [purgeResponses, isResponse]
          rw [hp]
          simp only [runTrace]
          exact ih _
      | response r =>
          have hp : purgeResponses (HostEvent.response r :: t)
              = purgeResponses t := by
            simp [purgeResponses, isResponse]
          rw [hp]
          simp only [runTrace]
          rw [allowsOf_responseObs]
          obtain ⟨a, d⟩ := s
          cases d with
          | true =>
              rw [dead_no_allows t _ (by simp [stepState])]
              exact nil_prefix _
          | false =>
              cases hk : readKills r with
              | true =>
                  rw [dead_no_allows t _ (by simp [stepState, hk])]
                  exact nil_prefix _
              | false =>
                  have hs : stepState ⟨a, false⟩ (.response r) = ⟨a, false⟩ := by
                    simp [stepState, hk]
                  rw [hs]
                  exact ih _
      | request raw now =>
          have hp : purgeResponses (HostEvent.request raw now :: t)
              = .request raw now :: purgeResponses t := by
            simp [purgeResponses, isResponse]
          rw [hp]
          obtain ⟨a, d⟩ := s
          cases d with
          | true =>
              simp only [runTrace]
              simp [allowsOf]
          | false =>
              simp only [runTrace]
              simp only [Bool.false_eq_true, if_false]
              cases hD : reqDecision a raw now with
              | Block => simpa [allowsOf] using ih _
              | Allow out =>
                  simp only [allowsOf]
                  exact prefix_cons _ (ih _)

/-- **Relay integrity, byte-for-byte.** The relayed frames of any run are a
    prefix of the complete frames the child emitted: same bytes, same order.
    The relay's only liberty is truncation at transport death — it can never
    invent, rewrite, or reorder egress bytes. -/
theorem relay_verbatim :
    ∀ (t : List HostEvent) (s : HostState),
      relayedOf (runTrace s t) <+: completesOf t := by
  intro t
  induction t with
  | nil => intro s; exact List.prefix_refl _
  | cons ev t ih =>
      intro s
      cases ev with
      | init cfg =>
          simp only [runTrace, completesOf]
          exact ih _
      | approve r sig =>
          simp only [runTrace, completesOf]
          exact ih _
      | response r =>
          simp only [runTrace, completesOf]
          obtain ⟨a, d⟩ := s
          cases d with
          | true =>
              rw [show responseObs ⟨a, true⟩ r = [] from rfl]
              rw [List.nil_append,
                dead_no_relays t _ (dead_is_terminal ⟨a, true⟩ _ rfl)]
              exact List.nil_prefix
          | false =>
              cases hr : relayedFrame? r with
              | some f =>
                  rw [show responseObs ⟨a, false⟩ r
                        = [.relayed f] from by simp [responseObs, hr]]
                  simp only [List.cons_append, relayedOf]
                  have hk : readKills r = false := by
                    cases r with
                    | ioError => simp [relayedFrame?] at hr
                    | chunk bytes =>
                        simp only [relayedFrame?] at hr
                        simp only [readKills]
                        cases hf : framingOf bytes <;>
                          simp [hf, framingKills] at hr ⊢
                  have hs : stepState ⟨a, false⟩ (.response r) = ⟨a, false⟩ := by
                    simp [stepState, hk]
                  rw [hs]
                  exact (List.prefix_cons_inj _).2 (ih _)
              | none =>
                  rw [show responseObs ⟨a, false⟩ r = [] from by
                    simp [responseObs, hr]]
                  simp only [List.nil_append]
                  have hk : readKills r = true := by
                    cases r with
                    | ioError => rfl
                    | chunk bytes =>
                        simp only [relayedFrame?] at hr
                        simp only [readKills]
                        cases hf : framingOf bytes <;>
                          simp [hf, framingKills] at hr ⊢
                  rw [
                    dead_no_relays t _
                      (by simp [stepState, hk])]
                  exact List.nil_prefix
      | request raw now =>
          simp only [runTrace, completesOf]
          obtain ⟨a, d⟩ := s
          cases d with
          | true => simp [relayedOf]
          | false =>
              simp only [Bool.false_eq_true, if_false]
              simpa [relayedOf] using ih (stepState ⟨a, false⟩ (.request raw now))

/-! ## Axiom pins -/

/-- info: '_private.SealV2.ResponseTransport.0.SealV2.ResponseTransport.findIdx?_append_newline' depends on axioms: [propext,
 Classical.choice,
 Quot.sound] -/
#guard_msgs in
#print axioms findIdx?_append_newline

/-- info: 'SealV2.ResponseTransport.framingOf_terminated' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms framingOf_terminated

/-- info: 'SealV2.ResponseTransport.framingOf_exact_limit' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms framingOf_exact_limit

/-- info: 'SealV2.ResponseTransport.framingOf_one_over_limit' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms framingOf_one_over_limit

/-- info: 'SealV2.ResponseTransport.tiny_non_utf8_complete' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms tiny_non_utf8_complete

/-- info: 'SealV2.ResponseTransport.non_utf8_relayed_verbatim' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms non_utf8_relayed_verbatim

/-- info: 'SealV2.ResponseTransport.killRun_purged_decides' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms killRun_purged_decides

/-- info: 'SealV2.ResponseTransport.killRun_seam_errors' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms killRun_seam_errors

/-- info: 'SealV2.ResponseTransport.transport_p6_refuted' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms transport_p6_refuted

/-- info: 'SealV2.ResponseTransport.transport_p6_insertion_refuted' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms transport_p6_insertion_refuted

/-- info: 'SealV2.ResponseTransport.benign_response_changes_trace' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms benign_response_changes_trace

/-- info: 'SealV2.ResponseTransport.response_approval_invariant' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms response_approval_invariant

/-- info: 'SealV2.ResponseTransport.dead_is_terminal' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms dead_is_terminal

/-- info: '_private.SealV2.ResponseTransport.0.SealV2.ResponseTransport.allowsOf_responseObs' depends on axioms: [propext,
 Classical.choice,
 Quot.sound] -/
#guard_msgs in
#print axioms allowsOf_responseObs

/-- info: 'SealV2.ResponseTransport.dead_no_allows' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms dead_no_allows

/-- info: 'SealV2.ResponseTransport.dead_no_relays' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms dead_no_relays

/-- info: 'SealV2.ResponseTransport.p6_fail_closed' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms p6_fail_closed

/-- info: 'SealV2.ResponseTransport.relay_verbatim' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms relay_verbatim

end SealV2.ResponseTransport
