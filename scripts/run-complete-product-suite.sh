#!/usr/bin/env bash
# Roster completeness label: INJECTED, not enforced.
# It catches a declared test file that did not run, whether by accident, by a
# crash, by a misconfiguration, or by a rename that was never followed through.
# It does not catch an actor who can write to the executed-file record. That
# record is written by the process being measured, so a consistent forgery is
# believed. That is accepted in CI because no such actor exists there; the
# record lives in the runner's own temporary directory for the life of one run.
# Known escapes: a count header edited to match a truncated body, and a forged
# snapshot that makes "at least N of M" print a floor that is not a floor.
# The declared product-suite roster is versioned separately from runtime
# discovery. Keep it separate from run_tests so missing files cannot shrink the
# expectation that the roster line compares against.
set -uo pipefail

declared_tests=()
roster_reported=0

report_roster_line() {
  echo "$1"
  roster_reported=1
}

report_unreadable_record() {
  local record_path="$1"
  local reason="$2"
  report_roster_line "ROSTER: unreadable; executed-file record unavailable at $record_path: $reason"
  exit 1
}

mark_record_untrusted() {
  local reason="$1"
  if [[ -n "${record_untrusted_reason:-}" ]]; then
    record_untrusted_reason+="; $reason"
  else
    record_untrusted_reason="$reason"
  fi
}

report_unreconciled_exit() {
  local status=$?
  if [[ -n "${output_file:-}" ]]; then
    rm -f -- "$output_file"
  fi
  if [[ -n "${record_snapshot_file:-}" ]]; then
    rm -f -- "$record_snapshot_file"
  fi
  if (( roster_reported == 0 )); then
    echo "ROSTER: unknown; driver exited $status before reconciliation"
  fi
}

report_driver_signal() {
  local signal="$1"
  local status="$2"
  if (( roster_reported == 0 )); then
    echo "ROSTER: unknown; driver died at SIG$signal"
    roster_reported=1
  fi
  trap - EXIT HUP INT TERM
  exit "$status"
}

trap report_unreconciled_exit EXIT
trap 'report_driver_signal HUP 129' HUP
trap 'report_driver_signal INT 130' INT
trap 'report_driver_signal TERM 143' TERM

canonical_path() {
  realpath -e -- "$1" 2>/dev/null || realpath -m -- "$1"
}

if [[ -v RUNNER_TEMP && ! -e "$RUNNER_TEMP" ]]; then
  supplied_runner_temp="$(realpath -m -- "$RUNNER_TEMP")"
  echo "::error::RUNNER_TEMP operator-supplied path does not exist: $supplied_runner_temp; the suite will not create it"
  exit 1
fi

if [[ -n "${SEAL_PRODUCT_SCRIPT_ROOT:-}" ]]; then
  script_root="$(cd "$SEAL_PRODUCT_SCRIPT_ROOT" && pwd)"
else
  script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
test_root="${SEAL_PRODUCT_TEST_ROOT:-.}"
if [[ ! -d "$test_root" || ! -r "$test_root" ]]; then
  echo "::error::cannot read declared product-test roster at $test_root"
  exit 1
fi
test_root="$(cd "$test_root" && pwd)"
test_directory="${SEAL_PRODUCT_TEST_DIR:-$script_root/test}"
if [[ ! -d "$test_directory" || ! -r "$test_directory" ]]; then
  echo "::error::cannot read product test directory at $test_directory"
  exit 1
fi
test_directory="$(cd "$test_directory" && pwd)"

roster_file="${SEAL_PRODUCT_TEST_ROSTER:-$script_root/scripts/product-test-roster.txt}"
if [[ ! -f "$roster_file" ]]; then
  echo "::error::cannot read declared product-test roster at $roster_file"
  exit 1
fi
printf -v roster_mode '%03d' "$(stat -c '%a' -- "$roster_file")"
if [[ "$roster_mode" == "000" ]]; then
  echo "::error::declared product-test roster is unreadable at $roster_file: mode $roster_mode has no read permissions"
  exit 1
fi
if [[ ! -r "$roster_file" ]]; then
  echo "::error::cannot read declared product-test roster at $roster_file"
  exit 1
