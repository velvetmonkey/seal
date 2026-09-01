#!/usr/bin/env bash
# A disposable field walk for Seal v0.2.1 Protect.  It intentionally leaves
# its temporary directory behind so its transcript and all state are inspectable.

set -u

RELEASE_BASE="https://github.com/velvetmonkey/seal/releases/download/v0.2.1"
AFTER_RESTART=0
WORK=""

if [ "${1:-}" = "--after-restart" ]; then
  AFTER_RESTART=1
  WORK="${2:-}"
  if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
    printf '%s\n' 'REFUSE after_restart_directory_required: use --after-restart /absolute/path/printed-by-the-first-run'
    exit 2
  fi
else
  if [ -z "${TMPDIR:-}" ]; then
    printf '%s\n' 'REFUSE tmpdir_missing: TMPDIR is required; no directory was created.'
    exit 2
  fi
  WORK="$(mktemp -d "${TMPDIR%/}/seal-mac-walk.XXXXXX")" || exit 1
fi

TRANSCRIPT="$WORK/transcript.txt"
mkdir -p "$WORK/logs" "$WORK/download" "$WORK/home" "$WORK/claude-config" "$WORK/xdg-data" "$WORK/cache" "$WORK/project" "$WORK/demo" "$WORK/prefix"
touch "$TRANSCRIPT"
exec > >(tee -a "$TRANSCRIPT") 2>&1

# These are deliberately private to this walk.  In particular, `seal protect`
# invokes `claude mcp add --scope local`; Claude sees only this temporary config.
export HOME="$WORK/home"
export CLAUDE_CONFIG_DIR="$WORK/claude-config"
export XDG_DATA_HOME="$WORK/xdg-data"
export XDG_CACHE_HOME="$WORK/cache"
export SEAL_CACHE_DIR="$WORK/cache/seal-runtime"

DOWNLOAD='SKIPPED (not reached)'
CHECKSUM='SKIPPED (not reached)'
INSTALL='SKIPPED (not reached)'
VERSION='SKIPPED (not reached)'
STATUS_INITIAL='SKIPPED (not reached)'
DEMO='SKIPPED (not reached)'
RECEIPT='SKIPPED (not reached)'
WITNESS='SKIPPED (not reached)'
PROTECT='SKIPPED (not reached)'
STATUS_AFTER_RESTART='SKIPPED (requires a real Claude Code restart)'

say() { printf '%s\n' "$*"; }
command_text() {
  for item in "$@"; do printf " '%s'" "$(printf '%s' "$item" | sed "s/'/'\\\"'\\\"'/g")"; done
  printf '\n'
}
run_capture() {
  label="$1"
  shift
  out="$WORK/logs/$label.txt"
  say "RUN:${label}:$(command_text "$@")"
  "$@" >"$out" 2>&1
  code=$?
  say "GOT:${label}: exit $code"
  if [ -s "$out" ]; then cat "$out"; else say 'GOT: (no stdout or stderr)'; fi
  return "$code"
}
summary() {
  say ''
  say 'SUMMARY'
  for pair in \
    "DOWNLOAD:$DOWNLOAD" "CHECKSUM:$CHECKSUM" "INSTALL:$INSTALL" "VERSION:$VERSION" \
    "STATUS_INITIAL:$STATUS_INITIAL" "DEMO:$DEMO" "RECEIPT:$RECEIPT" \
    "WITNESS:$WITNESS" "PROTECT:$PROTECT" "STATUS_AFTER_RESTART:$STATUS_AFTER_RESTART"; do
    say "  ${pair%%:*}: ${pair#*:}"
  done
  say "TRANSCRIPT: $TRANSCRIPT"
  say "WORK DIRECTORY (left intact; inspect or delete it yourself): $WORK"
}
finish() { summary; exit "${1:-0}"; }
gatekeeper_note() {
  file="$1"
  if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] &&
     grep -Eiq 'cannot be opened|developer cannot be verified|unidentified developer|malware' "$file"; then
    say 'GATEKEEPER: macOS appears to have refused a downloaded Seal component.'
    say "REMEDY (only if Ben chooses it after inspecting this temporary download): xattr -d com.apple.quarantine \"$ASSET\""
    say 'THIS IS A FINDING ABOUT OUR INSTALL DOCS. The script did not run xattr or bypass Gatekeeper.'
  fi
}

