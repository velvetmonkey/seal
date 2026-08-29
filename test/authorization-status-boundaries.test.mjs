// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { authorizationStatusBoundaryFailures } from "../scripts/check-authorization-status-boundaries.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");

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
