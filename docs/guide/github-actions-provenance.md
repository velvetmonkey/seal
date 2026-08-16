# GitHub Actions provenance for the demo receipt

The `demo receipt provenance` job in
[`ci.yml`](../../.github/workflows/ci.yml) runs only on GitHub-hosted
`ubuntu-latest`. It creates the demo receipt and the receipt-checker transcript
inside that runner, archives them there, and then asks GitHub to attest the
archive. The job does not download a receipt, checker transcript, or evidence
archive before it attests. Uploading the archive afterwards makes the
runner-produced evidence available to a stranger; it is not an input to the
job.

GitHub's provenance attestation binds the downloaded archive's digest to this
workflow and source commit while GitHub retains the attestation. A repository
can delete its attestations, so this is not a permanent public record or a
second person checking the file is true.

## Verify a run as a stranger

Install a current [GitHub CLI](https://cli.github.com/). The commands below
select the most recent successful `Docs & claims consistency` run, reject it
unless its job list includes a successful `demo receipt provenance` job, and
then download its `demo-receipt-provenance` artifact:

```sh
mkdir demo-receipt-provenance
RUN_ID="$(gh run list --repo velvetmonkey/seal --workflow ci.yml --status success \
  --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$RUN_ID"
test "$(gh run view "$RUN_ID" --repo velvetmonkey/seal --json jobs \
  --jq '[.jobs[] | select(.name == "demo receipt provenance" and .conclusion == "success")] | length')" = 1
RUN_SHA="$(gh run view "$RUN_ID" --repo velvetmonkey/seal --json headSha --jq .headSha)"
gh run download "$RUN_ID" --repo velvetmonkey/seal \
  --name demo-receipt-provenance --dir demo-receipt-provenance
gh attestation verify demo-receipt-provenance/demo-receipt-evidence.tgz \
  --repo velvetmonkey/seal \
  --signer-workflow velvetmonkey/seal/.github/workflows/ci.yml \
  --source-digest "$RUN_SHA" \
  --deny-self-hosted-runners
```

Success means the downloaded archive's digest has a GitHub Actions provenance
attestation from this repository and this workflow, for that source commit,
and the verifier rejected self-hosted-runner attestations. Extracting the
archive shows the runner-made `demo-allow-receipt.json`, `checker-output.txt`,
`demo-output.txt`, and the exact `recorded-workflow.yml` from the source
commit.

The job itself runs this same verification immediately after attesting. It
also makes a one-byte change to a copy of the archive and requires
verification to fail. Separately, it makes a one-byte change to a local
workflow copy and verifies the original archive again. That second verification
still succeeds: `gh attestation verify` checks the attested archive and the
workflow identity recorded in the attestation, not an arbitrary workflow file
on the verifier's disk. Compare a candidate workflow to
`recorded-workflow.yml` yourself when that is the question you need answered.
Before the real OIDC request, a negative control removes both runner OIDC
variables and requires the same availability guard to fail; unavailable OIDC
cannot become a skipped or passing provenance job.

## What this does not establish

This establishes where and when GitHub recorded the archive as produced, not
whether the demo receipt's claims are true, not
whether Seal behaved correctly, and not whether anyone independently checked
it. The receipt's own signer remains subject to its existing limitations; this
job introduces no signer or second account.

Next: [Knowing it worked](knowing-it-worked.md).
