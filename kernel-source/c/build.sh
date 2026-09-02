#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Compile the vendored TweetNaCl + the Lean FFI shim into one object that the Lean
# exes link via `moreLinkArgs`. Uses `leanc` (the Lean C compiler wrapper) so the
# lean.h include path is correct. Rebuilds from source every time — no stale blob.
#
# Output: c/build/libsealcrypto.o  (git-ignored; run this script before `lake build`
# — the README verify block and ci.yml both do).

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

# leanc's bundled clang lacks system headers (string.h); use the system C compiler
# with the Lean include path so both lean.h and libc headers resolve.
LEAN_PREFIX="$(lean --print-prefix)"
CC="${CC:-cc}"

mkdir -p c/build
"$CC" -c -O2 c/tweetnacl.c    -o c/build/tweetnacl.o
"$CC" -c -O2 -I"$LEAN_PREFIX/include" c/seal_ed25519.c -o c/build/seal_ed25519.o
# Merge into a single relocatable object so one moreLinkArgs entry covers it.
ld -r c/build/tweetnacl.o c/build/seal_ed25519.o -o c/build/libsealcrypto.o
echo "built c/build/libsealcrypto.o"
