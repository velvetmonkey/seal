#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, 'dist/404.html');
const route = path.join(here, 'dist/404');
fs.mkdirSync(route, { recursive: true });
fs.copyFileSync(source, path.join(route, 'index.html'));
