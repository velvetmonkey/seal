// SPDX-License-Identifier: Apache-2.0
// CLAIM-COVERAGE: docs/src/components/ApprovalIllustration.astro#recorded-demo
// Setup: npm ci && npx playwright install chromium (in docs/).
// Run after npm run build: npm run test:browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.env.SEAL_DOCS_DIST || new URL('./dist', import.meta.url).pathname);
const fixture = await readFile(new URL('../test/fixtures/readme-demo-output.txt', import.meta.url), 'utf8');
const demoDirectory = fixture.split('demo directory: ')[1].split(' (remains')[0];
const recorded = fixture.replaceAll(demoDirectory, '<demo>');
test('recorded demo shows child counts 0, 1, 1 and its BLOCK receipt in Chromium', async () => {
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
      assert.match(await card.locator('figcaption').innerText(), /A recorded run of v0.4.0/);
      assert.equal(await card.locator('a').getAttribute('href'), 'https://github.com/velvetmonkey/seal/blob/v0.4.0/test/fixtures/readme-demo-output.txt');
      const args = card.locator('[data-arguments]');
      const status = card.locator('[role="status"]');
      const check = async count => {
        assert.equal(await args.isVisible(), true, 'arguments remain visible');
        assert.deepEqual(JSON.parse(await args.innerText()), { line: 'seal demo wrote this line' });
        const box = await args.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, 'arguments fit viewport');
        assert.match(await status.innerText(), new RegExp(`Child calls observed: ${count}\\.`));
        for (const line of (await card.locator('[data-transcript]').innerText()).split('\n')) {
          assert.ok(recorded.includes(line), `excerpt comes from the fixture: ${line}`);
        }
        assert.equal(await card.getByText('Viewing controls only; nothing here runs Seal.', { exact: true }).isVisible(), true);
        assert.equal(await status.getAttribute('aria-live'), 'polite');
      };
      await check(0);
      // All transitions use the keyboard, including focus after a disappearing control.
      const approve = card.getByRole('button', { name: 'View approval', exact: true });
      await approve.focus();
      await page.keyboard.press('Enter');
      await check(1);
      assert.equal(await card.getByRole('button', { name: 'View replay' }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      await check(1);
      assert.match(await status.innerText(), /BLOCKED.*verdict BLOCK/s);
      assert.match(await status.innerText(), /one-use held:.*child calls observed: still 1/s);
      assert.match(await status.innerText(), /receipt written: <demo>\/receipts\/receipt-1788547290172-3933287-0003-BLOCK\.json/);
      assert.equal(await card.getByRole('button', { name: 'Reset view', exact: true }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      await check(0);
      await card.getByRole('button', { name: 'View approval', exact: true }).click();
      await check(1);
      await card.getByRole('button', { name: 'View replay' }).click();
      await check(1);
      assert.match(await status.innerText(), /BLOCKED.*verdict BLOCK/s);
      assert.match(await status.innerText(), /one-use held:.*child calls observed: still 1/s);
      assert.match(await status.innerText(), /receipt written: <demo>\/receipts\/receipt-1788547290172-3933287-0003-BLOCK\.json/);
      await card.getByRole('button', { name: 'Reset view', exact: true }).click();
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
