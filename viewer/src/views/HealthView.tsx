import { useMemo, useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { Term } from '../components/Term';
import type { Indexes } from '../data/indexes';
import { plainText } from '../data/library';
import { computeHealth, type Health } from '../graph/health';
import { useStore } from '../state/store';

type ListKey = keyof Health['lists'];

const LIST_TITLES: Record<ListKey, string> = {
  total: 'All results and definitions',
  proved: 'Without sorry or extra axioms',
  sorry: 'Resting on sorry',
  nonstandard: 'Resting on an extra axiom',
  deprecated: 'Deprecated',
  unsafe: 'Unsafe or partial',
};

/** Health and progress: computed from the code, not maintained by hand. Every count opens the
 * list of declarations behind it. */
export function HealthView({ ix }: { ix: Indexes }) {
  const h = useMemo(() => computeHealth(ix), [ix]);
  const select = useStore((s) => s.select);
  const [open, setOpen] = useState<ListKey | null>(null);
  const [axiom, setAxiom] = useState<string | null>(null);
  const name = (id: number) => (
    <button className="linklike" onClick={() => select(id)} title={ix.decls[id]!.title}>
      {ix.decls[id]!.name}
    </button>
  );
  const pct = (ok: number, total: number) => (total ? Math.round((100 * ok) / total) : 100);
  const stat = (key: ListKey, label: React.ReactNode, tone?: 'ok' | 'sorry' | 'axiom') => (
    <Stat label={label} value={h.lists[key].length} tone={tone} pressed={open === key} onClick={() => setOpen(open === key ? null : key)} />
  );
  return (
    <div className="health">
      <section className="stat-row" aria-label="Counts">
        {stat('total', 'Results and definitions')}
        {stat('proved', 'Without sorry or extra axioms', 'ok')}
        {stat('sorry', <Term term="sorry">Contain sorry</Term>, h.sorry ? 'sorry' : undefined)}
        {stat('nonstandard', <Term term="axiom">Extra axioms</Term>, h.nonstandard ? 'axiom' : undefined)}
        {stat('deprecated', <Term term="deprecated">Deprecated</Term>)}
        {stat('unsafe', <Term term="unsafe">Unsafe or partial</Term>)}
      </section>
      {open && (
        <section aria-label={LIST_TITLES[open]} className="stat-list">
          <h3>
            {LIST_TITLES[open]} ({h.lists[open].length})
          </h3>
          <DeclColumns ix={ix} ids={h.lists[open]} name={name} />
        </section>
      )}

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
                <td>
                  <button className="linklike" aria-expanded={axiom === a.name} onClick={() => setAxiom(axiom === a.name ? null : a.name)}>
                    {a.count}
                  </button>
                </td>
                <td>{a.name === 'sorryAx' ? 'unfinished proof' : a.standard ? 'standard' : 'extra assumption'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {axiom && (
          <div className="stat-list">
            <h3>
              Using {axiom === 'sorryAx' ? 'sorry' : axiom} ({h.axiomUsers.get(axiom)?.length ?? 0})
            </h3>
            <DeclColumns ix={ix} ids={h.axiomUsers.get(axiom) ?? []} name={name} />
          </div>
        )}
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

      <section aria-label="Standalone results">
        <h3>Standalone results ({h.standalone.length})</h3>
        <p className="muted plain">
          Documented theorems that no other declaration uses (main results excluded). Usually findings in their own right; set{' '}
          <code>[project] roots</code> in <code>proofmap.toml</code> to make the important ones main results.
        </p>
        <DeclColumns ix={ix} ids={h.standalone} name={name} />
      </section>

      <section aria-label="Unused declarations">
        <h3>Possibly unused ({h.unused.length})</h3>
        <p className="muted plain">
          Other results and definitions that no other declaration in the project uses. Scripts, tests outside Lean and documents are
          not read, so a result checked only there is listed too.
          {h.generated > 0 &&
            ` ${h.generated.toLocaleString()} declaration${h.generated === 1 ? '' : 's'} that Lean generated without a source location (match splitters, congruence lemmas, deriving helpers) ${h.generated === 1 ? 'is' : 'are'} not listed.`}
        </p>
        <DeclColumns ix={ix} ids={h.unused} name={name} />
      </section>

      <section aria-label="Progress" className="two-col">
        <div>
          <h3>By module</h3>
          {h.byModule.map((r) => (
            <Progress key={r.name} name={r.name} ok={r.ok} total={r.total} pct={pct} mono />
          ))}
        </div>
        <div>
          <h3>By step</h3>
          {h.byStep.map((r, i) => (
            <div key={`${r.module}:${r.name}`}>
              {(i === 0 || h.byStep[i - 1]!.module !== r.module) && <div className="progress-module mono">{r.module}</div>}
              <Progress name={plainText(r.name)} ok={r.ok} total={r.total} pct={pct} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Progress({ name, ok, total, pct, mono = false }: { name: string; ok: number; total: number; pct: (ok: number, total: number) => number; mono?: boolean }) {
  return (
    <div className="progress">
      <span className={`progress-label${mono ? ' mono' : ''}`} title={name}>
        {name}
      </span>
      <span className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(ok, total)} aria-label={`${name}: ${pct(ok, total)}% proved`}>
        <span style={{ width: `${pct(ok, total)}%` }} />
      </span>
      <span className="muted">
        {ok}/{total}
      </span>
    </div>
  );
}

function DeclColumns({ ix, ids, name }: { ix: Indexes; ids: number[]; name: (id: number) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const limit = all ? ids.length : 300;
  if (!ids.length) return <p className="empty plain">None</p>;
  return (
    <ul className="decl-list columns">
      {ids.slice(0, limit).map((id) => (
        <li key={id}>
          <StatusBadge decl={ix.decls[id]!} /> {name(id)}
        </li>
      ))}
      {ids.length > limit && (
        <li>
          <button className="linklike" onClick={() => setAll(true)}>
            and {ids.length - limit} more
          </button>
        </li>
      )}
    </ul>
  );
}

export function Stat({
  label,
  value,
  tone,
  onClick,
  pressed,
}: {
  label: React.ReactNode;
  value: number;
  tone?: 'ok' | 'sorry' | 'axiom';
  onClick?: () => void;
  pressed?: boolean;
}) {
  const body = (
    <>
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </>
  );
  if (!onClick) return <div className={`stat${tone ? ` stat-${tone}` : ''}`}>{body}</div>;
  return (
    <button className={`stat stat-button${tone ? ` stat-${tone}` : ''}`} aria-pressed={pressed} onClick={onClick}>
      {body}
    </button>
  );
}
