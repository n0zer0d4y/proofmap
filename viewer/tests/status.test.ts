import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProofmapData } from '../src/data/schema';
import { STATUS_LABEL, statusText, trustsCompiledCode } from '../src/data/status';

// One status vocabulary across the page: Proved (theorems) or Complete (other kinds and counts),
// Has sorry, Extra axiom, Other library.

const data = JSON.parse(readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
const decl = (name: string) => data.decls.find((d) => d.name === name)!;

describe('status words', () => {
  it('says Proved for a theorem and Complete for other kinds', () => {
    expect(statusText(decl('Fixture.double_eq_add'))).toBe('Proved');
    expect(decl('Fixture.double').kind).not.toBe('theorem');
    expect(statusText(decl('Fixture.double'))).toBe('Complete');
  });
  it('says Has sorry and Extra axiom whatever the kind', () => {
    expect(statusText(decl('Fixture.unfinished'))).toBe('Has sorry');
    expect(statusText(decl('Fixture.downstream_of_sorry'))).toBe('Has sorry');
    expect(statusText(decl('Fixture.uses_custom_axiom'))).toBe('Extra axiom');
  });
  it('uses words that fit any mix of kinds for counts and group cards', () => {
    expect(Object.values(STATUS_LABEL).map((l) => l.text)).toEqual(['Complete', 'Has sorry', 'Extra axiom', 'Other library']);
  });
  it('recognises the axioms behind native_decide, old and new', () => {
    for (const a of ['Lean.ofReduceBool', 'Lean.ofReduceNat', 'Lean.trustCompiler', 'Foo.bar._native.native_decide.ax_1'])
      expect(trustsCompiledCode(a)).toBe(true);
    for (const a of ['propext', 'Classical.choice', 'Fixture.customAxiom', 'Lean.ofReduceBoolish']) expect(trustsCompiledCode(a)).toBe(false);
  });
});
