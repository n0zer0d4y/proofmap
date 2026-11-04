import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fixtureUrl } from './helpers';

// Walkthrough view: stepping through fixture proofs shows the expected goals.

const expected = JSON.parse(
  readFileSync(new URL('../../../lean/test/fixture/expected/walkthroughs.json', import.meta.url), 'utf8'),
).walkthroughs as Record<string, Array<{ tactic: string; goalsBefore: string[]; goalsAfter: string[] }>>;

const goalText = (lines: string[]) => lines.map((l) => l.replace(/^[+−] |^ {2}/, '')).join('\n').trim();

test('stepping through add_origin shows the expected goals', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.add_origin`);
  await page.getByRole('button', { name: /Walk through the proof/ }).click();
  const view = page.getByLabel('Walkthrough of Fixture.add_origin');
  await expect(view).toBeVisible();
  const want = expected['Fixture.add_origin']!;
  for (let i = 0; i < want.length; i++) {
    await expect(view.locator('.wt-count')).toHaveText(`Step ${i + 1} of ${want.length}`);
    await expect(view.locator('.wt-goals h3 code')).toHaveText(want[i]!.tactic);
    const before = await view.getByRole('region', { name: 'Goals before' }).locator('.goal').allInnerTexts();
    expect(before.map((g) => goalText(g.split('\n')))).toEqual(want[i]!.goalsBefore);
    const after = await view.getByRole('region', { name: 'Goals after' }).locator('.goal').allInnerTexts();
    expect(after.map((g) => goalText(g.split('\n')))).toEqual(want[i]!.goalsAfter);
    // The current tactic's line is highlighted in the source.
    await expect(view.locator('.code-line.current').first()).toContainText(want[i]!.tactic.split(' ')[0]!);
    if (i + 1 < want.length) await page.keyboard.press('ArrowRight');
  }
  // The last step closes the goal.
  await expect(view.locator('.goal-closed')).toHaveText('✓ goal closed');
  await page.keyboard.press('ArrowLeft');
  await expect(view.locator('.wt-count')).toHaveText(`Step ${want.length - 1} of ${want.length}`);
  // Changed lines are marked.
  await expect(view.locator('.goal-line.added').first()).toBeVisible();
  await view.getByRole('button', { name: '← Back to the map' }).click();
  await expect(page.locator('[data-view="map"]')).toBeVisible();
});

test('bullets are listed once; compound tactics collapse; the scrubber jumps', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.and_swap?wt=1`);
  let view = page.getByLabel('Walkthrough of Fixture.and_swap');
  // `· exact hq` and its only tactic `exact hq` are one step.
  await expect(view.locator('.wt-count')).toHaveText('Step 1 of 3');
  await expect(view.getByRole('list', { name: 'Steps' }).getByRole('button', { name: 'exact hq', exact: true })).toHaveCount(0);
  await page.goto(`${fixtureUrl}#/map/Fixture.two_goals?wt=1`);
  view = page.getByLabel('Walkthrough of Fixture.two_goals');
  await expect(view.locator('.wt-count')).toHaveText('Step 1 of 4');
  await view.getByLabel('Timeline of the proof steps').fill('2');
  await expect(view.locator('.wt-goals h3 code')).toHaveText('omega');
  // Collapsing the compound tactic that holds the current step makes it the current step.
  await view.getByRole('button', { name: 'Collapse compound tactic' }).first().click();
  await expect(view.locator('.wt-count')).toHaveText('Step 1 of 1');
  await expect(view.locator('.wt-goals h3 code')).toHaveText('constructor <;> omega');
  await expect(view.getByRole('region', { name: 'Goals after' })).toContainText('proof is complete');
});

test('a term-mode proof says so', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.origin_x?wt=1`);
  await expect(page.locator('[data-view="walkthrough"]').getByText('This proof is a single term')).toBeVisible();
});
