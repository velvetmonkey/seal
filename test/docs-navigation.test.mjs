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

function footerAtEnd(text, entries) {
  if (entries.length === 0) return true;
  const block = entries.map(({ role, label, target }) => `${role}: [${label}](${target}).`).join("\n");
  return text.trimEnd().endsWith(block);
}

function markdownFiles(dir, prefix = "") {
  return readdirSync(resolve(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const file = `${prefix}${prefix ? "/" : ""}${entry.name}`;
    if (entry.isDirectory()) return markdownFiles(dir, file);
    return entry.isFile() && entry.name.endsWith(".md") ? [file] : [];
  });
}

test("declared documentation navigation footers match the section chains", () => {
  const declared = new Set([navigation.root.path]);
  assert.equal(existsSync(resolve(ROOT, navigation.root.path)), true, `navigation declares missing ${navigation.root.path}`);
  const rootText = readFileSync(resolve(ROOT, navigation.root.path), "utf8");
  const first = navigation.sections[0].pages[0];
  const rootFooter = [{ role: "Next", label: first.label, target: relativeLink(navigation.root.path, first.path) }];
  assert.deepEqual(footer(rootText), rootFooter, navigation.root.path);
  assert.equal(footerAtEnd(rootText, rootFooter), true, `${navigation.root.path}: navigation footer is not at the end of the page`);
  for (const [sectionIndex, section] of navigation.sections.entries()) {
    assert.ok(section.pages.length > 1, `${section.name}: chain needs at least two pages`);
    for (const [index, page] of section.pages.entries()) {
      assert.equal(declared.has(page.path), false, `navigation declares ${page.path} more than once`);
      declared.add(page.path);
      assert.equal(existsSync(resolve(ROOT, page.path)), true, `navigation declares missing ${page.path}`);
      const expected = [];
      const previous = section.pages[index - 1] || navigation.sections[sectionIndex - 1]?.pages.at(-1) || navigation.root;
      if (previous) {
        expected.push({ role: "Previous", label: previous.label, target: relativeLink(page.path, previous.path) });
      }
      const up = index === 0 ? navigation.root : section.pages[0];
      expected.push({ role: "Up", label: up.label, target: relativeLink(page.path, up.path) });
      const next = section.pages[index + 1] || navigation.sections[sectionIndex + 1]?.pages[0];
      if (next) {
        expected.push({ role: "Next", label: next.label, target: relativeLink(page.path, next.path) });
      }
      const text = readFileSync(resolve(ROOT, page.path), "utf8");
      assert.deepEqual(footer(text), expected, page.path);
      assert.equal(footerAtEnd(text, expected), true, `${page.path}: navigation footer is not at the end of the page`);
    }
  }
  for (const exception of navigation.exceptions) {
    assert.equal(declared.has(exception.path), false, `exception is also chained: ${exception.path}`);
    declared.add(exception.path);
    assert.equal(existsSync(resolve(ROOT, exception.path)), true, `navigation declares missing ${exception.path}`);
    const text = readFileSync(resolve(ROOT, exception.path), "utf8");
    assert.deepEqual(footer(text), exception.footer, exception.path);
    assert.equal(footerAtEnd(text, exception.footer), true, `${exception.path}: navigation footer is not at the end of the page`);
  }
  const markdown = markdownFiles(resolve(ROOT, "docs")).map((file) => `docs/${file}`).sort();
  const nonArchive = markdown.filter((path) => !path.startsWith("docs/archive/"));
  const undeclared = nonArchive.filter((path) => !declared.has(path));
  assert.deepEqual(
    undeclared,
    [],
    `documentation pages missing navigation declarations (docs/archive/** is excluded):\n${undeclared.join("\n")}`,
  );

  const chain = [navigation.root, ...navigation.sections.flatMap((section) => section.pages)];
  const chainFooters = new Map(chain.map((page) => [page.path, footer(readFileSync(resolve(ROOT, page.path), "utf8"))]));
  for (const page of chain) {
    const next = chainFooters.get(page.path).find((entry) => entry.role === "Next");
    if (!next) continue;
    const nextPath = resolve(ROOT, page.path, "..", next.target);
    const destination = chain.find((candidate) => resolve(ROOT, candidate.path) === nextPath);
    assert.ok(destination, `${page.path}: Next target is not in the declared chain: ${next.target}`);
    const previous = chainFooters.get(destination.path).find((entry) => entry.role === "Previous");
    assert.deepEqual(
      previous,
      { role: "Previous", label: page.label, target: relativeLink(destination.path, page.path) },
      `${destination.path}: Previous must point back to ${page.path}`,
    );
  }
});