fi

mapfile -t declared_names <"$roster_file"
roster_failures=()
declaration_failures=()
declare -A declared_name_set=() declared_set=()
for name in "${declared_names[@]}"; do
  [[ -z "$name" ]] && continue
  if [[ -n "${declared_name_set[$name]+x}" ]]; then
    declaration_failures+=("duplicate declaration: $name")
    continue
  fi
  declared_name_set["$name"]=1
  if [[ "$name" = /* ]]; then
    file="$name"
  else
    file="$test_root/$name"
  fi
  if [[ ! -e "$file" ]]; then
    roster_failures+=("missing: $file")
  elif [[ ! -f "$file" || ! -r "$file" ]]; then
    roster_failures+=("unreadable: $file")
  elif [[ ! -s "$file" ]]; then
    roster_failures+=("empty: $file")
  fi
  file="$(canonical_path "$file")"
  if [[ -z "${declared_set[$file]+x}" ]]; then
    declared_tests+=("$file")
    declared_set["$file"]=1
  fi
done
if (( ${#declared_tests[@]} == 0 )); then
  echo "::error::declared product-test roster under $test_root is empty"
  exit 1
fi
critical_manifest_file="${SEAL_CRITICAL_PROPERTY_MANIFEST:-$script_root/scripts/critical-property-manifest.tsv}"
if [[ ! -f "$critical_manifest_file" ]]; then
  echo "CRITICAL PROPERTY MANIFEST entries: UNAVAILABLE"
  echo "::error::critical-property manifest is absent at $critical_manifest_file"
  exit 1
fi
printf -v critical_manifest_mode '%03d' "$(stat -c '%a' -- "$critical_manifest_file")"
if [[ "$critical_manifest_mode" == "000" ]]; then
  echo "CRITICAL PROPERTY MANIFEST entries: UNAVAILABLE"
  echo "::error::critical-property manifest is unreadable at $critical_manifest_file: mode $critical_manifest_mode has no read permissions"
  exit 1
fi
if [[ ! -r "$critical_manifest_file" ]]; then
  echo "CRITICAL PROPERTY MANIFEST entries: UNAVAILABLE"
  echo "::error::cannot read critical-property manifest at $critical_manifest_file"
  exit 1
fi

mapfile -t critical_manifest_lines <"$critical_manifest_file"
critical_properties=()
critical_proof_files=()
critical_proof_tests=()
critical_manifest_failures=()
declare -A critical_property_set
critical_line_number=0
for line in "${critical_manifest_lines[@]}"; do
  ((critical_line_number += 1))
  [[ -z "$line" || "$line" == \#* ]] && continue
  IFS=$'\t' read -r property proof_name proof_test extra <<<"$line"
  if [[ -z "$property" || -z "$proof_name" || -z "$proof_test" || -n "$extra" ]]; then
    critical_manifest_failures+=("line $critical_line_number is malformed; expected property<TAB>test file<TAB>exact test case")
    continue
  fi
  if [[ -n "${critical_property_set[$property]+x}" ]]; then
    critical_manifest_failures+=("property \"$property\" is duplicated")
    continue
  fi
  critical_property_set["$property"]=1
  if [[ "$proof_name" = /* ]]; then
    proof_file="$proof_name"
  else
    proof_file="$test_root/$proof_name"
  fi
  proof_file="$(canonical_path "$proof_file")"
  critical_properties+=("$property")
  critical_proof_files+=("$proof_file")
  critical_proof_tests+=("$proof_test")
done

echo "CRITICAL PROPERTY MANIFEST entries: ${#critical_properties[@]}"
if (( ${#critical_properties[@]} == 0 )); then
  critical_manifest_failures+=("manifest is empty at $critical_manifest_file")
fi

for index in "${!critical_properties[@]}"; do
  property="${critical_properties[$index]}"
  proof_file="${critical_proof_files[$index]}"
  if [[ -z "${declared_set[$proof_file]+x}" ]]; then
    critical_manifest_failures+=("property \"$property\" lost its proof: test file is not declared: $proof_file")
  elif [[ ! -e "$proof_file" ]]; then
    critical_manifest_failures+=("property \"$property\" lost its proof: test file is missing: $proof_file")
  elif [[ ! -f "$proof_file" || ! -r "$proof_file" ]]; then
    critical_manifest_failures+=("property \"$property\" lost its proof: test file is unreadable: $proof_file")
  elif [[ ! -s "$proof_file" ]]; then
    critical_manifest_failures+=("property \"$property\" lost its proof: test file is empty: $proof_file")
  fi
done

check_manifest_floor_revision() {
  local revision="$1"
  local label="$2"
  local manifest_object="$revision:scripts/critical-property-manifest.tsv"
  local previous_line previous_property previous_proof_name previous_proof_test previous_extra
  local previous_count=0

  if ! git -C "$script_root" cat-file -e "$manifest_object" 2>/dev/null; then
    return
  fi
  while IFS= read -r previous_line; do
    [[ -z "$previous_line" || "$previous_line" == \#* ]] && continue
    IFS=$'\t' read -r previous_property previous_proof_name previous_proof_test previous_extra <<<"$previous_line"
    if [[ -z "$previous_property" || -z "$previous_proof_name" || -z "$previous_proof_test" || -n "$previous_extra" ]]; then
      critical_manifest_failures+=("$label manifest line is malformed in $manifest_object")
      continue
    fi
    ((previous_count += 1))
    if [[ -z "${critical_property_set[$previous_property]+x}" ]]; then
      critical_manifest_failures+=("property \"$previous_property\" was removed from the $label manifest floor")
    fi
  done < <(git -C "$script_root" show "$manifest_object")
  echo "CRITICAL PROPERTY MANIFEST $label entries: $previous_count"
}

if ! git -C "$script_root" rev-parse --verify HEAD >/dev/null 2>&1; then
  critical_manifest_failures+=("cannot inspect committed critical-property manifest history under $script_root")
else
  check_manifest_floor_revision "HEAD" "committed"
  if git -C "$script_root" rev-parse --verify HEAD^ >/dev/null 2>&1; then
    check_manifest_floor_revision "HEAD^" "parent"
  fi
fi

if (( ${#roster_failures[@]} > 0 || ${#declaration_failures[@]} > 0 || ${#critical_manifest_failures[@]} > 0 )); then
  if (( ${#roster_failures[@]} > 0 || ${#declaration_failures[@]} > 0 )); then
    report_roster_line "ROSTER: 0 of ${#declared_tests[@]} declared test files ran; refusing incomplete roster"
    if (( ${#roster_failures[@]} > 0 )); then
      printf 'FAIL  product suite roster: declared test file %s\n' "${roster_failures[@]}"
    fi
    if (( ${#declaration_failures[@]} > 0 )); then
      printf '::error::product suite roster: %s\n' "${declaration_failures[@]}"
    fi
  fi
  if (( ${#critical_manifest_failures[@]} > 0 )); then
    printf '::error::critical-property manifest: %s\n' "${critical_manifest_failures[@]}"
  fi
  exit 1
fi

# Discovery rule: Every regular file recursively below test_directory whose basename
# matches *.test.* is a product-suite test file and must appear in the declared
# roster.
mapfile -t present_paths < <(find "$test_directory" -mindepth 1 -type f -name '*.test.*' -print | sort)
present_tests=()
declare -A present_set=()
for file in "${present_paths[@]}"; do
  file="$(canonical_path "$file")"
  if [[ -z "${present_set[$file]+x}" ]]; then
    present_tests+=("$file")
    present_set["$file"]=1
  fi
done
present_not_declared=()
for file in "${present_tests[@]}"; do
  if [[ -z "${declared_set[$file]+x}" ]]; then
    present_not_declared+=("$file")
  fi
done
declared_not_present=()
for file in "${declared_tests[@]}"; do
  if [[ -z "${present_set[$file]+x}" ]]; then
    declared_not_present+=("$file")
  fi
done
if (( ${#present_not_declared[@]} > 0 || ${#declared_not_present[@]} > 0 )); then
  echo "::error::product suite roster disagrees with test directory"
  if (( ${#declared_not_present[@]} > 0 )); then
    printf '::error::declared but absent from test directory: %s\n' "${declared_not_present[*]}"
  fi
  if (( ${#present_not_declared[@]} > 0 )); then
    printf '::error::present but undeclared: %s\n' "${present_not_declared[*]}"
  fi
  exit 1
fi

run_tests=("${declared_tests[@]}")
record_directory="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
output_file="$record_directory/seal-node-test.$$.tap"
record_snapshot_file="$output_file.snapshot"
if [[ ! -d "$record_directory" ]]; then
  report_unreadable_record "$output_file" "record directory does not exist"
fi
if ! record_directory_mode="$(stat -c '%a' -- "$record_directory" 2>/dev/null)"; then
  report_unreadable_record "$output_file" "record directory metadata could not be read"
fi
if (( (8#$record_directory_mode & 0222) == 0 )); then
  report_unreadable_record "$output_file" "record directory mode $record_directory_mode has no write permissions"
fi
if [[ ! -w "$record_directory" || ! -x "$record_directory" ]]; then
  report_unreadable_record "$output_file" "record directory is not writable and searchable"
fi
umask 077
if ! : >"$output_file" 2>/dev/null; then
  report_unreadable_record "$output_file" "preflight creation failed"
fi
set +e
node --test --test-reporter="$script_root/scripts/product-suite-tap-reporter.mjs" "${run_tests[@]}" 2>&1 | tee "$output_file"
pipeline_status=("${PIPESTATUS[@]}")
node_status=${pipeline_status[0]}
record_write_status=${pipeline_status[1]}
set -e

if (( record_write_status != 0 )); then
  report_unreadable_record "$output_file" "record write failed with exit $record_write_status"
fi
if [[ ! -f "$output_file" || -L "$output_file" ]]; then
  report_unreadable_record "$output_file" "record is missing or is not a regular file"
fi
if ! output_file_mode="$(stat -c '%a' -- "$output_file" 2>/dev/null)"; then
  report_unreadable_record "$output_file" "record metadata could not be read after writing"
fi
if (( (8#$output_file_mode & 0444) == 0 )) || [[ ! -r "$output_file" ]]; then
  report_unreadable_record "$output_file" "record mode $output_file_mode is unreadable"
# CLAIM-COVERAGE: scripts/critical-property-manifest.tsv
fi
if ! record_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then
  report_unreadable_record "$output_file" "record could not be fingerprinted after writing"
fi
record_fingerprint="${record_fingerprint%% *}"
if ! cp -- "$output_file" "$record_snapshot_file" 2>/dev/null; then
  report_unreadable_record "$output_file" "record could not be snapshotted after writing"
fi
if ! snapshot_fingerprint="$(sha256sum -- "$record_snapshot_file" 2>/dev/null)"; then
  report_unreadable_record "$output_file" "record snapshot could not be fingerprinted"
fi
snapshot_fingerprint="${snapshot_fingerprint%% *}"
if [[ "$snapshot_fingerprint" != "$record_fingerprint" ]]; then
  report_unreadable_record "$output_file" "record changed while it was being snapshotted"
fi

gate_status=0
if (( node_status != 0 )); then
  echo "::error::node --test exited $node_status"
  gate_status=1
fi
record_untrusted_reason=""
if [[ ! -f "$output_file" || -L "$output_file" ]]; then
  mark_record_untrusted "record disappeared before reconciliation"
elif ! reconciliation_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then
  mark_record_untrusted "record could not be read before reconciliation"
else
  reconciliation_fingerprint="${reconciliation_fingerprint%% *}"
  if [[ "$reconciliation_fingerprint" != "$snapshot_fingerprint" ]]; then
    mark_record_untrusted "record changed after the test process finished"
  fi
fi

executed_file_count="$(sed -n 's/^# product-suite-executed-file-count \([0-9][0-9]*\)$/\1/p' "$record_snapshot_file" | tail -n 1)"
executed_file_count_occurrences="$(grep -Ec '^# product-suite-executed-file-count [0-9]+$' "$record_snapshot_file" || true)"
if [[ -z "$executed_file_count" ]]; then
  mark_record_untrusted "malformed record: missing canonical '# product-suite-executed-file-count N' header"
elif [[ "$executed_file_count_occurrences" != 1 ]]; then
  mark_record_untrusted "malformed record: canonical '# product-suite-executed-file-count N' header is duplicated"
fi

summary_value() {
  local field="$1"
  local value
  value="$(sed -n "s/^# $field \([0-9][0-9]*\)$/\1/p" "$record_snapshot_file" | tail -n 1)"
  if [[ -z "$value" ]]; then
    return 1
  fi
  printf '%s\n' "$value"
}

declare -A summary summary_status
summary_record_failures=()
for field in tests pass fail skipped todo; do
  set +e
  summary[$field]="$(summary_value "$field")"
  summary_status[$field]=$?
  set -e
  if (( summary_status[$field] != 0 )); then
    summary_record_failures+=("missing canonical '# $field N' summary")
  elif [[ "$(grep -Ec "^# $field [0-9]+$" "$record_snapshot_file")" != 1 ]]; then
    summary_record_failures+=("canonical '# $field N' summary is duplicated")
  fi
done
if (( ${#summary_record_failures[@]} > 0 )); then
  mark_record_untrusted "malformed record: ${summary_record_failures[*]}"
fi

if (( summary_status[skipped] == 0 && summary[skipped] != 0 )); then
  echo "::error::node --test reported ${summary[skipped]} skipped tests, expected 0"
  gate_status=1
fi
if (( summary_status[todo] == 0 && summary[todo] != 0 )); then
  echo "::error::node --test reported ${summary[todo]} todo tests, expected 0"
  gate_status=1
fi
executed_tests=()
execution_output_failures=()
declare -A executed_set=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  file="$(canonical_path "$file")"
  executed_tests+=("$file")
  if [[ -n "${executed_set[$file]+x}" ]]; then
    execution_output_failures+=("duplicate executed-file evidence: $file")
  fi
  executed_set["$file"]=1
done < <(sed -n 's/^# product-suite-executed-file //p' "$record_snapshot_file")
if [[ -n "$executed_file_count" && ${#executed_tests[@]} -ne "$executed_file_count" ]]; then
  mark_record_untrusted "malformed record: executed-file count says $executed_file_count but record contains ${#executed_tests[@]} entries"
fi

declare -A executed_case_count passed_test_case_set
case_count_output_failures=()


# CLAIM-COVERAGE: scripts/critical-property-manifest.tsv
while IFS=$'\t' read -r file count extra; do
  if [[ -z "$file" || ! "$count" =~ ^[0-9]+$ || -n "$extra" ]]; then
    case_count_output_failures+=("malformed test-case count from reporter: $file $count $extra")
    continue
  fi
  file="$(canonical_path "$file")"
  executed_case_count["$file"]="$count"
done < <(sed -n 's/^# product-suite-test-case-count //p' "$record_snapshot_file")
while IFS=$'\t' read -r file test_name extra; do
  if [[ -n "$file" && -n "$test_name" && -z "$extra" ]]; then
    file="$(canonical_path "$file")"
    passed_test_case_set["$file"$'\x1f'"$test_name"]=1
  fi
done < <(sed -n 's/^# product-suite-passed-test-case //p' "$record_snapshot_file")

load_failed_tests=()
declare -A load_failed_set=()
while IFS= read -r file; do
  file="$(canonical_path "$file")"
  if [[ -n "${declared_set[$file]+x}" ]]; then
    load_failed_tests+=("$file")
    load_failed_set["$file"]=1
  fi
done < <(sed -n 's/^not ok [0-9][0-9]* - //p' "$record_snapshot_file" | sort -u)
for file in "${load_failed_tests[@]}"; do
  echo "::error::declared test file failed to load: $file"
  unset 'executed_set[$file]'
done
roster_executed_tests=()
for file in "${executed_tests[@]}"; do
  if [[ -z "${load_failed_set[$file]+x}" ]]; then
    roster_executed_tests+=("$file")
  fi
done
declared_not_executed=()
for file in "${declared_tests[@]}"; do
  if [[ -z "${executed_set[$file]+x}" ]]; then
    declared_not_executed+=("$file")
  fi
done
executed_not_declared=()
for file in "${roster_executed_tests[@]}"; do
  if [[ -z "${declared_set[$file]+x}" ]]; then
    executed_not_declared+=("$file")
  fi
done
if [[ -n "$record_untrusted_reason" ]]; then
  known_missing_tests=()
  if [[ -n "$executed_file_count" && "$executed_file_count_occurrences" == 1 && ${#executed_tests[@]} -eq "$executed_file_count" && ${#summary_record_failures[@]} == 0 ]]; then
    known_missing_tests=("${declared_not_executed[@]}")
  else
    known_missing_tests=("${load_failed_tests[@]}")
  fi
  at_least_count=0
  for file in "${declared_tests[@]}"; do
    if [[ -n "${executed_set[$file]+x}" && -z "${load_failed_set[$file]+x}" ]]; then
      ((at_least_count += 1))
    fi
  done
  if (( ${#known_missing_tests[@]} > 0 )); then
    roster_message="ROSTER: at least $at_least_count of ${#declared_tests[@]} declared test files ran"
    for file in "${known_missing_tests[@]}"; do
      roster_message+="; $file did not run"
    done
    roster_message+="; floor comes from the suite's self-written executed-file record, which is untrusted at $output_file: $record_untrusted_reason, so the count may be low"
    report_roster_line "$roster_message"
    exit 1
  fi
  report_unreadable_record "$output_file" "$record_untrusted_reason"
fi
if (( summary_status[fail] == 0 && summary[fail] != 0 && ${#load_failed_tests[@]} == 0 )); then
  echo "::error::node --test reported ${summary[fail]} assertion failures, expected 0"
  gate_status=1
fi
if (( summary_status[pass] == 0 && summary_status[tests] == 0 && summary[pass] != summary[tests] && ${#load_failed_tests[@]} == 0 )); then
  echo "::error::node --test reported ${summary[pass]} passes for ${summary[tests]} tests"
  gate_status=1
fi
declared_without_cases=()
for file in "${declared_tests[@]}"; do
  if [[ -n "${executed_set[$file]+x}" && "${executed_case_count[$file]:-0}" == 0 ]]; then
    declared_without_cases+=("$file")
  fi
done
if (( ${#case_count_output_failures[@]} > 0 )); then
  printf '::error::%s\n' "${case_count_output_failures[@]}"
  gate_status=1
fi
if (( ${#execution_output_failures[@]} > 0 )); then
  printf '::error::%s\n' "${execution_output_failures[@]}"
  gate_status=1
fi
if (( ${#declared_without_cases[@]} > 0 )); then
  printf '::error::declared test file registered zero test cases: %s\n' "${declared_without_cases[@]}"
  gate_status=1
fi
critical_proof_failures=()
for index in "${!critical_properties[@]}"; do
  property="${critical_properties[$index]}"
  proof_file="${critical_proof_files[$index]}"
  proof_test="${critical_proof_tests[$index]}"
  proof_key="$proof_file"$'\x1f'"$proof_test"
  if [[ -z "${passed_test_case_set[$proof_key]+x}" ]]; then
    critical_proof_failures+=("property \"$property\" lost its proof: test case \"$proof_test\" did not run and pass in $proof_file")
  fi
done
if (( ${#critical_proof_failures[@]} > 0 )); then
  printf '::error::critical-property manifest: %s\n' "${critical_proof_failures[@]}"
  gate_status=1
fi

if (( ${#declared_not_executed[@]} > 0 || ${#executed_not_declared[@]} > 0 || ${#roster_executed_tests[@]} != ${#declared_tests[@]} )); then
  report_roster_line "ROSTER: ${#roster_executed_tests[@]} of ${#declared_tests[@]} declared test files ran; refusing incomplete roster"
  if (( ${#declared_not_executed[@]} > 0 )); then
    printf '::error::INCOMPLETE ROSTER: declared test file did not run: %s\n' "${declared_not_executed[@]}"
  fi
  if (( ${#executed_not_declared[@]} > 0 )); then
    printf '::error::executed but not declared: %s\n' "${executed_not_declared[*]}"
  fi
  gate_status=1
else
  report_roster_line "ROSTER: ${#roster_executed_tests[@]} of ${#declared_tests[@]} declared test files ran"
fi

exit "$gate_status"
