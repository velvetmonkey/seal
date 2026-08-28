// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const navigation = JSON.parse(readFileSync(resolve(ROOT, "docs/navigation.json"), "utf8"));
const NAVIGATION_LINE = /^(Previous|Up|Next): \[([^\]]+)\]\(([^)]+)\)\.$/gm;

function relativeLink(from, to) {
  return relative(resolve(ROOT, from, ".."), resolve(ROOT, to)).replaceAll("\\", "/");
}

function footer(text) {
  return [...text.matchAll(NAVIGATION_LINE)].map((match) => ({
    role: match[1], label: match[2], target: match[3],
  }));
}

function markdownFiles(dir, prefix = "") {
  return readdirSync(resolve(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const file = `${prefix}${prefix ? "/" : ""}${entry.name}`;
    if (entry.isDirectory()) return markdownFiles(dir, file);
    return entry.isFile() && entry.name.endsWith(".md") ? [file] : [];
  });
}

test("declared documentation navigation footers match the section chains", () => {
  const declared = new Set();
  for (const section of navigation.sections) {
    assert.ok(section.pages.length > 1, `${section.name}: chain needs at least two pages`);
    for (const [index, page] of section.pages.entries()) {
      assert.equal(declared.has(page.path), false, `navigation declares ${page.path} more than once`);
      declared.add(page.path);
      assert.equal(existsSync(resolve(ROOT, page.path)), true, `navigation declares missing ${page.path}`);
      const expected = [];
      if (index > 0) {
        const previous = section.pages[index - 1];
        expected.push({ role: "Previous", label: previous.label, target: relativeLink(page.path, previous.path) });
      }
      const up = index === 0 ? navigation.root : section.pages[0];
      expected.push({ role: "Up", label: up.label, target: relativeLink(page.path, up.path) });
      if (index + 1 < section.pages.length) {
        const next = section.pages[index + 1];
        expected.push({ role: "Next", label: next.label, target: relativeLink(page.path, next.path) });
      }
      assert.deepEqual(footer(readFileSync(resolve(ROOT, page.path), "utf8")), expected, page.path);
    }
  }
  for (const exception of navigation.exceptions) {
    assert.equal(declared.has(exception.path), false, `exception is also chained: ${exception.path}`);
    declared.add(exception.path);
    assert.equal(existsSync(resolve(ROOT, exception.path)), true, `navigation declares missing ${exception.path}`);
    assert.deepEqual(footer(readFileSync(resolve(ROOT, exception.path), "utf8")), exception.footer, exception.path);
  }
  for (const file of markdownFiles(resolve(ROOT, "docs"))) {
    const path = `docs/${file}`;
    if (path.startsWith("docs/archive/")) continue;
    if (!declared.has(path)) assert.deepEqual(footer(readFileSync(resolve(ROOT, path), "utf8")), [], `${path}: undeclared navigation footer`);
  }
});
