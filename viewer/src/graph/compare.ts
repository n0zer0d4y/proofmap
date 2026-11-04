import type { Decl, ProofmapData } from '../data/schema';

/**
 * Compare two snapshots. Project declarations (not generated helpers) are
 * matched by name, or by name and module when a name occurs in several modules. A declaration counts as changed when
 * its signature, code, status or dependencies differ. Must agree with `Proofmap/Compare.lean`,
 * which prints the same summary for `proofmap compare`.
 */

export type ChangeKind = 'signature' | 'code' | 'status' | 'dependencies';

export interface Comparison {
  baseline: { title: string; builtAt: string };
  /** Ids in the current data. */
  added: number[];
  removed: { name: string; title: string; module: string | null }[];
  changed: { id: number; what: ChangeKind[] }[];
  /** Current ids whose sorry status flipped. */
  nowSorryFree: number[];
  nowSorry: number[];
  /** Non-standard axioms used now but not before, and the reverse. */
  newAxioms: string[];
  goneAxioms: string[];
  addedSet: Set<number>;
  changedSet: Set<number>;
  /** The compared (older) version of each changed declaration, by current id. */
  before: Map<number, Before>;
}

export interface Before {
  signature: string;
  code: string | null;
  sorry: boolean;
  nonstandardAxioms: string[];
}

function keys(data: ProofmapData): Map<string, Decl> {
  // Generated helpers (`noise:*` flags) come and go with every proof edit; they are not compared.
  const project = data.decls.filter((d) => !d.external && !d.flags.some((f) => f.startsWith('noise:')));
  const count = new Map<string, number>();
  for (const d of project) count.set(d.name, (count.get(d.name) ?? 0) + 1);
  return new Map(project.map((d) => [count.get(d.name)! > 1 ? `${d.name}~${d.module ?? ''}` : d.name, d]));
}

/**
 * A statement in a form that does not depend on how proofmap printed it: every linked name is
 * written in full and the declaration's own name is left out. Versions of proofmap print names
 * differently (0.2 prints them relative to the namespace), and that must not count as a change.
 */
export function canonicalStatement(data: ProofmapData, d: Decl): string {
  const cps = Array.from(d.signature);
  let out = '';
  let at = 0;
  for (const h of [...d.signatureHover].sort((x, y) => x.start - y.start)) {
    if (h.start < at) continue;
    out += cps.slice(at, h.start).join('') + (data.decls[h.decl]?.name ?? cps.slice(h.start, h.end).join(''));
    at = h.end;
  }
  out += cps.slice(at).join('');
  // The head (the declaration's own name and universe list) up to the first space.
  return out.replace(/^\S+\s+/, '').replace(/\s+/g, ' ').trim();
}

const depNames = (data: ProofmapData, d: Decl) =>
  [...d.deps.statement.map((i) => `s:${data.decls[i]?.name}`), ...d.deps.proof.map((i) => `p:${data.decls[i]?.name}`)].sort().join('\n');

const statusKey = (d: Decl) => `${d.status.sorry}|${[...d.status.nonstandardAxioms].sort().join(',')}`;

const axiomsOf = (data: ProofmapData) => new Set(data.decls.filter((d) => !d.external).flatMap((d) => d.status.nonstandardAxioms));

export function compare(old: ProofmapData, cur: ProofmapData): Comparison {
  const before = keys(old);
  const after = keys(cur);
  const added: number[] = [];
  const changed: { id: number; what: ChangeKind[] }[] = [];
  const nowSorryFree: number[] = [];
  const nowSorry: number[] = [];
  const older = new Map<number, Before>();
  for (const [k, d] of after) {
    const o = before.get(k);
    if (!o) {
      added.push(d.id);
      continue;
    }
    const what: ChangeKind[] = [];
    if (canonicalStatement(old, o) !== canonicalStatement(cur, d)) what.push('signature');
    if ((o.code ?? '').trim() !== (d.code ?? '').trim()) what.push('code');
    if (statusKey(o) !== statusKey(d)) what.push('status');
    if (depNames(old, o) !== depNames(cur, d)) what.push('dependencies');
    if (what.length) {
      changed.push({ id: d.id, what });
      older.set(d.id, { signature: o.signature, code: o.code, sorry: o.status.sorry, nonstandardAxioms: o.status.nonstandardAxioms });
    }
    if (o.status.sorry && !d.status.sorry) nowSorryFree.push(d.id);
    if (!o.status.sorry && d.status.sorry) nowSorry.push(d.id);
  }
  const removed = [...before].filter(([k]) => !after.has(k)).map(([, d]) => ({ name: d.name, title: d.title, module: d.module }));
  const a0 = axiomsOf(old);
  const a1 = axiomsOf(cur);
  return {
    baseline: { title: old.project.title, builtAt: old.project.builtAt },
    added,
    removed,
    changed,
    nowSorryFree,
    nowSorry,
    newAxioms: [...a1].filter((a) => !a0.has(a)).sort(),
    goneAxioms: [...a0].filter((a) => !a1.has(a)).sort(),
    addedSet: new Set(added),
    changedSet: new Set(changed.map((c) => c.id)),
    before: older,
  };
}
