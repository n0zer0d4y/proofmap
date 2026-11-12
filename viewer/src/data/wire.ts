import type { CheckRef, Decl, DeclKind, ProofmapData, Rank, Status, Step, SummarySource, Walkthrough } from './schema';

/**
 * The page payload. Pages carry the data in a compact form written by
 * `lean/Proofmap/Package/Wire.lean`; this is the one place that reads it, turning it back into
 * the public `proofmap.json` shape the rest of the viewer uses. Public JSON (from
 * `proofmap build --json`, or a `proofmap compare` page) passes through unchanged.
 *
 * The compact form loses exactly what `slimForWire` removes, nothing else; a test checks
 * `decode(wire)` against `slimForWire(public)` for the same build.
 */

export const WIRE_VERSION = 1;

export class StaleDataError extends Error {}

type Deps2 = [number[], number[]];
type Range4 = [number, number, number, number];
/** [tactic, range, depth, goalsBefore, goalsAfter]; a goal is line indices into its module's table. */
export type WireStep = [string, Range4, number, number[][], number[][]];

interface WireDecl {
  n: string;
  /** Absent for a split helper's stub. */
  t?: string;
  k: number;
  s: number;
  m?: number;
  x?: 1;
  r?: Range4;
  p?: number[];
  /** Absent for a split helper's stub. */
  g?: string;
  h?: [number, number, number][];
  u?: [string, SummarySource];
  o?: string;
  l?: string;
  c?: string;
  f?: string[];
  d: Deps2;
  e?: Deps2;
  z: [number, number];
  a: Rank;
  q?: string;
  y?: Decl['tags'];
  w?: number;
  /** checkedBy: [command, module, line]. */
  v?: [string, string, number][];
}

interface WireWalkthrough {
  d: number;
  n: number;
  s?: WireStep[];
  f?: string;
  b?: string;
}

export interface Wire extends Pick<ProofmapData, 'schema' | 'generator' | 'project' | 'modules' | 'glossary'> {
  wire: number;
  /** Set when generated helpers were split out: their details are in this script. */
  helpers?: { f: string; b: string };
  kinds: DeclKind[];
  moduleNames: string[];
  statuses: Status[];
  decls: WireDecl[];
  walkthroughs: WireWalkthrough[];
  goalLines: Record<string, string[]>;
}

const range = (r: Range4) => ({ start: [r[0], r[1]] as [number, number], end: [r[2], r[3]] as [number, number] });
const deps = (d: Deps2) => ({ statement: d[0], proof: d[1] });

/** Steps from their compact form, with goals rebuilt from the module's line table. */
export function decodeSteps(steps: WireStep[], lines: string[]): Step[] {
  const goal = (g: number[]) => g.map((i) => lines[i]).join('\n');
  return steps.map(([tactic, r, depth, before, after]) => ({
    tactic,
    range: range(r),
    depth,
    goalsBefore: before.map(goal),
    goalsAfter: after.map(goal),
  }));
}

/** Page payload or public JSON to the public shape. */
export function decode(raw: unknown): ProofmapData {
  const obj = raw as Partial<Wire> & Partial<ProofmapData>;
  if (obj.wire === undefined) {
    // Version 1 (proofmap 0.1) differs only in `project.rootDir`, which the viewer does not use, so
    // older snapshots still open for comparison.
    const version = obj.schema as number | undefined;
    if ((version !== 1 && version !== 2) || !Array.isArray(obj.decls)) throw new Error('not proofmap data (schema 1 or 2)');
    return obj as ProofmapData;
  }
  if (obj.wire !== WIRE_VERSION)
    throw new StaleDataError('The data comes from a different version of proofmap than this page. Rebuild, or reload the page.');
  const w = obj as Wire;
  tables = w;
  pendingHelpers = w.helpers ?? null;
  const decls: Decl[] = w.decls.map((x, id) => declFrom(w, x, id));
  const walkthroughs: Walkthrough[] = w.walkthroughs.map((x) => {
    if (x.f !== undefined) return { decl: x.d, stepCount: x.n, file: x.f, build: x.b! };
    const module = decls[x.d]?.module ?? '_';
    return { decl: x.d, stepCount: x.n, steps: decodeSteps(x.s ?? [], w.goalLines[module] ?? []) };
  });
  return {
    schema: w.schema,
    generator: w.generator,
    project: w.project,
    modules: w.modules,
    decls,
    walkthroughs,
    glossary: w.glossary,
  };
}

/** One declaration. A split helper's stub has no title or statement yet: it shows its last name
 * component until `loadHelperDetails` fills it in. */
