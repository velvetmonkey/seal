#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Code examples and tables can overflow on narrow viewports. Keep their
// native semantics while allowing keyboard users to focus and scroll them.
export function focusScrollableContent(html) {
  return html.replace(/<(pre|table)(?=[\s>])([^>]*)>/gi, (tag, element, attributes) =>
    /\btabindex\s*=/i.test(attributes) ? tag : `<${element} tabindex="0"${attributes}>`);
}

function finalize(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) finalize(file);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const original = fs.readFileSync(file, 'utf8');
      const accessible = focusScrollableContent(original);
      if (accessible !== original) fs.writeFileSync(file, accessible);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.join(here, 'dist');
  finalize(dist);
  const source = path.join(dist, '404.html');
  const route = path.join(dist, '404');
  fs.mkdirSync(route, { recursive: true });
  fs.copyFileSync(source, path.join(route, 'index.html'));
}
