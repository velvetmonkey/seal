# Install Seal v0.2.0-rc.2

Source-built artifacts support Linux x86-64 and macOS x64/arm64. The immutable
v0.2.0-rc.2 asset remains Linux x86-64; Windows and Linux ARM are unsupported.
The installer refuses before changing anything on an unsupported or mismatched platform.

This page is the SHA256SUMS verification wall. The [README](../README.md)
short form is the same install without the named refusals spelled out. Use
this page when you want every check to fail closed in the shell, before the
binary runs.

The digest comparison below is *your* check, with the OS SHA-256 tool,
against the `SHA256SUMS` asset attached to the same GitHub release. That is
not the installer checking itself. The `--sha256` / `--bytes` flags are a
second pin the installer demands and will refuse without. Together they
answer "did I download the bytes the release named?" They do not answer
"is the publisher honest?"

## Verify, then install

```bash
SEAL_VERSION=v0.2.0-rc.2
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS"
curl -fsSLO "https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64"
if [ ! -r SHA256SUMS ] || [ ! -s SHA256SUMS ]; then echo "SHA256SUMS is missing, unreadable, or empty" >&2; exit 1; fi
read -r expected_digest expected_bytes expected_name < SHA256SUMS
if [ -z "$expected_digest" ] || [ -z "$expected_bytes" ] || [ -z "$expected_name" ]; then echo "SHA256SUMS is missing, unreadable, or empty" >&2; exit 1; fi
if [ "$expected_name" != "seal-$SEAL_VERSION-linux-x64" ]; then echo "SHA256SUMS names an unexpected artifact: $expected_name" >&2; exit 1; fi
if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "$expected_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "$expected_name" | awk '{print $1}')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi
if [ "$actual_digest" != "$expected_digest" ]; then echo "release artifact digest does not match SHA256SUMS" >&2; exit 1; fi
actual_bytes="$(wc -c < "$expected_name")"
if [ "$actual_bytes" != "$expected_bytes" ]; then echo "release artifact byte count does not match SHA256SUMS" >&2; exit 1; fi
chmod +x "$expected_name"
./"$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```

Success prints `installed seal 0.2.0-rc.2 linux-x64` and the store, command,
and tree lines. Path prefixes on `store:` and `command:` differ per machine.
The tree hash of the published v0.2.0-rc.2 asset is pinned here:

**Seal installed-tree pin role:** `published-asset`
```output
installed seal 0.2.0-rc.2 linux-x64
store: /home/you/.local/lib/seal/store/8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
command: /home/you/.local/bin/seal
tree: 8531e01f662dcd4168b06dbbe101dab3b012d6e28498286bece3e42688dbb0c3
```

Add `~/.local/bin` to PATH:

```bash
$ export PATH="$HOME/.local/bin:$PATH"
```

Further distribution detail, including what the payload does and does not
contain, is in [DISTRIBUTION.md](DISTRIBUTION.md). The published release
payload includes the receipt checker. A source build of this checkout excludes
it; see [evaluator-walk.md](evaluator-walk.md) for that secondary path.

## Source-build tree pin

A build of this checkout (not the published release asset) writes
`dist/seal-v<identity>-linux-x64`. That tree digest is a different claim
from the published-asset pin above:

**Seal installed-tree pin role:** `fresh-build`
```text
tree: 7239dc2595de967b12cc78c8b2b8d1642184c999ebb167ef715c8bfeabd07ab2
```

That hash is the installed-tree digest of the payload `scripts/build-dist.cjs`
packs from this tree. It is not a captured command transcript. It will
change when a payload member changes; it does not change when only docs
change.

### Installed-tree hash definition

The installed tree is exactly the regular payload files named by the artifact's
payload manifest (the build excludes `checker/seal-receipt-check.mjs` for a
fresh build). Order those relative slash-separated paths by bytewise
lexicographic path order. For each file, SHA-256 its exact payload bytes and
form one UTF-8 line: `<file-sha256><two spaces><decimal byte count><two
spaces><path><newline>`. Concatenate those lines without another separator and
SHA-256 the resulting UTF-8 byte sequence. That final digest is the
installed-tree hash. The same definition applies to a published asset; its
payload manifest, rather than this checkout, selects its file set.

## Build and install this checkout on macOS

The macOS CI lane runs this source-build ritual on a real `macos-latest` host.
It selects the artifact label from Node's running architecture and uses the
SHA-256 utility shipped by macOS when GNU `sha256sum` is absent:

```bash
platform="darwin-$(node -p 'process.arch')"
node scripts/build-dist.cjs --platform "$platform" --out dist
read -r expected_digest expected_bytes expected_name < dist/SHA256SUMS
if [ "$expected_name" != "$(node scripts/product-identity.cjs --artifact-name | sed 's/-linux-x64$//')-$platform" ]; then echo "SHA256SUMS names an unexpected artifact: $expected_name" >&2; exit 1; fi
if command -v shasum >/dev/null 2>&1; then actual_digest="$(shasum -a 256 "dist/$expected_name" | awk '{print $1}')"; elif command -v sha256sum >/dev/null 2>&1; then actual_digest="$(sha256sum "dist/$expected_name" | awk '{print $1}')"; else echo "no SHA-256 tool found (need shasum or sha256sum)" >&2; exit 1; fi
if [ "$actual_digest" != "$expected_digest" ]; then echo "artifact digest does not match SHA256SUMS" >&2; exit 1; fi
actual_bytes="$(wc -c < "dist/$expected_name" | tr -d ' ')"
if [ "$actual_bytes" != "$expected_bytes" ]; then echo "artifact byte count does not match SHA256SUMS" >&2; exit 1; fi
chmod +x "dist/$expected_name"
./"dist/$expected_name" --sha256 "$expected_digest" --bytes "$expected_bytes" --prefix ~/.local
```

The immutable landing-page record remains exact: Seal v0.2.0-rc.2 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.
