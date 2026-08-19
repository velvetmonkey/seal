#!/usr/bin/env bash
# The declared product-suite roster is the test files present at runtime.  Keep
# it separate from run_tests: the comparison below must catch any later slice
# or filter between discovery and invocation.
set -uo pipefail

if [[ -v RUNNER_TEMP && ! -e "$RUNNER_TEMP" ]]; then
  supplied_runner_temp="$(realpath -m -- "$RUNNER_TEMP")"
  echo "::error::RUNNER_TEMP operator-supplied path does not exist: $supplied_runner_temp; the suite will not create it"
  exit 1
fi

test_root="${SEAL_PRODUCT_TEST_ROOT:-test}"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -d "$test_root" || ! -r "$test_root" ]]; then
  echo "::error::cannot read declared product-test roster at $test_root"
  exit 1
fi
test_root="$(cd "$test_root" && pwd)"

# Choke point: never let the suite inherit the OS default /tmp. Honour a
# caller-owned TMPDIR; otherwise use <repo>/.tmp. Cleanup runs on EXIT
# (success and failure) unless KEEP_TMP=1. Never remove anything under /tmp.
TMPGUARD_RUN_ROOT="$(node "$script_root/scripts/temp-root.cjs" --make "$script_root" s)"
export TMPGUARD_RUN_ROOT
export TMPDIR="$TMPGUARD_RUN_ROOT"
export TMP="$TMPGUARD_RUN_ROOT"
export TEMP="$TMPGUARD_RUN_ROOT"
export GIT_CEILING_DIRECTORIES="${GIT_CEILING_DIRECTORIES:-$TMPGUARD_RUN_ROOT}"
cleanup_tmpguard() {
  node "$script_root/scripts/temp-root.cjs" --cleanup "$TMPGUARD_RUN_ROOT"
}

declaration_file="$(mktemp)"
# Snapshot lives beside the run root so a nested suite cannot delete it
# by cleaning its own child of TMPDIR.
tmp_before="${TMPGUARD_RUN_ROOT}.tmpguard-before.json"
trap 'rm -f "$declaration_file" "$tmp_before"; cleanup_tmpguard' EXIT
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
output_file="${RUNNER_TEMP:-${TMPDIR:-$TMPGUARD_RUN_ROOT}}/seal-node-test.tap"
node -e 'const fs=require("node:fs"); const {snapshotTmp}=require(process.argv[1]); fs.writeFileSync(process.argv[2], JSON.stringify(snapshotTmp()));' \
  "$script_root/scripts/check-no-tmp-leaks.cjs" "$tmp_before"
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

declare -A declared_set executed_set
for file in "${declared_tests[@]}"; do
  declared_set["$file"]=1
done
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

set +e
node -e '
  const fs = require("node:fs");
  const { newTmpNames, reportLeaks } = require(process.argv[1]);
  let before;
  try {
    before = new Set(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
  } catch (error) {
    console.error(`TEMP LEAK CHECK: cannot read /tmp snapshot: ${error.message}`);
    process.exit(2);
  }
  const names = newTmpNames(before);
  reportLeaks(names);
  process.exit(names.length ? 1 : 0);
' "$script_root/scripts/check-no-tmp-leaks.cjs" "$tmp_before"
leak_status=$?
set -e
if (( leak_status == 2 )); then
  echo "::error::/tmp snapshot unreadable; silence is a finding"
  gate_status=1
elif (( leak_status != 0 )); then
  echo "::error::test run created names directly under /tmp"
  gate_status=1
fi

exit "$gate_status"
