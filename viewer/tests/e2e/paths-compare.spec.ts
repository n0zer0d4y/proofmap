import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fixtureUrl } from './helpers';

// The path finder's dependent choices, the outline's expand/collapse, and comparing against a
// file chosen in the page (as a reader does), with snapshots of both data format versions.

test('path finder: once one end is chosen, the other offers only ends that connect', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/paths`);
  const view = page.locator('[data-view="paths"]');
  await view.getByRole('combobox', { name: 'Path from' }).fill('Fixture.double');
  await page.getByRole('option').filter({ hasText: /^Double\s*Fixture\.double$/ }).first().click();
  // Clicking the empty "to" box lists the choices; every one of them gives a path.
  const to = view.getByRole('combobox', { name: 'Path to' });
  await to.click();
  const choices = page.getByRole('listbox', { name: 'Path to: results' }).getByRole('option');
  await expect(choices.first()).toBeVisible();
  const names = await choices.locator('.hit-name').allTextContents();
  expect(names).toContain('Fixture.main_result');
  // Typing filters within the valid choices only: an unrelated name is not offered.
  await to.fill('origin_x');
  await expect(page.getByRole('listbox', { name: 'Path to: results' })).toHaveCount(0);
  await to.fill('main_result');
  await page.getByRole('option').filter({ hasText: 'Fixture.main_result' }).first().click();
  await expect(view).toContainText('Shortest chain');
});

test('path finder: a start that nothing rests on says so at once', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/paths?from=Fixture.main_result`);
  await expect(page.locator('[data-view="paths"]')).toContainText('Nothing in this project rests on');
});

test('outline: expand all and collapse all', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/outline`);
  const rows = page.locator('[data-view="outline"] [role="treeitem"]');
  const roots = await rows.count();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(roots);
  // Everything is open: no closed row is left.
  await expect(page.locator('[data-view="outline"] [aria-expanded="false"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('[data-view="outline"] [aria-expanded="true"]')).toHaveCount(0);
});

const fixtureFile = (f: string) => fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url));

test('compare: an older proofmap.json chosen in the page, data format 1 and 2', async ({ page }) => {
  for (const file of ['compare-old.json', 'fixture.json']) {
    await page.goto(`${fixtureUrl}#/compare`);
    const view = page.locator('[data-view="compare"]');
    await view.locator('input[type="file"]').setInputFiles(fixtureFile(file));
    await expect(view).toContainText('Compared with');
    await expect(view.getByRole('button', { name: 'Stop comparing' })).toBeVisible();
  }
  // The fixture page against its own data: nothing changed.
  await expect(page.locator('[data-view="compare"]')).toContainText('Nothing changed.');
  // Stop comparing returns to the picker.
  await page.getByRole('button', { name: 'Stop comparing' }).click();
  await expect(page.locator('[data-view="compare"]')).toContainText('Choose an older proofmap.json');
});

test('compare: a file that is not proofmap data is reported', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/compare`);
  await page.locator('[data-view="compare"] input[type="file"]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
  await expect(page.locator('[data-view="compare"]')).toContainText('Could not read notes.json');
});

test('path finder: the choice count sits on the label line, so the bar keeps its height', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/paths`);
  const bar = page.locator('.paths-form');
  const empty = (await bar.boundingBox())!.height;
  await page.goto(`${fixtureUrl}#/paths?from=Fixture.double`);
  await expect(page.locator('.paths-hint')).toContainText('rest on');
  expect((await bar.boundingBox())!.height).toBe(empty);
});

test('path finder: an empty box lists its choices on click, the project first', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/paths`);
  await page.getByRole('combobox', { name: 'Path from' }).click();
  const options = page.getByRole('listbox', { name: 'Path from: results' }).getByRole('option');
  await expect(options.first()).toBeVisible();
  // Starts that something rests on, from this project (no Lean core basics such as Eq or Nat).
  const data = JSON.parse(readFileSync(fixtureFile('fixture.json'), 'utf8')) as { decls: { name: string; external: boolean }[] };
  const own = new Set(data.decls.filter((d) => !d.external).map((d) => d.name));
  const names = await options.locator('.hit-name').allTextContents();
  expect(names.length).toBeGreaterThan(3);
  expect(names.filter((n) => !own.has(n))).toEqual([]);
});
