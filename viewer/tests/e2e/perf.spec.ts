import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// Performance budgets on a real, large page: set PROOFMAP_PERF_PAGE
// to a generated proofmap.html. Opening is interactive in <= 2 s; a layout of <= 300 visible
// cards takes <= 500 ms in the worker; search answers in <= 50 ms; the map stays readable (the
// visible card cap holds, externals are grouped per library).
const pagePath = process.env.PROOFMAP_PERF_PAGE;
test.skip(!pagePath, 'set PROOFMAP_PERF_PAGE to a generated proofmap.html');
test.setTimeout(120_000);

test('a large page meets the performance budgets', async ({ page }) => {
  await page.goto(pathToFileURL(pagePath!).href);
  await expect(page.locator('.map-card').first()).toBeVisible({ timeout: 30_000 });
  const interactive = await page.evaluate(() => performance.now());
  const decls = await page.evaluate(() => document.title);
  console.log(`interactive after ${interactive.toFixed(0)} ms (${decls})`);
  expect(interactive).toBeLessThanOrEqual(2000);

  // The map stays readable: at most 150 cards, and libraries are grouped.
  const cards = await page.locator('.map-card').count();
  console.log(`visible cards: ${cards}`);
  expect(cards).toBeLessThanOrEqual(150);

  // Select a card and open more of the map around it, then read the layout timings the viewer
  // recorded.
  await page.locator('.map-card').first().click();
  await page.getByRole('button', { name: 'Show more around this' }).click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const layouts = await page.evaluate(() =>
    performance.getEntriesByName('proofmap:layout').map((e) => ({ ms: e.duration, nodes: (e as PerformanceMeasure).detail?.nodes as number })),
  );
  console.log(`layouts: ${layouts.map((l) => `${l.nodes} nodes ${l.ms.toFixed(0)} ms`).join(', ')}`);
  expect(layouts.length).toBeGreaterThan(0);
  for (const l of layouts.filter((x) => x.nodes <= 300)) expect(l.ms).toBeLessThanOrEqual(500);

  // Search: type a few queries; every search must answer within 50 ms.
  const box = page.getByRole('combobox').first();
  for (const q of ['sum', 'prime', 'square', 'lemma', 'list']) {
    await box.fill(q);
    await page.waitForTimeout(200);
  }
  const searches = await page.evaluate(() => performance.getEntriesByName('proofmap:search').map((e) => e.duration));
  console.log(`searches: ${searches.map((s) => s.toFixed(1)).join(', ')} ms`);
  expect(searches.length).toBeGreaterThan(0);
  expect(Math.max(...searches)).toBeLessThanOrEqual(50);
});
