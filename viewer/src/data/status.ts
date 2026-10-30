import type { Decl } from './schema';

export type StatusKind = 'ok' | 'sorry' | 'axiom' | 'external';

/** Status colouring: sorry > non-standard axiom > proved; externals grey. */
export function statusOf(d: Decl): StatusKind {
  if (d.status.sorry) return 'sorry';
  if (d.status.nonstandardAxioms.length > 0) return 'axiom';
  if (d.external) return 'external';
  return 'ok';
}

/** Icon and words for each status, so colour is never the only signal. */
export const STATUS_LABEL: Record<StatusKind, { icon: string; text: string }> = {
  ok: { icon: '✓', text: 'Proved (standard axioms)' },
  sorry: { icon: '✗', text: 'Contains sorry' },
  axiom: { icon: '!', text: 'Uses a non-standard axiom' },
  external: { icon: '○', text: 'From another library' },
};
