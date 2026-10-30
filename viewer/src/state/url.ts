import { PRESETS, VIEWS, type Preset, type View } from './presets';

/**
 * The part of the state mirrored into the URL hash, so links can be shared
 * and the back button works, including under `file://`:
 *
 *   #/map/Fixture.main_result?exp=Fixture.double,Fixture.add_origin&preset=reader&theme=dark
 *
 * Declarations are named by `keyOf` (name, or `name~module` when the name is not unique).
 */
export type Theme = 'system' | 'light' | 'dark';

export interface UrlState {
  view: View;
  focus: string | null;
  /** The map's anchor (the result the map is built around); null = the first root. */
  anchor: string | null;
  expanded: string[];
  /** Opened group and boundary cards on the map. */
  groups: string[];
  preset: Preset | null;
  theme: Theme;
  showNoise: boolean;
  pathFrom: string | null;
  pathTo: string | null;
  walkthrough: boolean;
}

export const emptyUrlState = (view: View = 'map'): UrlState => ({
  view,
  focus: null,
  anchor: null,
  expanded: [],
  groups: [],
  preset: null,
  theme: 'system',
  showNoise: false,
  pathFrom: null,
  pathTo: null,
  walkthrough: false,
});

const enc = (s: string) => encodeURIComponent(s).replace(/%2E/g, '.').replace(/%7E/g, '~');

export function serialize(s: UrlState): string {
  let h = `#/${s.view}`;
  if (s.focus) h += `/${enc(s.focus)}`;
  const q: string[] = [];
  if (s.anchor) q.push(`at=${enc(s.anchor)}`);
  if (s.expanded.length) q.push(`exp=${s.expanded.map(enc).join(',')}`);
  if (s.groups.length) q.push(`grp=${s.groups.map(enc).join(',')}`);
  if (s.preset) q.push(`preset=${s.preset}`);
  if (s.theme !== 'system') q.push(`theme=${s.theme}`);
  if (s.showNoise) q.push('noise=1');
  if (s.pathFrom) q.push(`from=${enc(s.pathFrom)}`);
  if (s.pathTo) q.push(`to=${enc(s.pathTo)}`);
  if (s.walkthrough) q.push('wt=1');
  return q.length ? `${h}?${q.join('&')}` : h;
}

export function parse(hash: string, fallbackView: View): UrlState {
  const s = emptyUrlState(fallbackView);
  const raw = hash.replace(/^#/, '');
  const [path = '', query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] && (VIEWS as string[]).includes(parts[0])) s.view = parts[0] as View;
  if (parts[1]) s.focus = decodeURIComponent(parts.slice(1).join('/'));
  for (const kv of query.split('&').filter(Boolean)) {
    const [k = '', v = ''] = kv.split('=');
    const val = decodeURIComponent(v);
    if (k === 'exp') s.expanded = v.split(',').filter(Boolean).map(decodeURIComponent);
    else if (k === 'grp') s.groups = v.split(',').filter(Boolean).map(decodeURIComponent);
    else if (k === 'at') s.anchor = val;
    else if (k === 'preset' && (PRESETS as string[]).includes(val)) s.preset = val as Preset;
    else if (k === 'theme' && (val === 'light' || val === 'dark')) s.theme = val;
    else if (k === 'noise') s.showNoise = val === '1';
    else if (k === 'from') s.pathFrom = val;
    else if (k === 'to') s.pathTo = val;
    else if (k === 'wt') s.walkthrough = val === '1';
  }
  return s;
}

/** A change of view or focus is a navigation (new history entry); anything else replaces. */
export const isNavigation = (a: UrlState, b: UrlState) =>
  a.view !== b.view || a.focus !== b.focus || a.anchor !== b.anchor;
