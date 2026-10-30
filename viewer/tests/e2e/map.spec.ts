import { expect, test, type Page } from '@playwright/test';
import { fixtureUrl } from './helpers';

// Map view checks: cards (light and dark snapshots), edges and their sentences, status
// colouring, controls and a keyboard-only walkthrough.

const card = (page: Page, name: string) => page.locator(`[data-decl="${name}"]`);

test('cards show title, summary chip, kind and counts; expanding shows the linked statement', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map?preset=reader`);
  await page.getByRole('tab', { name: 'Map' }).click();
  const main = card(page, 'Fixture.main_result');
  await expect(main).toContainText('Main result');
  await expect(main).toContainText('docstring');
  await expect(main).toContainText('theorem');
  await expect(main).toContainText(/rests on \d+ · used by 0/);
  const dm = card(page, 'Fixture.double_mono');
  await dm.getByRole('button', { name: /Show what .* rests on/ }).click();
  await expect(dm.locator('.signature')).toContainText('Fixture.double_mono');
  // A linked name in the statement selects its declaration.
  await dm.locator('.sig-link', { hasText: 'Fixture.double' }).first().click();
  await expect(page.getByRole('complementary', { name: 'Details' })).toContainText('Fixture.double');
  // Expanding added the cards it rests on.
  await expect(card(page, 'Fixture.double_eq_add')).toBeVisible();
});

test('card snapshots in light and dark themes', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await page.goto(`${fixtureUrl}#/map/Fixture.main_result?theme=${theme}`);
    const main = card(page, 'Fixture.main_result');
    await expect(main).toBeVisible();
    await page.waitForTimeout(400); // let the position transition settle
    await expect(main).toHaveScreenshot(`card-main-${theme}.png`);
  }
});

test('edges: solid for proof uses, dashed for statement uses, with a sentence', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map?theme=light`);
  await expect(card(page, 'Fixture.main_result')).toBeVisible();
  const proof = page.locator('.dep-edge', { has: page.locator('title', { hasText: 'Fixture.double_double is used in the proof of Fixture.main_result' }) });
  await expect(proof).toHaveCount(1);
  const statement = page.locator('.dep-edge', { has: page.locator('title', { hasText: 'Fixture.double appears in the statement of Fixture.main_result' }) });
  await expect(statement).toHaveCount(1);
  await expect(statement.locator('path').first()).toHaveCSS('stroke-dasharray', /7/);
  await expect(proof.locator('path').first()).toHaveCSS('stroke-dasharray', 'none');
  // Hovering an edge shows its sentence (the SVG title).
  await proof.locator('path').last().hover({ force: true });
  await expect(proof).toHaveAttribute('aria-label', /is used in the proof of/);
  // Snapshot of the edges (solid, dashed, routed into the main result).
  await page.waitForTimeout(400);
  await expect(page.locator('.react-flow')).toHaveScreenshot('map-edges-light.png');
});

test('status: tainted results are coloured and labelled, not only by colour', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map?at=Fixture.tainted_result`);
  const t = card(page, 'Fixture.tainted_result');
  await expect(t).toHaveClass(/status-border-sorry/);
  await expect(t).toHaveAttribute('aria-label', /Contains sorry/);
  await expect(t.locator('.status')).toHaveText('✗');
  const ax = card(page, 'Fixture.uses_custom_axiom_indirectly');
  await expect(ax).toHaveClass(/status-border-axiom/);
});

test('keyboard-only walkthrough', async ({ page }) => {
  await page.goto(fixtureUrl);
  await expect(card(page, 'Fixture.main_result')).toBeVisible();
  // Select the main result with the search box, then tab into the map.
  await page.keyboard.press('/');
  await page.keyboard.type('main_result');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => document.activeElement?.classList.contains('map'))) break;
    await page.keyboard.press('Tab');
  }
  expect(await page.evaluate(() => document.activeElement?.classList.contains('map'))).toBe(true);
  // The detail panel's full-name line is the current selection.
  const selectedName = page.locator('.detail .fullname-text');
  await expect(selectedName).toHaveText('Fixture.main_result');
  // Left moves to a dependency.
  await page.keyboard.press('ArrowLeft');
  await expect(selectedName).not.toHaveText('Fixture.main_result');
  const selected = (await page.locator('.map-card.selected').getAttribute('data-decl'))!;
  // Up/down move within the column.
  await page.keyboard.press('ArrowDown');
  const below = await page.locator('.map-card.selected').getAttribute('data-decl');
  expect(below).not.toBe(null);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.map-card.selected')).toHaveAttribute('data-decl', selected);
  // Right goes back to a user.
  await page.keyboard.press('ArrowRight');
  await expect(selectedName).toHaveText('Fixture.main_result');
  // Select double_mono, Enter expands it, Escape collapses it.
  await page.keyboard.press('ArrowLeft');
  // Go to the top of the column, then down until double_mono (bounded).
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
  for (let i = 0; i < 10 && (await selectedName.textContent()) !== 'Fixture.double_mono'; i++) await page.keyboard.press('ArrowDown');
  await expect(selectedName).toHaveText('Fixture.double_mono');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Fixture.double_eq_add')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page, 'Fixture.double_eq_add')).toHaveCount(0);
  // f builds the map around the selection.
  await page.keyboard.press('f');
  await expect(page.locator('.toolbar-title')).toContainText('Double monotone');
  expect(page.url()).toContain('at=Fixture.double_mono');
  // p pins the path finder's start, a second p its end, and opens the path finder.
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('p');
  await expect(page.locator('[data-view="paths"]')).toBeVisible();
  expect(page.url()).toMatch(/from=Fixture\.double_mono/);
});

test('controls: fit, minimap, filters, show more, back to main result', async ({ page }) => {
  await page.goto(fixtureUrl);
  await expect(card(page, 'Fixture.main_result')).toBeVisible();
  await expect(page.locator('.react-flow__minimap-node').first()).toBeAttached();
  await page.getByRole('button', { name: 'Fit' }).click();
  // Externals can be hidden.
  await expect(page.locator('.group-card')).not.toHaveCount(0);
  await page.getByLabel('Other libraries').uncheck();
  await expect(page.locator('.group-card')).toHaveCount(0);
  // Show more around the selection adds a ring of dependencies.
  await card(page, 'Fixture.double_mono').locator('.card-head').click();
  await page.getByRole('button', { name: 'Show more around this' }).click();
  await expect(card(page, 'Fixture.double_eq_add')).toBeVisible();
  // Focus map here, then back.
  await page.getByRole('button', { name: 'Focus map here' }).click();
  await expect(page.locator('.toolbar-title')).toContainText('Double monotone');
  await page.getByRole('button', { name: 'Back to main result' }).click();
  await expect(page.locator('.toolbar-title')).toContainText('Main result');
});
