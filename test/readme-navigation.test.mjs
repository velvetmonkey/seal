import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/readme-navigation.mjs", import.meta.url));

test("an empty public-sibling population is a refusal, not a complete inventory", (t) => {
  const bin = mkdtempSync(join(tmpdir(), "seal-navigation-empty-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const gh = join(bin, "gh");
  writeFileSync(gh, "#!/usr/bin/env node\nprocess.stdout.write('[]\\n');\n");
  chmodSync(gh, 0o755);

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /public sibling population is empty/);
});
