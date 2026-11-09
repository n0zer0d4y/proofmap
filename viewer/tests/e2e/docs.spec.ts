import { expect, test } from '@playwright/test';
import { fixtureUrl } from './helpers';

// The built-in docs: the user guide, opened from the header or with `?`, read with its contents,
// and left with Back to the view it was opened from.

test('Docs opens the guide, its contents follow the reading, and Back returns to the view', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/health`);
  await page.getByRole('button', { name: 'Docs' }).click();
  const docs = page.locator('[data-view="docs"]');
  await expect(docs).toBeVisible();
  await expect(page).toHaveURL(/#\/docs$/);
  await expect(page.getByRole('button', { name: 'Docs' })).toHaveAttribute('aria-pressed', 'true');
  // The guide's sections, with its own words, and no pictures (the page stays one small file).
  const contents = page.getByRole('navigation', { name: 'Contents' });
  for (const s of ['The page at a glance', 'Map', 'Health', 'Keyboard shortcuts', 'Sharing'])
    await expect(contents.getByRole('button', { name: s, exact: true })).toBeVisible();
  await expect(docs.locator('.docs-article img')).toHaveCount(0);
  await expect(docs.locator('.docs-article kbd').first()).toBeVisible();
  await expect(docs.locator('.docs-article .badge.kind-theorem')).toBeVisible();
  // A contents entry takes you to its section and lights up.
  await contents.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const heading = docs.locator('.docs-article h2', { hasText: 'Keyboard shortcuts' });
  await expect(heading).toBeInViewport();
  await expect(contents.getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toHaveAttribute('aria-current', 'true');
  // Back goes to the view the docs were opened from.
  await page.getByRole('button', { name: 'Back to the health view' }).click();
  await expect(page.locator('[data-view="health"]')).toBeVisible();
});

test('? opens the docs from anywhere, but not while typing in search', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map`);
  await page.getByRole('combobox', { name: 'Search declarations' }).fill('a?');
  await expect(page.locator('[data-view="docs"]')).toHaveCount(0);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  await expect(page.locator('[data-view="docs"]')).toBeVisible();
  // The browser's Back leaves the docs too.
  await page.goBack();
  await expect(page.locator('[data-view="map"]')).toBeVisible();
});
