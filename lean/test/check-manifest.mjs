// Compares extractor output for the fixture with test/fixture/expected/manifest.json.
// Usage: node test/check-manifest.mjs FIXTURE_JSON [--lean v4.29.0]
// Covers kinds, flags, sorry, axioms and the module import graph.
// On a toolchain newer than the newest one proofmap was tested with, generated helpers
// (`noise:*`) that the manifest does not list are notes rather than errors: each Lean release
// may add or rename them, and the viewer hides them either way.
import { readFile } from 'node:fs/promises';

const [file, ...rest] = process.argv.slice(2);
const leanVersion = rest[rest.indexOf('--lean') + 1] ?? null;
const manifest = JSON.parse(
  await readFile(new URL('./fixture/expected/manifest.json', import.meta.url), 'utf8'),
);
const data = JSON.parse(await readFile(file, 'utf8'));

/** `v4.36.0-rc1` → [4, 36, 0]; null when the toolchain is not a numbered release. */
const versionOf = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v ?? '');
  return m ? m.slice(1).map(Number) : null;
};
const launcher = await readFile(new URL('../Proofmap/Launcher.lean', import.meta.url), 'utf8');
const nt = /def newestTested : LeanVersion := \{ major := (\d+), minor := (\d+), patch := (\d+) \}/.exec(launcher);
if (!nt) throw new Error('newestTested not found in Proofmap/Launcher.lean');
const newestTested = nt.slice(1).map(Number);
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};
const current = versionOf(leanVersion);
const untested = current !== null && newer(current, newestTested);

const errors = [];
const notes = [];
const fail = (msg) => errors.push(msg);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
// Project declarations keyed by name and module (two modules may declare the same name).
const projectDecls = data.decls.filter((d) => !d.external);
const byKey = new Map(projectDecls.map((d) => [`${d.name}@${d.module}`, d]));
const byName = new Map();
for (const d of projectDecls) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
const one = (name) => (byName.get(name) ?? [])[0];
// Edge-list key: the bare name when it is unique, name@module otherwise.
const edgeKey = (d) => (byName.get(d.name).length > 1 ? `${d.name}@${d.module}` : d.name);
const noiseOf = (d) => d.flags.filter((f) => f.startsWith('noise:'));

// Declarations.
const defaults = manifest.defaults;
for (const m of manifest.decls) {
  const d = byKey.get(`${m.name}@${m.module}`);
  if (!d) { fail(`${m.name} [${m.module}]: missing`); continue; }
  if (d.kind !== m.kind) fail(`${m.name}: kind ${d.kind}, expected ${m.kind}`);
  if (d.module !== m.module) fail(`${m.name}: module ${d.module}, expected ${m.module}`);
  if ((d.docstring !== null) !== m.docstring) fail(`${m.name}: docstring present = ${d.docstring !== null}`);
  const flags = m.flags ?? defaults.flags;
  if (!same(d.flags, flags)) fail(`${m.name}: flags ${JSON.stringify(d.flags)}, expected ${JSON.stringify(flags)}`);
  if (m.axioms && !same(d.status.axioms, m.axioms))
    fail(`${m.name}: axioms ${JSON.stringify(d.status.axioms)}, expected ${JSON.stringify(m.axioms)}`);
  const sorry = m.sorry ?? defaults.sorry;
  if (d.status.sorry !== sorry) fail(`${m.name}: sorry ${d.status.sorry}, expected ${sorry}`);
  const ns = m.nonstandardAxioms ?? defaults.nonstandardAxioms;
  if (!same(d.status.nonstandardAxioms, ns))
    fail(`${m.name}: nonstandardAxioms ${JSON.stringify(d.status.nonstandardAxioms)}, expected ${JSON.stringify(ns)}`);
  if (m.title && d.title !== m.title) fail(`${m.name}: title "${d.title}", expected "${m.title}"`);
  // `#print axioms` / `#check` / `#eval` commands that name it: "command@line", none unless listed.
  const checks = (d.checkedBy ?? []).map((c) => `${c.command}@${c.line}`);
  if (!same(checks, m.checkedBy ?? [])) fail(`${m.name}: checkedBy ${JSON.stringify(checks)}, expected ${JSON.stringify(m.checkedBy ?? [])}`);
}

