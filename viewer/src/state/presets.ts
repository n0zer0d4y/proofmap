/** Persona presets. A preset only changes defaults; every feature stays
 * reachable from every preset. */
export type Preset = 'reader' | 'mathematician' | 'developer' | 'auditor';
/** The views of the project (tabs), and the built-in docs (opened from the header, not a tab). */
export type View = 'map' | 'outline' | 'paths' | 'health' | 'compare' | 'docs';

export const PRESETS: Preset[] = ['reader', 'mathematician', 'developer', 'auditor'];
export const VIEWS: View[] = ['map', 'outline', 'paths', 'health', 'compare'];
/** Every view an address can name. */
export const ALL_VIEWS: View[] = [...VIEWS, 'docs'];

/** A view's name in a sentence ("Back to the health view"). */
export const VIEW_NAMES: Record<View, string> = {
  map: 'map',
  outline: 'outline',
  paths: 'path finder',
  health: 'health view',
  compare: 'comparison',
  docs: 'docs',
};

export interface PresetDefaults {
  view: View;
  /** Lean code shown in cards and the detail panel without a click. */
  showCode: boolean;
  /** Statements shown on cards without a click. */
  statementsExpanded: boolean;
  /** Humanized titles first, Lean names secondary. */
  namesSecondary: boolean;
  /** Noise toggles visible in the toolbar. */
  noiseControls: boolean;
  /** Lean's own libraries (Init, Std, Lean) shown as a library card on the map. */
  showCore: boolean;
}

export const PRESET_DEFAULTS: Record<Preset, PresetDefaults> = {
  reader: { view: 'outline', showCode: false, statementsExpanded: false, namesSecondary: true, noiseControls: false, showCore: false },
  mathematician: { view: 'map', showCode: false, statementsExpanded: true, namesSecondary: true, noiseControls: false, showCore: false },
  developer: { view: 'map', showCode: true, statementsExpanded: true, namesSecondary: false, noiseControls: true, showCore: true },
  auditor: { view: 'health', showCode: false, statementsExpanded: false, namesSecondary: false, noiseControls: true, showCore: true },
};

export const PRESET_LABELS: Record<Preset, string> = {
  reader: 'Reader',
  mathematician: 'Mathematician',
  developer: 'Lean developer',
  auditor: 'Auditor',
};
