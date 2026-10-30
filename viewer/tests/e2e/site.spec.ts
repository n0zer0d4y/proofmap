import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Site mode: the folder written by `proofmap build --site`, served by a plain static
// server under a sub-path, as GitHub Pages would. No proofmap endpoints exist there.

const siteDir = fileURLToPath(new URL('../out/site/', import.meta.url));
const types: Record<string, string> = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript' };
let server: Server;
let base = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (!path.startsWith('/proofmap/')) return void res.writeHead(404).end();
    const rel = normalize(path.slice('/proofmap/'.length) || 'index.html');
    const file = join(siteDir, rel);
    if (rel.startsWith('..') || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/proofmap/`;
});
test.afterAll(() => server.close());

test('the site works under a sub-path and loads walkthroughs on demand', async ({ page }) => {
  const requests: string[] = [];
  const failed: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  // The live-reload probe is expected to fail on a static host; that is how the page knows.
  const probe = (u: string) => u.includes('__proofmap/version');
  page.on('requestfailed', (r) => {
    if (!probe(r.url())) failed.push(r.url());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !probe(r.url())) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${base}#/map/Fixture.add_origin`);
  await expect(page.locator('[data-view="map"]')).toBeVisible();
  expect(requests.some((u) => u === `${base}data/page.json`)).toBe(true);
  // No walkthrough chunk is fetched until one is opened.
  expect(requests.filter((u) => u.includes('/walkthrough/'))).toEqual([]);
  await page.getByRole('button', { name: /Walk through the proof \(\d+ steps\)/ }).click();
  const view = page.getByLabel('Walkthrough of Fixture.add_origin');
  await expect(view.locator('.wt-count')).toHaveText(/Step 1 of \d+/);
  const chunks = requests.filter((u) => u.includes('/walkthrough/'));
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatch(new RegExp(`^${base}data/walkthrough/Fixture\\.Result-[0-9a-f]{8}\\.js\\?v=[0-9a-f]+$`));
  // Another proof from the same module reuses the loaded chunk.
  await page.goto(`${base}#/map/Fixture.double_mono?wt=1`);
  await expect(page.getByLabel('Walkthrough of Fixture.double_mono').locator('.wt-count')).toHaveText(/Step 1 of/);
  expect(requests.filter((u) => u.startsWith('http')).every((u) => u.startsWith(base))).toBe(true);
  expect(failed).toEqual([]);
});

test('a chunk from another build is refused', async ({ page }) => {
  await page.route('**/walkthrough/*.js*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/^(window\.__proofmapWalkthroughs\("[^"]+", ")[0-9a-f]+/, '$1deadbeef');
    await route.fulfill({ response: res, body });
  });
  await page.goto(`${base}#/map/Fixture.add_origin?wt=1`);
  await expect(page.getByRole('alert')).toContainText('different build');
});

test('a missing chunk says so instead of spinning', async ({ page }) => {
  await page.route('**/walkthrough/*.js*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`${base}#/map/Fixture.add_origin?wt=1`);
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
});
