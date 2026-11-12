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
  const theorems = visible.filter((d) => d.kind === 'theorem');
  await expect(stat('Theorems')).toHaveText(String(theorems.length));
  await expect(stat('Definitions and types')).toHaveText(String(visible.filter((d) => d.kind !== 'theorem' && d.kind !== 'axiom').length));
  await expect(stat('Main results')).toHaveText(String(data.project.roots.filter((r) => visible.some((d) => d.id === r)).length));
  // Next to the theorem count: how many theorems are not proved (the fixture has unfinished ones).
  const withSorry = theorems.filter((d) => d.status.sorry).length;
  await expect(counts.locator('.stat', { has: page.locator('.stat-label', { hasText: /^Theorems/ }) }).locator('.stat-note')).toHaveText(`${withSorry} with sorry`);
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
  await page.getByRole('button', { name: /Theorems/ }).click();
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
  // A wrapped name keeps its status mark on its first line, and nothing in a row spills past it.
  const misplaced = await page.locator('.health .decl-list li').evaluateAll((rows) =>
    rows
      .filter((li) => {
        const mark = li.querySelector('.status'), name = li.querySelector('.decl-name .linklike, .linklike');
        if (!mark || !name) return false;
        // One box however many lines the name has: compare tops, against the mark's height (a line).
        const m = mark.getBoundingClientRect();
        return Math.abs(m.top - name.getBoundingClientRect().top) >= m.height || li.scrollWidth > li.clientWidth + 1;
      })
      .map((li) => li.textContent),
  );
  expect(misplaced).toEqual([]);
});

test('health tiles are one size, nothing in them is cut, and counts of one read in the singular', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/health`);
  const tiles = page.locator('.health-tiles .stat');
  await expect(tiles).toHaveCount(8);
  const boxes = await tiles.evaluateAll((els) =>
    els.map((e) => ({ w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), cut: [...e.querySelectorAll('.stat-top, .stat-label')].some((c) => c.scrollWidth > c.clientWidth + 1) })),
  );
  expect(new Set(boxes.map((b) => `${b.w}x${b.h}`)).size).toBe(1);
  expect(boxes[0]!.w).toBeGreaterThanOrEqual(136);
  expect(boxes.filter((b) => b.cut)).toEqual([]);
  // The definitions by kind: "1 structure", not "1 structures".
  await expect(page.locator('.kind-split')).toContainText('1 structure');
  await expect(page.locator('.kind-split')).not.toContainText('1 structures');
});

test('kind badges are coloured by kind, and the rank appears only when it adds something', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.Point`);
  const badges = page.getByRole('complementary', { name: 'Details' }).locator('.badges .badge');
  // A structure is a structure: no second "definition" badge.
  await expect(badges).toHaveCount(1);
  await expect(badges.first()).toHaveClass(/kind-structure/);
  const structure = await badges.first().evaluate((e) => getComputedStyle(e).color);
  // Map cards use the same badges, with the kind written out (the main result's map shows Double).
  await page.goto(`${fixtureUrl}#/map`);
  const card = page.locator('[data-decl="Fixture.double"]');
  await expect(card.locator('.card-foot .badge')).toHaveText('definition');
  const definition = await card.locator('.card-foot .badge').evaluate((e) => getComputedStyle(e).color);
  expect(definition).not.toBe(structure);
});

test('a list of one kind shows the kind once, by its heading; a mixed list shows it on each row', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/health`);
  await page.getByRole('button', { name: /Theorems/ }).click();
  const theorems = page.getByRole('region', { name: 'Theorems' });
  await expect(theorems.locator('h3 .badge')).toHaveText('theorem');
  await expect(theorems.locator('li .badge.kind-theorem')).toHaveCount(0);
  // Long names can wrap between their parts (after a dot or an underscore), not inside a word.
  expect(await theorems.locator('li .linklike wbr').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: /Definitions and types/ }).click();
  const defs = page.getByRole('region', { name: 'Definitions and types' });
  await expect(defs.locator('h3 .badge')).toHaveCount(0);
  expect(await defs.locator('li .badge[class*="kind-"]').count()).toBeGreaterThan(1);
});

test('top-10 lists keep the number, a wrapping name and its count on one row, even on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`${fixtureUrl}#/health`);
  const rows = page.getByRole('region', { name: 'Largest proofs' }).locator('.top-list > li');
  await expect(rows.first()).toBeVisible();
  const bad = await rows.evaluateAll((lis) =>
    lis
      .map((li) => {
        const name = li.querySelector('.linklike')!, count = li.querySelector('.muted')!;
        const n = name.getBoundingClientRect(), c = count.getBoundingClientRect();
        // The count sits beside the name's first line, and the name's text starts at its left edge.
        const sameRow = Math.abs(c.top - n.top) < 6;
        return sameRow && getComputedStyle(name).textAlign !== 'center' ? null : li.textContent;
      })
      .filter(Boolean),
  );
  expect(bad).toEqual([]);
});

