// SPDX-License-Identifier: Apache-2.0
// Canonical bytes for the approval contract: compact JSON, keys sorted by
// UTF-8 byte order, safe integers only, no undefined/NaN/Infinity. The
// contract binds arguments by the SHA-256 of this rendering, so "identical
// arguments" means identical canonical bytes, nothing looser.
//
// Self-contained on purpose: this branch is cut from origin/main and step 2
// (the spine refit) owns unifying this with the spine's canonicalizer.
const crypto = require("node:crypto");

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function encode(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number has no canonical form");
    if (!Number.isInteger(value)) throw new Error("non-integer number has no canonical form in the contract");
    if (value < -MAX_SAFE || value > MAX_SAFE) throw new Error("integer outside the safe canonical range");
    if (Object.is(value, -0)) return "0";
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  if (typeof value === "object") {
    const names = Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    return `{${names.map((name) => `${JSON.stringify(name)}:${encode(value[name])}`).join(",")}}`;
  }
  throw new Error(`value of type ${typeof value} has no canonical form`);
}

function canonicalString(value) {
  return encode(value);
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

module.exports = { canonicalString, sha256Hex };
