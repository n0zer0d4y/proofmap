import { pathToFileURL, fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fixtureUrl } from './helpers';

// Accessibility audit: axe-core with the WCAG 2.1 A and AA rules on every view,
// in both themes. Done when no violation is serious or critical.
const compareUrl = pathToFileURL(fileURLToPath(new URL('../out/compare.html', import.meta.url))).href;

const pages: Array<[string, string, string]> = [
  ['map with a selection', `${fixtureUrl}#/map/Fixture.main_result?exp=Fixture.main_result`, '[data-view="map"] .map-card'],
  ['outline', `${fixtureUrl}#/outline/Fixture.main_result`, '[data-view="outline"]'],
  ['path finder', `${fixtureUrl}#/paths/Fixture.double?from=Fixture.double&to=Fixture.main_result`, '[data-view="paths"]'],
  ['health', `${fixtureUrl}#/health`, '[data-view="health"]'],
  ['walkthrough', `${fixtureUrl}#/map/Fixture.and_swap?wt=1`, '[data-view="walkthrough"] .wt-count'],
  ['compare', `${compareUrl}#/compare`, '[data-view="compare"] .stat'],
  ['compare without a snapshot', `${fixtureUrl}#/compare`, '[data-view="compare"]'],
];

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`);
}

for (const theme of ['light', 'dark'] as const) {
  for (const [name, url, ready] of pages) {
    test(`${name} (${theme}) has no serious or critical violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(url);
      await expect(page.locator(ready).first()).toBeVisible();
      // Let layout and highlighting settle, so the audit sees the finished page.
      await page.waitForTimeout(500);
      expect(await audit(page)).toEqual([]);
    });
  }
}
