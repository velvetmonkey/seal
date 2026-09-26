// SPDX-License-Identifier: Apache-2.0
// Small, shell-owned tool-call selection. This module does not authorize a
// call. It only decides whether the existing approval contract must see it.
// The kernel does not prove the predicate. When Node forwards a selected
// tool's call without approval, the kernel re-checks the predicates its match
// language can express exactly (see kernelMatchFor).
// String values match exactly: "delete" does not match "delete ".

const ARGUMENT_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function parsePredicate(source) {
  if (typeof source !== "string" || source.length === 0) return { ok: false, error: "predicate is empty" };
  const match = source.match(/^([A-Za-z_][A-Za-z0-9_.-]*)(=|~)(.+)$/s);
  if (!match) return { ok: false, error: "predicate must be ARG=SCALAR or ARG~\"PATTERN\"" };
  const [, argument, operator, encoded] = match;
  if (!ARGUMENT_NAME.test(argument)) return { ok: false, error: "argument name is invalid" };
  let value;
  try { value = JSON.parse(encoded); }
  catch (error) { return { ok: false, error: `predicate value is not JSON: ${error.message}` }; }
  if (operator === "=") {
    if (value !== null && typeof value === "object") return { ok: false, error: "exact predicate value must be a JSON scalar" };
    return { ok: true, argument, operator, value, source };
  }
  if (typeof value !== "string") return { ok: false, error: "pattern predicate value must be a JSON string" };
  if ((value.match(/\*/g) || []).length !== 1) return { ok: false, error: "pattern must contain exactly one * wildcard" };
  const [prefix, suffix] = value.split("*");
  return { ok: true, argument, operator, value, prefix, suffix, source };
}

function parseToolSelection(source) {
  if (typeof source !== "string" || source.length === 0) return { ok: false, error: "tool selection is empty", source };
  const separator = source.indexOf("?");
  if (separator === -1) return { ok: true, name: source, predicate: null, source };
  const name = source.slice(0, separator);
  const predicateSource = source.slice(separator + 1);
  if (name.length === 0) return { ok: false, error: "tool name is empty", source };
  const predicate = parsePredicate(predicateSource);
  if (!predicate.ok) return { ok: false, name, predicate: predicateSource, error: predicate.error, source };
  return { ok: true, name, predicate: predicateSource, parsedPredicate: predicate, source };
}

function normalizeToolSelection(selection) {
  if (typeof selection === "string") return parseToolSelection(selection);
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return { ok: false, name: "", predicate: "", error: "selection is not a string or object" };
  const name = selection.name;
  const predicate = selection.predicate ?? null;
  if (typeof name !== "string" || name.length === 0) return { ok: false, name: "", predicate, error: "tool name is empty" };
  if (predicate === null) return { ok: true, name, predicate: null, source: name };
  const parsed = parsePredicate(predicate);
  return parsed.ok
    ? { ok: true, name, predicate, parsedPredicate: parsed, source: `${name}?${predicate}` }
    : { ok: false, name, predicate, error: parsed.error, source: `${name}?${predicate}` };
}

function jsonHasDuplicateObjectKeys(text, onValue) {
  let index = 0;
  let duplicate = false;
  const whitespace = () => { while (/\s/u.test(text[index] || "")) index += 1; };
  function string() {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    throw new Error("unterminated JSON string");
  }
  // Optional source observation leaves ordinary JSON.parse argument semantics
  // alone. Paths distinguish envelope identities from similarly named args.
  function value(path = []) {
    whitespace();
    const start = index;
    readValue(path);
    if (onValue) onValue(path, text.slice(start, index));
  }
  function readValue(path) {
    if (text[index] === "{") {
      index += 1; whitespace();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      for (;;) {
        whitespace();
        if (text[index] !== '"') throw new Error("object key is not a string");
        const key = string();
        if (keys.has(key)) duplicate = true;
        keys.add(key);
        whitespace();
        if (text[index++] !== ":") throw new Error("object colon is absent");
        value([...path, key]); whitespace();
        const token = text[index++];
        if (token === "}") return;
        if (token !== ",") throw new Error("object separator is invalid");
      }
    }
    if (text[index] === "[") {
      index += 1; whitespace();
      if (text[index] === "]") { index += 1; return; }
      let item = 0;
      for (;;) {
        value([...path, item++]); whitespace();
        const token = text[index++];
        if (token === "]") return;
        if (token !== ",") throw new Error("array separator is invalid");
      }
    }
    if (text[index] === '"') { string(); return; }
    const match = text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
    if (!match) throw new Error("JSON value is invalid");
    index += match[0].length;
  }
  value(); whitespace();
  if (index !== text.length) throw new Error("JSON has trailing data");
  return duplicate;
}

