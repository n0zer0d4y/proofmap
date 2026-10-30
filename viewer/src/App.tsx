import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { DetailPanel } from './components/DetailPanel';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { buildIndexes, type Indexes } from './data/indexes';
import { loadBaseline, loadData } from './data/load';
import { helperDetailsPending, loadHelperDetails } from './data/wire';
import { compare } from './graph/compare';
import { PRESETS, type Preset } from './state/presets';
import { syncWithUrl, useStore } from './state/store';
import { TourPanel } from './components/Tour';
import { HealthView } from './views/HealthView';
import { MapView } from './views/MapView';
import { OutlineView } from './views/OutlineView';
import { PathsView } from './views/PathsView';
import { WalkthroughView } from './views/WalkthroughView';
import { CompareView } from './views/CompareView';

export function App() {
  const [ix, setIx] = useState<Indexes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData()
      .then((data) => setIx(buildIndexes(data)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!ix) return;
    document.title = `${ix.data.project.title} · proofmap`;
    const baseline = loadBaseline();
    if (baseline) useStore.getState().setComparison(compare(baseline, ix.data));
    const configured = ix.data.project.preset;
    const preset: Preset = configured && (PRESETS as string[]).includes(configured) ? configured : 'mathematician';
    return syncWithUrl(ix, preset);
  }, [ix]);

  // Big single files keep generated helpers' details in a script beside the page; load it
  // when helpers are shown or one is selected, then rebuild the indexes once.
  const showNoise = useStore((s) => s.showNoise);
  const focus = useStore((s) => s.focus);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!ix || !helperDetailsPending()) return;
    const helperFocused = focus !== null && ix.isNoise(focus);
    if (!showNoise && !helperFocused) return;
    loadHelperDetails(ix.data).then(
      (changed) => {
        if (changed) setIx(buildIndexes(ix.data));
      },
      (e: unknown) => setNotice(e instanceof Error ? e.message : String(e)),
    );
  }, [ix, showNoise, focus]);

  const theme = useStore((s) => s.theme);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  if (error) return <p className="empty" role="alert">{error}</p>;
  if (!ix) return <p className="empty">Loading…</p>;
  return (
    <div className="app">
      <Header ix={ix} />
      <main className="main">
        <Group orientation="horizontal" style={{ height: '100%' }}>
          <Panel defaultSize="64%" minSize="30%">
            <div className="panel" style={{ overflow: 'hidden' }}>
              <CurrentView ix={ix} />
            </div>
          </Panel>
          <Separator className="separator" aria-label="Resize details panel" />
          <Panel defaultSize="36%" minSize="20%">
            <div className="panel">
              <DetailPanel ix={ix} />
            </div>
          </Panel>
        </Group>
      </main>
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <Footer ix={ix} />
      <TourPanel ix={ix} />
    </div>
  );
}

function CurrentView({ ix }: { ix: Indexes }) {
  const view = useStore((s) => s.view);
  const walkthrough = useStore((s) => s.walkthrough);
  const focus = useStore((s) => s.focus);
  if (walkthrough && focus !== null && ix.decls[focus])
    return (
      <section aria-label="Proof walkthrough" data-view="walkthrough" style={{ height: '100%' }}>
        <WalkthroughView ix={ix} id={focus} key={focus} />
      </section>
    );
  const labels = { map: 'Map', outline: 'Outline', paths: 'Path finder', health: 'Health', compare: 'Compare' };
  return (
    <section aria-label={labels[view]} data-view={view} style={{ height: '100%' }}>
      {view === 'map' && <MapView ix={ix} />}
      {view === 'outline' && <OutlineView ix={ix} />}
      {view === 'paths' && <PathsView ix={ix} />}
      {view === 'health' && <HealthView ix={ix} />}
      {view === 'compare' && <CompareView ix={ix} />}
    </section>
  );
}
