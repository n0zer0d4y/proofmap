import { useMemo } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { Term } from '../components/Term';
import type { Indexes } from '../data/indexes';
import { computeHealth } from '../graph/health';
import { useStore } from '../state/store';

/** Health and progress: computed from the code, not maintained by hand. */
export function HealthView({ ix }: { ix: Indexes }) {
  const h = useMemo(() => computeHealth(ix), [ix]);
  const select = useStore((s) => s.select);
  const name = (id: number) => (
    <button className="linklike" onClick={() => select(id)} title={ix.decls[id]!.title}>
      {ix.decls[id]!.name}
    </button>
  );
  const pct = (ok: number, total: number) => (total ? Math.round((100 * ok) / total) : 100);
  return (
    <div className="health">
      <section className="stat-row" aria-label="Counts">
        <Stat label="Results and definitions" value={h.total} />
        <Stat label="Fully proved" value={h.proved} tone="ok" />
        <Stat label={<Term term="sorry">Contain sorry</Term>} value={h.sorry} tone={h.sorry ? 'sorry' : undefined} />
        <Stat label={<Term term="axiom">Extra axioms</Term>} value={h.nonstandard} tone={h.nonstandard ? 'axiom' : undefined} />
        <Stat label={<Term term="deprecated">Deprecated</Term>} value={h.deprecated} />
        <Stat label={<Term term="unsafe">Unsafe or partial</Term>} value={h.unsafe} />
      </section>

      <section aria-label="Unfinished proofs">
        <h3>Unfinished proofs (sorry)</h3>
        {h.sorrySources.length === 0 ? (
          <p className="plain">No proof contains sorry. ✓</p>
        ) : (
          <ul className="decl-list">
            {h.sorrySources.map((s) => (
              <li key={s.id}>
                <StatusBadge decl={ix.decls[s.id]!} /> {name(s.id)}: {s.downstream} result{s.downstream === 1 ? '' : 's'} rest on it
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Axioms">
        <h3>Axioms used</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Axiom</th>
              <th>Results using it</th>
              <th>Kind</th>
            </tr>
          </thead>
          <tbody>
            {h.axioms.map((a) => (
              <tr key={a.name}>
                <td className="mono">{a.name === 'sorryAx' ? 'sorry' : a.name}</td>
                <td>{a.count}</td>
                <td>{a.name === 'sorryAx' ? 'unfinished proof' : a.standard ? 'standard' : 'extra assumption'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Largest proofs" className="two-col">
        <div>
          <h3>Longest (lines of source)</h3>
          <ol>
            {h.largestByLines.map((id) => (
              <li key={id}>
                {name(id)} <span className="muted">{ix.decls[id]!.size.lines} lines</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Largest proof terms</h3>
          <ol>
            {h.largestByTerm.map((id) => (
              <li key={id}>
                {name(id)} <span className="muted">{ix.decls[id]!.size.exprNodes.toLocaleString()} nodes</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="Unused declarations">
        <h3>Not used by other declarations ({h.unused.length})</h3>
        <p className="muted plain">
          Results and definitions that no other declaration in the project uses (main results excluded). Scripts, tests
          outside Lean and documents are not read, so a result checked only there is listed too.
          {h.generated > 0 &&
            ` ${h.generated.toLocaleString()} declaration${h.generated === 1 ? '' : 's'} that Lean generated without a source location (match splitters, congruence lemmas, deriving helpers) ${h.generated === 1 ? 'is' : 'are'} not listed.`}
        </p>
        <ul className="decl-list columns">
          {h.unused.slice(0, 300).map((id) => (
            <li key={id}>{name(id)}</li>
          ))}
          {h.unused.length > 300 && <li className="muted">and {h.unused.length - 300} more</li>}
        </ul>
      </section>

      <section aria-label="Progress" className="two-col">
        {[
          ['By module', h.byModule],
          ['By step', h.byStep],
        ].map(([title, rows]) => (
          <div key={title as string}>
            <h3>{title as string}</h3>
            {(rows as typeof h.byModule).map((r) => (
              <div className="progress" key={r.name}>
                <span className="progress-label mono" title={r.name}>
                  {r.name}
                </span>
                <span className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(r.ok, r.total)} aria-label={`${r.name}: ${pct(r.ok, r.total)}% proved`}>
                  <span style={{ width: `${pct(r.ok, r.total)}%` }} />
                </span>
                <span className="muted">
                  {r.ok}/{r.total}
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: React.ReactNode; value: number; tone?: 'ok' | 'sorry' | 'axiom' }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
