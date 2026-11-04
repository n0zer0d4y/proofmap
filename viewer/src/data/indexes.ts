import MiniSearch from 'minisearch';
import type { Decl, ProofmapData, Section } from './schema';

/** Lookups built once when the data is loaded. */
export interface Indexes {
  data: ProofmapData;
  decls: Decl[];
  /** Declaration ids by name; a name can occur in several modules. */
  byName: Map<string, number[]>;
  /** Reverse dependencies (collapsed), split by kind. */
  usedBy: { statement: number[][]; proof: number[][] };
  /** Project declarations by module. */
  byModule: Map<string, number[]>;
  /** Project declarations that are not noise. */
  visible: number[];
  isNoise: (id: number) => boolean;
  search: (query: string, limit?: number) => SearchHit[];
  /** Section at a declaration's `sectionPath`, with its ancestors (outermost first). */
  sectionsOf: (id: number) => Section[];
  /** Stable key for URLs: the name, plus `~module` when the name is not unique. */
  keyOf: (id: number) => string;
  idOfKey: (key: string) => number | undefined;
}

export interface SearchHit {
  id: number;
  name: string;
  title: string;
  module: string | null;
  score: number;
}

export const isNoiseDecl = (d: Decl) => d.flags.some((f) => f.startsWith('noise:'));

export function buildIndexes(data: ProofmapData): Indexes {
  const decls = data.decls;
  const n = decls.length;
  const byName = new Map<string, number[]>();
  const byModule = new Map<string, number[]>();
  const usedBy = {
    statement: Array.from({ length: n }, () => [] as number[]),
    proof: Array.from({ length: n }, () => [] as number[]),
  };
  const visible: number[] = [];
  const noise = new Uint8Array(n);
  for (const d of decls) {
    byName.set(d.name, [...(byName.get(d.name) ?? []), d.id]);
    if (isNoiseDecl(d)) noise[d.id] = 1;
    if (!d.external) {
      if (d.module) byModule.set(d.module, [...(byModule.get(d.module) ?? []), d.id]);
      if (!noise[d.id]) visible.push(d.id);
    }
    for (const t of d.deps.statement) usedBy.statement[t]!.push(d.id);
    for (const t of d.deps.proof) usedBy.proof[t]!.push(d.id);
  }

  // Search over project declarations and the externals they use directly.
  const roots = new Set(data.project.roots);
  const mini = new MiniSearch<{ id: number; name: string; title: string; summary: string; module: string }>({
    fields: ['name', 'title', 'summary', 'module'],
    storeFields: [],
    searchOptions: {
      boost: { name: 3, title: 2 },
      prefix: true,
      fuzzy: 0.15,
      // Main results first, then the project's own declarations, then other libraries'.
      boostDocument: (docId) => (roots.has(docId as number) ? 3 : decls[docId as number]?.external ? 1 : 2),
    },
    // Split names on dots and underscores, and text on Markdown and punctuation, so `double_eq`
    // finds `Fixture.double_eq_add`, `Fermat` finds "**Fermat's theorem**" and `four-squares` finds
    // `sum_four_squares`.
    tokenize: (text) => text.split(/[\s.,;:_()[\]{}`'"*#|$!?<>=+^~/-]+/u).filter(Boolean),
  });
  mini.addAll(
    decls
      .filter((d) => !noise[d.id])
      .map((d) => ({ id: d.id, name: d.name, title: d.title, summary: d.summary?.text ?? '', module: d.module ?? '' })),
  );

  const moduleSections = new Map<string, Section[]>(data.modules.map((m) => [m.name, m.sections]));

  const keyOf = (id: number) => {
    const d = decls[id]!;
    return (byName.get(d.name)?.length ?? 0) > 1 ? `${d.name}~${d.module ?? ''}` : d.name;
  };

  return {
    data,
    decls,
    byName,
    usedBy,
    byModule,
    visible,
    isNoise: (id) => noise[id] === 1,
    search: (query, limit = 20) => {
      const start = performance.now();
      const hits = mini
        .search(query)
        .slice(0, limit)
        .map((r) => {
          const d = decls[r.id as number]!;
          return { id: d.id, name: d.name, title: d.title, module: d.module, score: r.score };
        });
      // Recorded for the performance checks.
      performance.measure('proofmap:search', { start });
      return hits;
    },
    sectionsOf: (id) => {
      const d = decls[id]!;
      const out: Section[] = [];
      let nodes = (d.module && moduleSections.get(d.module)) || [];
      for (const i of d.sectionPath) {
        const s = nodes[i];
        if (!s) break;
        out.push(s);
        nodes = s.children;
      }
      return out;
    },
    keyOf,
    idOfKey: (key) => {
      const [name, module] = key.split('~');
      const ids = byName.get(name ?? '') ?? [];
      if (module === undefined) return ids[0];
      return ids.find((id) => (decls[id]!.module ?? '') === module);
    },
  };
}
