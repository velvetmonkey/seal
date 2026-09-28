#!/usr/bin/env bash
# Run the shipped kernel checks in declaration order, then the host test driver.
# Build failures and runtime
# assertion failures both stop the roster. Run from any working directory.
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
for executable in "${tests[@]}"; do
  printf '[kernel-tests] RUN %s\n' "$executable"
  if lake exe "$executable"; then
    printf '[kernel-tests] PASS %s\n' "$executable"
  else
    status=$?
    printf '[kernel-tests] FAIL %s (exit %s)\n' "$executable" "$status" >&2
    exit "$status"
  fi
done
printf '[kernel-tests] all %s executables passed\n' "${#tests[@]}"

cd "$repo_root"
printf '[lean-tests] RUN lake test\n'
if lake test; then
  printf '[lean-tests] PASS lake test\n'
else
  status=$?
  printf '[lean-tests] FAIL lake test (exit %s)\n' "$status" >&2
  exit "$status"
fi
