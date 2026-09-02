/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Policy
import Seal.PolicyBundle

/-!
# The accepted guard language — full-argument targets only

Stage A theorems about what the policy parsers ACCEPT after the guard-target
restriction:

* `guard_requires_full_arguments` — a policy the parser accepts cannot
  contain a guarded rule whose target is anything but `[.fullArguments]`.
* `bundle_guard_requires_full_arguments` — the same, through the signed
  7-kernel bundle entrypoint.
* `guard_partial_target_rejected` / `guard_empty_target_rejected` /
  `guard_starts_with_target_rejected` — concrete rejection witnesses: an
  `{"arg": path}` target, an absent target, and a `{"starts_with": ...}`
  target part under guard mode are hard parse errors.
* `guard_full_arguments_policy_accepted` /
  `allow_partial_target_still_accepted` — concrete acceptance witnesses:
  the accepted set is non-empty, and the restriction is scoped to guarded
  mode (targets on `allow` rules still parse — they never bind approvals).

The language theorems reason ONLY through the codec combinator spine
(`emit`/`check`/`field`/`fieldD`/`arrCodec`) plus the shared `guardCheck`
constant; `parseMatch` (partial) and `parseTargetPart` stay opaque, so no
theorem here depends on their interiors.
-/

namespace Seal

open Lean
open Seal.JsonUtil

/-! ## Except-bind extraction spine -/

private theorem bind_ok {α β : Type} {m : Except String α}
    {f : α → Except String β} {b : β} (h : m >>= f = .ok b) :
    ∃ a, m = .ok a ∧ f a = .ok b := by
  cases m with
  | error e => exact absurd h (by simp [Bind.bind, Except.bind])
  | ok a => exact ⟨a, rfl, h⟩

private theorem bind_def {α β : Type} (m : Except String α)
    (f : α → Except String β) : m >>= f = Except.bind m f := rfl

private theorem pure_def {α : Type} (a : α) :
    (pure a : Except String α) = Except.ok a := rfl

private theorem throw_def {α : Type} (e : String) :
    (throw e : Except String α) = Except.error e := rfl

private theorem check_parse_ok {γ : Type} {s : ObjSpec γ}
    {f : γ → Except String Unit} {j : Json} {g : γ}
    (h : (s.check f).parse j = .ok g) :
    s.parse j = .ok g ∧ f g = .ok () := by
  simp only [ObjSpec.check] at h
  obtain ⟨a, ha, hrest⟩ := bind_ok h
  obtain ⟨u, hu, hpure⟩ := bind_ok hrest
  cases Except.ok.inj hpure
  cases u
  exact ⟨ha, hu⟩

private theorem emit_parse_ok {γ α : Type} {s : ObjSpec γ} {f : γ → α}
    {j : Json} {a : α} (h : (s.emit f).parse j = .ok a) :
    ∃ g, s.parse j = .ok g ∧ a = f g := by
  simp only [ObjSpec.emit] at h
  obtain ⟨g, hg, hpure⟩ := bind_ok h
  exact ⟨g, hg, (Except.ok.inj hpure).symm⟩

private theorem field_parse_ok {γ β : Type} {s : ObjSpec γ} {key : String}
    {vc : WireCodec β} {j : Json} {out : γ × β}
    (h : (s.field key vc).parse j = .ok out) :
    s.parse j = .ok out.1 ∧ ∃ jv, vc.parse jv = .ok out.2 := by
  simp only [ObjSpec.field] at h
  obtain ⟨g, hg, hrest⟩ := bind_ok h
  obtain ⟨jv, _hjv, hrest⟩ := bind_ok hrest
  obtain ⟨b, hb, hpure⟩ := bind_ok hrest
  cases Except.ok.inj hpure
  exact ⟨hg, jv, hb⟩