say "WORK DIRECTORY: $WORK"
say "TRANSCRIPT: $TRANSCRIPT"
say "MODE: $([ "$AFTER_RESTART" -eq 1 ] && printf after-restart || printf first-run)"

NODE_ARCH="$(node -p 'process.arch' 2>"$WORK/logs/node-arch.txt")"
NODE_CODE=$?
say "RUN:node-architecture: node -p 'process.arch'"
say "GOT:node-architecture: exit $NODE_CODE; value ${NODE_ARCH:-<none>}"
if [ "$NODE_CODE" -ne 0 ] || { [ "$NODE_ARCH" != "arm64" ] && [ "$NODE_ARCH" != "x64" ]; }; then
  say 'FAIL: unsupported or unreadable Node architecture; expected arm64 or x64.'
  finish 1
fi
PLATFORM="${SEAL_MAC_WALK_PLATFORM:-darwin-$NODE_ARCH}"
case "$PLATFORM" in
  darwin-arm64|darwin-x64|linux-x64) ;;
  *) say "FAIL: unsupported selected platform $PLATFORM"; finish 1 ;;
esac
ASSET="seal-v0.2.1-$PLATFORM"
ASSET_PATH="$WORK/download/$ASSET"
SUMS_PATH="$WORK/download/SHA256SUMS"
CHECKER="$WORK/download/seal-receipt-v2.mjs"
PREFIX="$WORK/prefix"
SEAL="$PREFIX/bin/seal"

if [ "$AFTER_RESTART" -eq 1 ]; then
  if [ ! -x "$SEAL" ]; then
    say "FAIL: no executable Seal installation at $SEAL; use the directory from a completed first run."
    finish 1
  fi
  if [ ! -d "$WORK/project" ]; then
    say "FAIL: no throwaway project at $WORK/project; use the directory from a completed first run."
    finish 1
  fi
  DOWNLOAD='SKIPPED (after-restart mode uses the existing verified temporary installation)'
  CHECKSUM='SKIPPED (after-restart mode uses the existing verified temporary installation)'
  INSTALL='SKIPPED (after-restart mode uses the existing verified temporary installation)'
  VERSION='SKIPPED (after-restart mode checks only route activation)'
  STATUS_INITIAL='SKIPPED (after-restart mode checks only route activation)'
  DEMO='SKIPPED (after-restart mode checks only route activation)'
  RECEIPT='SKIPPED (after-restart mode checks only route activation)'
  WITNESS='SKIPPED (the first run already reported witness readiness)'
  PROTECT='SKIPPED (protect is first-run work; after-restart mode only observes it)'
  say 'After-restart check: this command does not start Claude Code; it reports the state Claude Code actually left behind.'
  (cd "$WORK/project" && run_capture status-after-restart "$SEAL" status)
  code=$?
  if [ "$code" -eq 0 ] && grep -Fq 'Sealed MCP route db: ACTIVE' "$WORK/logs/status-after-restart.txt"; then
    STATUS_AFTER_RESTART=PASS
  else
    STATUS_AFTER_RESTART=FAIL
    say 'FAIL: expected the actual status output to contain: Sealed MCP route db: ACTIVE'
  fi
  finish "$([ "$STATUS_AFTER_RESTART" = PASS ] && printf 0 || printf 1)"
fi

fetch() {
  destination="$1"
  url="$2"
  run_capture "download-$(basename "$destination")" curl -fL --retry 2 --connect-timeout 20 -o "$destination" "$url"
}
fetch "$ASSET_PATH" "$RELEASE_BASE/$ASSET" && fetch "$SUMS_PATH" "$RELEASE_BASE/SHA256SUMS" && fetch "$CHECKER" "$RELEASE_BASE/seal-receipt-v2.mjs"
if [ "$?" -ne 0 ]; then
  DOWNLOAD=FAIL
  say 'FAIL: a required release download did not complete.'
  finish 1
