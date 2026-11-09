import { expect, test } from '@playwright/test';
import { fixtureUrl, trackRequests } from './helpers';

// The app shell, search, views, presets and theme, on the fixture page opened from file://.

test('app shell loads offline with the data and makes no external requests', async ({ page, context }) => {
  await context.route(/^(?!file:|data:|blob:).*/, (r) => r.abort());
  const external = trackRequests(page);
  await page.goto(fixtureUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture');
  await expect(page.getByRole('tablist', { name: 'Views' })).toBeVisible();
  await expect(page.locator('[data-decl="Fixture.main_result"]')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('Made with proofmap');
  expect(external).toEqual([]);
});

test('search, select, views, preset and theme', async ({ page }) => {
  await page.goto(fixtureUrl);
  // WebKit can return from goto before the app has mounted; `/` would then go to the body.
  await expect(page.getByRole('combobox', { name: 'Search declarations' })).toBeVisible();
  await page.keyboard.press('/');
  await page.keyboard.type('double_eq_add');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Details' })).toContainText('Fixture.double_eq_add');
  await page.getByRole('tab', { name: 'Outline' }).click();
  await expect(page.locator('[data-view="outline"]')).toBeVisible();
  // A preset changes what is shown, not the view.
  await page.getByLabel('Persona preset').selectOption('auditor');
  await expect(page.locator('[data-view="outline"]')).toBeVisible();
  await page.getByRole('button', { name: /^Theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.getByRole('dialog', { name: 'About proofmap' })).toContainText('Apache License');
});

test('reload restores the state', async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.getByRole('button', { name: 'Tainted result', exact: true }).click();
  await page.getByRole('tab', { name: 'Health' }).click();
  await page.getByRole('button', { name: /^Theme/ }).click();
  await page.reload();
  await expect(page.locator('[data-view="health"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Details' })).toContainText('Fixture.tainted_result');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the back button works under file://', async ({ page }) => {
  await page.goto(fixtureUrl);
  const details = page.getByRole('complementary', { name: 'Details' });
  await page.locator('[data-decl="Fixture.main_result"] .card-head').click();
  await expect(details).toContainText('Fixture.main_result');
  await page.locator('[data-decl="Fixture.double_mono"] .card-head').click();
  await expect(details).toContainText('Fixture.double_mono');
  expect(page.url()).toMatch(/^file:.*#\/map\/Fixture\.double_mono/);
  await page.goBack();
  await expect(details).toContainText('Fixture.main_result');
  await page.goBack();
  await expect(details).toContainText('Select a result');
  await page.goForward();
  await expect(details).toContainText('Fixture.main_result');
});

test('the About dialog closes from its top right corner, like any window', async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.getByRole('button', { name: 'About' }).click();
  const dialog = page.getByRole('dialog', { name: 'About proofmap' });
  const box = (await dialog.boundingBox())!;
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toHaveCount(1);
  const c = (await close.boundingBox())!;
  // In the top right corner: level with the title row, against the right edge.
  expect(c.y - box.y).toBeLessThan(40);
  expect(box.x + box.width - (c.x + c.width)).toBeLessThan(40);
  await expect(dialog).toContainText('Data format');
  await expect(dialog.getByRole('button', { name: 'Copy details' })).toBeVisible();
  await close.click();
  await expect(dialog).toBeHidden();
});

test('dropdowns keep their chevron away from the edge', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map`);
  for (const select of [page.getByLabel('Persona preset'), page.locator('.map-toolbar select')]) {
    const style = await select.evaluate((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, paddingRight: parseFloat(s.paddingRight), image: s.backgroundImage };
    });
    expect(style.appearance).toBe('none');
    expect(style.image).toContain('svg');
    expect(style.paddingRight).toBeGreaterThanOrEqual(24);
  }
});