function evaluateSelection(selection, args, rawFrame) {
  const label = selection.source || `${selection.name}?${selection.predicate}`;
  if (!selection.ok) return { gate: true, label, detail: `predicate failed to parse: ${selection.error}` };
  try {
    if (jsonHasDuplicateObjectKeys(rawFrame)) return { gate: true, label, detail: "duplicate JSON object key" };
  } catch (error) {
    return { gate: true, label, detail: `argument inspection failed: ${error.message}` };
  }
  if (selection.predicate === null) return { gate: true, label, detail: "bare tool name selects all calls" };
  const predicate = selection.parsedPredicate;
  if (!args || typeof args !== "object" || Array.isArray(args)) return { gate: true, label, detail: "predicate does not apply to a non-object arguments value" };
  if (!Object.hasOwn(args, predicate.argument)) return { gate: true, label, detail: `predicate does not apply because argument ${predicate.argument} is absent` };
  const actual = args[predicate.argument];
  if (predicate.operator === "~") {
    if (typeof actual !== "string") return { gate: true, label, detail: `predicate does not apply because argument ${predicate.argument} is not a string` };
    return actual.length >= predicate.prefix.length + predicate.suffix.length && actual.startsWith(predicate.prefix) && actual.endsWith(predicate.suffix)
      ? { gate: true, label, detail: "predicate matched" }
      : { gate: false };
  }
  const sameType = predicate.value === null ? actual === null : typeof actual === typeof predicate.value;
  if (!sameType || (actual !== null && typeof actual === "object")) return { gate: true, label, detail: `predicate does not apply because argument ${predicate.argument} has a different JSON type` };
  // JSON numbers have no signed-zero distinction. IEEE-754 -0 and +0 are one scalar.
  const sameScalar = Object.is(actual, predicate.value)
    || (typeof actual === "number" && typeof predicate.value === "number" && actual === predicate.value);
  return sameScalar ? { gate: true, label, detail: "predicate matched" } : { gate: false };
}

// Unicode case folding for key and name comparison. Lower, upper, lower
// over-approximates simple folding (K/k/U+212A, s/S/U+017F) and also joins
// full-folding pairs such as ss/U+00DF, so it may refuse more, never less.
function caseFold(value) {
  return value.toLowerCase().toUpperCase().toLowerCase();
}

// The exact name in `names` that `value` equals only under case folding.
function caseVariantOf(value, names) {
  if (typeof value !== "string") return null;
  for (const name of names) {
    if (value !== name && caseFold(value) === caseFold(name)) return name;
  }
  return null;
}

function foldCollision(keys) {
  const seen = new Map();
  for (const key of keys) {
    const folded = caseFold(key);
    if (seen.has(folded)) return [seen.get(folded), key];
    seen.set(folded, key);
  }
  return null;
}

// Every object in the parsed value, at any depth, must hold keys that stay
// distinct under case folding. Returns the first colliding pair, else null.
function nestedFoldCollision(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const keys = Object.keys(current);
    const collision = foldCollision(keys);
    if (collision) return collision;
    for (const key of keys) stack.push(current[key]);
  }
  return null;
}

// Exact decimal identity of a validated JSON number token, without expanding
// a potentially enormous exponent: 42, 42.0 and 4.2e1 share one identity.
function decimalIdentity(token) {
  const [, sign, whole, fraction = "", exponent = "0"] =
    token.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  let digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "number:0";
  const trailing = digits.match(/0*$/)[0].length;
  digits = digits.slice(0, digits.length - trailing);
  const power = BigInt(exponent) - BigInt(fraction.length) + BigInt(trailing);
  return `number:${sign}${digits}e${power}`;
}

// Re-serialization forwards the binary64 value JSON.parse produced. That
// keeps every fraction's binary64 value, but loses a value outright when the
// literal overflows binary64 (it would serialize as null) or when an integer
// literal has more precision than binary64 holds (9007199254740993 would
// arrive as 9007199254740992). Those two cases are refused, not rewritten.
function numberNotRepresentable(token) {
  const value = Number(token);
  if (!Number.isFinite(value)) return "overflows binary64";
  if (/^-?\d+$/.test(token) && decimalIdentity(token) !== decimalIdentity(JSON.stringify(value))) {
    return "is an integer binary64 cannot hold exactly";
  }
  return null;
}

// Express a selection as a kernel match only where the kernel's match
// language agrees with evaluateSelection on every call Node leaves ungated:
// exact strings, booleans and safe integers, and prefix-only patterns. Kernel
// argument paths split on ".", and the kernel has no suffix match; those
// selections return null and the kernel checks the call without them.
function kernelMatchFor(selection) {
  if (!selection?.ok || !selection.parsedPredicate) return null;
  const predicate = selection.parsedPredicate;
  if (predicate.argument.includes(".")) return null;
  if (predicate.operator === "~") {
    return predicate.suffix === "" ? { type: "starts_with", arg: predicate.argument, value: predicate.prefix } : null;
  }
  const value = predicate.value;
  if (typeof value === "string") return { type: "equals", arg: predicate.argument, value };
  if (typeof value === "boolean" || Number.isSafeInteger(value)) {
    return { type: "equals", arg: predicate.argument, value: String(value) };
  }
  return null;
}

module.exports = {
  caseFold, caseVariantOf, decimalIdentity, evaluateSelection, foldCollision, jsonHasDuplicateObjectKeys,
  kernelMatchFor, nestedFoldCollision, normalizeToolSelection, numberNotRepresentable, parsePredicate, parseToolSelection,
};
