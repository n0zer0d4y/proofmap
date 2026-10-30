/** Persona presets. A preset only changes defaults; every feature stays
 * reachable from every preset. */
export type Preset = 'reader' | 'mathematician' | 'developer' | 'auditor';
export type View = 'map' | 'outline' | 'paths' | 'health' | 'compare';

export const PRESETS: Preset[] = ['reader', 'mathematician', 'developer', 'auditor'];
export const VIEWS: View[] = ['map', 'outline', 'paths', 'health', 'compare'];

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
}

export const PRESET_DEFAULTS: Record<Preset, PresetDefaults> = {
  reader: { view: 'outline', showCode: false, statementsExpanded: false, namesSecondary: true, noiseControls: false },
  mathematician: { view: 'map', showCode: false, statementsExpanded: true, namesSecondary: true, noiseControls: false },
  developer: { view: 'map', showCode: true, statementsExpanded: true, namesSecondary: false, noiseControls: true },
  auditor: { view: 'health', showCode: false, statementsExpanded: false, namesSecondary: false, noiseControls: true },
};

export const PRESET_LABELS: Record<Preset, string> = {
  reader: 'Reader',
  mathematician: 'Mathematician',
  developer: 'Lean developer',
  auditor: 'Auditor',
};
