import { create } from 'zustand';
import type { Indexes } from '../data/indexes';
import type { Comparison } from '../graph/compare';
import { PRESET_DEFAULTS, type Preset, type View } from './presets';
import { emptyUrlState, isNavigation, parse, serialize, type Theme, type UrlState } from './url';

/** One store for the whole viewer. Views select from it, so selecting
 * something in one view selects it in all of them. */
export interface ViewerState {
  view: View;
  /** Focused (selected) declaration. */
  focus: number | null;
  /** The map's anchor; null = the first root. */
  anchor: number | null;
  /** Expanded cards / outline rows. */
  expanded: Set<number>;
  /** Opened group and boundary cards (by map node id). */
  expandedGroups: Set<string>;
  preset: Preset;
  theme: Theme;
  showNoise: boolean;
  showExternal: boolean;
  showCode: boolean;
  statementsExpanded: boolean;
  namesSecondary: boolean;
  noiseControls: boolean;
  pathFrom: number | null;
  pathTo: number | null;
  walkthrough: boolean;
  /** Declarations highlighted on the map (a "why" chain, or the way to a tour step). */
  highlight: number[];
  /** Index of the current guided-tour step, or null when no tour is running. */
  tour: number | null;
  /** The comparison with an older snapshot, when one is loaded (compare view, map badges). */
  comparison: Comparison | null;
  setComparison: (c: Comparison | null) => void;
  setView: (v: View) => void;
  select: (id: number | null) => void;
  toggleExpanded: (id: number) => void;
  setAnchor: (id: number | null) => void;
  toggleGroup: (gid: string) => void;
  setExpanded: (ids: Iterable<number>) => void;
  setPreset: (p: Preset) => void;
  setTheme: (t: Theme) => void;
  setShowNoise: (b: boolean) => void;
  setShowExternal: (b: boolean) => void;
  setShowCode: (b: boolean) => void;
  setPath: (from: number | null, to: number | null) => void;
  setWalkthrough: (b: boolean) => void;
  /** Show a chain on the map: anchored at its first declaration, expanded and highlighted. */
  showChain: (chain: number[]) => void;
  /** Go to tour step `index`; `path` runs from its root to the step's result. */
  tourGo: (index: number, path: number[]) => void;
  tourEnd: () => void;
}

export const useStore = create<ViewerState>((set) => ({
  focus: null,
  anchor: null,
  expanded: new Set(),
  expandedGroups: new Set(),
  preset: 'mathematician',
  theme: 'system',
  showNoise: false,
  showExternal: true,
  ...PRESET_DEFAULTS.mathematician,
  pathFrom: null,
  pathTo: null,
  walkthrough: false,
  highlight: [],
  tour: null,
  comparison: null,
  setComparison: (comparison) => set({ comparison }),
  setView: (view) => set({ view }),
  // Selecting another result leaves the walkthrough; selecting the same one keeps it.
  select: (focus) => set((s) => ({ focus, walkthrough: s.focus === focus ? s.walkthrough : false })),
  toggleExpanded: (id) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      return { expanded };
    }),
  setExpanded: (ids) => set({ expanded: new Set(ids) }),
  setAnchor: (anchor) => set({ anchor, expanded: new Set(), expandedGroups: new Set() }),
  toggleGroup: (gid) =>
    set((s) => {
      const expandedGroups = new Set(s.expandedGroups);
      if (expandedGroups.has(gid)) expandedGroups.delete(gid);
      else expandedGroups.add(gid);
      return { expandedGroups };
    }),
  setPreset: (preset) => set({ preset, ...PRESET_DEFAULTS[preset] }),
  setTheme: (theme) => set({ theme }),
  setShowNoise: (showNoise) => set({ showNoise }),
  setShowExternal: (showExternal) => set({ showExternal }),
  setShowCode: (showCode) => set({ showCode }),
  setPath: (pathFrom, pathTo) => set({ pathFrom, pathTo }),
  setWalkthrough: (walkthrough) => set({ walkthrough }),
  showChain: (chain) =>
    set({
      view: 'map',
      anchor: chain[0] ?? null,
      expanded: new Set(chain.slice(0, -1)),
      expandedGroups: new Set(),
      highlight: chain,
      focus: chain[chain.length - 1] ?? null,
    }),
  tourGo: (index, path) =>
    set((s) => ({
      tour: index,
      focus: path[path.length - 1] ?? null,
      anchor: path[0] ?? s.anchor,
      expanded: new Set(path.slice(0, -1)),
      highlight: path,
    })),
  tourEnd: () => set({ tour: null, highlight: [] }),
}));

export function toUrlState(s: ViewerState, ix: Indexes, defaultPreset: Preset): UrlState {
  const key = (id: number | null) => (id === null ? null : ix.keyOf(id));
  return {
    view: s.view,
    focus: key(s.focus),
    anchor: key(s.anchor),
    expanded: [...s.expanded].map((id) => ix.keyOf(id)).sort(),
    groups: [...s.expandedGroups].sort(),
    preset: s.preset === defaultPreset ? null : s.preset,
    theme: s.theme,
    showNoise: s.showNoise,
    pathFrom: key(s.pathFrom),
    pathTo: key(s.pathTo),
    walkthrough: s.walkthrough,
  };
}

function applyUrlState(u: UrlState, ix: Indexes, defaultPreset: Preset): Partial<ViewerState> {
  const id = (k: string | null) => (k === null ? null : (ix.idOfKey(k) ?? null));
  const preset = u.preset ?? defaultPreset;
  return {
    ...PRESET_DEFAULTS[preset],
    preset,
    view: u.view,
    focus: id(u.focus),
    anchor: id(u.anchor),
    expanded: new Set(u.expanded.map((k) => ix.idOfKey(k)).filter((i): i is number => i !== undefined)),
    expandedGroups: new Set(u.groups),
    theme: u.theme,
    showNoise: u.showNoise,
    pathFrom: id(u.pathFrom),
    pathTo: id(u.pathTo),
    walkthrough: u.walkthrough,
  };
}

/**
 * Keeps the store and `location.hash` in sync: the state is restored from the hash on load and
 * on back/forward, and every state change is written back (pushing a history entry for a change
 * of view or focus). Returns a function that stops the sync.
 */
export function syncWithUrl(ix: Indexes, defaultPreset: Preset, win: Window = window): () => void {
  const fallbackView = PRESET_DEFAULTS[defaultPreset].view;
  let applying = false;
  const fromHash = () => {
    applying = true;
    useStore.setState(applyUrlState(parse(win.location.hash, fallbackView), ix, defaultPreset));
    applying = false;
  };
  fromHash();
  let last = toUrlState(useStore.getState(), ix, defaultPreset);
  if (!win.location.hash) win.history.replaceState(null, '', serialize(last));
  const unsubscribe = useStore.subscribe((s) => {
    if (applying) return;
    const next = toUrlState(s, ix, defaultPreset);
    const hash = serialize(next);
    if (hash === win.location.hash) return;
    if (isNavigation(last, next)) win.location.hash = hash;
    else win.history.replaceState(null, '', hash);
    last = next;
  });
  const onHash = () => {
    fromHash();
    last = toUrlState(useStore.getState(), ix, defaultPreset);
  };
  win.addEventListener('hashchange', onHash);
  return () => {
    unsubscribe();
    win.removeEventListener('hashchange', onHash);
  };
}

export const emptyState = emptyUrlState;
