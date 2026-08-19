const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) {
  console.error("usage: check-no-tmp-leaks.cjs <command> [args...]");
  process.exit(2);
}

const before = new Set(fs.readdirSync("/tmp"));
const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
const after = fs.readdirSync("/tmp").filter((name) => !before.has(name));
if (after.length) {
  console.error(`TEMP LEAK: created directly under /tmp: ${after.map((name) => `/tmp/${name}`).join(", ")}`);
  process.exitCode = 1;
}
if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
