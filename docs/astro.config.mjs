import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import navigation from './navigation.json' with { type: 'json' };
import { pageSlug, siteDescription } from './prepare-content.mjs';
import { siteUrl } from './site-url.mjs';

const site = siteUrl();
const item = ({ path, label, anchor }) => anchor
  ? { label, link: `/${pageSlug(path)}/#${anchor}` }
  : { label, slug: pageSlug(path) };

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

const sidebarGroup = (group) => ({
  label: group.label,
  collapsed: group.collapsed ?? true,
  items: [...group.pages.map(item), ...(group.groups ?? []).map(sidebarGroup)],
});

export default defineConfig({
  // Astro's JSX whitespace mode drops line breaks beside inline elements.
  // Preserve HTML whitespace so wrapped prose keeps its word boundaries.
  compressHTML: false,
  outDir: './dist',
  site: site.origin,
  base: site.pathname.replace(/\/$/, '') || '/',
  integrations: [starlight({
    title: 'Seal',
    favicon: '/favicon.png',
    description: siteDescription,
    components: { Header: './src/components/Header.astro', Hero: './src/components/Hero.astro' },
    customCss: ['./src/styles/custom.css'],
    sidebar: sidebarGroups.map(sidebarGroup),
  })],
});
