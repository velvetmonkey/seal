// SPDX-License-Identifier: Apache-2.0
// Small, shell-owned tool-call selection. This module does not authorize a
// call. It only decides whether the existing approval contract must see it.
// The kernel does not evaluate or prove the predicate.
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

function jsonHasDuplicateObjectKeys(text) {
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
  function value() {
    whitespace();
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
        value(); whitespace();
        const token = text[index++];
        if (token === "}") return;
        if (token !== ",") throw new Error("object separator is invalid");
      }
    }
    if (text[index] === "[") {
      index += 1; whitespace();
      if (text[index] === "]") { index += 1; return; }
      for (;;) {
        value(); whitespace();
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
  if (selection.predicate === null) return { gate: true, label, detail: "bare tool name selects all calls" };
  try {
    if (jsonHasDuplicateObjectKeys(rawFrame)) return { gate: true, label, detail: "duplicate JSON object key" };
  } catch (error) {
    return { gate: true, label, detail: `argument inspection failed: ${error.message}` };
  }
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

module.exports = { evaluateSelection, jsonHasDuplicateObjectKeys, normalizeToolSelection, parsePredicate, parseToolSelection };
