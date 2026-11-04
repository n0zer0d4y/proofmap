import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { buildIndexes } from '../../src/data/indexes';
import type { ProofmapData } from '../../src/data/schema';
import { tourSteps } from '../../src/graph/outline';
import { fixtureUrl } from './helpers';

// Outline, path finder, health, tour, export.

const data = JSON.parse(readFileSync(new URL('../fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
const ix = buildIndexes(data);
const visible = data.decls.filter((d) => !d.external && !d.flags.some((f) => f.startsWith('noise:')));

test('outline: roots, expansion, "also used here", selection, print mode', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/outline`);
  const tree = page.getByRole('tree', { name: 'Outline of the main results' });
  const rootTitles = data.project.roots.map((r) => data.decls[r]!.title);
  for (const t of rootTitles) await expect(tree.getByRole('button', { name: t, exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand all' }).click();
  // double_eq_add is used by both double_double and double_mono: once in full, once as a link.
  await expect(tree.getByRole('button', { name: '↪ also used here' }).first()).toBeVisible();
  await tree.getByRole('button', { name: 'Double equals add', exact: true }).first().click();
  await expect(page.locator('.detail .fullname-text')).toHaveText('Fixture.double_eq_add');
  // Print mode: the outline becomes a document with statements; the chrome is hidden.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.header')).toBeHidden();
  await expect(tree.locator('.print-only .signature').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('path finder: shortest chain in plain words and a filtered map', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/paths?from=Fixture.double_eq_add&to=Fixture.main_result`);
  const summary = page.getByRole('region', { name: 'Shortest chain' });
  await expect(summary).toContainText('Shortest chain (2 steps)');
  await expect(summary.locator('li').first()).toContainText(/Double equals add is used in the proof of (Double double|Double monotone)/);
  // The canvas shows exactly the declarations on the chains.
  await expect(page.locator('.paths-canvas .map-card')).toHaveCount(4);
  // Reversed: no chain, with an offer to swap.
  await page.getByRole('button', { name: 'Swap from and to' }).click();
  await expect(page.getByText('does not rest on')).toBeVisible();
  await page.getByRole('button', { name: 'swap', exact: true }).click();
  await expect(summary).toBeVisible();
});

test('health numbers match the extracted data', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/health`);
  const counts = page.getByRole('region', { name: 'Counts' });
  // Match a stat by the start of its label (glossary hover cards inside labels contain other words).
  const stat = (label: string) =>
    counts.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: new RegExp('^' + label) }) }).locator('.stat-value');
  await expect(stat('Results and definitions')).toHaveText(String(visible.length));
  await expect(stat('Without sorry or extra axioms')).toHaveText(String(visible.filter((d) => !d.status.sorry && !d.status.nonstandardAxioms.length).length));
  await expect(stat('Contain sorry')).toHaveText(String(visible.filter((d) => d.status.sorry).length));
  await expect(stat('Extra axioms')).toHaveText(String(visible.filter((d) => d.status.nonstandardAxioms.length).length));
  await expect(page.getByRole('region', { name: 'Unfinished proofs' })).toContainText('Fixture.unfinished: 2 results rest on it');
  await expect(page.getByRole('region', { name: 'Axioms' })).toContainText('Fixture.customAxiom');
  await expect(page.getByRole('meter').first()).toBeVisible();
});

test('guided tour visits the outline in order', async ({ page }) => {
  await page.goto(fixtureUrl);
  const expected = tourSteps(ix, data.project.roots).map((i) => data.decls[i]!.title);
  await page.getByRole('button', { name: 'Walk me through it' }).click();
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  for (let i = 0; i < expected.length; i++) {
    await expect(tour).toContainText(`Step ${i + 1} of ${expected.length}`);
    await expect(tour.locator('h3')).toContainText(expected[i]!);
    // The step's card is on the map and selected.
    await expect(page.locator('.map-card.selected')).toBeVisible();
    await tour.getByRole('button', { name: i + 1 < expected.length ? 'Next →' : 'Finish' }).click();
  }
  await expect(tour).toBeHidden();
});

test('export: the whole map as a real SVG and a PNG', async ({ page, browser }) => {
  await page.goto(`${fixtureUrl}#/map?theme=light`);
  await expect(page.locator('[data-decl="Fixture.main_result"]')).toBeVisible();
  await page.waitForTimeout(400);
  const titles = (await page.locator('.react-flow__node .card-title').allTextContents()).sort();
  const cards = await page.locator('.react-flow__node').count();
  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'SVG' }).click()]);
  const svg = readFileSync(await svgDl.path(), 'utf8');
  expect(svg.startsWith('<svg')).toBe(true);
  // Shapes and text only: vector editors and LaTeX cannot render HTML inside an SVG.
  expect(svg).not.toContain('foreignObject');
  // Every card of the map, not only those on screen.
  expect(svg.match(/<g>/g)?.length).toBe(cards);
  for (const t of titles) expect(svg).toContain(t.split(' ')[0]!);
  const view = await browser.newPage();
  await view.setContent(`<img id="x" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
  const size = await view.evaluate(() => new Promise<[number, number]>((r) => {
    const img = document.getElementById('x') as HTMLImageElement;
    const done = () => r([img.naturalWidth, img.naturalHeight]);
    if (img.complete) done(); else img.onload = done;
  }));
  expect(size[0]).toBeGreaterThan(200);
  expect(size[1]).toBeGreaterThan(100);
  await view.close();
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]);
  const png = readFileSync(await pngDl.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(pngDl.suggestedFilename()).toMatch(/^Fixture-map\.png$/);
});
