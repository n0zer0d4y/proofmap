import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProofmapData } from '../src/data/schema';
import { decode, slimForWire, StaleDataError, type Wire } from '../src/data/wire';

// The page payload must decode to the public proofmap.json of the same build, minus
// exactly the documented losses. Both files are written by the Lean side for the fixture
// (`build --json` and `--page-json`). PROOFMAP_ROUNDTRIP=DIR runs the same check on
// DIR/public.json and DIR/page.json (used on large projects, too big to commit).
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
const fixture = (f: string) => new URL(`./fixtures/${f}`, import.meta.url);

describe('page payload', () => {
  const pub = read(fixture('fixture.json').pathname.replace(/^\/([A-Za-z]:)/, '$1')) as ProofmapData;
  const wire = read(fixture('fixture.page.json').pathname.replace(/^\/([A-Za-z]:)/, '$1')) as Wire;

  it('decodes to the public JSON, minus exactly the documented losses', () => {
    expect(decode(wire)).toEqual(slimForWire(pub));
  });
  it('covers both directDeps forms and the helper slimming', () => {
    expect(wire.decls.some((d) => d.e === undefined)).toBe(true);
    expect(wire.decls.some((d) => d.e !== undefined)).toBe(true);
    const helper = wire.decls.findIndex((_, i) => pub.decls[i]!.flags.some((f) => f.startsWith('noise:')) && pub.decls[i]!.code);
    if (helper >= 0) expect(wire.decls[helper]!.c).toBeUndefined();
  });
  it('passes public JSON through unchanged', () => {
    expect(decode(pub)).toBe(pub);
  });
  it('refuses a payload from another version', () => {
    expect(() => decode({ ...wire, wire: 99 })).toThrow(StaleDataError);
    expect(() => decode({ hello: 1 })).toThrow('not proofmap data');
  });
});

const dir = process.env.PROOFMAP_ROUNDTRIP;
describe.runIf(dir)('page payload round trip on a large project', () => {
  it('decodes to the public JSON, minus exactly the documented losses', () => {
    const pub = read(`${dir}/public.json`) as ProofmapData;
    const wire = read(`${dir}/page.json`) as Wire;
    const got = decode(wire);
    const want = slimForWire(pub);
    // Field by field first, so a failure names the culprit without a 80 MB diff.
    expect(got.decls.length).toBe(want.decls.length);
    for (let i = 0; i < want.decls.length; i++) expect(got.decls[i], want.decls[i]!.name).toEqual(want.decls[i]);
    expect(got.walkthroughs).toEqual(want.walkthroughs);
    expect(got).toEqual(want);
  }, 600_000);
});
