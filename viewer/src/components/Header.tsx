import type { Indexes } from '../data/indexes';
import { PRESETS, PRESET_LABELS, VIEWS, type Preset, type View } from '../state/presets';
import { useStore } from '../state/store';
import type { Theme } from '../state/url';
import { ExportButton } from './Export';
import { SearchBox } from './SearchBox';
import { useTour } from './Tour';

const VIEW_LABELS: Record<View, string> = {
  map: 'Map',
  outline: 'Outline',
  paths: 'Paths',
  health: 'Health',
  compare: 'Compare',
};

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

export function Header({ ix }: { ix: Indexes }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const preset = useStore((s) => s.preset);
  const setPreset = useStore((s) => s.setPreset);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const tourGo = useStore((s) => s.tourGo);
  const { steps, pathTo } = useTour(ix);
  return (
    <header className="header">
      <h1 title={ix.data.project.title}>{ix.data.project.title}</h1>
      <SearchBox ix={ix} />
      <div className="tabs" role="tablist" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      <span className="spacer" />
      <button className="icon-button" disabled={!steps.length} onClick={() => tourGo(0, pathTo(steps[0]!))}>
        Walk me through it
      </button>
      <ExportButton title={ix.data.project.title} />
      <label>
        <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>
          Persona preset
        </span>
        <select
          className="control"
          aria-label="Persona preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <button className="icon-button" onClick={() => setTheme(NEXT_THEME[theme])} aria-label={THEME_LABEL[theme]}>
        {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'} {theme}
      </button>
    </header>
  );
}
