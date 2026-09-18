import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import navigation from './navigation.json' with { type: 'json' };
import { pageSlug, siteDescription } from './prepare-content.mjs';
import { siteUrl } from './site-url.mjs';

const site = siteUrl();
const item = ({ path, label }) => ({ label, slug: pageSlug(path) });

// The Starlight sidebar is reader-facing presentation: it groups pages by task
// (spec section 5) using navigation.json's "presentation" field when present.
// The chain-of-custody structure that drives Previous/Up/Next footers
// (navigation.root / navigation.sections / navigation.exceptions, enforced by
// test/docs-navigation.test.mjs) is untouched by this grouping, so relabelling
// or regrouping the sidebar here can never remove an exception page's checks.
const sidebarGroups = navigation.presentation ?? navigation.sections.map((section) => ({
  label: section.name,
  pages: section.pages,
}));

export default defineConfig({
  outDir: './dist',
  site: site.origin,
  base: site.pathname.replace(/\/$/, '') || '/',
  integrations: [starlight({
    title: 'Seal',
    description: siteDescription,
    components: { Header: './src/components/Header.astro' },
    customCss: ['./src/styles/custom.css'],
    sidebar: [
      item(navigation.root),
      ...sidebarGroups.map((group) => ({
        label: group.label,
        items: group.pages.map(item),
      })),
    ],
  })],
});