private theorem mapM_ok_mem {α β : Type} {f : α → Except String β} :
    ∀ {xs : List α} {ys : List β}, xs.mapM f = .ok ys →
      ∀ y ∈ ys, ∃ x, f x = .ok y := by
  intro xs
  induction xs with
  | nil =>
      intro ys h y hy
      simp only [List.mapM_nil] at h
      cases Except.ok.inj h
      cases hy
  | cons x xs ih =>
      intro ys h y hy
      rw [List.mapM_cons] at h
      obtain ⟨b, hb, hrest⟩ := bind_ok h
      obtain ⟨bs, hbs, hpure⟩ := bind_ok hrest
      cases Except.ok.inj hpure
      rcases List.mem_cons.mp hy with rfl | hmem
      · exact ⟨x, hb⟩
      · exact ih hbs y hmem

private theorem arrCodec_parse_ok {β : Type} {item : WireCodec β} {j : Json}
    {l : List β} (h : (arrCodec item).parse j = .ok l) :
    ∀ x ∈ l, ∃ jx, item.parse jx = .ok x := by
  simp only [arrCodec] at h
  obtain ⟨arr, _harr, hmap⟩ := bind_ok h
  exact mapM_ok_mem hmap

/-! ## The guard-target invariant -/

theorem isFullArgumentsTarget_eq_true {t : List TargetPart}
    (h : isFullArgumentsTarget t = true) : t = [.fullArguments] := by
  cases t with
  | nil => simp [isFullArgumentsTarget] at h
  | cons p rest =>
      cases p <;> cases rest <;> simp_all [isFullArgumentsTarget]

theorem guardCheck_ok_guarded {t : List TargetPart}
    (h : guardCheck .guarded t = .ok ()) : t = [.fullArguments] := by
  unfold guardCheck at h
  cases hf : isFullArgumentsTarget t with
  | true => exact isFullArgumentsTarget_eq_true hf
  | false =>
      rw [hf, show (ToolMode.guarded == ToolMode.guarded) = true from rfl] at h
      simp at h

/-- Rule level: any tool rule the codec accepts with `mode = .guarded`
    carries exactly the full-argument target. -/
theorem toolRule_guard_full_arguments {j : Json} {r : ToolRule}
    (h : toolRuleCodec.parse j = .ok r) (hmode : r.mode = .guarded) :
    r.target = [.fullArguments] := by
  have h' : toolRuleSpec.parse j = .ok r := h
  obtain ⟨g, hg, hemit⟩ := emit_parse_ok h'
  obtain ⟨_hparse, hcheck⟩ := check_parse_ok hg
  obtain ⟨⟨⟨⟨u, name⟩, mode⟩, matcher⟩, target⟩ := g
  subst hemit
  simp only at hmode
  subst hmode
  exact guardCheck_ok_guarded hcheck

/-- **`guard_requires_full_arguments`** — the ACCEPTED LANGUAGE. A policy
    whose guarded target is not exactly `[{"full_arguments": true}]` is
    rejected at parse time; equivalently, every guarded rule of every
    accepted policy binds the full canonical arguments. -/
theorem guard_requires_full_arguments {j : Json} {p : Policy}
    (h : parsePolicyJson j = .ok p) :
    ∀ rule ∈ p.tools, rule.mode = .guarded → rule.target = [.fullArguments] := by
  intro rule hmem hmode
  have h' : (policySpecWith (.openObj approvalSpec)).parse j = .ok p := h
  obtain ⟨g, hg, hemit⟩ := emit_parse_ok h'
  obtain ⟨_hprev, jv, hjv⟩ := field_parse_ok hg
  obtain ⟨⟨⟨u, approval⟩, server⟩, tools⟩ := g
  subst hemit
  simp only at hmem
  obtain ⟨jr, hjr⟩ := arrCodec_parse_ok hjv rule hmem
  exact toolRule_guard_full_arguments hjr hmode

/-- The same invariant through the signed bundle entrypoint: the safety
    policy inside any accepted bundle satisfies it. -/
theorem bundle_guard_requires_full_arguments {j : Json} {b : PolicyBundle}
    (h : parsePolicyBundle j = .ok b) :
    ∀ rule ∈ b.safety.tools, rule.mode = .guarded →
      rule.target = [.fullArguments] := by
  intro rule hmem hmode
  unfold parsePolicyBundle at h
  simp only [bind_def, pure_def, throw_def, Except.bind] at h
  repeat' first
    | (simp only [reduceCtorEq] at h)
    | split at h
  all_goals
    cases Except.ok.inj h
    exact guard_requires_full_arguments (by assumption) rule hmem hmode

