import { expect, test, type Page } from '@playwright/test';
import { fixtureUrl } from './helpers';

// Map view checks: cards (light and dark snapshots), edges and their sentences, status
// colouring, controls and a keyboard-only walkthrough.

const card = (page: Page, name: string) => page.locator(`[data-decl="${name}"]`);

test('cards show title, summary chip, kind and counts; + shows what a card rests on', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map?preset=reader`);
  await page.getByRole('tab', { name: 'Map' }).click();
  const main = card(page, 'Fixture.main_result');
  await expect(main).toContainText('Main result');
  await expect(main).toContainText('docstring');
  await expect(main).toContainText('theorem');
  await expect(main).toContainText(/uses \d+ · used by 0/);
  const dm = card(page, 'Fixture.double_mono');
  await dm.getByRole('button', { name: /Show what .* rests on/ }).click();
  // Opening what a card rests on adds those cards; the card itself does not grow a statement.
  await expect(card(page, 'Fixture.double_eq_add')).toBeVisible();
  await expect(dm.locator('.signature')).toHaveCount(0);
});

test('cards show the statement without repeating the name, with linked names', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map?preset=mathematician`);
  const main = card(page, 'Fixture.main_result');
  const dm = card(page, 'Fixture.double_mono');
  await expect(dm.locator('.signature')).toBeVisible();
  await expect(dm.locator('.signature')).not.toContainText('Fixture.double_mono');
  // The whole statement can be read on the card: nothing is cut off or faded; a statement longer
  // than the box scrolls (the scroll bar appears only then).
  for (const c of [main, dm]) {
    const sig = await c.locator('.signature').evaluate((e) => {
      const s = getComputedStyle(e);
      return { overflowY: s.overflowY, mask: s.maskImage || s.webkitMaskImage || 'none', fits: e.scrollHeight <= e.clientHeight, noWheel: e.classList.contains('nowheel') };
    });
    expect(sig.overflowY).toBe('auto');
    expect(sig.mask === 'none' || sig.mask === '').toBe(true);
    expect(sig.noWheel).toBe(true);
  }
  await dm.locator('.sig-link', { hasText: 'Fixture.double' }).first().click();
  await expect(page.getByRole('complementary', { name: 'Details' })).toContainText('Fixture.double');
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
  await expect(t).toHaveAttribute('aria-label', /Has sorry/);
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
  // Lean core is one library card, off by default for mathematicians; other libraries can be hidden.
  await expect(page.locator('.group-card')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Lean core' }).check();
  await expect(page.locator('.group-card', { hasText: 'Lean core' })).toHaveCount(1);
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

test('code in cards scrolls inside the card instead of being cut off', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.main_result`);
  await page.getByRole('checkbox', { name: 'Code in cards' }).check();
  const code = page.locator('[data-decl="Fixture.main_result"] .card-code');
  await expect(code).toBeVisible();
  expect(await code.evaluate((e) => getComputedStyle(e).overflowY)).toBe('auto');
  expect(await code.evaluate((e) => e.classList.contains('nowheel'))).toBe(true);
});

test('a highlighted chain draws its lines in the highlight colour, as moving dashes', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.tainted_result`);
  const item = page.getByRole('complementary', { name: 'Details' }).locator('.why-item', { hasText: 'Fixture.customAxiom' });
  await item.getByRole('button', { name: 'Why?' }).click();
  await item.getByRole('button', { name: 'Show on map' }).click();
  const line = page.locator('.react-flow__edge.highlighted path').first();
  await expect(line).toBeAttached();
  const style = await line.evaluate((e) => ({ dash: getComputedStyle(e).strokeDasharray, animation: getComputedStyle(e).animationName }));
  expect(style.dash).not.toBe('none');
  expect(style.animation).toBe('proofmap-flow');
});

test('a statement longer than its box scrolls inside the card, nothing is cut off', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map/Fixture.main_result`);
  const sig = page.locator('[data-decl="Fixture.main_result"] .signature');
  await expect(sig).toBeVisible();
  // Shrink the box so the statement is longer than it: it must scroll to its end.
  const end = await sig.evaluate((e) => {
    e.style.maxHeight = '30px';
    e.scrollTop = e.scrollHeight;
    return { scrolled: e.scrollTop > 0, overflowY: getComputedStyle(e).overflowY };
  });
  expect(end).toEqual({ scrolled: true, overflowY: 'auto' });
});

test('the main result control says what it is', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map`);
  await expect(page.locator('.map-toolbar .toolbar-title')).toContainText('Main result');
});

test('the main result opens and closes like any other card', async ({ page }) => {
  await page.goto(`${fixtureUrl}#/map`);
  const main = page.locator('.react-flow__node:has([data-decl="Fixture.main_result"])');
  const cards = page.locator('.react-flow__node');
  await expect(main).toBeVisible();
  const toggle = main.locator('.card-toggle');
  // Open by default, so its button closes it.
  await expect(toggle).toHaveText('−');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const open = await cards.count();
  expect(open).toBeGreaterThan(1);
  await toggle.click();
  await expect(cards).toHaveCount(1);
  await expect(toggle).toHaveText('+');
  await toggle.click();
  await expect(cards).toHaveCount(open);
  // The keyboard does the same: Escape on the main result closes it.
  await main.locator('.card-title').click();
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(cards).toHaveCount(open);
});

test('the first paint never shows lines without their cards', async ({ page }) => {
  // Watch every frame from the start: a frame with visible edges but no visible card is a flash.
  await page.addInitScript(() => {
    const w = window as unknown as { __bareEdgeFrames: number };
    w.__bareEdgeFrames = 0;
    const start = performance.now();
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const tick = () => {
      const edges = [...document.querySelectorAll('.react-flow__edge path')].filter(visible);
      const cards = [...document.querySelectorAll('.react-flow__node')].filter(visible);
      if (edges.length && !cards.length) w.__bareEdgeFrames++;
      if (performance.now() - start < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${fixtureUrl}#/map`);
  await expect(page.locator('[data-decl="Fixture.main_result"]')).toBeVisible();
  await page.waitForTimeout(3200);
  expect(await page.evaluate(() => (window as unknown as { __bareEdgeFrames: number }).__bareEdgeFrames)).toBe(0);
});
