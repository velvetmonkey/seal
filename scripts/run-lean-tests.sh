#!/usr/bin/env bash
# Run the shipped kernel checks in declaration order, then the host test driver.
# Report build and runtime failures, then run the full roster and host test driver.
# Run from any working directory.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/kernel-source"
tests=(
  automaton_tests
  policy_v2_tests
  policy_bundle_tests
  policy_diff_tests
  scaffold_tests
  channel_tests
  effect_vectors
  meta_identity_controls
  mrtr_identity_controls
  v2_meta_identity_controls
  v2_mrtr_identity_controls
  axiom_check
  module_axiom_check
  v2_parse_tests
  v2_m1_axiom_check
  v2_validate_tests
  v2_m2_axiom_check
  v2_serialize_tests
  v2_m3_axiom_check
  v2_m3_parser_axiom_check
  v2_m4_axiom_check
  v2_m6_axiom_check
  v2_serialize_line
  v2_lifecycle_tests
  principal_non_influence_show
  k5_framing_show
  classify_enum
  numeric_agreement_show
  escape_events_show
  nonce_ledger_show
  field_warrant_tests
  field_warrant_mutation
  m2_adapter_revision_set
  m7_version_gate
  field_warrant_dishonest_probe
)
omit=(
  seal                 # Runtime MCP host, not a test.
  policy_schema_emit   # Prints the policy schema.
  scan_oracle          # Reads a corpus and reports verdicts without failing on a false verdict.
  v2_parse_line        # Prints the parse result and exits zero for either result.
  v2_validate_line     # Prints the validation result and exits zero for either result.
  v2_decide_line       # Prints the decision and exits zero for Allow or Block.
  ffi_shared           # Build target for the FFI; main does no work.
  v2_signed_bytes      # Prints signed message bytes for a selected input.
  v2_verify_line       # Prints verification or decision results and exits zero for either result.
)

check_roster() {
  local name status=0
  local -a declared
  local -A lean_exe=() run=() omitted=()

  mapfile -t declared < <(awk '
    /^\[\[/ { in_exe = ($0 == "[[lean_exe]]"); found = 0; next }
    in_exe && !found && /^name[[:space:]]*=[[:space:]]*"[^"]+"/ {
      name = $0
      sub(/^name[[:space:]]*=[[:space:]]*"/, "", name)
      sub(/".*/, "", name)
      print name
      found = 1
    }
  ' "$repo_root/kernel-source/lakefile.toml")

  if ((${#declared[@]} == 0)); then
    printf '[kernel-tests] roster: no lean_exe found\n' >&2
    return 1
  fi

  for name in "${declared[@]}"; do lean_exe["$name"]=1; done
  for name in "${tests[@]}"; do run["$name"]=1; done
  for name in "${omit[@]}"; do omitted["$name"]=1; done

  for name in "${declared[@]}"; do
    if [[ ! -v run[$name] && ! -v omitted[$name] ]]; then
      printf '[kernel-tests] roster: %s is a lean_exe in neither list\n' "$name" >&2
      status=1
    fi
    if [[ -v run[$name] && -v omitted[$name] ]]; then
      printf '[kernel-tests] roster: %s is in both lists\n' "$name" >&2
      status=1
    fi
  done
  for name in "${tests[@]}" "${omit[@]}"; do
    if [[ ! -v lean_exe[$name] ]]; then
      printf '[kernel-tests] roster: %s is listed but is not a lean_exe\n' "$name" >&2
      status=1
    fi
  done

  if ((status != 0)); then return "$status"; fi
  printf '[kernel-tests] roster check: %s lean_exe, %s run, %s omit\n' \
    "${#declared[@]}" "${#tests[@]}" "${#omit[@]}"
}

case "${1-}" in
  '') if (($# != 0)); then printf 'usage: %s [--check-roster]\n' "$0" >&2; exit 2; fi ;;
  --check-roster) if (($# != 1)); then printf 'usage: %s [--check-roster]\n' "$0" >&2; exit 2; fi ;;
  *) printf 'usage: %s [--check-roster]\n' "$0" >&2; exit 2 ;;
esac
check_roster
if (($# == 1)); then exit 0; fi

readonly expected_runs="${#tests[@]}"
runs=0
failed_executables=()
result=0
for executable in "${tests[@]}"; do
  printf '[kernel-tests] RUN %s\n' "$executable"
  if lake exe "$executable"; then
    runs=$((runs + 1))
    printf '[kernel-tests] PASS %s\n' "$executable"
  else
    status=$?
    runs=$((runs + 1))
    printf '[kernel-tests] FAIL %s (exit %s)\n' "$executable" "$status" >&2
    failed_executables+=("$executable")
  fi
done
if ((runs != expected_runs)); then
  printf '[kernel-tests] COUNT MISMATCH: ran %s of %s roster executables; refusing to pass\n' \
    "$runs" "$expected_runs" >&2
  result=1
fi
if ((${#failed_executables[@]} == 0)); then
  if ((runs == expected_runs)); then
  printf '[kernel-tests] all %s executables passed\n' "${#tests[@]}"
  fi
else
  printf '[kernel-tests] %s of %s executables failed: %s\n' \
    "${#failed_executables[@]}" "${#tests[@]}" "${failed_executables[*]}" >&2
  result=1
fi

cd "$repo_root"
printf '[lean-tests] RUN lake test\n'
if lake test; then
  printf '[lean-tests] PASS lake test\n'
else
  status=$?
  printf '[lean-tests] FAIL lake test (exit %s)\n' "$status" >&2
  result=1
fi
exit "$result"