test('a name two modules share shows its module wherever it is listed', async ({ page }) => {
  // Health's lists: the two ClashDemo.value_pos theorems are told apart by their modules.
  await page.goto(`${fixtureUrl}#/health`);
  await page.getByRole('button', { name: /Theorems/ }).click();
  const rows = page.getByRole('region', { name: 'Theorems' }).locator('li', { hasText: 'ClashDemo.value_pos' });
  await expect(rows).toHaveCount(2);
  expect((await rows.allTextContents()).map((t) => t.replace(/\u200b/g, '')).sort()).toEqual([
    expect.stringContaining('· Fixture.Clash.A'),
    expect.stringContaining('· Fixture.Clash.B'),
  ]);
  // The module follows the name in the same item, so the name keeps its width and stays one line.
  for (const row of await rows.all()) {
    await expect(row.locator('.decl-name .muted')).toHaveCount(1);
    expect(await row.locator('.decl-name .linklike').evaluate((e) => e.getClientRects().length)).toBe(1);
  }
  // A map card: the module's last part next to the name, the whole module in its tooltip.
  await page.goto(`${fixtureUrl}#/map/ClashDemo.value_pos~Fixture.Clash.B`);
  const name = page.locator('[data-decl="ClashDemo.value_pos"] .card-name').first();
  await expect(name).toContainText('· B');
  await expect(name).toHaveAttribute('title', 'ClashDemo.value_pos · Fixture.Clash.B');
});

test('declarations nothing uses show what names them, and whether they are private or simp lemmas', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/health`);
  const unused = page.getByRole('region', { name: 'Unused declarations' });
  const audited = unused.locator('li', { hasText: 'Fixture.double_two' });
  await expect(audited.locator('.badge', { hasText: 'simp' })).toHaveCount(1);
  await expect(audited.locator('.check-ref')).toHaveText('audited by #print axioms at Fixture/Tagged.lean:40');
  const checked = unused.locator('li', { hasText: 'Fixture.double_zero' });
  await expect(checked.locator('.badge', { hasText: 'private' })).toHaveCount(1);
  await expect(checked.locator('.check-ref')).toHaveText('type-checked by #check at Fixture/Basic.lean:75');
  // Entries nothing names have no mark.
  await expect(unused.locator('li', { hasText: 'Fixture.trickyChar' }).locator('.check-ref')).toHaveCount(0);
  // The details panel says the same.
  await audited.getByRole('button', { name: /Fixture\.double_two/ }).click();
  await expect(page.getByRole('complementary', { name: 'Details' }).locator('.checked-by')).toHaveText('Named by #print axioms at Fixture/Tagged.lean:40');
  // A long name in a row with notes wraps beside its status mark, not onto a line of its own.
  await page.setViewportSize({ width: 900, height: 800 });
  const row = (await audited.elementHandle())!;
  await row.evaluate((li) => (li.querySelector('.decl-name .linklike')!.textContent = 'Project.Section.Subsection.'.repeat(6) + 'a_declaration_name_longer_than_any_column'));
  const layout = await row.evaluate((li) => {
    // The name button is one box, however many lines it has: compare its top with the mark's,
    // against the mark's own height (one line).
    const mark = li.querySelector('.status')!.getBoundingClientRect();
    const name = li.querySelector('.decl-name .linklike')!.getBoundingClientRect();
    return { gap: Math.abs(mark.top - name.top), line: mark.height, spills: li.scrollWidth > li.clientWidth + 1 };
  });
  expect(layout.gap).toBeLessThan(layout.line);
  expect(layout.spills).toBe(false);
});
