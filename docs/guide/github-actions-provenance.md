# GitHub Actions provenance for the demo receipt

The `demo receipt provenance` job in
[`ci.yml`](../../.github/workflows/ci.yml) runs only on GitHub-hosted
`ubuntu-latest`. It creates the demo receipt and the receipt-checker transcript
inside that runner, archives them there, and then asks GitHub to attest the
archive. The job does not download a receipt, checker transcript, or evidence
archive before it attests. Uploading the archive afterwards makes the
runner-produced evidence available to a stranger; it is not an input to the
job.

GitHub recorded this file came from this workflow on this version, and that
public record cannot be quietly deleted. That is not a second person checking
the file is true.

## Verify a run as a stranger

Install a current [GitHub CLI](https://cli.github.com/), choose a successful
`Docs & claims consistency` run, and download its
`demo-receipt-provenance` artifact. Substitute the run's commit SHA for
`RUN_SHA`:

```sh
mkdir demo-receipt-provenance
gh run download RUN_ID --repo velvetmonkey/seal \
  --name demo-receipt-provenance --dir demo-receipt-provenance
gh attestation verify demo-receipt-provenance/demo-receipt-evidence.tgz \
  --repo velvetmonkey/seal \
  --signer-workflow velvetmonkey/seal/.github/workflows/ci.yml \
  --source-digest RUN_SHA \
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

## What this does not establish

This establishes where and when GitHub recorded the archive as produced, not
whether the demo receipt's claims are true, not
whether Seal behaved correctly, and not whether anyone independently checked
it. The receipt's own signer remains subject to its existing limitations; this
job introduces no signer or second account.

Next: [Knowing it worked](knowing-it-worked.md).
