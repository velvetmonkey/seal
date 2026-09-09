import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import navigation from './navigation.json' with { type: 'json' };
import { pageSlug, siteDescription } from './prepare-content.mjs';
import { siteUrl } from './site-url.mjs';

const site = siteUrl();
const item = ({ path, label }) => ({ label, slug: pageSlug(path) });

export default defineConfig({
  outDir: './dist',
  site: site.origin,
  base: site.pathname.replace(/\/$/, '') || '/',
  integrations: [starlight({
    title: 'Seal',
    description: siteDescription,
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