function declFrom(w: Pick<Wire, 'kinds' | 'moduleNames' | 'statuses'>, x: WireDecl, id: number): Decl {
  return {
    id,
    name: x.n,
    title: x.t ?? x.n.split('.').at(-1) ?? x.n,
    kind: w.kinds[x.k]!,
    module: x.m === undefined ? null : w.moduleNames[x.m]!,
    external: x.x === 1,
    range: x.r ? range(x.r) : null,
    sectionPath: x.p ?? [],
    signature: x.g ?? '',
    signatureHover: (x.h ?? []).map(([start, end, decl]) => ({ start, end, decl })),
    summary: x.u ? { text: x.u[0], source: x.u[1] } : null,
    docstring: x.o ?? null,
    leadingComment: x.l ?? null,
    code: x.c ?? null,
    flags: (x.f ?? []) as Decl['flags'],
    status: w.statuses[x.s]!,
    deps: deps(x.d),
    // Left out when equal to deps.
    directDeps: deps(x.e ?? x.d),
    size: { lines: x.z[0], exprNodes: x.z[1] },
    rank: x.a,
    step: x.q ?? null,
    tags: x.y ?? {},
    walkthrough: x.w ?? null,
    checkedBy: (x.v ?? []).map(([command, module, line]) => ({ command: command as CheckRef['command'], module, line })),
  };
}

let tables: Pick<Wire, 'kinds' | 'moduleNames' | 'statuses'> | null = null;
let pendingHelpers: { f: string; b: string } | null = null;
let helpersLoad: Promise<boolean> | null = null;

/** Whether generated helpers' details are still in their script (a big single file). */
export const helperDetailsPending = () => pendingHelpers !== null;

/**
 * Load the generated helpers' details from their script and fill them into `data` in place.
 * Resolves to true when something changed (the caller rebuilds its indexes). A script from
 * another build is refused, as with walkthrough chunks.
 */
export function loadHelperDetails(data: ProofmapData, timeoutMs = 30000): Promise<boolean> {
  const pending = pendingHelpers;
  const t = tables;
  if (!pending || !t) return Promise.resolve(false);
  helpersLoad ??= new Promise<boolean>((resolve, reject) => {
    const missing = () => new StaleDataError(`The file ${pending.f} could not be loaded. Keep the folder next to the page, or rebuild.`);
    const timer = setTimeout(() => reject(missing()), timeoutMs);
    window.__proofmapHelpers = (file, build, details) => {
      if (file !== pending.f) return;
      clearTimeout(timer);
      if (build !== pending.b) return reject(new StaleDataError('The helpers file comes from a different build than this page. Rebuild, or reload the page.'));
      for (const [id, extra] of Object.entries(details)) {
        const i = Number(id);
        const stub = wireOf(data.decls[i]!, t);
        data.decls[i] = declFrom(t, { ...stub, ...extra }, i);
      }
      pendingHelpers = null;
      resolve(true);
    };
    const s = document.createElement('script');
    s.src = location.protocol.startsWith('http') ? `${pending.f}?v=${encodeURIComponent(pending.b)}` : pending.f;
    s.onerror = () => {
      clearTimeout(timer);
      reject(missing());
    };
    document.head.append(s);
  });
  return helpersLoad;
}

/** The stub fields of a decoded declaration, back in short keys (to merge the details into). */
function wireOf(d: Decl, t: Pick<Wire, 'kinds' | 'moduleNames' | 'statuses'>): WireDecl {
  return {
    n: d.name,
    k: t.kinds.indexOf(d.kind),
    s: t.statuses.indexOf(d.status),
    m: d.module === null ? undefined : t.moduleNames.indexOf(d.module),
    x: d.external ? 1 : undefined,
    r: d.range ? [d.range.start[0], d.range.start[1], d.range.end[0], d.range.end[1]] : undefined,
    f: d.flags,
    d: [d.deps.statement, d.deps.proof],
    e: [d.directDeps.statement, d.directDeps.proof],
    z: [d.size.lines, d.size.exprNodes],
    a: d.rank,
    v: d.checkedBy?.length ? d.checkedBy.map((c) => [c.command, c.module, c.line] as [string, string, number]) : undefined,
  };
}

declare global {
  interface Window {
    __proofmapHelpers?: (file: string, build: string, details: Record<string, Partial<WireDecl>>) => void;
  }
}

/** Exactly what the page payload leaves out: generated helpers carry no hover spans or code. */
export function slimForWire(data: ProofmapData): ProofmapData {
  return {
    ...data,
    decls: data.decls.map((d) =>
      d.flags.some((f) => f.startsWith('noise:')) ? { ...d, signatureHover: [], code: null } : d,
    ),
  };
}
