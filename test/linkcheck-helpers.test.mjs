// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { countDestination, markdownDestinations } from "../scripts/linkcheck.mjs";

test("family target is unverified only while its family root is absent", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "seal-linkcheck-family-outcome-"));
  const familyRoot = path.join(scratch, "sister");
  const roots = new Map([["sister", familyRoot]]);
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(message);
  try {
    const absent = { internalOccurrences: 0, externalOccurrences: 0, unverified: 0, bad: 0 };
    countDestination("README.md", "sister/docs/missing.md", scratch, roots, absent, true);
    assert.deepEqual(absent, { internalOccurrences: 0, externalOccurrences: 1, unverified: 1, bad: 0 },
      "absent family root must be counted as unverified without failing");

    mkdirSync(familyRoot);
    const present = { internalOccurrences: 0, externalOccurrences: 0, unverified: 0, bad: 0 };
    countDestination("README.md", "sister/docs/missing.md", scratch, roots, present, true);
    assert.deepEqual(present, { internalOccurrences: 0, externalOccurrences: 1, unverified: 0, bad: 1 },
      "missing file beneath a present family root must be broken");
    assert.deepEqual(messages, [
      "UNVERIFIED  README.md -> sister/docs/missing.md",
      "BROKEN  README.md -> sister/docs/missing.md",
    ], "family diagnostics must distinguish absent root from missing target");
  } finally {
    console.log = originalLog;
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("CommonMark parser does not expose link-looking text in inline code spans", () => {
  const fixture = "Extraction regex: `/VERIFY_PROFILE[^\"']*[\"'](P-[A-Z]+)[\"']/`.";
  assert.deepEqual(markdownDestinations(fixture), []);
});

test("raw HTML block and inline src/href attributes become linkcheck destinations", () => {
  const fixture = [
    '<p><img src="assets/seal-logo.png"><a href="docs/guide/README.md">guide</a></p>',
    '',
    'Inline <img src=assets/seal-flow.svg> and <a href=docs/start/install.md>install</a>.',
    '',
    '<img src="https://example.test/logo.png"><a href="mailto:test@example.test">mail</a>',
  ].join("\n");
  assert.deepEqual(markdownDestinations(fixture), [
    "assets/seal-logo.png",
    "docs/guide/README.md",
    "assets/seal-flow.svg",
    "docs/start/install.md",
    "https://example.test/logo.png",
    "mailto:test@example.test",
  ]);
});

test("escaped backticks remain prose and do not hide real Markdown links", () => {
  const fixture = "Write \\`[ghost](escaped-not-code.md)\\` then [install](docs/start/install.md)";
  assert.deepEqual(
    markdownDestinations(fixture),
    ["escaped-not-code.md", "docs/start/install.md"],
  );
});

test("CommonMark parser handles code span, fence, indented code, and HTML block boundaries", () => {
  const cases = [
    {
      name: "indented-code-block",
      markdown: "    [ghost](indent-ghost.md)\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "html-block-pre",
      markdown: "<pre>\n[ghost](html-ghost.md)\n</pre>\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "code-span-spanning-line-break",
      markdown: "`[ghost](break-ghost.md)\ncontinues`\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "one-line-triple-backtick-span-then-real-link",
      markdown: "```not-a-fence```\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "one-line-triple-backtick-span-adjacent-real-link",
      markdown: "```not-a-fence```\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "info-string-contains-backticks-then-later-fence",
      markdown: "```not-a-fence```\n[keep](docs/start/install.md)\n\n```js\n[ghost](fence-ghost.md)\n```\n\n[guide](docs/guide/README.md)\n",
      links: ["docs/start/install.md", "docs/guide/README.md"],
    },
  ];

  for (const item of cases) {
    assert.deepEqual(markdownDestinations(item.markdown), item.links, item.name);
  }
});
