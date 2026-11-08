import type { Decl } from './schema';

export type StatusKind = 'ok' | 'sorry' | 'axiom' | 'external';

/** Status colouring: sorry > non-standard axiom > proved; externals grey. */
export function statusOf(d: Decl): StatusKind {
  if (d.status.sorry) return 'sorry';
  if (d.status.nonstandardAxioms.length > 0) return 'axiom';
  if (d.external) return 'external';
  return 'ok';
}

/**
 * Icon and words for each status, so colour is never the only signal. These words fit any mix of
 * kinds (a group card, a legend, a count): "Complete" is true of a proved theorem too. Statuses are
 * transitive, like `#print axioms`: "Has sorry" means here or somewhere below.
 */
export const STATUS_LABEL: Record<StatusKind, { icon: string; text: string }> = {
  ok: { icon: '✓', text: 'Complete' },
  sorry: { icon: '✗', text: 'Has sorry' },
  axiom: { icon: '!', text: 'Extra axiom' },
  external: { icon: '○', text: 'Other library' },
};

/** The status words for one declaration: a theorem without sorry or extra axioms is "Proved";
 * nobody proves a definition, so every other kind says "Complete". */
export function statusText(d: Decl): string {
  const s = statusOf(d);
  return s === 'ok' && d.kind === 'theorem' ? 'Proved' : STATUS_LABEL[s].text;
}

/** Axioms that trust compiled code rather than state a fact: `native_decide` (`Lean.ofReduceBool`,
 * `Lean.ofReduceNat`, `Lean.trustCompiler`, or the per-use `…._native.native_decide.ax_N` axioms of
 * newer Lean versions). */
export function trustsCompiledCode(axiom: string): boolean {
  return /^Lean\.(ofReduceBool|ofReduceNat|trustCompiler)$|\._native\./.test(axiom);
}
