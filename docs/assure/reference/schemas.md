# Policy, tools and labels

Three authored input populations have different jobs.

**Tools catalogue:** a tools array, or an object containing one, lists exact tool names with optional descriptions and MCP annotations. The scanner uses annotations before its name/description heuristic and treats unknown effects conservatively. Missing routes cannot be discovered from an incomplete catalogue.

**TrustedConfig:** epoch and safety are required. Safety contains approval configuration and exact-name tools rules. Allow, guard and deny differ: an allowed mutating tool is still ungated; a guard requires a nonempty target. Optional temporal, consensus, convergence, calibration, linear and budget sections have their own enabled/participation semantics. Safety cannot be disabled. Legacy top-level rules are not the current input shape.

**Adequacy labels:** declare unique monitor names and finite states. Each state needs an identity, label and evidence value for every monitor. Missing evidence is malformed input. Equal evidence with different labels is a collision; a single label can be vacuous.

Setup manifests additionally need server identity and are not interchangeable with bare scanner catalogues. See [the generated example](../configure.md).

The owner retains the complete [normative input schema guide](https://github.com/velvetmonkey/seal-assurance-kit/blob/1ae0df58b3ffd68bef86bc5853e6dad67eef1968/docs/SCHEMAS.md). Its numerical warning describes a verifier limitation: the Protect contract itself permits finite decimals in its supported range.

Previous: [Assurance CLI reference](README.md).
Up: [Assurance CLI](../README.md).
Next: [Verification profiles](verify-profiles.md).