fi
DOWNLOAD=PASS

EXPECTED="$(awk -v name="$ASSET" '$3 == name { print $1 " " $2; exit }' "$SUMS_PATH")"
EXPECTED_DIGEST="${EXPECTED%% *}"
EXPECTED_BYTES="${EXPECTED#* }"
ACTUAL_DIGEST="$(shasum -a 256 "$ASSET_PATH" | awk '{print $1}')"
say "RUN:checksum: shasum -a 256 '$ASSET_PATH'"
say "GOT:checksum: expected=$EXPECTED_DIGEST actual=$ACTUAL_DIGEST expected_bytes=$EXPECTED_BYTES"
if [ -z "$EXPECTED" ] || [ "$EXPECTED_DIGEST" = "$EXPECTED_BYTES" ] || [ "$ACTUAL_DIGEST" != "$EXPECTED_DIGEST" ]; then
  CHECKSUM=FAIL
  say 'FAIL: downloaded digest does not match the SHA256SUMS release record; stopping before execution.'
  finish 1
fi
CHECKSUM=PASS

run_capture make-downloaded-asset-executable chmod 700 "$ASSET_PATH"
if [ "$?" -ne 0 ]; then
  INSTALL=FAIL
  say 'FAIL: the verified downloaded asset could not be made executable inside the temporary directory.'
  finish 1
fi
run_capture install "$ASSET_PATH" --sha256 "$EXPECTED_DIGEST" --bytes "$EXPECTED_BYTES" --prefix "$PREFIX"
if [ "$?" -ne 0 ]; then
  INSTALL=FAIL
  gatekeeper_note "$WORK/logs/install.txt"
  finish 1
fi
INSTALL=PASS

run_capture version "$SEAL" --version
if [ "$?" -ne 0 ]; then VERSION=FAIL; gatekeeper_note "$WORK/logs/version.txt"; finish 1; fi
# Exit 0 alone would pass for any version string, including the wrong asset.
if grep -Fq '0.2.1' "$WORK/logs/version.txt"; then
  VERSION=PASS
else
  VERSION='FAIL (expected 0.2.1)'
  say 'FAIL: the installed Seal did not report version 0.2.1.'
  finish 1
fi

run_capture status-initial "$SEAL" status
if [ "$?" -eq 0 ]; then STATUS_INITIAL=PASS; else STATUS_INITIAL=FAIL; gatekeeper_note "$WORK/logs/status-initial.txt"; finish 1; fi

run_capture demo sh -c "printf 'y\\n' | \"$SEAL\" demo --dir \"$WORK/demo\""
if [ "$?" -ne 0 ]; then DEMO=FAIL; gatekeeper_note "$WORK/logs/demo.txt"; finish 1; fi
DEMO=PASS
DEMO_DIRECTORY="$(awk -F': ' '/^receipt written: / { sub(/\/receipts\/.*/, "", $2); print $2; exit }' "$WORK/logs/demo.txt")"
RECEIPT_PATH="$(awk -F': ' '/^receipt written: / { print $2; exit }' "$WORK/logs/demo.txt")"
say "GOT:demo-directory: ${DEMO_DIRECTORY:-<not printed by Seal>}"
if [ -z "$RECEIPT_PATH" ] || [ ! -f "$RECEIPT_PATH" ]; then
  RECEIPT=FAIL
  say 'FAIL: demo succeeded but no receipt path was printed and found.'
  finish 1