// Sections and leading comments.
const sectionTitle = (d) => {
  const mod = data.modules.find((m) => m.name === d.module);
  let nodes = mod?.sections ?? [], title = null;
  for (const i of d.sectionPath) { title = nodes[i]?.title ?? null; nodes = nodes[i]?.children ?? []; }
  return title;
};
for (const m of manifest.decls) {
  const d = byKey.get(`${m.name}@${m.module}`);
  if (!d) continue;
  if (m.section !== undefined && sectionTitle(d) !== m.section)
    fail(`${m.name}: section ${JSON.stringify(sectionTitle(d))}, expected ${JSON.stringify(m.section)}`);
  if (m.leadingComment !== undefined && d.leadingComment !== m.leadingComment)
    fail(`${m.name}: leadingComment ${JSON.stringify(d.leadingComment)}, expected ${JSON.stringify(m.leadingComment)}`);
  // Attribute tags and what they override.
  if (m.tags && JSON.stringify(d.tags) !== JSON.stringify(m.tags))
    fail(`${m.name}: tags ${JSON.stringify(d.tags)}, expected ${JSON.stringify(m.tags)}`);
  if (m.expectSummary && JSON.stringify(d.summary) !== JSON.stringify(m.expectSummary))
    fail(`${m.name}: summary ${JSON.stringify(d.summary)}, expected ${JSON.stringify(m.expectSummary)}`);
  if (m.expectStep !== undefined && d.step !== m.expectStep) fail(`${m.name}: step ${d.step}, expected ${m.expectStep}`);
  if (m.expectRank !== undefined && d.rank !== m.expectRank) fail(`${m.name}: rank ${d.rank}, expected ${m.expectRank}`);
}

// Roots.
const rootNames = data.project.roots.map((i) => data.decls[i].name);
for (const r of manifest.rootsMustInclude)
  if (!rootNames.includes(r)) fail(`root ${r} not detected (roots: ${JSON.stringify(rootNames)})`);

// Noise.
const extra = (leanVersion && manifest.toolchainDifferences[leanVersion]?.extraNoise) ?? [];
const noiseNames = [...manifest.noise.names, ...extra];
for (const n of noiseNames) {
  const d = one(n);
  if (!d) fail(`${n}: expected noise declaration missing`);
  else if (noiseOf(d).length === 0) fail(`${n}: no noise flag (flags ${JSON.stringify(d.flags)})`);
}

// Nothing unaccounted for: every project declaration is in the manifest or the noise list.
const known = new Set([...manifest.decls.map((m) => `${m.name}@${m.module}`), ...noiseNames]);
for (const d of projectDecls) {
  if (!known.has(`${d.name}@${d.module}`) && !known.has(d.name)) {
    const msg = `${d.name} [${d.module}]: not in the manifest (flags ${JSON.stringify(d.flags)})`;
    if (untested && noiseOf(d).length > 0) notes.push(msg);
    else fail(msg);
  } else {
    const declared = manifest.decls.find((m) => m.name === d.name && m.module === d.module);
    const noiseExpected = noiseNames.includes(d.name) || (declared?.flags ?? []).some((f) => f.startsWith('noise:'));
    if (!noiseExpected && noiseOf(d).length > 0) fail(`${d.name}: unexpectedly flagged ${noiseOf(d)}`);
  }
}

// sorry and non-standard axioms appear only where the manifest says.
for (const d of projectDecls) {
  const m = manifest.decls.find((x) => x.name === d.name && x.module === d.module);
  if (!m && (d.status.sorry || d.status.nonstandardAxioms.length > 0) && noiseOf(d).length === 0)
    fail(`${d.name}: unexpected sorry/non-standard axiom`);
}

