const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "bin", "seal");

test("VERSION is the CLI version authority and matches package metadata", () => {
  const declared = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  const packageVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const reported = execFileSync(process.execPath, [CLI, "--version"], { encoding: "utf8" }).trim();

  assert.match(declared, /^\d+\.\d+\.\d+$/);
  assert.equal(packageVersion, declared, "package.json version must match VERSION");
  assert.equal(reported, declared, "seal --version must report VERSION");
});
