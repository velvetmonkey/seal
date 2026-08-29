// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { authorizationStatusBoundaryFailures } from "../scripts/check-authorization-status-boundaries.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const RUNTIME_TAMPER = path.join(ROOT, "runtime", "statusclaimcold-never-seen.cjs");

function withFileMutation(file, mutate, body) {
  const original = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, mutate(original));
  try {
    return body();
  } finally {
    fs.writeFileSync(file, original);
  }
}

test("product and docs never emit a protection state without its boundary", () => {
  assert.deepEqual(authorizationStatusBoundaryFailures(), []);
});

test("boundary control goes red when a current product surface returns to the old wording", () => {
  const failures = withFileMutation(
    SEAL,
    (source) => source.replace(
      "for (const line of protection.protectionBoundary(view, root, filePath)) console.log(line);",
      "console.log(\"Protection: ACTIVE\");",
    ),
    () => authorizationStatusBoundaryFailures(),
  );
  assert.ok(failures.some((failure) => failure.includes("bin/seal") && failure.includes("old unbounded Protection state")), failures.join("\n"));
});

test("boundary control goes red when a new product surface prints a bare state", () => {
  const file = path.join(ROOT, "bin", "seal-statusclaim-tamper");
  fs.writeFileSync(file, "#!/usr/bin/env node\nconsole.log('Protection: ACTIVE')\n");
  try {
    const failures = authorizationStatusBoundaryFailures();
    assert.ok(failures.some((failure) => failure.includes("bin/seal-statusclaim-tamper") && failure.includes("old unbounded Protection state")), failures.join("\n"));
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("a protection claim in a directory the control has never listed is caught", () => {
  fs.writeFileSync(RUNTIME_TAMPER, "console.log('Protection: ACTIVE')\n");
  try {
    const failures = authorizationStatusBoundaryFailures();
    assert.ok(failures.some((failure) => failure.includes("runtime/statusclaimcold-never-seen.cjs") && failure.includes("old unbounded Protection state")), failures.join("\n"));
  } finally {
    fs.rmSync(RUNTIME_TAMPER, { force: true });
  }
});

test("a correct boundary statement with many gated tools stays green", () => {
  const failures = withFileMutation(
    SEAL,
    (source) => source.replace(
      "for (const line of protection.protectionBoundary(view, root, filePath)) console.log(line);",
      [
        "console.log('Sealed MCP route db: ACTIVE');",
        "console.log('Gated through this route:');",
        ...Array.from({ length: 20 }, (_, index) => `console.log('  db.tool${index + 1}');`),
        "console.log('Not controlled:');",
        "console.log('  other uncontrolled routes can also exist');",
      ].join("\n      "),
    ),
    () => authorizationStatusBoundaryFailures(),
  );
  assert.ok(!failures.some((failure) => failure.includes("bin/seal") && failure.includes("sealed route state lacks boundary statement")), failures.join("\n"));
});

test("Effect protected is rejected in product files and ignored in archive files", () => {
  const productFile = path.join(ROOT, "runtime", "effect-protected-tamper.txt");
  const archiveFile = path.join(ROOT, "docs", "archive", "effect-protected-tamper.txt");
  fs.writeFileSync(productFile, "Effect protected\n");
  fs.writeFileSync(archiveFile, "Effect protected\n");
  try {
    const failures = authorizationStatusBoundaryFailures();
    assert.ok(failures.some((failure) => failure.includes("runtime/effect-protected-tamper.txt") && failure.includes("reserved future broker phrase")), failures.join("\n"));
    assert.ok(!failures.some((failure) => failure.includes("docs/archive/effect-protected-tamper.txt")), failures.join("\n"));
  } finally {
    fs.rmSync(productFile, { force: true });
    fs.rmSync(archiveFile, { force: true });
  }
});
