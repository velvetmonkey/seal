#!/usr/bin/env bash
# The declared product-suite roster is the test files present at runtime.  Keep
# it separate from run_tests: the comparison below must catch any later slice
# or filter between discovery and invocation.
set -uo pipefail

test_root="${SEAL_PRODUCT_TEST_ROOT:-test}"
if [[ ! -d "$test_root" || ! -r "$test_root" ]]; then
  echo "::error::cannot read declared product-test roster at $test_root"
  exit 1
fi

declaration_file="$(mktemp)"
trap 'rm -f "$declaration_file"' EXIT
if ! find "$test_root" -type f -name '*test.*' -print0 | sort -z >"$declaration_file"; then
  echo "::error::cannot determine declared product-test roster under $test_root"
  exit 1
fi

mapfile -d '' -t declared_tests <"$declaration_file"
if (( ${#declared_tests[@]} == 0 )); then
  echo "::error::declared product-test roster under $test_root is empty"
  exit 1
fi

run_tests=("${declared_tests[@]}")
output_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/seal-node-test.tap"
set +e
node --test "${run_tests[@]}" 2>&1 | tee "$output_file"
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

if (( summary_status[fail] == 0 && summary[fail] != 0 )); then
  echo "::error::node --test reported ${summary[fail]} failures, expected 0"
  gate_status=1
fi
if (( summary_status[skipped] == 0 && summary[skipped] != 0 )); then
  echo "::error::node --test reported ${summary[skipped]} skipped tests, expected 0"
  gate_status=1
fi
if (( summary_status[todo] == 0 && summary[todo] != 0 )); then
  echo "::error::node --test reported ${summary[todo]} todo tests, expected 0"
  gate_status=1
fi
if (( summary_status[pass] == 0 && summary_status[tests] == 0 && summary[pass] != summary[tests] )); then
  echo "::error::node --test reported ${summary[pass]} passes for ${summary[tests]} tests"
  gate_status=1
fi

ran=${#run_tests[@]}
declared=${#declared_tests[@]}
if (( ran != declared )); then
  echo "::error::product suite ran $ran declared test files, but $declared were declared"
  gate_status=1
else
  echo "PASS  product suite ran all $ran declared test files"
fi

exit "$gate_status"
