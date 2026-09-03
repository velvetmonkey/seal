/- SPDX-License-Identifier: Apache-2.0 -/

import Seal.EncodingInjective

/-!
# K5 SHOW: framing injectivity at the hashed-byte surface

Runnable evidence for `Seal/EncodingInjective.lean`, real SHA-256, compiled.

    lake exe k5_framing_show            -- GREEN: host framed like the kernel
    lake exe k5_framing_show --tamper   -- RED:  host framed with byte-counted
                                        --       lengths (the djb-netstring
                                        --       reading a reimplementer writes)

The checker never changes. It models the commitment cross-check surface — a
host re-derives the commitment and compares digests with the kernel — and
demands, over an adversarial corpus of part-lists:

  1. AGREEMENT: the host digest equals the kernel digest for the SAME list;
  2. NO ALIASING: the host digest never equals the kernel digest of a
     DIFFERENT list.

With the kernel framing on both sides, (1) is trivial and (2) is
`encodeParts_toUTF8_injective` in action: GREEN. With `--tamper` the host
frames by BYTE count: both properties break — multi-byte lists disagree
(fail-closed availability defect) and the constructed witness pair ALIASES
(`["é","8:aaaaaaaa"]` at the host collides with `["é1","","aaaaaaaa"]` at the
kernel — the security defect): RED, exit 1.

Note byte-counted framing is injective WITHIN itself (true djb netstrings
are sound); the defect is strictly cross-implementation. That is why the
checker is host-vs-kernel, not host-vs-host.
-/

open Seal Seal.Encoding

/-- Adversarial corpus: the constructed witness pair plus separator-stuffing,
    digit-stuffing, empty-part, and multi-byte near-misses. All pairwise
    DISTINCT part-lists. -/
private def corpus : List (List String) :=
  [ witnessCharSide,                 -- ["é1", "", "aaaaaaaa"]
    witnessByteSide,                 -- ["é", "8:aaaaaaaa"]
    ["a", "b"], ["a|b"], ["a", "1:b"], ["a1:b"],
    ["1", ""], ["", "1"], ["10"], ["1", "0"],
    [":"], ["::"], [":", ":"], [""], [], ["", ""],
    ["é"], ["é", ""], ["", "é"], ["éé"], ["é", "é"],
    ["💥"], ["💥a"], ["💥", "a"],
    ["2:é"], ["é2"], ["é", "2"],
    ["seal.effect/v3", "srv-é", "tool", "{\"x\":1}"],
    ["seal.effect/v3", "srv-é1", "", "{\"x\":1}"] ]

private def hexOf (frame : List String → String) (parts : List String) : String :=
  (Seal.stableHashString (frame parts)).toHex

private def showParts (l : List String) : String :=
  "[" ++ String.intercalate ", " (l.map (fun s => "\"" ++ s ++ "\"")) ++ "]"

def main (args : List String) : IO UInt32 := do
  let tamper := args.contains "--tamper"
  let hostFrame := if tamper then encodePartsByteCount else Seal.encodeParts
  let hostName := if tamper then
    "encodePartsByteCount (TAMPERED: byte-counted lengths, the djb-netstring reading)"
  else
    "Seal.encodeParts (same framing as the kernel)"
  IO.println s!"K5 SHOW — kernel: Seal.encodeParts (character-counted lengths)"
  IO.println s!"          host:   {hostName}"

  let kernelTagged := corpus.map fun l => (l, hexOf Seal.encodeParts l)
  let hostTagged   := corpus.map fun l => (l, hexOf hostFrame l)
  let mut red := false

  -- Property 1: host and kernel agree on every part-list.
  let disagreements := (kernelTagged.zip hostTagged).filterMap
    fun ((l, kh), (_, hh)) => if kh != hh then some (l, kh, hh) else none
  if disagreements.isEmpty then
    IO.println s!"AGREEMENT: host digest = kernel digest on all {corpus.length} corpus part-lists"
  else
    red := true
    for (l, kh, hh) in disagreements do
      IO.println s!"RED: DISAGREEMENT on {showParts l}: kernel {kh} vs host {hh}"

  -- Property 2: no host digest equals the kernel digest of a DIFFERENT list.
  let aliases := hostTagged.flatMap fun (lh, hh) =>
    kernelTagged.filterMap fun (lk, kh) =>
      if lh ≠ lk && hh == kh then some (lh, lk, kh) else none
  if aliases.isEmpty then
    IO.println s!"NO ALIASING: no host digest matches the kernel digest of a different part-list"
  else
    red := true
    for (lh, lk, h) in aliases do
      IO.println s!"RED: ALIAS: host {showParts lh} == kernel {showParts lk} -> {h}"

  if red then
    IO.println "RED: this host framing does NOT bind the part-list the kernel committed to"
    return 1
  IO.println "GREEN: framing binds the part-list end to end"
  return 0
