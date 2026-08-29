// SPDX-License-Identifier: Apache-2.0

export const README_SECTIONS = [
  '<p align="center"><img src="assets/seal-logo.png" width="150" alt="Seal"></p>',
  "AI agents can call dangerous tools.",
  "Seal is a local approval boundary for AI-agent tool calls.",
  "*Claude can ask. Seal decides whether that exact call may cross the boundary.*",
  "## Supported path",
  "## Try Seal in two minutes",
  "## What you should see",
  "## Protect a real tool set",
  "## Remove it",
  "## Guarantees and non-guarantees",
  "## Choose your next page",
];

export const DOCS_ROUTE_TABLE = `# Choose your route

| I came here to | Route |
|---|---|
| Try and use Seal | [Install](start/install.md), [Protect](guide/choosing-what-to-protect.md), [Operate](guide/what-is-protected-right-now.md), [Receipts](reference/receipt-operations.md) |
| Fix something | [Troubleshooting](guide/when-something-looks-wrong.md), [Refusal codes](guide/when-something-looks-wrong.md) |
| Audit the claims | [Guarantees](assurance/RELEASE-NOTES-v0.2.0-rc.3.md#what-seal-does-not-cover), [Architecture](assurance/architecture.md), [Reproducible kernel](reproduce.md), [Release provenance](guide/github-actions-provenance.md) |

Next: [Start](start/README.md).
`;

export function checkReadmeFrontDoor(readme) {
  let cursor = -1;
  for (const section of README_SECTIONS) {
    const next = readme.indexOf(section, cursor + 1);
    if (next === -1) throw new Error(`README required section absent or out of order: ${section}`);
    if (readme.indexOf(section, next + section.length) !== -1) throw new Error(`README required section duplicated: ${section}`);
    cursor = next;
  }
}

export function checkDocsRouteTable(document) {
  if (document !== DOCS_ROUTE_TABLE) {
    throw new Error("docs/README.md must contain only the route-table heading, the three-route table, and the Start link");
  }
}
