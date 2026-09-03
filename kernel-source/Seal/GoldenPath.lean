/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.Scaffold
import SealCore.Safety

/-!
# Golden-path non-bypass — the shell reference cell, concretely

Instantiates the abstract gate (`SealCore.step` + the Safety theorems) for a
concrete shell-exec tool under a policy produced by the proven scaffolder.
These are the theorems the demo's boundary card cites:

* `shell_rm_rf_requires_live_approval` — a destructive shell command cannot
  reach the wire without a live approval for exactly its target.
* `shell_rm_rf_blocks_on_fresh_state` — on a fresh session the command is
  blocked outright ("watch it block" is this theorem, not theater).
* `shell_rm_rf_allows_with_fresh_approval` — the same command flows after a
  matching unexpired approval is recorded (the demo's approve leg).
* `shell_read_flows` — the readonly tool is benign and never waits.

Scope: these govern the MEDIATED path (calls classified by the seal gate).
An agent that bypasses the MCP server entirely never reaches `step` and is
out of scope — the runtime must state that boundary loudly.
-/

namespace Seal

open Lean SealCore

/-- The shell cell's executor: destructive by annotation. -/
def shellExecTool : ManifestTool := { name := "shell_exec", destructiveHint := some true }

/-- The shell cell's reader: explicitly readonly. -/
def shellReadTool : ManifestTool := { name := "read_file", readOnlyHint := some true }

/-- The shell reference cell's manifest. -/
def shellManifest : Manifest := [shellExecTool, shellReadTool]

/-- The policy `seal init` generates for the shell cell (120 s TTL). -/
def shellPolicy : Policy :=
  scaffold "shell-cell" 120000 "seal-approvals.jsonl" shellManifest

/-- The destructive command exactly as the demo issues it. -/
def shellRmArgs : Json := Json.mkObj [("command", Json.str "rm -rf /")]

/-- The target every scaffolded `shell_exec` guard binds for those arguments:
    identity + tool name + full canonical argument bytes. Symbolic — never
    kernel-evaluated. -/
def shellRmTarget : TargetHash := scaffoldTarget shellPolicy "shell_exec" shellRmArgs

/-- Every `shell_exec` call — any arguments — classifies guarded under the
    scaffolded shell policy. -/
theorem shell_exec_always_guarded (args : Json) :
    classifyToolCall shellPolicy "shell_exec" args =
      .event (.guarded (scaffoldTarget shellPolicy "shell_exec" args))
        (scaffoldTarget shellPolicy "shell_exec" args).toHex :=
  scaffold_safety "shell-cell" 120000 "seal-approvals.jsonl" shellManifest
    shellExecTool (List.mem_cons_self ..) rfl args

theorem shell_rm_rf_guarded :
    classifyToolCall shellPolicy "shell_exec" shellRmArgs =
      .event (.guarded shellRmTarget) shellRmTarget.toHex :=
  shell_exec_always_guarded shellRmArgs

/-- **Golden-path non-bypass, general form.** If the gate forwards a
    `shell_exec` call, a live approval for exactly that call's target was in
    state. -/
theorem shell_exec_requires_live_approval (args : Json) (now : Nat) (s : State) :
    (step now s (classifyToolCall shellPolicy "shell_exec" args).toEvent).1
        = Decision.allow →
      live s (scaffoldTarget shellPolicy "shell_exec" args) now = true := by
  intro h
  rw [shell_exec_always_guarded] at h
  exact no_allow_guarded_without_matching_approval_in_state now s _ h

/-- **Golden-path non-bypass, demo form.** `rm -rf /` cannot reach the wire
    without a matching live approval. -/
theorem shell_rm_rf_requires_live_approval (now : Nat) (s : State) :
    (step now s (classifyToolCall shellPolicy "shell_exec" shellRmArgs).toEvent).1
        = Decision.allow →
      live s shellRmTarget now = true :=
  shell_exec_requires_live_approval shellRmArgs now s

/-- No live approval ⇒ the gate blocks. The "watch it block" moment. -/
theorem shell_rm_rf_blocks_without_approval (now : Nat) (s : State)
    (h : live s shellRmTarget now = false) :
    (step now s (classifyToolCall shellPolicy "shell_exec" shellRmArgs).toEvent).1
      = Decision.block := by
  rw [shell_rm_rf_guarded]
  show (step now s (.guarded shellRmTarget)).1 = Decision.block
  unfold step
  simp [h]

/-- On a fresh session state the destructive command is blocked outright. -/
theorem shell_rm_rf_blocks_on_fresh_state (now : Nat) :
    (step now State.empty
      (classifyToolCall shellPolicy "shell_exec" shellRmArgs).toEvent).1
      = Decision.block := by
  refine shell_rm_rf_blocks_without_approval now State.empty ?_
  unfold live State.empty
  simp

/-- The approve leg: after a matching unexpired approval is recorded, the same
    command flows — approval is sufficient, not just necessary. -/
theorem shell_rm_rf_allows_with_fresh_approval (now deadline : Nat) (s : State)
    (h : now < deadline) :
    (step now (step now s (.approval shellRmTarget deadline)).2
      (classifyToolCall shellPolicy "shell_exec" shellRmArgs).toEvent).1
      = Decision.allow := by
  rw [shell_rm_rf_guarded]
  show (step now _ (.guarded shellRmTarget)).1 = Decision.allow
  exact (guarded_allow_iff_live ..).2
    (fresh_approval_live now deadline s shellRmTarget h)

/-- The readonly leg: `read_file` classifies benign under the scaffolded
    policy and flows without approval. -/
theorem shell_read_benign (args : Json) :
    classifyToolCall shellPolicy "read_file" args =
      .event .benign "explicit policy allow" := by
  refine scaffold_readonly_flows "shell-cell" 120000 "seal-approvals.jsonl"
    shellManifest "read_file" args ?_ ⟨shellReadTool, ?_, rfl⟩
  · intro tool hmem hname
    simp only [shellManifest, List.mem_cons, List.not_mem_nil, or_false] at hmem
    rcases hmem with rfl | rfl
    · simp [shellExecTool] at hname
    · rfl
  · exact List.mem_cons_of_mem _ (List.mem_cons_self ..)

/-- `read_file` never waits: the gate forwards it on any state. -/
theorem shell_read_flows (args : Json) (now : Nat) (s : State) :
    (step now s (classifyToolCall shellPolicy "read_file" args).toEvent).1
      = Decision.allow := by
  rw [shell_read_benign]
  rfl

end Seal
