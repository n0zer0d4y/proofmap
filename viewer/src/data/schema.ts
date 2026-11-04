/* Generated from schema/proofmap.schema.json by scripts/gen-types.mjs. Do not edit. */

export type DeclId = number;
/**
 * [line, column]: 1-based line, 0-based column in Unicode code points.
 *
 * @minItems 2
 * @maxItems 2
 */
export type Position = [number, number];
export type DeclKind =
  | 'theorem'
  | 'def'
  | 'abbrev'
  | 'structure'
  | 'inductive'
  | 'ctor'
  | 'recursor'
  | 'instance'
  | 'axiom'
  | 'opaque'
  | 'quot';
export type SummarySource = 'attr' | 'config' | 'docstring' | 'comment' | 'section' | 'ai';
/**
 * Noise flags start with 'noise:' and hide the declaration by default; the rest are informational. noise:generated marks a project declaration Lean generated without a source range (match splitters, congruence lemmas, deriving helpers).
 */
export type Flag =
  | 'noise:instance'
  | 'noise:aux'
  | 'noise:internal'
  | 'noise:matcher'
  | 'noise:projection'
  | 'noise:ctor'
  | 'noise:equation'
  | 'noise:generated'
  | 'private'
  | 'deprecated'
  | 'unsafe'
  | 'partial';
export type Rank = 'result' | 'theorem' | 'lemma' | 'def';
/**
 * A proof's tactic steps. proofmap build --json always writes the inline form (steps). The split form (file, build) is what the viewer holds for a page whose walkthroughs were moved into files next to it; it loads them when the walkthrough is opened. stepCount is always present.
 */
export type Walkthrough = InlineWalkthrough | SplitWalkthrough;

/**
 * proofmap.json, schema version 1. Written by the proofmap Lean extractor and read by the viewer. This file is the source of truth: the TypeScript types are generated from it and the Lean output is validated against it.
 */
export interface ProofmapData {
  schema: 2;
  generator: Generator;
  project: Project;
  modules: Module[];
  /**
   * All declarations. A declaration's id equals its index in this array.
   */
  decls: Decl[];
  walkthroughs: Walkthrough[];
  /**
   * Name fragment to plain-words expansions used for humanized titles (built-in defaults merged with config).
   */
  glossary: {
    [k: string]: string;
  };
}
export interface Generator {
  name: 'proofmap';
  version: string;
  /**
   * Lean version the extractor ran on, e.g. 4.29.0.
   */
  lean: string;
}
export interface Project {
  title: string;
  rootModules: string[];
  repoUrl?: string | null;
  repoRef?: string | null;
  /**
   * The project folder relative to the page, with forward slashes ("" when the page is in the project folder). Written for single-file pages only, so the viewer can link to source files; no absolute path is ever recorded.
   */
  pageToRoot?: string | null;
  /**
   * ISO 8601 timestamp of the build.
   */
  builtAt: string;
  /**
   * Ids of the root declarations (from config, or detected automatically).
   */
  roots: DeclId[];
  /**
   * Axioms counted as standard; anything else is reported as non-standard.
   */
  standardAxioms?: string[];
  preset?: 'reader' | 'mathematician' | 'developer' | 'auditor';
  /**
   * Show the 'Made with proofmap' footer (default true).
   */
  footer?: boolean;
}
export interface Module {
  name: string;
  /**
   * Source path relative to the project root, forward slashes.
   */
  path: string | null;
  imports: string[];
  /**
   * Module docs (/-! ... -/ blocks) joined as Markdown.
   */
  doc: string | null;
  sections: Section[];
}
export interface Section {
  title: string;
  /**
   * What produced the section: a heading in a module doc, a divider comment, or a section/namespace block.
   */
  source: 'doc' | 'divider' | 'section' | 'namespace';
  description?: string | null;
  range: Range;
  children: Section[];
}
export interface Range {
  start: Position;
  end: Position;
}
export interface Decl {
  id: DeclId;
  /**
   * Full Lean name as written (private names unmangled).
   */
  name: string;
  /**
   * Humanized title.
   */
  title: string;
  kind: DeclKind;
  module: string | null;
  /**
   * True for declarations outside the root modules (boundary nodes).
   */
  external: boolean;
  range: Range | null;
  /**
   * Index path into the module's section tree (sections[i].children[j]...). Empty when outside any section.
   */
  sectionPath: number[];
  signature: string;
  signatureHover: HoverSpan[];
  summary: Summary | null;
  docstring: string | null;
  leadingComment: string | null;
  /**
   * Full source of the declaration; null for external declarations.
   */
  code: string | null;
  flags: Flag[];
  status: Status;
  deps: DepLists;
  directDeps: DepLists1;
  size: {
    lines: number;
    exprNodes: number;
  };
  rank: Rank;
  /**
   * Step label used to group big steps on the map.
   */
  step: string | null;
  tags: Tags;
  /**
   * Index into walkthroughs, or null.
   */
  walkthrough: number | null;
}
/**
 * A name inside the signature that links to a declaration. Offsets are Unicode code points into the signature string, end exclusive.
 */
export interface HoverSpan {
  start: number;
  end: number;
  decl: DeclId;
}
export interface Summary {
  text: string;
  source: SummarySource;
}
export interface Status {
  sorry: boolean;
  /**
   * All axioms used, sorted. Includes sorryAx when sorry is true.
   */
  axioms: string[];
  /**
   * Axioms outside the standard set, excluding sorryAx, sorted.
   */
  nonstandardAxioms: string[];
}
/**
 * Direct dependencies after collapsing through noise: what the map draws.
 */
export interface DepLists {
  statement: DeclId[];
  proof: DeclId[];
}
/**
 * Direct dependencies as Lean records them, including noise declarations. An edge in deps but not in directDeps is routed through hidden noise.
 */
export interface DepLists1 {
  statement: DeclId[];
  proof: DeclId[];
}
/**
 * Author tags from @[proofmap ...] or proofmap.toml.
 */
export interface Tags {
  step?: string;
  rank?: Rank;
  summary?: string;
}
export interface InlineWalkthrough {
  decl: DeclId;
  stepCount: number;
  steps: Step[];
}
export interface Step {
  tactic: string;
  range: Range;
  /**
   * Nesting depth; children of a compound tactic follow it with depth + 1.
   */
  depth: number;
  goalsBefore: string[];
  goalsAfter: string[];
}
export interface SplitWalkthrough {
  decl: DeclId;
  stepCount: number;
  /**
   * Script relative to the page. It calls window.__proofmapWalkthroughs(file, build, { "<declaration name>": steps, ... }).
   */
  file: string;
  /**
   * Id the script must carry; a mismatch means the page and the script come from different builds.
   */
  build: string;
}
