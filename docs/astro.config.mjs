import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import navigation from './navigation.json' with { type: 'json' };
import { pageSlug } from './prepare-content.mjs';
import { siteUrl } from './site-url.mjs';

const site = siteUrl();
const item = ({ path, label }) => ({ label, slug: pageSlug(path) });

export default defineConfig({
  outDir: './dist',
  site: site.origin,
  base: site.pathname.replace(/\/$/, '') || '/',
  integrations: [starlight({
    title: 'Seal',
    description: 'Seal is a local approval boundary for AI-agent tool calls.',
    components: { Header: './src/components/Header.astro' },
    sidebar: [
      item(navigation.root),
      ...navigation.sections.map((section) => ({
        label: section.name,
        items: section.pages.map(item),
      })),
    ],
  })],
});
