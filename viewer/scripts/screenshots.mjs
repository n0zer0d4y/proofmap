// Takes the documentation screenshots (docs/images/*.png) from a generated page, so they can be
// remade whenever the viewer changes. Usage:
//   node scripts/screenshots.mjs PAGE.html OUT_DIR ROOT_DECL WALKTHROUGH_DECL [THEME]
// ROOT_DECL is the result to show on the map and in the outline; WALKTHROUGH_DECL a tactic proof;
// THEME is dark (the default, as in the docs) or light.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const [page, out, root, proof, theme = 'dark'] = process.argv.slice(2);
if (!page || !out || !root || !proof || !['dark', 'light'].includes(theme)) {
  console.error('usage: node scripts/screenshots.mjs PAGE.html OUT_DIR ROOT_DECL WALKTHROUGH_DECL [dark|light]');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const url = pathToFileURL(page).href;
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1440, height: 860 }, colorScheme: theme });

const shots = [
  ['map', `#/map/${root}?at=${root}&exp=${root}`, '.map-card'],
  ['outline', `#/outline/${root}?preset=reader`, '[data-view="outline"]'],
  ['walkthrough', `#/map/${proof}?wt=1`, '.wt-count'],
  ['health', `#/health`, '[data-view="health"] .stat'],
];
for (const [name, hash, ready] of shots) {
  await tab.goto(url + hash);
  await tab.locator(ready).first().waitFor({ timeout: 30000 });
  await tab.waitForTimeout(1500);
  await tab.screenshot({ path: join(out, `${name}.png`) });
  console.log(`wrote ${join(out, `${name}.png`)}`);
}
await browser.close();
