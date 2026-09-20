// SPDX-License-Identifier: Apache-2.0
// Setup: npm ci && npx playwright install chromium (in docs/).
// Run after npm run build: npm run test:browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.env.SEAL_DOCS_DIST || new URL('./dist', import.meta.url).pathname);
test('approval illustration holds, forwards once, and refuses replay in Chromium', async () => {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/seal/, '');
    const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
    if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1280, 390]) for (const reducedMotion of ['no-preference', 'reduce']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion, colorScheme: 'dark' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/seal/`);
      const card = page.locator('[data-approval-demo]');
      assert.equal(await card.count(), 1, 'interactive approval card exists');
      for (const name of ['Docs', 'Guarantees & limits', 'GitHub']) {
        assert.equal(await page.getByRole('navigation', { name: 'Global' }).getByRole('link', { name, exact: true }).isVisible(), true, `navigation: ${name}`);
      }
      const args = card.locator('pre');
      const status = card.locator('[role="status"]');
      const check = async count => {
        assert.equal(await args.isVisible(), true, 'arguments remain visible');
        assert.deepEqual(JSON.parse(await args.innerText()), { path: './drafts/old-notes.md' });
        const box = await args.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, 'arguments fit viewport');
        assert.match(await status.innerText(), new RegExp(`Calls forwarded: ${count}\\.`));
        assert.equal(await status.getAttribute('aria-live'), 'polite');
      };
      await check(0);
      // All transitions use the keyboard, including focus after a disappearing control.
      const approve = card.getByRole('button', { name: 'Approve once', exact: true });
      await approve.focus();
      await page.keyboard.press('Enter');
      await check(1);
      assert.equal(await card.getByRole('button', { name: 'Replay the approval' }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      await check(1);
      assert.match(await status.innerText(), /Replay refused.*BLOCK/s);
      assert.equal(await card.getByRole('button', { name: 'Reset', exact: true }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      await check(0);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await check(0);
      assert.match(await status.innerText(), /Declined/);
      await page.keyboard.press('Enter');
      await check(0);
      await card.getByRole('button', { name: 'Approve once', exact: true }).click();
      await check(1);
      await card.getByRole('button', { name: 'Replay the approval' }).click();
      await check(1);
      assert.match(await status.innerText(), /Replay refused.*BLOCK/s);
      await card.getByRole('button', { name: 'Reset', exact: true }).click();
      await check(0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
      assert.deepEqual(errors, []);
      if (process.env.SEAL_SCREENSHOT_PREFIX) {
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
        await page.screenshot({ path: `${process.env.SEAL_SCREENSHOT_PREFIX}-${width}-${reducedMotion}.png`, fullPage: true });
        console.log(JSON.stringify({ width, reducedMotion, linkedSentences: await page.locator('main p:has(a)').allInnerTexts() }));
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
