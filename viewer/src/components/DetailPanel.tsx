import { useState } from 'react';
import type { Indexes } from '../data/indexes';
import { extraAxioms, whyChain } from '../graph/why';
import { useStore } from '../state/store';
import { CodeBlock } from './CodeBlock';
import { sourceLinks } from './links';
import { Markdown } from './Markdown';
import { Statement } from './Statement';
import { StatusBadge } from './StatusBadge';
import { Term } from './Term';

/** The selected declaration in full. */
export function DetailPanel({ ix }: { ix: Indexes }) {
  const focus = useStore((s) => s.focus);
  const select = useStore((s) => s.select);
  const showCode = useStore((s) => s.showCode);
  const setWalkthrough = useStore((s) => s.setWalkthrough);
  if (focus === null || !ix.decls[focus]) {
    return (
      <aside className="detail" aria-label="Details">
        <p className="empty">Select a result to see its statement, explanation and code.</p>
      </aside>
    );
  }
  const d = ix.decls[focus];
  const sections = ix.sectionsOf(focus);
  const crumbs = [d.module ?? 'other library', ...sections.map((s) => s.title)];
  const uses = [...new Set([...d.deps.statement, ...d.deps.proof])].filter((i) => !ix.isNoise(i));
  const usedBy = [...new Set([...ix.usedBy.statement[focus]!, ...ix.usedBy.proof[focus]!])];
  const links = sourceLinks(ix, d);
  const sectionDoc = [...sections].reverse().find((s) => s.description)?.description;
  const extras = extraAxioms(ix, focus);
  return (
    <aside className="detail" aria-label="Details" key={focus}>
      <div className="breadcrumb">{crumbs.join(' › ')}</div>
      <h2>
        <StatusBadge decl={d} /> {d.title}
      </h2>
      <div className="fullname">
        <span className="fullname-text">{d.name}</span>{' '}
        <button className="linklike" onClick={() => void navigator.clipboard?.writeText(d.name)} aria-label={`Copy the name ${d.name}`}>
          copy
        </button>
      </div>
      <div className="badges">
        <Term term={d.kind} />
        <Term term={d.rank} />
        {d.flags
          .filter((f) => !f.startsWith('noise:'))
          .map((f) => (
            <Term key={f} term={f} />
          ))}
        {d.external && <Term term="external" />}
      </div>

      {extras.length > 0 && (
        <section className="why" aria-label="Why this result is not fully proved">
          {extras.map((ax) => (
            <WhyItem key={ax} ix={ix} from={focus} axiom={ax} />
          ))}
        </section>
      )}

      {d.summary && d.summary.source !== 'docstring' && (
        <section>
          <h3>{d.summary.source === 'section' ? 'In section' : 'Summary'}</h3>
          <p className="plain">{d.summary.text}</p>
          <span className="chip">from {d.summary.source === 'attr' ? 'the author tag' : d.summary.source}</span>
        </section>
      )}
      {d.docstring && (
        <section>
          <h3>Description</h3>
          <Markdown text={d.docstring} />
        </section>
      )}
      {d.leadingComment && (
        <section>
          <h3>Comment in the source</h3>
          <Markdown text={d.leadingComment} className="comment" />
        </section>
      )}

      <section>
        <h3>Statement</h3>
        <Statement decl={d} ix={ix} onSelect={select} />
      </section>

      {d.code && (
        <section>
          <details open={showCode}>
            <summary>
              Lean code{d.range ? ` (lines ${d.range.start[0]}–${d.range.end[0]})` : ''}
            </summary>
            <CodeBlock code={d.code} firstLine={d.range?.start[0] ?? 1} label={`Lean code of ${d.name}`} />
          </details>
          <div className="card-links">
            {links.vscode && <a href={links.vscode}>Open in VS Code</a>}
            {links.github && (
              <a href={links.github} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            )}
          </div>
        </section>
      )}
      {d.walkthrough !== null ? (
        <p className="plain">
          <button className="icon-button" onClick={() => setWalkthrough(true)}>
            ▶ Walk through the proof ({ix.data.walkthroughs[d.walkthrough]?.stepCount ?? 0} steps)
          </button>
        </p>
      ) : (
        !d.external &&
        d.kind === 'theorem' &&
        d.code && (
          <p className="empty plain">
            {ix.data.walkthroughs.length === 0
              ? 'Walkthroughs were not built for this page (proofmap build --walkthrough adds them).'
              : 'This proof is a single term (no tactic steps to walk through).'}
          </p>
        )
      )}

      <DeclList title="Uses" ids={uses} ix={ix} onSelect={select} />
      <DeclList title="Used by" ids={usedBy} ix={ix} onSelect={select} />

      {sectionDoc && (
        <section>
          <h3>About this section</h3>
          <Markdown text={sectionDoc} />
        </section>
      )}
    </aside>
  );
}

function WhyItem({ ix, from, axiom }: { ix: Indexes; from: number; axiom: string }) {
  const [chain, setChain] = useState<number[] | null>(null);
  const select = useStore((s) => s.select);
  const showChain = useStore((s) => s.showChain);
  const label = axiom === 'sorryAx' ? 'an unfinished proof (sorry)' : `the axiom ${axiom}`;
  return (
    <div className="why-item">
      <p className="plain">
        <span className={`status status-${axiom === 'sorryAx' ? 'sorry' : 'axiom'}`}>{axiom === 'sorryAx' ? '✗' : '!'}</span> Rests on {label}.{' '}
        {!chain && (
          <button className="icon-button" onClick={() => setChain(whyChain(ix, from, axiom) ?? [])}>
            Why?
          </button>
        )}
      </p>
      {chain && chain.length > 0 && (
        <>
          <ol className="chain">
            {chain.map((id, i) => (
              <li key={id}>
                <button className="linklike" onClick={() => select(id)}>
                  {ix.decls[id]!.name}
                </button>
                {i === chain.length - 1 && (axiom === 'sorryAx' ? ' contains sorry' : ' is the axiom')}
              </li>
            ))}
          </ol>
          <button className="icon-button" onClick={() => showChain(chain)}>
            Show on map
          </button>
        </>
      )}
      {chain && chain.length === 0 && <p className="empty plain">No chain found in this project.</p>}
    </div>
  );
}

function DeclList({ title, ids, ix, onSelect }: { title: string; ids: number[]; ix: Indexes; onSelect: (id: number) => void }) {
  const [filter, setFilter] = useState('');
  const [all, setAll] = useState(false);
  const shown = ids.filter((i) => !filter || ix.decls[i]!.name.toLowerCase().includes(filter.toLowerCase()));
  const limit = all ? shown.length : 30;
  return (
    <section>
      <h3>
        {title} ({ids.length})
      </h3>
      {ids.length > 8 && (
        <input className="control filter" placeholder="Filter" aria-label={`Filter ${title.toLowerCase()}`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {ids.length === 0 ? (
        <p className="empty plain">None</p>
      ) : (
        <ul className="decl-list">
          {shown.slice(0, limit).map((i) => (
            <li key={i}>
              <StatusBadge decl={ix.decls[i]!} />{' '}
              <button className="linklike" onClick={() => onSelect(i)} title={ix.decls[i]!.title}>
                {ix.decls[i]!.name}
              </button>
            </li>
          ))}
          {shown.length > limit && (
            <li>
              <button className="linklike" onClick={() => setAll(true)}>
                and {shown.length - limit} more
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
