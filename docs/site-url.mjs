export const DEFAULT_SITE_URL = 'https://velvetmonkey.github.io/seal/';

export function siteUrl(value = process.env.SITE_URL) {
  const supplied = value || DEFAULT_SITE_URL;
  const site = new URL(supplied);
  if (!['http:', 'https:'].includes(site.protocol) || site.search || site.hash || site.username ||
      site.pathname.includes('//') || site.pathname.split('/').some((part) => part === '.' || part === '..') ||
      decodeURI(site.pathname) !== site.pathname) {
    throw new Error(`SITE_URL must be an absolute HTTP(S) site address with a plain base path, not ${JSON.stringify(value)}`);
  }
  if (!site.pathname.endsWith('/')) site.pathname += '/';
  return site;
}
