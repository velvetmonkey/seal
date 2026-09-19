#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteUrl } from './site-url.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const siteBase = siteUrl().pathname.replace(/\/$/, '');
const output = path.join(here, 'src/content/docs');
const archiveWarning = 'Files in the last two groups describe the Seal family of research repositories or a past design state — they are kept for the record and are not claims about the Node CLI this repository ships.';
const historicalDeadTarget = 'https://github.com/velvetmonkey/seal/blob/18bba8ea230ead9fb605cd61d352a0e894c256d5/scripts/check-receipt-canonicalization.mjs';
export const siteDescription = `Seal is a local approval boundary for AI-agent tool calls.`;
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
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) return raw;
  const match = raw.match(/^([^?#]*)([?#].*)?$/);
  if (!match || !match[1]) return raw;
  const suffix = match[2] || '';
  const sourceName = path.relative(root, source).split(path.sep).join('/');
  const targetName = path.posix.normalize(path.posix.join(path.posix.dirname(sourceName), match[1]));
  // Real static assets (screenshots, captured-output renders) live under
  // docs/public/, Astro's convention for files served byte-for-byte at the
  // site root. Astro does not rewrite literal markdown paths with the
  // configured base itself, so this is the one place that must, or every
  // such reference would otherwise fall into the "unknown repo path" branch
  // below and become a non-image GitHub blob-view link instead of the real
  // asset.
  if (targetName.startsWith('docs/public/')) {
    return `${siteBase}/${targetName.slice('docs/public/'.length)}${suffix}`;
  }
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

// Starlight renders its own <h1> from the frontmatter title set below on
// every ordinary article page (ASTRO-INTEGRATION.md section 3: "Normalize
// this so each rendered page has one H1... remove the duplicate source H1
// during generation."). Source Markdown keeps its own leading "# Title" for
// readers viewing the file directly on GitHub; strip only that first H1 line
// (the same line pageSlug's title is read from) out of the generated copy so
// the built page does not render it twice.
function stripSourceH1(markdown) {
  return markdown.replace(/^#[ \t]+.+\r?\n?/m, '');
}

function rewriteLinks(source, markdown) {
  return markdown.replace(/(!?\[[^\]]*\]\()([^)\s]+)([^)]*\))/g,
    (whole, open, destination, close) => `${open}${destinationFor(source, destination)}${close}`);
}

function prepareMarkdown(sourceName, markdown) {
  if (sourceName === 'docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.md') {
    markdown = markdown.replace(
      new RegExp(`\\[([^\\]]+)\\]\\(${historicalDeadTarget.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\)`, 'g'),
      '$1 *(historical target moved)*',
    );
  }
  if (sourceName === 'docs/assurance/README.md') {
    markdown = markdown.replace(/\n## I want the design history[\s\S]*?\nThe evaluator-facing family truth surface is/, '\n\nThe evaluator-facing family truth surface is');
  }
  return markdown;
}

function main() {
  emptyGenerated(output);
  fs.mkdirSync(output, { recursive: true });

  // The homepage route "/" is owned exclusively by src/pages/index.astro
  // (a Starlight custom page, see astro.config.mjs). This generator must
  // never also write a competing src/content/docs/index.md: the root has
  // exactly one owner.
  const slugs = new Map();
  for (const source of sources) {
    const sourceName = path.relative(root, source).split(path.sep).join('/');
    const slug = pageSlug(sourceName);
    if (slug === '') {
      throw new Error(`${sourceName}: generated slug is empty, which would collide with the custom homepage at src/pages/index.astro`);
    }
    const existing = slugs.get(slug);
    if (existing) {
      throw new Error(`duplicate generated route "/${slug}/" from both ${existing} and ${sourceName}`);
    }
    slugs.set(slug, sourceName);
  }

  for (const source of sources) {
    const sourceName = path.relative(root, source).split(path.sep).join('/');
    const slug = pageSlug(sourceName);
    const destination = path.join(output, `${slug}.md`);
    const original = fs.readFileSync(source, 'utf8');
    const archive = sourceName.startsWith('docs/archive/');
    const sourceTitle = original.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, '') || path.basename(source, '.md');
    const title = archive ? `Archive — ${sourceTitle}` : sourceTitle;
    const archiveFrontmatter = archive
      ? `banner:\n  content: "<strong>Archive — not current documentation</strong>"\npagefind: false\n`
      : '';
    const warning = archive ? `> **Archive — not current documentation.** ${archiveWarning}\n\n` : '';
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const prepared = stripSourceH1(prepareMarkdown(sourceName, original));
    fs.writeFileSync(destination, `---\ntitle: ${JSON.stringify(title)}\n${archiveFrontmatter}---\n\n${warning}${rewriteLinks(source, prepared)}`);
  }

  console.log(`Prepared ${sources.length} markdown sources without modifying them; homepage is src/pages/index.astro`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
