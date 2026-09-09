#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const output = path.join(here, 'src/content/docs');

export function pageSlug(file) {
  let relative = file.replace(/^docs\//, '').replace(/\.md$/, '');
  if (relative === 'README') return 'documentation-map';
  relative = relative.replace(/\/?README$/, '');
  return relative.split('/').map((part) => part.toLowerCase().replaceAll('.', '')).join('/');
}

function emptyGenerated(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      emptyGenerated(target);
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
  }
}

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory() && !['src', 'node_modules', 'dist'].includes(entry.name)) return markdownFiles(target);
    return entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
  });
}

const sources = markdownFiles(here);
const sourceSet = new Set(sources.map((file) => path.relative(root, file).split(path.sep).join('/')));

function routeFor(file) {
  const slug = pageSlug(file);
  return slug ? `/${slug}/` : '/';
}

function destinationFor(source, raw) {
  if (raw === 'https://github.com/velvetmonkey/seal/blob/18bba8ea230ead9fb605cd61d352a0e894c256d5/scripts/check-receipt-canonicalization.mjs') {
    return 'https://github.com/velvetmonkey/seal/blob/18bba8ea230ead9fb605cd61d352a0e894c256d5/test/receipt-checker.test.cjs';
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) return raw;
  const match = raw.match(/^([^?#]*)([?#].*)?$/);
  if (!match || !match[1]) return raw;
  const suffix = match[2] || '';
  const sourceName = path.relative(root, source).split(path.sep).join('/');
  const targetName = path.posix.normalize(path.posix.join(path.posix.dirname(sourceName), match[1]));
  if (sourceSet.has(targetName)) {
    const from = routeFor(sourceName);
    const to = routeFor(targetName);
    let relative = path.posix.relative(from, to);
    if (!relative) relative = './';
    else if (!relative.endsWith('/')) relative += '/';
    return relative + suffix;
  }
  if (targetName.startsWith('docs/') || !targetName.startsWith('../')) {
    const repositoryTarget = targetName.replace(/^\.\.\//, '');
    return `https://github.com/velvetmonkey/seal/blob/main/${repositoryTarget}${suffix}`;
  }
  return raw;
}

function rewriteLinks(source, markdown) {
  return markdown.replace(/(!?\[[^\]]*\]\()([^)\s]+)([^)]*\))/g,
    (whole, open, destination, close) => `${open}${destinationFor(source, destination)}${close}`);
}

function main() {
  emptyGenerated(output);
  fs.mkdirSync(output, { recursive: true });

  const landing = `---\ntitle: Seal\ndescription: Seal is a local approval boundary for AI-agent tool calls.\n---\n\nSeal is a local approval boundary for AI-agent tool calls.\n\nThis guide is for using that gate day to day. It assumes you have seen a \`.mcp.json\` before and can run commands in a terminal, and nothing more.\n\nSeal holds each exact call, asks once, permits at most one execution, and writes a signed receipt.\n\n[Choose your route](documentation-map/)\n`;
  fs.writeFileSync(path.join(output, 'index.md'), landing);

  for (const source of sources) {
    const sourceName = path.relative(root, source).split(path.sep).join('/');
    const slug = pageSlug(sourceName);
    const destination = path.join(output, `${slug}.md`);
    const original = fs.readFileSync(source, 'utf8');
    const title = original.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, '') || path.basename(source, '.md');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `---\ntitle: ${JSON.stringify(title)}\n---\n\n${rewriteLinks(source, original)}`);
  }

  console.log(`Prepared landing page and ${sources.length} markdown sources without modifying them`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
