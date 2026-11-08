import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fixtureUrl } from './helpers';

// Detail panel, "why" trace and glossary hover cards.

const basicLean = readFileSync(new URL('../../../lean/test/fixture/Fixture/Basic.lean', import.meta.url), 'utf8').split(/\r?\n/);

test('code block line numbers and text match the source file; VS Code link names the line', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.double_eq_add`);
  const detail = page.getByRole('complementary', { name: 'Details' });
  await detail.getByText(/^Lean code/).click();
  const lines = detail.locator('.code .code-line');
  await expect(lines.first()).toBeVisible();
  const n = await lines.count();
  expect(n).toBeGreaterThan(2);
  for (let i = 0; i < n; i++) {
    const line = lines.nth(i);
    const no = Number(await line.getAttribute('data-line'));
    const text = (await line.innerText()).replace(/^\s*\d+/, '').replace(/\n$/, '');
    expect(text.trimEnd()).toBe(basicLean[no - 1]!.trimEnd());
  }
  expect(Number(await lines.first().getAttribute('data-line'))).toBe(49);
  // Highlighted (Shiki) tokens are present.
  await expect(detail.locator('.code span[style]').first()).toBeAttached();
  // The page records the project folder relative to itself; the link is worked out from where
  // the page is opened (no absolute path is stored in the page).
  await expect(detail.getByRole('link', { name: 'Open in VS Code' })).toHaveAttribute('href', /^vscode:\/\/file\/.+\/tests\/out\/Fixture\/Basic\.lean:49$/);
});

test('docstring, statement with links, uses and used-by', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.main_result`);
  const detail = page.getByRole('complementary', { name: 'Details' });
  await expect(detail).toContainText('The main result of the fixture');
  await expect(detail.locator('.signature .sig-link').first()).toBeVisible();
  await expect(detail.getByRole('heading', { name: /^Uses \(/ })).toBeVisible();
  await detail.getByRole('button', { name: 'Fixture.double_double', exact: true }).click();
  await expect(detail.locator('.fullname')).toContainText('Fixture.double_double');
});

test('why trace names the chain to the custom axiom and highlights it on the map', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.tainted_result`);
  const detail = page.getByRole('complementary', { name: 'Details' });
  const item = detail.locator('.why-item', { hasText: 'Fixture.customAxiom' });
  // The sentence names the axiom before "Why?" is opened.
  await expect(item).toContainText('Uses the axiom Fixture.customAxiom.');
  await item.getByRole('button', { name: 'Why?' }).click();
  await expect(item.locator('.chain li')).toHaveText([
    'Fixture.tainted_result',
    'Fixture.uses_custom_axiom_indirectly',
    'Fixture.uses_custom_axiom',
    'Fixture.customAxiom is the axiom',
  ]);
  await item.getByRole('button', { name: 'Show on map' }).click();
  for (const n of ['Fixture.tainted_result', 'Fixture.uses_custom_axiom_indirectly', 'Fixture.uses_custom_axiom', 'Fixture.customAxiom'])
    await expect(page.locator(`.react-flow__node.highlighted [data-decl="${n}"]`)).toBeVisible();
  // "Show on map" selected the chain's source, and the view keeps it on screen.
  await expect(detail.locator('.fullname-text')).toHaveText('Fixture.customAxiom');
  const flow = (await page.locator('.react-flow').boundingBox())!;
  const source = (await page.locator('[data-decl="Fixture.customAxiom"]').boundingBox())!;
  expect(source.x).toBeGreaterThanOrEqual(flow.x);
  expect(source.x + source.width).toBeLessThanOrEqual(flow.x + flow.width);
  // Back to the tainted result (through search) for the sorry.
  const search = page.getByRole('combobox', { name: 'Search declarations' });
  await search.fill('tainted_result');
  await page.getByRole('option').filter({ hasText: 'Fixture.tainted_result' }).first().click();
  const sorry = detail.locator('.why-item', { hasText: 'sorry' });
  // The status covers everything below, so the sentence says where the sorry is.
  await expect(sorry).toContainText('Rests on sorry in Fixture.unfinished.');
  await sorry.getByRole('button', { name: 'Why?' }).click();
  await expect(sorry.locator('.chain li').last()).toHaveText('Fixture.unfinished has sorry');
});

test('details say how many main results rest on the selection, with a meter', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.double`);
  const detail = page.getByRole('complementary', { name: 'Details' });
  const needed = detail.locator('.needed');
  await expect(needed).toHaveText('Needed for 2 of 5 main results');
  await expect(needed.locator('.needed-meter i')).toHaveCount(5);
  await expect(needed.locator('.needed-meter i.on')).toHaveCount(2);
  // A main result itself has no such line; its badge says what it is.
  await page.goto(`${fixtureUrl}#/map/Fixture.main_result`);
  await expect(detail.locator('.fullname-text')).toHaveText('Fixture.main_result');
  await expect(detail.locator('.needed')).toHaveCount(0);
});

test('glossary hover cards explain jargon', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.customAxiom`);
  const term = page.getByRole('complementary', { name: 'Details' }).locator('.term', { hasText: 'axiom' }).first();
  await term.focus();
  await expect(term.getByRole('tooltip')).toBeVisible();
  await expect(term.getByRole('tooltip')).toContainText('assumed without proof');
});
