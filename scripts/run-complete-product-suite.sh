#!/usr/bin/env bash
# The declared product-suite roster is versioned separately from runtime
# discovery. Keep it separate from run_tests so missing files cannot shrink the
# expectation that the roster line compares against.
set -uo pipefail

if [[ -v RUNNER_TEMP && ! -e "$RUNNER_TEMP" ]]; then
  supplied_runner_temp="$(realpath -m -- "$RUNNER_TEMP")"
  echo "::error::RUNNER_TEMP operator-supplied path does not exist: $supplied_runner_temp; the suite will not create it"
  exit 1
fi

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
declared_tests=()
roster_failures=()
for name in "${declared_names[@]}"; do
  [[ -z "$name" ]] && continue
  if [[ "$name" = /* ]]; then
    file="$name"
  else
    file="$test_root/$name"
  fi
  declared_tests+=("$file")
  if [[ ! -e "$file" ]]; then
    roster_failures+=("missing: $file")
  elif [[ ! -f "$file" || ! -r "$file" ]]; then
    roster_failures+=("unreadable: $file")
  elif [[ ! -s "$file" ]]; then
    roster_failures+=("empty: $file")
  fi
done
if (( ${#declared_tests[@]} == 0 )); then
  echo "::error::declared product-test roster under $test_root is empty"
  exit 1
fi
if (( ${#roster_failures[@]} > 0 )); then
  echo "FAIL  product suite roster: declared test files are not runnable"
  printf 'FAIL  product suite roster: declared test file %s\n' "${roster_failures[@]}"
  exit 1
fi

declare -A declared_set
for file in "${declared_tests[@]}"; do
  declared_set["$file"]=1
done

# A test file is a regular file directly under test_directory whose basename
# matches *.test.*. Directories, hidden files, backups, disabled files, and
# other names are not product-suite test files.
mapfile -t present_tests < <(find "$test_directory" -mindepth 1 -maxdepth 1 -type f -name '*.test.*' -print | sort)
declare -A present_set
for file in "${present_tests[@]}"; do
  present_set["$file"]=1
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
output_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/seal-node-test.tap"
set +e
node --test --test-reporter="$script_root/scripts/product-suite-tap-reporter.mjs" "${run_tests[@]}" 2>&1 | tee "$output_file"
node_status=${PIPESTATUS[0]}
set -e

gate_status=0
if (( node_status != 0 )); then
  echo "::error::node --test exited $node_status"
  gate_status=1
fi

summary_value() {
  local field="$1"
  local value
  value="$(sed -n "s/^# $field \([0-9][0-9]*\)$/\1/p" "$output_file" | tail -n 1)"
  if [[ -z "$value" ]]; then
    return 1
  fi
  printf '%s\n' "$value"
}

declare -A summary summary_status
for field in tests pass fail skipped todo; do
  set +e
  summary[$field]="$(summary_value "$field")"
  summary_status[$field]=$?
  set -e
  if (( summary_status[$field] != 0 )); then
    echo "::error::node --test is missing canonical '# $field N' summary"
    gate_status=1
  fi
done

if (( summary_status[skipped] == 0 && summary[skipped] != 0 )); then
  echo "::error::node --test reported ${summary[skipped]} skipped tests, expected 0"
  gate_status=1
fi
if (( summary_status[todo] == 0 && summary[todo] != 0 )); then
  echo "::error::node --test reported ${summary[todo]} todo tests, expected 0"
  gate_status=1
fi
mapfile -t executed_tests < <(sed -n 's/^# product-suite-executed-file //p' "$output_file" | sort -u)

declare -A executed_set
for file in "${executed_tests[@]}"; do
  executed_set["$file"]=1
done

declared_not_executed=()
for file in "${declared_tests[@]}"; do
  if [[ -z "${executed_set[$file]+x}" ]]; then
    declared_not_executed+=("$file")
  fi
done
executed_not_declared=()
for file in "${executed_tests[@]}"; do
  if [[ -z "${declared_set[$file]+x}" ]]; then
    executed_not_declared+=("$file")
  fi
done
load_failed_tests=()
while IFS= read -r file; do
  if [[ -n "${declared_set[$file]+x}" ]]; then
    load_failed_tests+=("$file")
  fi
done < <(sed -n 's/^not ok [0-9][0-9]* - //p' "$output_file" | sort -u)

for file in "${load_failed_tests[@]}"; do
  echo "::error::declared test file failed to load: $file"
done
if (( summary_status[fail] == 0 && summary[fail] != 0 && ${#load_failed_tests[@]} == 0 )); then
  echo "::error::node --test reported ${summary[fail]} assertion failures, expected 0"
  gate_status=1
fi
if (( summary_status[pass] == 0 && summary_status[tests] == 0 && summary[pass] != summary[tests] && ${#load_failed_tests[@]} == 0 )); then
  echo "::error::node --test reported ${summary[pass]} passes for ${summary[tests]} tests"
  gate_status=1
fi

if (( ${#declared_not_executed[@]} > 0 || ${#executed_not_declared[@]} > 0 )); then
  echo "::error::product suite roster disagrees with executed test files"
  if (( ${#declared_not_executed[@]} > 0 )); then
    printf '::error::declared but not executed: %s\n' "${declared_not_executed[*]}"
  fi
  if (( ${#executed_not_declared[@]} > 0 )); then
    printf '::error::executed but not declared: %s\n' "${executed_not_declared[*]}"
  fi
  gate_status=1
else
  echo "PASS  product suite ran all ${#declared_tests[@]} declared test files"
fi

exit "$gate_status"
