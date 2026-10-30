import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Serve + live reload against the real Lean side: on a copy of the
// fixture project, `proofmap serve`, edit a docstring, `proofmap build`, and the open page
// shows the new text within 3 s of the build finishing. PROOFMAP_EXE is the proofmap
// executable (run through `lake env`) built for the fixture's toolchain; PROOFMAP_FIXTURE
// optionally names the fixture folder (default: lean/test/fixture in this repository).
const exe = process.env.PROOFMAP_EXE;
test.skip(!exe, 'set PROOFMAP_EXE to a built proofmap executable');
test.setTimeout(300_000);

const fixture = process.env.PROOFMAP_FIXTURE ?? fileURLToPath(new URL('../../../lean/test/fixture/', import.meta.url));
let dir = '';
let server: ChildProcess | null = null;

const build = () => {
  const r = spawnSync('lake', ['env', exe!, 'build', '--root', 'Fixture', '--no-walkthrough'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build failed: ${r.stdout}\n${r.stderr}`);
};

test.beforeAll(() => {
  // A sibling of the fixture: its lakefile requires proofmap by the relative path `../..`.
  dir = mkdtempSync(join(fixture, '..', '.live-'));
  cpSync(fixture, dir, { recursive: true, filter: (src) => !src.includes('expected') });
  build();
});
test.afterAll(() => {
  server?.kill();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the folder briefly after the server exits.
  }
});

test('editing a docstring and rebuilding updates the open page', async ({ page }) => {
  server = spawn('lake', ['env', exe!, 'serve', '--no-build'], { cwd: dir });
  const url = await new Promise<string>((resolve, reject) => {
    let out = '';
    server!.stdout!.on('data', (d) => {
      out += d;
      const m = /at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(out);
      if (m) resolve(m[1]!);
    });
    server!.on('exit', (code) => reject(new Error(`serve exited with ${code}: ${out}`)));
  });
  await page.goto(`${url}#/map/Fixture.Point.origin`);
  const detail = page.getByRole('complementary', { name: 'Details' });
  await expect(detail).toContainText('The origin.');

  const file = join(dir, 'Fixture', 'Basic.lean');
  writeFileSync(file, readFileSync(file, 'utf8').replace('/-- The origin. -/', '/-- The centre of the plane. -/'));
  build();
  const built = Date.now();
  await expect(detail).toContainText('The centre of the plane.', { timeout: 3000 });
  const took = Date.now() - built;
  console.log(`page updated ${took} ms after the build finished`);
  expect(took).toBeLessThanOrEqual(3000);
  // The reload keeps the view and the selection.
  await expect(page).toHaveURL(/#\/map\/Fixture\.Point\.origin/);
});
