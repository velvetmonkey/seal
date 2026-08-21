// SPDX-License-Identifier: Apache-2.0
// Node preload used only by the completeness checker. It observes reads in
// this process and in Node children that inherit NODE_OPTIONS.
const fs = require("node:fs");
const path = require("node:path");

const output = process.env.TWODERIVATIONS_OBSERVATION_FILE;
const consumer = process.env.TWODERIVATIONS_CONSUMER || "unknown-consumer";
const seen = new Set();

function record(value) {
  if (!output || typeof value !== "string") return;
  const normalized = path.resolve(value);
  const match = normalized.match(/(?:^|[\\/])store[\\/]([0-9a-f]{64})[\\/](.+)$/);
  if (!match) return;
  const item = JSON.stringify({ path: match[2].split(path.sep).join("/"), consumer });
  if (seen.has(item)) return;
  seen.add(item);
  fs.appendFileSync(output, `${item}\n`, { encoding: "utf8" });
}

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function observedReadFileSync(file, ...args) {
  record(file);
  const result = originalReadFileSync.call(this, file, ...args);
  return result;
};
const originalOpenSync = fs.openSync;
  fs.openSync = function observedOpenSync(file, ...args) {
  const result = originalOpenSync.call(this, file, ...args);
  record(file);
  return result;
};
for (const name of ["statSync", "lstatSync", "existsSync", "accessSync"]) {
  const original = fs[name];
  fs[name] = function observedMetadataAccess(file, ...args) {
    const result = original.call(this, file, ...args);
    if (name !== "existsSync" || result) record(file);
    return result;
  };
}
const originalReadFile = fs.readFile;
fs.readFile = function observedReadFile(file, ...args) {
  const callback = args.at(-1);
  args[args.length - 1] = function observedReadCallback(error, ...rest) {
    if (!error) record(file);
    return callback.call(this, error, ...rest);
  };
  return originalReadFile.call(this, file, ...args);
};
const originalPromisesReadFile = fs.promises.readFile.bind(fs.promises);
fs.promises.readFile = function observedPromisesReadFile(file, ...args) {
  return originalPromisesReadFile(file, ...args).then((value) => { record(file); return value; });
};
const originalPromisesOpen = fs.promises.open.bind(fs.promises);
fs.promises.open = function observedPromisesOpen(file, ...args) {
  return originalPromisesOpen(file, ...args).then((value) => { record(file); return value; });
};
