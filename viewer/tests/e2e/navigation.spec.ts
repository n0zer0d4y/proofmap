import { expect, test, type Page } from '@playwright/test';
import { fixtureUrl } from './helpers';

// Navigation between views, walkthroughs, the tour, links and the keyboard.

const shown = (page: Page) => page.locator('.panel section').first();

test('tabs work while a walkthrough is open, and its exit names where it returns', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/outline/Fixture.add_origin`);
  const details = page.getByRole('complementary', { name: 'Details' });
  await details.getByRole('button', { name: /Walk through the proof/ }).click();
  await expect(shown(page)).toHaveAttribute('data-view', 'walkthrough');
  await expect(page.getByRole('button', { name: '← Back to the outline' })).toBeVisible();
  await page.getByRole('tab', { name: 'Health' }).click();
  await expect(shown(page)).toHaveAttribute('data-view', 'health');
  await page.getByRole('tab', { name: 'Outline' }).click();
  await expect(shown(page)).toHaveAttribute('data-view', 'outline');
});

test('Back from a walkthrough keeps the selection', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.add_origin`);
  await page.getByRole('complementary', { name: 'Details' }).getByRole('button', { name: /Walk through the proof/ }).click();
  await expect(shown(page)).toHaveAttribute('data-view', 'walkthrough');
  await page.goBack();
  await expect(shown(page)).toHaveAttribute('data-view', 'map');
  expect(page.url()).toMatch(/#\/map\/Fixture\.add_origin/);
});

test('Escape on the About dialog closes only the dialog', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.add_origin?wt=1`);
  await expect(shown(page)).toHaveAttribute('data-view', 'walkthrough');
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.getByRole('dialog', { name: 'About proofmap' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'About proofmap' })).toBeHidden();
  await expect(shown(page)).toHaveAttribute('data-view', 'walkthrough');
});

test('the tour shows each step on the map, and Escape ends it', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/health`);
  await page.getByRole('button', { name: 'Walk me through it' }).click();
  await expect(shown(page)).toHaveAttribute('data-view', 'map');
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Next →' }).click();
  await expect(shown(page)).toHaveAttribute('data-view', 'map');
  await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();
});

test('the tour panel belongs to the map: above the legend, gone on other views, back on the map', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${fixtureUrl}#/map`);
  await page.getByRole('button', { name: 'Walk me through it' }).click();
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await tour.getByRole('button', { name: 'Next →' }).click();
  await expect(tour).toContainText('Step 2 of');
  // Stacked above the legend: the two boxes do not overlap.
  const legend = page.locator('.map-legend');
  const t = (await tour.boundingBox())!;
  const l = (await legend.boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual(l.y);
  // Other views do not show it.
  for (const tab of ['Health', 'Outline']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(tour).toBeHidden();
  }
  // Back on the map, the tour is where it was.
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(tour).toContainText('Step 2 of');
});

test('a link to a declaration not on the map rebuilds the map around it', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.tainted_result`);
  await expect(page.locator('[data-decl="Fixture.tainted_result"]')).toBeVisible();
});

test('a link to a name that is not in this build says so', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.no_such_lemma`);
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details).toContainText('Fixture.no_such_lemma is not in this build');
});

test('the outline reveals a deep selection and keeps its state across views', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/outline/Fixture.double_eq_add`);
  const row = page.locator('[data-view="outline"] [role="treeitem"][aria-selected="true"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Fixture.double_eq_add');
  const rows = await page.locator('[data-view="outline"] [role="treeitem"]').count();
  await page.getByRole('tab', { name: 'Map' }).click();
  await page.getByRole('tab', { name: 'Outline' }).click();
  await expect(page.locator('[data-view="outline"] [role="treeitem"]')).toHaveCount(rows);
});

test('keys on map controls act on the control, not the map', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.main_result`);
  await expect(page.locator('[data-decl="Fixture.main_result"]')).toBeVisible();
  const before = page.url();
  await page.getByRole('button', { name: 'Fit' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Other libraries').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('f');
  // Neither a card expansion, a new selection nor a new anchor.
  expect(page.url()).toBe(before);
});

test('pressing p on a card says what to do next', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.main_result`);
  await page.locator('[data-decl="Fixture.main_result"] .card-head').click();
  await page.keyboard.press('p');
  await expect(page.getByRole('status')).toContainText('press p on a second result');
});

test('health counts open their lists', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/health`);
  await page.getByRole('button', { name: /Deprecated/ }).click();
  await expect(page.getByRole('region', { name: 'Deprecated' })).toContainText('Fixture.');
  await page.getByRole('region', { name: 'Axioms' }).getByRole('button', { name: '4' }).click();
  await expect(page.getByRole('region', { name: 'Axioms' })).toContainText('Using Fixture.customAxiom (4)');
});

test('changing the preset keeps the view', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map`);
  await page.getByLabel('Persona preset').selectOption('auditor');
  await expect(shown(page)).toHaveAttribute('data-view', 'map');
});

test('display settings survive selecting and going back', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.main_result`);
  await page.getByRole('checkbox', { name: 'Lean core' }).check();
  await page.getByRole('checkbox', { name: 'Code in cards' }).check();
  await page.getByRole('complementary', { name: 'Details' }).getByRole('button', { name: 'Fixture.double_mono', exact: true }).click();
  await expect(page.locator('.detail .fullname-text')).toHaveText('Fixture.double_mono');
  await page.goBack();
  await expect(page.getByRole('checkbox', { name: 'Lean core' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Code in cards' })).toBeChecked();
});
