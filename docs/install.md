# Install Seal v0.2.0-rc.2

Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not
supported in this release. The installer refuses before changing anything on
an unsupported platform.

This page is the SHA256SUMS verification wall. The [README](../README.md)
short form is the same install without the named refusals spelled out. Use
this page when you want every check to fail closed in the shell, before the
binary runs.

The digest comparison below is *your* check, with the OS `sha256sum` tool,
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
actual_digest="$(sha256sum "$expected_name" | awk '{print $1}')"
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
tree: b0a5a797db738153eea35521465e6735058f3ea4c9ea2b69994cb7097af0d1e2
```

That hash is the installed-tree digest of the payload `scripts/build-dist.cjs`
packs from this tree. It is not a captured command transcript. It will
change when a payload member changes; it does not change when only docs
change.
