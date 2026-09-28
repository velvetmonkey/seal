#!/usr/bin/env python3
"""Check the rendered sidebar, independently of the navigation configuration."""
from html.parser import HTMLParser
from pathlib import Path
import json
import os
import unittest
from urllib.parse import urljoin, urlsplit, unquote


class Sidebar(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.active = False
        self.depth = 0
        self.entries = []
        self.capture = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'sl-sidebar-state-persist':
            self.active = True
        if not self.active:
            return
        if tag == 'details':
            self.depth += 1
            self.open = 'open' in attrs
        if tag in ('summary', 'a'):
            self.capture = {'kind': tag, 'depth': self.depth, 'label': '',
                            'href': attrs.get('href'), 'open': getattr(self, 'open', False)}

    def handle_data(self, data):
        if self.active and self.capture is not None:
            self.capture['label'] += data

    def handle_endtag(self, tag):
        if not self.active:
            return
        if self.capture is not None and tag == self.capture['kind']:
            self.capture['label'] = self.capture['label'].strip()
            self.entries.append(self.capture)
            self.capture = None
        if tag == 'details':
            self.depth -= 1
        if tag == 'sl-sidebar-state-persist':
            self.active = False


class Pagination(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a':
            for direction in ('next', 'prev'):
                if direction in attrs.get('rel', '').split():
                    self.links.append((direction, attrs.get('href', '')))


# Captured from the live/baseline built sidebar at main 94e9b5de7abe57fe2a4d5a89b796f0b4dd96fc85.
# Deliberately independent of navigation.json so deleting a configured page fails.
BEFORE_ROUTES = set(json.loads('''[
  "/assurance/architecture/",
  "/assurance/claude-code-evidence/",
  "/assurance/current-scope/",
  "/assurance/distribution/",
  "/assurance/evaluator-start/",
  "/assurance/release-notes-v040/",
  "/assurance/version-identity/",
  "/assure/",
  "/assure/adequacy/",
  "/assure/ci/",
  "/assure/configure/",
  "/assure/conformance/",
  "/assure/receipt-diff/",
  "/assure/reference/",
  "/assure/reference/schemas/",
  "/assure/reference/verify-profiles/",
  "/assure/scan/",
  "/assure/start/",
  "/assure/verify/",
  "/check/",
  "/check/formats/",
  "/check/from-seal/",
  "/check/keys-and-sharing/",
  "/check/reference/",
  "/check/results/",
  "/check/run-locally/",
  "/check/your-first-receipt/",
  "/concepts/",
  "/concepts/approval/",
  "/concepts/decision-and-effect/",
  "/concepts/gate/",
  "/concepts/glossary/",
  "/concepts/replay-and-trust/",
  "/documentation-map/",
  "/evidence/",
  "/evidence/conformance/",
  "/evidence/correspondence/",
  "/evidence/dependencies/",
  "/evidence/proofs/",
  "/evidence/sources/",
  "/guide/choosing-what-to-protect/",
  "/guide/first-approval/",
  "/guide/github-actions-provenance/",
  "/guide/knowing-it-worked/",
  "/guide/lifecycle/",
  "/guide/what-is-protected-right-now/",
  "/guide/when-something-looks-wrong/",
  "/reference/cli/",
  "/reference/multi-tool-semantics/",
  "/reference/receipt-operations-v1/",
  "/reference/receipt-operations/",
  "/reproduce/",
  "/seal-receipt-v2/",
  "/start/",
  "/start/evaluator-walk/",
  "/start/install/",
  "/verify/",
  "/verify/browser/",
  "/verify/cli/"
]'''))
# Ruling 2026-09-20: this one exact anchor entry may share Install's page.
DUPLICATE_PAGE_ALLOWLIST = {'/start/install/#run-the-harmless-approve-once-demo'}
FIRST_USE = [
    ('Install', '/start/install/'),
    ('Harmless demo', '/start/install/#run-the-harmless-approve-once-demo'),
    ('Protect a real tool', '/guide/choosing-what-to-protect/'),
]
GROUPS = ['Get started', 'Use Seal', 'Check receipts', 'Reference', 'Assurance']


class BuiltSidebarTest(unittest.TestCase):
    def test_pagination_leaves_page(self):
        site = os.environ.get('SITE_URL', 'https://velvetmonkey.github.io/seal/')
        dist = Path(__file__).parent / 'dist'
        files = sorted(dist.rglob('*.html'))
        self.assertTrue(files, 'Build the documentation first')
        checked_links = 0
        for file in files:
            relative = file.relative_to(dist).as_posix()
            route = relative.removesuffix('index.html') if relative.endswith('index.html') else relative
            current = urljoin(site, route)
            for direction, href in Pagination(file.read_text()).links:
                checked_links += 1
                with self.subTest(page=relative, direction=direction, href=href):
                    self.assertNotEqual(
                        unquote(urlsplit(urljoin(current, href)).path).rstrip('/'),
                        unquote(urlsplit(current).path).rstrip('/'),
                        'Pagination must leave the current page')
        print(f'Pagination checked {len(files)} pages and {checked_links} links', flush=True)
        self.assertGreater(checked_links, 0, 'Expected rendered pagination links')

    def test_next_walk(self):
        site = os.environ.get('SITE_URL', 'https://velvetmonkey.github.io/seal/')
        base = urlsplit(site).path.rstrip('/')
        dist = Path(__file__).parent / 'dist'
        sidebar = Sidebar((dist / 'start/install/index.html').read_text())
        expected = ['/'] + [urlsplit(e['href']).path.removeprefix(base)
                            for e in sidebar.entries if e['kind'] == 'a'
                            and e['href'].removeprefix(base) not in DUPLICATE_PAGE_ALLOWLIST]
        walked = []
        route = '/'
        while True:
            self.assertNotIn(route, walked, 'Next must not loop')
            walked.append(route)
            file = dist / route.lstrip('/') / 'index.html'
            self.assertTrue(file.is_file(), f'Next destination missing: {route}')
            links = dict(Pagination(file.read_text()).links)
            if 'next' not in links:
                break
            route = urlsplit(urljoin(site, links['next'])).path.removeprefix(base)
        self.assertEqual(walked, expected, 'Next must visit every sidebar page in order')
        install = dict(Pagination((dist / 'start/install/index.html').read_text()).links)
        protect = dict(Pagination((dist / 'guide/choosing-what-to-protect/index.html').read_text()).links)
        self.assertEqual(urlsplit(install['next']).path.removeprefix(base),
                         '/guide/choosing-what-to-protect/')
        self.assertEqual(urlsplit(protect['prev']).path.removeprefix(base), '/start/install/')
        print(f'Next walk: {len(walked)} pages; ends at {walked[-1]}', flush=True)

    def test_built_sidebars(self):
        base = urlsplit(os.environ.get('SITE_URL', 'https://velvetmonkey.github.io/seal/')).path.rstrip('/')
        files = list((Path(__file__).parent / 'dist').rglob('*.html'))
        self.assertTrue(files, 'Build the documentation first')
        checked = 0
        for file in files:
            sidebar = Sidebar(file.read_text())
            if not sidebar.entries:
                continue  # The homepage deliberately uses Starlight's splash template.
            checked += 1
            with self.subTest(page=str(file)):
                groups = [e for e in sidebar.entries if e['kind'] == 'summary' and e['depth'] == 1]
                self.assertEqual([e['label'] for e in groups], GROUPS)
                links = [e for e in sidebar.entries if e['kind'] == 'a']
                routes = [urlsplit(e['href']).path.removeprefix(base) for e in links]
                self.assertEqual(set(routes), BEFORE_ROUTES, 'Reachable page URLs changed')
                hrefs = [e['href'].removeprefix(base) for e in links]
                self.assertEqual(len(hrefs), len(set(hrefs)), 'An exact sidebar entry appears twice')
                self.assertEqual(set(hrefs) & DUPLICATE_PAGE_ALLOWLIST, DUPLICATE_PAGE_ALLOWLIST,
                                 'The sole allowed demo anchor must appear exactly once')
                unique_routes = [route for route, href in zip(routes, hrefs)
                                 if href not in DUPLICATE_PAGE_ALLOWLIST]
                self.assertEqual(len(unique_routes), len(set(unique_routes)),
                                 'A page appears twice outside the exact demo-anchor allowlist')
                self.assertTrue(all(e['depth'] >= 1 for e in links), 'Ungrouped page')
                self.assertEqual([(e['label'], href) for e, href in zip(links[:3], hrefs[:3])], FIRST_USE)
                # Starlight opens the current page's ancestors even when collapsed by default.
                current = '/' + file.parent.relative_to(Path(__file__).parent / 'dist').as_posix() + '/'
                if current == '/start/install/':
                    self.assertEqual([e['open'] for e in groups], [True, False, False, False, False])
        self.assertGreater(checked, 1, 'Expected ordinary documentation pages with sidebars')


if __name__ == '__main__':
    unittest.main()
