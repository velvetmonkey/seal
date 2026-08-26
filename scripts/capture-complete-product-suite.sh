#!/usr/bin/env bash
# Run the existing product-suite driver unchanged while recording its own output.
set -uo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner="${SEAL_SUITE_RUNNER:-$script_root/scripts/run-complete-product-suite.sh}"
receipt_writer="$script_root/scripts/suitecapture-receipt.mjs"
raw_output="$(mktemp "${TMPDIR:-/tmp}/seal-suitecapture.XXXXXX")"
runner_exit=125
wrapper_exit=1
captured=0
runner_pid=""

write_receipt() {
  (( captured == 0 )) || return
  captured=1
  git_sha="$(git -C "$script_root" rev-parse HEAD 2>/dev/null || printf 'UNKNOWN')"
  node "$receipt_writer" record --raw "$raw_output" --sha "$git_sha" --runner-exit "$runner_exit" --wrapper-exit "$wrapper_exit"
}

finish_signal() {
  local signal="$1" status="$2"
  if [[ -n "$runner_pid" ]]; then
    kill -s "$signal" "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
  fi
  runner_exit="$status"
  wrapper_exit="$status"
  write_receipt
  trap - EXIT HUP INT TERM
  exit "$status"
}

trap 'finish_signal HUP 129' HUP
trap 'finish_signal INT 130' INT
trap 'finish_signal TERM 143' TERM
trap 'write_receipt' EXIT

set +e
"$runner" "$@" > >(tee "$raw_output") 2>&1 &
runner_pid=$!
wait "$runner_pid"
runner_exit=$?
set -e
runner_pid=""
if (( runner_exit != 0 )); then
  wrapper_exit="$runner_exit"
else
  wrapper_exit=0
fi

# A clean child exit is not a pass when it did not print one complete suite.
if (( runner_exit == 0 )) && {
  [[ "$(grep -Ec '^ROSTER:.*$' "$raw_output")" != 1 ]] ||
  [[ "$(grep -Ec '^# tests [0-9]+$' "$raw_output")" != 1 ]] ||
  [[ "$(grep -Ec '^# pass [0-9]+$' "$raw_output")" != 1 ]] ||
  [[ "$(grep -Ec '^# fail [0-9]+$' "$raw_output")" != 1 ]] ||
  [[ "$(grep -Ec '^# cancelled [0-9]+$' "$raw_output")" != 1 ]] ||
  [[ "$(grep -Ec '^# skipped [0-9]+$' "$raw_output")" != 1 ]]
}; then
  wrapper_exit=1
fi
node "$receipt_writer" record --raw "$raw_output" --sha "$(git -C "$script_root" rev-parse HEAD)" --runner-exit "$runner_exit" --wrapper-exit "$wrapper_exit" >/dev/null
captured=1
exit "$wrapper_exit"
