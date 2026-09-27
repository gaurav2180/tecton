/// <reference lib="dom" />
// The report in a real browser: every page renders without script errors and looks as it did
// (screenshot baselines per platform and project), and the main interactions work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';

const FIXTURES = path.join(os.tmpdir(), 'tecton-ui-fixtures');
const reportUrl = (name) => pathToFileURL(path.join(FIXTURES, `${name}.html`)).href;
const generatedAt = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')).generatedAt;

/** Open a report page with the clock pinned to when it was generated ("Generated just now" stays put). */
async function open(page, name, hash) {
  await page.clock.setFixedTime(new Date(generatedAt(name)));
  await page.goto(`${reportUrl(name)}#${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

let errors;
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
});
test.afterEach(() => { expect(errors, 'script errors on the page').toEqual([]); });

const PAGES = ['overview', 'system', 'map', 'rules', 'changes', 'modules', 'module:services'];

test.describe('every page renders and matches its screenshot', () => {
  for (const hash of PAGES) {
    test(`demo · ${hash}`, async ({ page }) => {
      await open(page, 'demo', hash);
      await expect(page.locator('.page.active')).toBeVisible();
      await expect(page).toHaveScreenshot(`demo-${hash.replace(':', '-')}.png`);
    });
  }
  test('big repo · architecture diagram', async ({ page }) => {
    await open(page, 'big', 'system');
    await expect(page.locator('#arch-svg .an')).toHaveCount(4 + 6 + 11 + 1); // apps, stores, outside systems, users
    await expect(page).toHaveScreenshot('big-system.png');
  });
});

test.describe('interactions', () => {
  test('number keys switch pages and the palette finds files', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcuts');
    await open(page, 'demo', 'overview');
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/#system$/);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('stripe.ts');
    await expect(page.locator('.pal-item.on')).toContainText('src/payments/stripe.ts');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#module:payments$/);
    await expect(page.locator('#sheet')).toHaveClass(/open/);
    await expect(page.locator('#sheet h3')).toHaveText('stripe.ts');
  });

  test('map: "Only touched" keeps edited modules and their neighbours', async ({ page }) => {
    await open(page, 'demo', 'map');
    await page.locator('#touched-sw').check();
    await expect(page.locator('#map-svg .node[aria-label="components"]')).not.toHaveClass(/\bdim\b/);
    await expect(page.locator('#map-svg .node[aria-label="db"]')).not.toHaveClass(/\bdim\b/);
    await expect(page.locator('#map-svg .node[aria-label="components"]')).toHaveClass(/\btouched\b/);
    await expect(page.locator('#map-svg .node[aria-label="npm:pg"]')).toHaveClass(/\bdim\b/); // only linked to db, which is untouched
  });

  test('architecture: hover traces an app, Before hides what the branch added', async ({ page, isMobile }) => {
    await open(page, 'demo', 'system');
    if (!isMobile) {
      await page.locator('#arch-svg .an[data-node="."]').hover();
      await expect(page.locator('#arch-card')).toHaveClass(/hl-on/);
      await expect(page.locator('#arch-svg .an[data-node="svc:stripe"]')).toHaveClass(/\bhl\b/);
      await expect(page.locator('#arch-svg .an[data-node="store:redis"]')).not.toHaveClass(/\bhl\b/);
      await page.mouse.move(5, 5);
    }
    await expect(page.locator('#arch-svg .an[data-node="svc:stripe"]')).toHaveClass(/\badded\b/);
    await page.locator('.sys-tabs button', { hasText: 'Before' }).click();
    await expect(page.locator('#arch-svg .an[data-node="svc:stripe"]')).toHaveClass(/\bgone\b/);
    await page.locator('#arch-svg .an[data-node="server"]').click();
    await expect(page.locator('#sheet')).toHaveClass(/open/);
    await expect(page.locator('#sheet')).toContainText('HTTP endpoints');
  });

  test('module page: a file opens its imports, a neighbour module opens its page', async ({ page }) => {
    await open(page, 'demo', 'module:services');
    await page.locator('#fmap .node', { hasText: 'cart.ts' }).click();
    await expect(page.locator('#sheet')).toHaveClass(/open/);
    await expect(page.locator('#sheet')).toContainText('src/payments/stripe.ts');
    await page.locator('#sheet button[aria-label="Close"]').click(); // on phones the panel covers the page
    await expect(page.locator('#sheet')).not.toHaveClass(/open/);
    await page.locator('#fmap .node.external', { hasText: 'payments' }).click();
    await expect(page).toHaveURL(/#module:payments$/);
  });

  test('rule checks list both new breaks', async ({ page }) => {
    await open(page, 'demo', 'rules');
    await expect(page.locator('#page-rules')).toContainText('UI must not touch the database');
    await expect(page.locator('#page-rules')).toContainText('lib stays dependency-free');
  });
});
