/- SPDX-License-Identifier: Apache-2.0 -/
import SealV2.EffectEnvelope

open SealV2.Effect

#guard mcpDiscoverySupportedRevisionStrings == ["2025-06-18", "2026-07-28"]
#guard mcpEntryCallOfMethod "initialize" == some .initialize
#guard mcpEntryCallOfMethod "server/discover" == some .serverDiscover
#guard mcpEntryCallOfMethod "tools/call" == none
#guard mcpAdapterForEntryMethod "initialize" ==
  some { type := "mcp", version := "2025-06-18" }
#guard mcpAdapterForEntryMethod "server/discover" ==
  some { type := "mcp", version := "2026-07-28" }
#guard mcpMixedVersionPolicy == .transparentDualEra

def main : IO UInt32 := do
  IO.println "M2 LEAN SET GREEN supportedVersions=[2025-06-18,2026-07-28] nodup=theorem"
  IO.println "M2 LEAN LEGACY GREEN entry=initialize adapterVersion=2025-06-18"
  IO.println "M2 LEAN CURRENT GREEN entry=server/discover adapterVersion=2026-07-28"
  IO.println "M2 LEAN NO-DEFAULT GREEN method=tools/call adapter=none"
  IO.println "M2a LEAN TRANSPARENCY GREEN policy=transparentDualEra translationClaim=absent"
  return 0
