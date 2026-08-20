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
not the installer checking itself. The `--sha256` flag is a second pin the
installer demands and will refuse without. Together they answer "did I
download the bytes the release named?" They do not answer
"is the publisher honest?"

## Verify, then install

```bash
SEAL_VERSION=v0.2.0-rc.2
base="https://github.com/velvetmonkey/seal/releases/download/$SEAL_VERSION"
curl -fsSLO "$base/SHA256SUMS" -O "$base/seal-$SEAL_VERSION-linux-x64"
if [ ! -r SHA256SUMS ] || ! grep -q '[^[:space:]]' SHA256SUMS; then echo "SHA256SUMS is missing, unreadable, or empty" >&2; exit 1; fi
sha256sum -c SHA256SUMS
expected_digest="$(awk '{print $1}' SHA256SUMS)"
chmod +x "seal-$SEAL_VERSION-linux-x64"
./"seal-$SEAL_VERSION-linux-x64" --sha256 "$expected_digest" --prefix ~/.local
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
tree: 666a9758f1edd42a6b7f720dccb81b1f06c6946a144b83bef045b84e0d62c108
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
