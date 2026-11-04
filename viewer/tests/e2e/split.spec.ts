import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// A single file over its size budget: walkthroughs and generated helpers' details
// move to `<name>_files/` beside the page and load from there when needed, also from disk
// (file://). The fixture is built with a tiny budget (PROOFMAP_PAGE_BUDGET) to force both
// splits. PROOFMAP_EXE is the proofmap executable; PROOFMAP_FIXTURE optionally names the fixture.
const exe = process.env.PROOFMAP_EXE;
test.skip(!exe, 'set PROOFMAP_EXE to a built proofmap executable');
test.setTimeout(300_000);

const fixture = process.env.PROOFMAP_FIXTURE ?? fileURLToPath(new URL('../../../lean/test/fixture/', import.meta.url));
let dir = '';
let pageUrl = '';

test.beforeAll(() => {
  // A sibling of the fixture: its lakefile requires proofmap by the relative path `../..`.
  dir = mkdtempSync(join(fixture, '..', '.live-split-'));
  cpSync(fixture, dir, { recursive: true, filter: (src) => !src.includes('expected') });
  const r = spawnSync('lake', ['env', exe!, 'build', '--root', 'Fixture', '--walkthrough', '--out', 'page.html'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PROOFMAP_PAGE_BUDGET: '1000' },
  });
  if (r.status !== 0) throw new Error(`build failed: ${r.stdout}\n${r.stderr}`);
  expect(r.stdout).toContain('walkthroughs and helper details are in');
  expect(r.stdout).toContain('loads faster');
  pageUrl = pathToFileURL(join(dir, 'page.html')).href;
});
test.afterAll(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

test('walkthroughs and helper details load from beside the page', async ({ page }) => {
  const files = readdirSync(join(dir, 'page_files'));
  expect(files.some((f) => f.startsWith('helpers-'))).toBe(true);
  expect(readdirSync(join(dir, 'page_files', 'walkthrough')).length).toBeGreaterThan(0);

  // Walkthrough from its chunk.
  await page.goto(`${pageUrl}#/map/Fixture.and_swap?wt=1`);
  await expect(page.getByLabel('Walkthrough of Fixture.and_swap').locator('.wt-count')).toHaveText('Step 1 of 3');

  // A helper selected before its details load shows its stub, then its real statement.
  await page.goto(`${pageUrl}#/map/Fixture.Point.x`);
  const detail = page.getByRole('complementary', { name: 'Details' });
  await expect(detail).toContainText('Fixture.Point.x (self : Point) : Int', { timeout: 10_000 });
});

test('a missing helpers file is reported, not hidden', async ({ page }) => {
  const helpers = readdirSync(join(dir, 'page_files')).find((f) => f.startsWith('helpers-'))!;
  const path = join(dir, 'page_files', helpers);
  renameSync(path, `${path}.away`);
  try {
    await page.goto(`${pageUrl}#/map/Fixture.Point.x`);
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
  } finally {
    renameSync(`${path}.away`, path);
  }
});
