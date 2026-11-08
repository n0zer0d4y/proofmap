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
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  // double_eq_add is used by both double_double and double_mono: once in full, once as a link.
  await expect(tree.getByRole('button', { name: '↪ also used here' }).first()).toBeVisible();
  await tree.getByRole('button', { name: 'Double equals add', exact: true }).first().click();
  await expect(page.locator('.detail .fullname-text')).toHaveText('Fixture.double_eq_add');
  // Print mode: the outline becomes a document with statements; the chrome is hidden. The
  // statements are made for printing only (Print / PDF, or the browser's own print).
  await page.evaluate(() => (window.print = () => undefined));
  await page.getByRole('button', { name: 'Print / PDF' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.header')).toBeHidden();
  await expect(tree.locator('.print-only .signature').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('outline: printing gives the whole outline at full page width, not the visible window', async ({ page }) => {
  // A short window, so the expanded outline is taller than the screen.
  await page.setViewportSize({ width: 1000, height: 360 });
  await page.goto(`${fixtureUrl}#/outline`);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await page.evaluate(() => (window.print = () => undefined));
  await page.getByRole('button', { name: 'Print / PDF' }).click();
  await page.emulateMedia({ media: 'print' });
  const tree = page.getByRole('tree', { name: 'Outline of the main results' });
  await expect(tree.locator('.print-only .signature').first()).toBeVisible();
  const layout = await tree.evaluate((el) => {
    // Every box around the outline grows with it: none of them clips or scrolls its content.
    const clipping: string[] = [];
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowY !== 'visible' && a.scrollHeight > a.clientHeight + 1) clipping.push(`${a.tagName}.${a.className}`);
    }
    const rows = el.querySelectorAll('[role="treeitem"]');
    return {
      clipping,
      treeWidth: el.getBoundingClientRect().width,
      pageWidth: document.documentElement.clientWidth,
      lastRowBottom: rows[rows.length - 1]!.getBoundingClientRect().bottom + window.scrollY,
      docHeight: document.documentElement.scrollHeight,
      detail: [...document.querySelectorAll('[data-panel]')].map((p) => p.getBoundingClientRect().width),
    };
  });
  expect(layout.clipping).toEqual([]);
  expect(layout.lastRowBottom).toBeGreaterThan(360);
  expect(layout.lastRowBottom).toBeLessThanOrEqual(layout.docHeight + 1);
  // The outline takes the page's width; the details panel leaves no empty column.
  expect(layout.treeWidth).toBeGreaterThan(layout.pageWidth * 0.9);
  expect(layout.detail.filter((w) => w > 0)).toHaveLength(1);
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
  await expect(stat('Complete')).toHaveText(String(visible.filter((d) => !d.status.sorry && !d.status.nonstandardAxioms.length).length));
  await expect(stat('Has sorry')).toHaveText(String(visible.filter((d) => d.status.sorry).length));
  await expect(stat('Extra axioms')).toHaveText(String(visible.filter((d) => d.status.nonstandardAxioms.length).length));
  await expect(page.getByRole('region', { name: 'Where the sorry is' })).toContainText('Fixture.unfinished: 2 results rest on it');
  await expect(page.getByRole('region', { name: 'Axioms' })).toContainText('Fixture.customAxiom');
  await expect(page.getByRole('meter').first()).toBeVisible();
});

test('guided tour visits the outline in order', async ({ page }) => {
  // Every step of the tour (22 on the fixture), each with a layout: longer than the default limit
  // when the machine is busy.
  test.setTimeout(120_000);
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
  // The first layout can take longer than the default wait on a loaded machine (WebKit).
  await expect(page.locator('[data-decl="Fixture.main_result"]')).toBeVisible({ timeout: 15_000 });
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

test('long names in lists wrap instead of being cut to an ellipsis, on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`${fixtureUrl}#/health`);
  await page.getByRole('button', { name: /Results and definitions/ }).click();
  const names = page.locator('.health .decl-list .linklike');
  await expect(names.first()).toBeVisible();
  // Every name lies wholly inside its row (a row that clips would hide it behind an ellipsis).
  const cut = await names.evaluateAll((els) =>
    els
      .filter((e) => {
        const r = e.getBoundingClientRect(), row = e.closest('li')!.getBoundingClientRect();
        return r.width < 8 || r.right > row.right + 1 || e.scrollWidth > e.clientWidth + 1;
      })
      .map((e) => e.textContent),
  );
  expect(cut).toEqual([]);
});
