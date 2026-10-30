import { useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import type { Indexes } from '../data/indexes';
import type { ProofmapData } from '../data/schema';
import { compare, type ChangeKind } from '../graph/compare';
import { useStore } from '../state/store';
import { Stat } from './HealthView';

const whatLabel: Record<ChangeKind, string> = {
  signature: 'statement',
  code: 'code',
  status: 'status',
  dependencies: 'dependencies',
};

/**
 * Compare view: what changed since an older snapshot. The snapshot is
 * embedded by `proofmap compare OLD.json NEW.json`, or chosen here from disk (any
 * proofmap.json written by `proofmap build --json`). Added and changed declarations are also
 * badged on the map.
 */
export function CompareView({ ix }: { ix: Indexes }) {
  const comparison = useStore((s) => s.comparison);
  const setComparison = useStore((s) => s.setComparison);
  const select = useStore((s) => s.select);
  const [error, setError] = useState<string | null>(null);

  const load = (file: File) => {
    setError(null);
    file
      .text()
      .then((text) => {
        const old = JSON.parse(text) as ProofmapData;
        if (old.schema !== 1 || !Array.isArray(old.decls)) throw new Error('not a proofmap.json (schema 1)');
        setComparison(compare(old, ix.data));
      })
      .catch((e: unknown) => setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`));
  };
  const picker = (label: string) => (
    <label className="icon-button file-pick">
      {label}
      <input
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) load(f);
          e.target.value = '';
        }}
      />
    </label>
  );
  const name = (id: number) => (
    <button className="linklike" onClick={() => select(id)} title={ix.decls[id]!.title}>
      {ix.decls[id]!.name}
    </button>
  );

  if (!comparison)
    return (
      <div className="health">
        <h3>Compare with an older version</h3>
        <p className="plain">
          Choose a <code>proofmap.json</code> from an earlier build (<code>proofmap build --json proofmap.json</code>) to see which
          results were added, removed or changed since then. <code>proofmap compare OLD.json NEW.json</code> makes a page with the
          comparison built in.
        </p>
        <p>{picker('Choose an older proofmap.json…')}</p>
        {error && <p role="alert">{error}</p>}
      </div>
    );

  const c = comparison;
  return (
    <div className="health">
      <p className="plain">
        Compared with <strong>{c.baseline.title}</strong>, built {c.baseline.builtAt.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC')}.{' '}
        {picker('Compare with another file…')}{' '}
        <button className="icon-button" onClick={() => setComparison(null)}>
          Stop comparing
        </button>
      </p>
      {error && <p role="alert">{error}</p>}
      <section className="stat-row" aria-label="Changes">
        <Stat label="Added" value={c.added.length} tone={c.added.length ? 'ok' : undefined} />
        <Stat label="Removed" value={c.removed.length} />
        <Stat label="Changed" value={c.changed.length} />
        <Stat label="Now sorry-free" value={c.nowSorryFree.length} tone={c.nowSorryFree.length ? 'ok' : undefined} />
        <Stat label="Newly depending on sorry" value={c.nowSorry.length} tone={c.nowSorry.length ? 'sorry' : undefined} />
      </section>
      {(c.newAxioms.length > 0 || c.goneAxioms.length > 0) && (
        <section aria-label="Axiom changes">
          <h3>Axioms</h3>
          <ul className="decl-list">
            {c.newAxioms.map((a) => (
              <li key={a}>
                <span className="badge-diff changed">new</span> now uses the extra axiom <code>{a}</code>
              </li>
            ))}
            {c.goneAxioms.map((a) => (
              <li key={a}>
                no longer uses the extra axiom <code>{a}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Added declarations">
        <h3>Added ({c.added.length})</h3>
        {c.added.length === 0 ? (
          <p className="plain">Nothing added.</p>
        ) : (
          <ul className="decl-list">
            {c.added.map((id) => (
              <li key={id}>
                <StatusBadge decl={ix.decls[id]!} /> {name(id)} <span className="muted">{ix.decls[id]!.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Changed declarations">
        <h3>Changed ({c.changed.length})</h3>
        {c.changed.length === 0 ? (
          <p className="plain">Nothing changed.</p>
        ) : (
          <ul className="decl-list">
            {c.changed.map(({ id, what }) => (
              <li key={id}>
                <StatusBadge decl={ix.decls[id]!} /> {name(id)}{' '}
                {what.map((w) => (
                  <span key={w} className="chip">
                    {whatLabel[w]}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Removed declarations">
        <h3>Removed ({c.removed.length})</h3>
        {c.removed.length === 0 ? (
          <p className="plain">Nothing removed.</p>
        ) : (
          <ul className="decl-list">
            {c.removed.map((r) => (
              <li key={`${r.module}:${r.name}`}>
                <span className="mono">{r.name}</span> <span className="muted">{r.module}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
