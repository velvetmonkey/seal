#!/usr/bin/env bash
# Run the existing product-suite driver unchanged while recording its own output.
set -uo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner="${SEAL_SUITE_RUNNER:-$script_root/scripts/run-complete-product-suite.sh}"
receipt_writer="$script_root/scripts/suitecapture-receipt.mjs"
raw_output="$(mktemp "${TMPDIR:-/tmp}/seal-suitecapture.XXXXXX")"
capture_dir="$(mktemp -d "${TMPDIR:-/tmp}/seal-suitecapture-pipe.XXXXXX")"
capture_pipe="$capture_dir/output"
mkfifo "$capture_pipe"
runner_exit=125
wrapper_exit=1
captured=0
runner_pid=""
tee_pid=""
capture_complete=0

cleanup_capture_pipe() {
  [[ -e "$capture_pipe" ]] && unlink "$capture_pipe"
  rmdir "$capture_dir" 2>/dev/null || true
}

write_receipt() {
  (( captured == 0 )) || return
  # Set this before invoking node: the EXIT trap can therefore never append a
  # second receipt if a signal arrives while the first writer is running.
  captured=1
  # --verify rejects failed or symbolic output; an absent identity is explicit.
  git_sha="$(git -C "$script_root" rev-parse --verify HEAD^{commit} 2>/dev/null || true)"
  node "$receipt_writer" record --raw "$raw_output" --sha "$git_sha" --runner "$runner" \
    --capture-complete "$capture_complete" --runner-exit "$runner_exit" --wrapper-exit "$wrapper_exit"
}

wait_for_capture() {
  [[ -n "$tee_pid" ]] || return 0
  wait "$tee_pid"
  local tee_exit=$?
  tee_pid=""
  # This wait is a completion barrier: tee has consumed EOF only after the
  # runner closed the FIFO, so no receipt can read a still-flushing capture.
  if (( tee_exit == 0 )); then capture_complete=1; fi
  return "$tee_exit"
}

finish_signal() {
  local signal="$1" status="$2"
  if [[ -n "$runner_pid" ]]; then
    kill -s "$signal" "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    runner_pid=""
  fi
  # Even interrupted runs wait for tee, recording all bytes the killed runner
  # actually emitted; the signal status still makes the receipt REFUSED.
  wait_for_capture || true
  runner_exit="$status"
  wrapper_exit="$status"
  write_receipt
  trap - EXIT HUP INT TERM
  cleanup_capture_pipe
  exit "$status"
}

trap 'finish_signal HUP 129' HUP
trap 'finish_signal INT 130' INT
trap 'finish_signal TERM 143' TERM
trap 'write_receipt; cleanup_capture_pipe' EXIT

set +e
tee "$raw_output" < "$capture_pipe" &
tee_pid=$!
"$runner" "$@" > "$capture_pipe" 2>&1 &
runner_pid=$!
wait "$runner_pid"
runner_exit=$?
runner_pid=""
wait_for_capture
tee_exit=$?
set -e
if (( tee_exit != 0 )); then wrapper_exit=1; fi
if (( runner_exit != 0 )); then
  wrapper_exit="$runner_exit"
elif (( tee_exit == 0 )); then
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
write_receipt >/dev/null
exit "$wrapper_exit"
