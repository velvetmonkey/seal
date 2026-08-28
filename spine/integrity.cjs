// SPDX-License-Identifier: Apache-2.0
// Tree digest and payload codec for Seal install artifacts.
// Used by the builder and by tests. The installer and the installed launcher
// carry their own copies so they do not load code from a store they are
// about to judge.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAGIC = "SEALPAY1\n";
const DATA = "--DATA--\n";
const PLATFORM = "linux-x64";
const SUPPORTED_PLATFORMS = new Set(["linux-x64", "darwin-arm64"]);

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function treeDigest(files) {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.bytes}  ${file.path}\n`)
    .join("");
  return sha256Hex(Buffer.from(lines, "utf8"));
}

function walkFiles(root) {
  const out = [];
  function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === "." || name === "..") continue;
      const full = path.join(dir, name);
      const next = rel ? `${rel}/${name}` : name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, next);
      else if (stat.isFile()) {
        const data = fs.readFileSync(full);
        out.push({ path: next, bytes: data.length, sha256: sha256Hex(data), data });
      }
    }
  }
  walk(root, "");
  return out;
}

function packPayload(root, version, platform = PLATFORM) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    const error = new Error(`unsupported artifact platform: ${platform}`);
    error.code = "unsupported_platform";
    throw error;
  }
  const files = walkFiles(root);
  const listed = files.map(({ path: p, bytes, sha256 }) => ({ path: p, bytes, sha256 }));
  const manifest = {
    schema: "seal.payload/v1",
    version,
    platform,
    files: listed,
    treeSha256: treeDigest(listed),
    payloadBytes: files.reduce((n, file) => n + file.bytes, 0),
  };
  const header = Buffer.from(`${MAGIC}${JSON.stringify(manifest)}\n${DATA}`, "utf8");
  return { payload: Buffer.concat([header, ...files.map((file) => file.data)]), manifest };
}

function unpackPayload(payload) {
  const textStart = payload.toString("utf8", 0, Math.min(payload.length, 1 << 20));
  if (!textStart.startsWith(MAGIC)) {
    const error = new Error("payload does not start with SEALPAY1");
    error.code = "artifact_malformed";
    throw error;
  }
  const dataAt = payload.indexOf(Buffer.from(DATA, "utf8"), MAGIC.length);
  if (dataAt < 0) {
    const error = new Error("payload is missing the data marker");
    error.code = "artifact_truncated";
    throw error;
  }
  const headerBytes = payload.subarray(MAGIC.length, dataAt);
  let manifest;
  try {
    manifest = JSON.parse(headerBytes.toString("utf8").trim());
  } catch (error) {
    const fail = new Error(`payload header is not JSON: ${error.message}`);
    fail.code = "artifact_malformed";
    throw fail;
  }
  let offset = dataAt + DATA.length;
  const extracted = [];
  for (const file of manifest.files || []) {
    const end = offset + file.bytes;
    if (payload.length < end) {
      const fail = new Error(`payload ends at ${payload.length} bytes; ${file.path} needs ${file.bytes} starting at ${offset}`);
      fail.code = "artifact_truncated";
      throw fail;
    }
    const data = payload.subarray(offset, end);
    const got = sha256Hex(data);
    if (got !== file.sha256) {
      const fail = new Error(`${file.path} digest ${got} does not match the payload manifest`);
      fail.code = "artifact_digest_mismatch";
      throw fail;
    }
    extracted.push({ ...file, data });
    offset = end;
  }
  if (offset !== payload.length) {
    const fail = new Error(`payload has ${payload.length - offset} trailing bytes`);
    fail.code = "artifact_malformed";
    throw fail;
  }
  const digest = treeDigest(manifest.files);
  if (digest !== manifest.treeSha256) {
    const fail = new Error("payload tree digest does not match its manifest");
    fail.code = "artifact_digest_mismatch";
    throw fail;
  }
  return { manifest, files: extracted };
}

function verifyStore(storeRoot, record) {
  const missing = [];
  const unread = [];
  const truncated = [];
  const mismatched = [];
  const seen = [];
  for (const file of record.files) {
    const full = path.join(storeRoot, file.path);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (error) {
      if (error && error.code === "ENOENT") missing.push(file.path);
      else unread.push(file.path);
      continue;
    }
    if (!stat.isFile()) {
      missing.push(file.path);
      continue;
    }
    if (stat.size < file.bytes) {
      truncated.push(file.path);
      continue;
    }
    let data;
    try {
      data = fs.readFileSync(full);
    } catch {
      unread.push(file.path);
      continue;
    }
    if (data.length < file.bytes) {
      truncated.push(file.path);
      continue;
    }
    const got = sha256Hex(data);
    if (got !== file.sha256 || data.length !== file.bytes) mismatched.push(file.path);
    else seen.push({ path: file.path, bytes: data.length, sha256: got });
  }
  if (missing.length) return { ok: false, code: "artifact_missing", reason: `installed file missing: ${missing[0]}` };
  if (unread.length) return { ok: false, code: "artifact_unreadable", reason: `installed file unreadable: ${unread[0]}` };
  if (truncated.length) return { ok: false, code: "artifact_truncated", reason: `installed file truncated: ${truncated[0]}` };
  if (mismatched.length) return { ok: false, code: "artifact_digest_mismatch", reason: `installed file digest mismatch: ${mismatched[0]}` };
  const digest = treeDigest(seen);
  if (digest !== record.treeSha256) {
    return { ok: false, code: "artifact_digest_mismatch", reason: "installed tree digest does not match the install record" };
  }
  return { ok: true, treeSha256: digest };
}

module.exports = {
  PLATFORM,
  SUPPORTED_PLATFORMS,
  sha256Hex,
  treeDigest,
  walkFiles,
  packPayload,
  unpackPayload,
  verifyStore,
};