fi
# The published checker imports ../runtime/kernel/decision-runner.cjs.  Its
# release download is one file, so give it a private temporary runtime sibling
# copied from the verified temporary Seal installation.
# `find -quit` is a GNU extension and the BSD find on macOS rejects it, so take
# the first match with `head` instead.  Both userlands accept this form.
INSTALLED_CHECKER="$(find "$PREFIX/lib/seal/store" -type f -path '*/checker/seal-receipt-v2.mjs' -print | head -n 1)"
if [ -z "$INSTALLED_CHECKER" ]; then
  RECEIPT=FAIL
  say 'FAIL: the temporary Seal installation has no checker location for the downloaded checker.'
  finish 1
fi
STORE_ROOT="$(dirname "$(dirname "$INSTALLED_CHECKER")")"
CHECKER_ROOT="$WORK/download/checker-runtime"
mkdir -p "$CHECKER_ROOT/checker"
run_capture stage-checker-runtime cp -R "$STORE_ROOT/runtime" "$CHECKER_ROOT/runtime"
if [ "$?" -ne 0 ]; then RECEIPT=FAIL; finish 1; fi
run_capture stage-downloaded-receipt-checker cp "$CHECKER" "$CHECKER_ROOT/checker/seal-receipt-v2.mjs"
if [ "$?" -ne 0 ]; then RECEIPT=FAIL; finish 1; fi
run_capture receipt-check node "$CHECKER_ROOT/checker/seal-receipt-v2.mjs" "$RECEIPT_PATH" --pubkey "$(tr -d '\n' < "$WORK/demo/receipt-signer.pub")"
if [ "$?" -eq 0 ]; then RECEIPT=PASS; else RECEIPT=FAIL; finish 1; fi

cat > "$WORK/project/server.mjs" <<'SERVER'
import readline from "node:readline";
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let request; try { request = JSON.parse(line); } catch { return; }
  if (request.method === "initialize") return send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "macwalk-db", version: "1" } } });
  if (request.method === "tools/list") return send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "db.write", description: "throwaway test tool", inputSchema: { type: "object", properties: {} } }, { name: "db.read", description: "throwaway test tool", inputSchema: { type: "object", properties: {} } }] } });
  if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "method not implemented in throwaway server" } });
});
SERVER
printf '%s\n' '{"mcpServers":{"db":{"command":"node","args":["./server.mjs"]}}}' > "$WORK/project/.mcp.json"
cat > "$WORK/start-claude-code.sh" <<EOF
#!/usr/bin/env bash
cd "$WORK/project" || exit 1
export HOME="$WORK/home"
export CLAUDE_CONFIG_DIR="$WORK/claude-config"
export XDG_DATA_HOME="$WORK/xdg-data"
export XDG_CACHE_HOME="$WORK/cache"
export SEAL_CACHE_DIR="$WORK/cache/seal-runtime"
exec claude
EOF
chmod 700 "$WORK/start-claude-code.sh"

run_capture witness-helper "$SEAL" doctor
if [ "$?" -ne 0 ]; then
  WITNESS=FAIL
  gatekeeper_note "$WORK/logs/witness-helper.txt"
  say 'FAIL: Protect will not be attempted because `seal doctor` exited non-zero.'
  finish 1
fi
# `seal doctor` exits 0 even when it reports that it has NOT established
# readiness, so report what it said instead of reading exit 0 as readiness.
if grep -Fq 'ASSUMPTION' "$WORK/logs/witness-helper.txt"; then
  WITNESS='UNKNOWN (seal doctor exited 0 and reported ASSUMPTION: readiness not established)'
else
  WITNESS=PASS
fi

(cd "$WORK/project" && run_capture protect "$SEAL" protect db db.write)
if [ "$?" -eq 0 ]; then PROTECT=PASS; else PROTECT=FAIL; gatekeeper_note "$WORK/logs/protect.txt"; finish 1; fi

say ''
say 'NEXT: Restart Claude Code using the temporary configuration and project:'
say "  $WORK/start-claude-code.sh"
say 'Close that Claude Code session after it has started the db MCP route, then run:'
say "  $0 --after-restart $WORK"
say 'The follow-up checks the actual status output for ACTIVE; it does not claim activation merely because protect succeeded.'
finish 0
