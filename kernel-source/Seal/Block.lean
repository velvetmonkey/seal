/- SPDX-License-Identifier: Apache-2.0 -/

import Lean.Data.Json

namespace Seal

open Lean

def blockResponseLine (id : Json) (targetText : String) : String :=
  let response := Json.mkObj [
    ("jsonrpc", "2.0"),
    ("id", id),
    ("result", Json.mkObj [
      ("content", Json.arr #[
        Json.mkObj [
          ("type", "text"),
          ("text", s!"approval required: {targetText}")
        ]
      ]),
      ("isError", true)
    ])
  ]
  response.compress ++ "\n"

/-- A hard mediation refusal that is not an approval offer. -/
def errorResponseLine (id : Json) (message : String) : String :=
  let response := Json.mkObj [
    ("jsonrpc", "2.0"),
    ("id", id),
    ("result", Json.mkObj [
      ("content", Json.arr #[
        Json.mkObj [
          ("type", "text"),
          ("text", message)
        ]
      ]),
      ("isError", true)
    ])
  ]
  response.compress ++ "\n"

end Seal
