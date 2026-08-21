#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  else
    echo "no SHA-256 tool found (need sha256sum or shasum)" >&2
    return 1
  fi
}

repository_name=${1:?repository name is required}
release_tag=${2:?release tag is required}
release_dir=${3:?release output directory is required}
expected_tag="v$(tr -d '\n' < VERSION)"

if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
  echo "release tag is not exact SemVer: $release_tag" >&2
  exit 1
fi
if [[ "$release_tag" != "$expected_tag" ]]; then
  echo "release tag $release_tag does not match VERSION ($expected_tag)" >&2
  exit 1
fi

commit_sha=${GITHUB_SHA:-$(git rev-parse HEAD)}
archive_name="${repository_name}-${release_tag}.tar.gz"
mkdir -p "$release_dir"
git archive --format=tar --prefix="${repository_name}-${release_tag}/" "$commit_sha" |
  gzip -n -9 > "$release_dir/$archive_name"

(
  cd "$release_dir"
  sha256_file "$archive_name" > SHA256SUMS
)

REPOSITORY_NAME=$repository_name RELEASE_TAG=$release_tag RELEASE_DIR=$release_dir \
ARCHIVE_NAME=$archive_name COMMIT_SHA=$commit_sha python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

release_dir = Path(os.environ["RELEASE_DIR"])
archive_name = os.environ["ARCHIVE_NAME"]
archive = release_dir / archive_name
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
repository = os.environ.get("GITHUB_REPOSITORY", f"velvetmonkey/{os.environ['REPOSITORY_NAME']}")
run_id = os.environ.get("GITHUB_RUN_ID", "local")
server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
statement = {
    "schemaVersion": 1,
    "repository": repository,
    "releaseTag": os.environ["RELEASE_TAG"],
    "commitSha": os.environ["COMMIT_SHA"],
    "workflow": {
        "name": os.environ.get("GITHUB_WORKFLOW", "local release build"),
        "ref": os.environ.get("GITHUB_WORKFLOW_REF", "local"),
        "runId": run_id,
        "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT", "local"),
        "url": f"{server}/{repository}/actions/runs/{run_id}" if run_id != "local" else "local",
    },
    "builder": {
        "id": "https://github.com/actions/runner-images" if run_id != "local" else "local",
        "runnerEnvironment": os.environ.get("RUNNER_ENVIRONMENT", "local"),
        "os": os.environ.get("RUNNER_OS", os.name),
        "arch": os.environ.get("RUNNER_ARCH", "unknown"),
    },
    "artifact": {"name": archive_name, "sha256": digest},
    "claim": "The named workflow archived the exact tagged Git tree and recorded the resulting artifact digest.",
    "nonClaims": [
        "This record is not a signature or an independent attestation.",
        "It does not prove that GitHub Actions, the repository, the source, or the builder was uncompromised.",
        "It does not turn source or prebuilt files into a newly compiled binary.",
    ],
}
(release_dir / "SEAL-RELEASE-PROVENANCE.json").write_text(
    json.dumps(statement, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY

(
  cd "$release_dir"
  read -r expected_digest expected_name < SHA256SUMS
  actual_digest="$(sha256_file "$expected_name" | awk '{print $1}')"
  test "$actual_digest" = "$expected_digest"
)
