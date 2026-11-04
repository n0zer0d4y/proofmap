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
  showCore: boolean;
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
  /** Outline rows opened by the reader; null = the default (main results open). Kept across views. */
  outlineOpen: Set<number> | null;
  /** The outline's scroll position, restored when the reader comes back to it. */
  outlineScroll: number;
  /** The declaration key a link asked for when this build has no such declaration. */
  missingKey: string | null;
  /** A short status message (path finder pick, copy), cleared after a few seconds. */
  notice: string | null;
  /** The next URL write replaces the history entry (an automatic change, not the reader's). */
  urlReplace: boolean;
  setComparison: (c: Comparison | null) => void;
  setView: (v: View) => void;
  select: (id: number | null) => void;
  toggleExpanded: (id: number) => void;
  /** `replace`: an automatic re-anchoring that should not add a history entry. */
  setAnchor: (id: number | null, opts?: { replace?: boolean }) => void;
  setOutlineOpen: (open: Set<number> | null) => void;
  setOutlineScroll: (top: number) => void;
  setNotice: (text: string | null) => void;
  toggleGroup: (gid: string) => void;
  setExpanded: (ids: Iterable<number>) => void;
  setPreset: (p: Preset) => void;
  setTheme: (t: Theme) => void;
  setShowNoise: (b: boolean) => void;
  setShowExternal: (b: boolean) => void;
  setShowCore: (b: boolean) => void;
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
  outlineOpen: null,
  outlineScroll: 0,
  missingKey: null,
  notice: null,
  urlReplace: false,
  setComparison: (comparison) => set({ comparison }),
  // Choosing a view leaves an open walkthrough, which would otherwise hide every view.
  setView: (view) => set({ view, walkthrough: false }),
  // Selecting another result leaves the walkthrough; selecting the same one keeps it.
  select: (focus) => set((s) => ({ focus, missingKey: null, walkthrough: s.focus === focus ? s.walkthrough : false })),
  toggleExpanded: (id) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      return { expanded };
    }),
  setExpanded: (ids) => set({ expanded: new Set(ids) }),
  setAnchor: (anchor, opts) =>
    set({ anchor, expanded: new Set(), expandedGroups: new Set(), highlight: [], urlReplace: opts?.replace ?? false }),
  setOutlineOpen: (outlineOpen) => set({ outlineOpen }),
  setOutlineScroll: (outlineScroll) => set({ outlineScroll }),
  setNotice: (notice) => set({ notice }),
  toggleGroup: (gid) =>
    set((s) => {
      const expandedGroups = new Set(s.expandedGroups);
      if (expandedGroups.has(gid)) expandedGroups.delete(gid);
      else expandedGroups.add(gid);
      return { expandedGroups };
    }),
  // A preset changes what is shown, not where the reader is: its view applies only on opening.
  setPreset: (preset) => {
    const d = PRESET_DEFAULTS[preset];
    set({
      preset,
      showCode: d.showCode,
      statementsExpanded: d.statementsExpanded,
      namesSecondary: d.namesSecondary,
      noiseControls: d.noiseControls,
      showCore: d.showCore,
    });
  },
  setTheme: (theme) => {
    storeTheme(theme);
    set({ theme });
  },
  setShowNoise: (showNoise) => set({ showNoise }),
  setShowExternal: (showExternal) => set({ showExternal }),
  setShowCore: (showCore) => set({ showCore }),
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
  // The tour shows each step on the map, so it leaves any walkthrough and switches to the map.
  tourGo: (index, path) =>
    set((s) => ({
      tour: index,
      view: 'map',
      walkthrough: false,
      focus: path[path.length - 1] ?? null,
      anchor: path[0] ?? s.anchor,
      expanded: new Set(path.slice(0, -1)),
      highlight: path,
    })),
  tourEnd: () => set({ tour: null, highlight: [] }),
}));

const THEME_KEY = 'proofmap.theme';

/** The reader's theme preference; storage can be missing or blocked, so every access is guarded. */
export function storedTheme(): Theme {
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function storeTheme(theme: Theme) {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembered; the choice still applies to this page.
  }
}

export function toUrlState(s: ViewerState, ix: Indexes, defaultPreset: Preset): UrlState {
  const key = (id: number | null) => (id === null ? null : ix.keyOf(id));
  return {
    view: s.view,
    focus: key(s.focus),
    anchor: key(s.anchor),
    expanded: [...s.expanded].map((id) => ix.keyOf(id)).sort(),
    groups: [...s.expandedGroups].sort(),
    preset: s.preset === defaultPreset ? null : s.preset,
    theme: null,
    showNoise: s.showNoise,
    pathFrom: key(s.pathFrom),
    pathTo: key(s.pathTo),
    walkthrough: s.walkthrough,
  };
}

/**
 * The store state a hash describes. Settings the hash does not carry (the preset's display
 * defaults, the path finder's ends outside its view) are applied on the first load and when the
 * preset changes, and otherwise kept, so following a link or pressing Back does not reset them.
 */
function applyUrlState(u: UrlState, ix: Indexes, defaultPreset: Preset, first: boolean): Partial<ViewerState> {
  const id = (k: string | null) => (k === null ? null : (ix.idOfKey(k) ?? null));
  const preset = u.preset ?? defaultPreset;
  const focus = id(u.focus);
  const cur = useStore.getState();
  const presetChanged = first || cur.preset !== preset;
  const paths = u.view === 'paths' || first ? { pathFrom: id(u.pathFrom), pathTo: id(u.pathTo) } : {};
  return {
    ...(presetChanged ? PRESET_DEFAULTS[preset] : {}),
    ...paths,
    preset,
    view: u.view,
    focus,
    missingKey: u.focus !== null && focus === null ? u.focus : null,
    anchor: id(u.anchor),
    expanded: new Set(u.expanded.map((k) => ix.idOfKey(k)).filter((i): i is number => i !== undefined)),
    expandedGroups: new Set(u.groups),
    ...(u.theme ? { theme: u.theme } : {}),
    showNoise: u.showNoise,
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
  const fromHash = (first = false) => {
    applying = true;
    useStore.setState(applyUrlState(parse(win.location.hash, fallbackView), ix, defaultPreset, first));
    applying = false;
  };
  useStore.setState({ theme: storedTheme() });
  fromHash(true);
  let last = toUrlState(useStore.getState(), ix, defaultPreset);
  if (!win.location.hash) win.history.replaceState(null, '', serialize(last));
  const unsubscribe = useStore.subscribe((s) => {
    if (applying) return;
    const replace = s.urlReplace;
    if (replace) {
      applying = true;
      useStore.setState({ urlReplace: false });
      applying = false;
    }
    const next = toUrlState(s, ix, defaultPreset);
    const hash = serialize(next);
    if (hash === win.location.hash) return;
    if (!replace && isNavigation(last, next)) win.location.hash = hash;
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
