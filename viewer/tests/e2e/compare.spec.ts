import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fixtureUrl } from './helpers';

// Compare view on two real fixture snapshots (lean/test/check-compare.mjs --save): one
// theorem added, one removed, a sorry fixed (three results now sorry-free), a proof rewritten.
const compareUrl = pathToFileURL(fileURLToPath(new URL('../out/compare.html', import.meta.url))).href;
const oldSnapshot = fileURLToPath(new URL('../fixtures/compare-old.json', import.meta.url));

test('a compare page lists the planted changes', async ({ page }) => {
  await page.goto(`${compareUrl}#/compare`);
  const view = page.locator('[data-view="compare"]');
  const stat = (label: string) => view.locator('.stat', { hasText: label }).locator('.stat-value');
  await expect(stat('Added')).toHaveText('1');
  await expect(stat('Removed')).toHaveText('1');
  await expect(stat('Changed')).toHaveText('4');
  await expect(stat('Now sorry-free')).toHaveText('3');
  await expect(view.getByRole('region', { name: 'Added declarations' })).toContainText('Fixture.double_three');
  await expect(view.getByRole('region', { name: 'Removed declarations' })).toContainText('Fixture.classical_fact');
  const changed = view.getByRole('region', { name: 'Changed declarations' }).getByRole('listitem');
  await expect(changed).toHaveCount(4);
  await expect(changed.filter({ hasText: 'Fixture.unfinished' })).toContainText('codestatusdependencies');
  await expect(changed.filter({ hasText: 'Fixture.hiddenHelper_pos' })).toContainText('codedependencies');
});

test('added and changed results are badged on the map', async ({ page }) => {
  await page.goto(`${compareUrl}#/map/Fixture.double_three?at=Fixture.double_three`);
  await expect(page.locator('[data-decl="Fixture.double_three"] .badge-diff')).toHaveText('new');
  await page.goto(`${compareUrl}#/map/Fixture.unfinished?at=Fixture.downstream_of_sorry`);
  await expect(page.locator('[data-decl="Fixture.unfinished"] .badge-diff')).toHaveText('changed');
  await expect(page.locator('[data-decl="Fixture.downstream_of_sorry"] .badge-diff')).toHaveText('changed');
});

test('any page can compare with a snapshot chosen from disk', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/compare`);
  const view = page.locator('[data-view="compare"]');
  await view.getByLabel('Choose an older proofmap.json…').setInputFiles(oldSnapshot);
  await expect(view.locator('.stat', { hasText: 'Added' })).toBeVisible();
  await view.getByRole('button', { name: 'Stop comparing' }).click();
  await view.getByLabel('Choose an older proofmap.json…').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"x":1}') });
  await expect(view.getByRole('alert')).toContainText('not a proofmap.json');
});