/-! ## Concrete witnesses — the accepted set is non-empty, the rejections
are real. `Json.parse` (partial) is never used: the wire values are built
with `Json.mkObj`, so the witnesses reduce in the kernel. -/

private def policyJsonWith (rule : Json) : Json :=
  Json.mkObj [
    ("approval", Json.mkObj [("control_file", Json.str "approvals.ndjson")]),
    ("tools", Json.arr #[rule])]

private def guardFullArgsRule : Json :=
  Json.mkObj [
    ("name", Json.str "db.execute"),
    ("mode", Json.str "guard"),
    ("target", Json.arr #[Json.mkObj [("full_arguments", Json.bool true)]])]

private def guardArgTargetRule : Json :=
  Json.mkObj [
    ("name", Json.str "db.execute"),
    ("mode", Json.str "guard"),
    ("target", Json.arr #[Json.mkObj [("arg", Json.str "sql")]])]

private def guardEmptyTargetRule : Json :=
  Json.mkObj [
    ("name", Json.str "db.execute"),
    ("mode", Json.str "guard")]

private def guardStartsWithTargetRule : Json :=
  Json.mkObj [
    ("name", Json.str "db.execute"),
    ("mode", Json.str "guard"),
    ("target", Json.arr #[Json.mkObj [("starts_with", Json.str "DROP")]])]

private def allowLiteralTargetRule : Json :=
  Json.mkObj [
    ("name", Json.str "db.query"),
    ("mode", Json.str "allow"),
    ("target", Json.arr #[Json.mkObj [("literal", Json.str "x")]])]

/-- Acceptance witness: the canonical guarded rule parses, to exactly the
    expected policy value. -/
theorem guard_full_arguments_policy_accepted :
    parsePolicyJson (policyJsonWith guardFullArgsRule) =
      .ok { approvalTtlMs := 120000,
            approvalFile := System.FilePath.mk "approvals.ndjson",
            serverIdentity := "",
            tools := [{ name := "db.execute", mode := .guarded,
                        matcher := .always, target := [.fullArguments] }] } := by
  rfl

/-- **`guard_partial_target_rejected`** — an `{"arg": path}` guarded target
    is a hard parse error. -/
theorem guard_partial_target_rejected :
    parsePolicyJson (policyJsonWith guardArgTargetRule) =
      .error guardTargetErrorText := by
  rfl

/-- An absent (defaulted-empty) target under guard mode is a hard parse
    error too. -/
theorem guard_empty_target_rejected :
    parsePolicyJson (policyJsonWith guardEmptyTargetRule) =
      .error guardTargetErrorText := by
  rfl

/-- A `{"starts_with": ...}` target part is a hard error in the SAME class
    as the existing unknown-shape hard errors (it is not a target part at
    all — rejected before the guard-target check even runs). -/
theorem guard_starts_with_target_rejected :
    parsePolicyJson (policyJsonWith guardStartsWithTargetRule) =
      .error "target part must contain exactly one of literal, arg, full_arguments" := by
  rfl

/-- Scope witness: the restriction is guard-mode only — an `allow` rule with
    a non-full-argument (`literal`) target still parses (allow targets never
    bind an approval). A `literal` part is used because it reduces in the
    kernel; `{"arg": ...}` would witness the same scoping but goes through
    `splitPath`/`String.splitOn`, which does not kernel-reduce. -/
theorem allow_partial_target_still_accepted :
    parsePolicyJson (policyJsonWith allowLiteralTargetRule) =
      .ok { approvalTtlMs := 120000,
            approvalFile := System.FilePath.mk "approvals.ndjson",
            serverIdentity := "",
            tools := [{ name := "db.query", mode := .allow,
                        matcher := .always, target := [.literal "x"] }] } := by
  rfl

end Seal