// Dependency edges: project-internal edges after noise collapse, exactly.
const expectedEdges = JSON.parse(
  await readFile(new URL('./fixture/expected/edges.json', import.meta.url), 'utf8'),
).edges;
const visible = projectDecls.filter((d) => noiseOf(d).length === 0);
for (const d of visible) {
  const want = expectedEdges[edgeKey(d)];
  if (!want) { fail(`${edgeKey(d)}: no expected edges`); continue; }
  for (const kind of ['statement', 'proof']) {
    const got = d.deps[kind].filter((i) => !data.decls[i].external).map((i) => edgeKey(data.decls[i]));
    if (!same(got, want[kind])) fail(`${edgeKey(d)}: ${kind} deps ${JSON.stringify(got.sort())}, expected ${JSON.stringify(want[kind])}`);
  }
}
for (const n of Object.keys(expectedEdges)) if (!visible.some((d) => edgeKey(d) === n)) fail(`${n}: expected visible declaration missing`);

// Signatures, hover links and titles: rendered snapshot, reviewed by hand.
const render = (x) => {
  const cps = Array.from(x.signature);
  let s = '', i = 0;
  for (const h of x.signatureHover) {
    const t = data.decls[h.decl];
    s += cps.slice(i, h.start).join('') + '⟦' + cps.slice(h.start, h.end).join('') + '→' + t.name + '@' + (t.module ?? '') + '⟧';
    i = h.end;
  }
  return s + cps.slice(i).join('');
};
const snapshot = visible
  .slice()
  .sort((a, b) => (a.module + a.name < b.module + b.name ? -1 : 1))
  .map((x) => `${x.name}  [${x.module}]\n  title: ${x.title}\n  sig:   ${render(x)}`)
  .join('\n') + '\n';
const snapshotFile = new URL('./fixture/expected/signatures.txt', import.meta.url);
if (process.argv.includes('--update-snapshot')) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(snapshotFile, snapshot);
  console.log('wrote expected/signatures.txt');
} else {
  const want = await readFile(snapshotFile, 'utf8').catch(() => '');
  if (want !== snapshot) {
    const a = want.split('\n'), b = snapshot.split('\n');
    const at = a.findIndex((l, k) => l !== b[k]);
    fail(`signature snapshot differs at line ${at + 1}:\n    expected: ${a[at]}\n    got:      ${b[at]}`);
  }
}

// Proof walkthroughs: hand-checked steps, exactly; term-mode proofs have none.
const wt = JSON.parse(await readFile(new URL('./fixture/expected/walkthroughs.json', import.meta.url), 'utf8'));
if (process.argv.includes('--no-walkthrough')) {
  // Data built with --no-walkthrough: nothing to check here.
} else {
  for (const [n, want] of Object.entries(wt.walkthroughs)) {
    const d = one(n);
    const w = d && d.walkthrough !== null ? data.walkthroughs[d.walkthrough] : null;
    if (!w) { fail(`${n}: no walkthrough`); continue; }
    const got = w.steps.map((s) => ({ tactic: s.tactic, depth: s.depth, goalsBefore: s.goalsBefore, goalsAfter: s.goalsAfter }));
    if (JSON.stringify(got) !== JSON.stringify(want))
      fail(`${n}: walkthrough differs
    expected: ${JSON.stringify(want)}
    got:      ${JSON.stringify(got)}`);
  }
  for (const n of wt.termMode) if (one(n)?.walkthrough !== null) fail(`${n}: term-mode proof has a walkthrough`);
}

// Module import graph (project modules only).
for (const m of manifest.modules) {
  const mod = data.modules.find((x) => x.name === m.name);
  if (!mod) { fail(`module ${m.name}: missing`); continue; }
  const imports = mod.imports.filter((i) => i === 'Fixture' || i.startsWith('Fixture.'));
  if (!same(imports, m.imports)) fail(`module ${m.name}: imports ${JSON.stringify(imports)}, expected ${JSON.stringify(m.imports)}`);
}

for (const n of notes) console.log(`note (Lean ${leanVersion} is newer than ${newestTested.join('.')}): ${n}`);
if (errors.length) {
  console.error(`manifest check: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`manifest check: OK (${manifest.decls.length} declarations, ${noiseNames.length} noise, ${manifest.modules.length} modules)`);
