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

/** The version badge changes every release; mask it so releases don't change the screenshots. */
const unversioned = (page) => [page.locator('#sidebar .ver')];

const PAGES = ['overview', 'system', 'map', 'rules', 'changes', 'modules', 'module:services'];

test.describe('every page renders and matches its screenshot', () => {
  for (const hash of PAGES) {
    test(`demo · ${hash}`, async ({ page }) => {
      await open(page, 'demo', hash);
      await expect(page.locator('.page.active')).toBeVisible();
      await expect(page).toHaveScreenshot(`demo-${hash.replace(':', '-')}.png`, { mask: unversioned(page) });
    });
  }
  for (const [hash, tabs, view] of [['map', '#map-kind-tabs', 'Matrix'], ['map', '#map-kind-tabs', 'Radial'], ['system', '#arch-kind-tabs', 'Tiers'], ['system', '#arch-kind-tabs', 'Matrix']]) {
    test(`demo · ${hash} as ${view}`, async ({ page }) => {
      await open(page, 'demo', hash);
      await page.locator(`${tabs} button`, { hasText: view }).click();
      await expect(page.locator(hash === 'map' ? '#map-alt' : '#arch-alt')).toBeVisible();
      await expect(page).toHaveScreenshot(`demo-${hash}-${view.toLowerCase()}.png`, { mask: unversioned(page) });
    });
  }
  test('loops repo · only the imports that close the loop stand out', async ({ page }) => {
    await open(page, 'loops', 'map');
    await expect(page.locator('#map-svg .edge.warnv path.line')).toHaveCount(4); // gmp, lib, registrars → (root) and one side of (root) ↔ routes
    await expect(page.locator('#map-svg .edge.viol')).toHaveCount(0);
    await expect(page).toHaveScreenshot('loops-map.png', { mask: unversioned(page) });
  });
  test('big repo · architecture diagram', async ({ page }) => {
    await open(page, 'big', 'system');
    await expect(page.locator('#arch-svg .an')).toHaveCount(4 + 6 + 11 + 1); // apps, stores, outside systems, users
    await expect(page).toHaveScreenshot('big-system.png', { mask: unversioned(page) });
  });
});

test.describe('interactions', () => {
  test('number keys switch pages and the palette finds files', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcuts');
    await open(page, 'demo', 'overview');
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/#system$/);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette input')).toBeFocused(); // it focuses a moment after opening
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

  test('diagram kinds: remembered after a reload, and their cells open the details', async ({ page }) => {
    await open(page, 'demo', 'map');
    await page.locator('#map-kind-tabs button', { hasText: 'Matrix' }).click();
    // components → db is a new rule break: its cell is marked and opens the dependency in the side panel
    const cell = page.locator('.dsm td[aria-label="components imports db"]');
    await expect(cell).toHaveClass(/\bviol\b/);
    await cell.click();
    await expect(page.locator('#drawer')).toHaveClass(/open/);
    await expect(page.locator('#drawer h3')).toContainText('components');
    await page.reload();
    await expect(page.locator('#map-card')).toHaveAttribute('data-kind', 'matrix');
    await page.locator('#map-kind-tabs button', { hasText: 'Graph' }).click();
    await expect(page.locator('#map-card')).not.toHaveClass(/alt-on/);

    await page.goto(page.url().replace(/#.*$/, '#system'));
    await page.locator('#arch-kind-tabs button', { hasText: 'Matrix' }).click();
    await page.locator('.amx td[title^="server → Redis"]').click();
    await expect(page.locator('#sheet')).toHaveClass(/open/);
    await expect(page.locator('#sheet h3')).toHaveText('Redis');
  });

  test('Simple detail: names and arrows only, on both diagrams, remembered', async ({ page }) => {
    await open(page, 'demo', 'map');
    await page.locator('#map-float .detail-tabs button', { hasText: 'Simple' }).click();
    await expect(page.locator('#map-svg .node[aria-label="npm:pg"]')).toBeHidden();
    await expect(page.locator('#map-svg .lbl').first()).toBeHidden();
    await expect(page.locator('#map-svg .node[aria-label="db"]')).toBeVisible();
    await page.goto(page.url().replace(/#.*$/, '#system'));
    await expect(page.locator('#page-system .detail-tabs button[aria-pressed="true"]')).toHaveText('Simple');
    await expect(page.locator('#arch-svg .an[data-node="server"] .an-simple')).toBeVisible();
    await expect(page.locator('#arch-svg .an[data-node="server"] .an-full')).toBeHidden();
    await expect(page.locator('#arch-svg .aw-lbl').first()).toBeHidden();
    await expect(page).toHaveScreenshot('demo-system-simple.png', { mask: unversioned(page) });
  });

  test('architecture tiers: Before hides what the branch added', async ({ page }) => {
    await open(page, 'demo', 'system');
    await page.locator('#arch-kind-tabs button', { hasText: 'Tiers' }).click();
    await expect(page.locator('.tile[data-id="svc:stripe"]')).toHaveClass(/s-added/);
    await page.locator('.sys-tabs button', { hasText: 'Before' }).click();
    await expect(page.locator('.tile[data-id="svc:stripe"]')).toHaveCount(0);
  });

  test('rule checks list both new breaks', async ({ page }) => {
    await open(page, 'demo', 'rules');
    await expect(page.locator('#page-rules')).toContainText('UI must not touch the database');
    await expect(page.locator('#page-rules')).toContainText('lib stays dependency-free');
  });
});
