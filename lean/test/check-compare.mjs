// Checks `proofmap compare` on two real snapshots of the fixture: a copy is
// built, then edited (one theorem added, one removed, a sorry fixed, a proof rewritten) and
// built again. The printed summary must list exactly the planted changes.
// Usage: node check-compare.mjs [--save DIR] COMMAND...   (COMMAND runs proofmap, for example
// `lake env /abs/path/proofmap`). --save keeps both snapshots, with rootDir normalized, for the
// viewer's compare tests.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let args = process.argv.slice(2);
let save = null;
if (args[0] === '--save') {
  save = args[1];
  args = args.slice(2);
}
const [cmd, ...prefix] = args;
if (!cmd) {
  console.error('usage: node check-compare.mjs [--save DIR] COMMAND...');
  process.exit(1);
}

// PROOFMAP_FIXTURE names another fixture folder (CI uses one per toolchain).
const fixture = process.env.PROOFMAP_FIXTURE ?? fileURLToPath(new URL('./fixture/', import.meta.url));
// A sibling of the fixture: its lakefile requires proofmap by the relative path `../..`.
const dir = mkdtempSync(join(fixture, '..', '.live-compare-'));
const run = (...a) => {
  const r = spawnSync(cmd, [...prefix, ...a], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`proofmap ${a.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const edit = (file, from, to) => {
  const p = join(dir, file);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`${file}: planted edit target not found: ${from}`);
  writeFileSync(p, s.replace(from, to));
};

const failures = [];
try {
  cpSync(fixture, dir, { recursive: true, filter: (src) => !src.includes('expected') });
  run('build', '--root', 'Fixture', '--no-walkthrough', '--json', 'old.json', '--out', 'old.html');

  edit('Fixture/Status.lean', '/-- Classical reasoning: uses only standard axioms. -/\ntheorem classical_fact (p : Prop) : p ∨ ¬p := Classical.em p\n',
    '/-- Added in the second snapshot. -/\ntheorem double_three : double 3 = 6 := rfl\n');
  edit('Fixture/Status.lean', 'theorem unfinished (n : Nat) : double n = n * 2 := by\n  sorry', 'theorem unfinished (n : Nat) : double n = n * 2 := by\n  unfold double\n  omega');
  edit('Fixture/Status.lean', '  unfold hiddenHelper\n  omega', '  unfold hiddenHelper\n  exact Nat.succ_pos n');
  run('build', '--root', 'Fixture', '--no-walkthrough', '--json', 'new.json', '--out', 'new.html');

  const out = run('compare', 'old.json', 'new.json', '--out', 'compare.html');
  const lines = out.split('\n');
  const pick = (mark) => lines.filter((l) => l.startsWith(`  ${mark} `)).map((l) => l.slice(4)).sort();
  const eq = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  eq('added', pick('+'), ['Fixture.double_three']);
  eq('removed', pick('-'), ['Fixture.classical_fact']);
  eq('changed', pick('~'), [
    'Fixture.downstream_of_sorry (status)',
    'Fixture.hiddenHelper_pos (code, dependencies)',
    'Fixture.tainted_result (status)',
    'Fixture.unfinished (code, status, dependencies)',
  ]);
  if (!lines[0].includes('now sorry-free: 3, newly depending on sorry: 0')) failures.push(`summary line: ${lines[0]}`);
  const html = readFileSync(join(dir, 'compare.html'), 'utf8');
  if (!html.includes('<script id="proofmap-baseline" type="application/json">{')) failures.push('compare.html has no embedded baseline');
  // Bad input: a usage error, not a crash.
  const bad = spawnSync(cmd, [...prefix, 'compare', 'old.json', 'missing.json'], { cwd: dir, encoding: 'utf8' });
  if (bad.status !== 1) failures.push(`compare with a missing file exited with ${bad.status}, expected 1`);

  if (save) {
    for (const f of ['old', 'new']) {
      const d = JSON.parse(readFileSync(join(dir, `${f}.json`), 'utf8'));
      d.project.rootDir = 'C:/fixture';
      writeFileSync(join(save, `compare-${f}.json`), JSON.stringify(d));
    }
    console.log(`saved snapshots to ${save}`);
  }
  if (!failures.length) console.log(out.trim());
} finally {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`compare check FAILED (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('compare OK');
