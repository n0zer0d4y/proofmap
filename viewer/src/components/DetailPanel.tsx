import { useEffect, useMemo, useState } from 'react';
import type { Indexes } from '../data/indexes';
import { isCoreLibrary, libraryOf, plainText } from '../data/library';
import { trustsCompiledCode } from '../data/status';
import { mainResultsNeeding } from '../graph/needed';
import { extraAxioms, whyChain } from '../graph/why';
import { useStore } from '../state/store';
import { breakable } from './breakable';
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
  const showNoise = useStore((s) => s.showNoise);
  const missingKey = useStore((s) => s.missingKey);
  if (focus === null || !ix.decls[focus]) {
    return (
      <aside className="detail" aria-label="Details">
        {missingKey ? (
          <Missing ix={ix} name={missingKey} onSelect={select} />
        ) : (
          <p className="empty">Select a result to see its statement, explanation and code.</p>
        )}
      </aside>
    );
  }
  const d = ix.decls[focus];
  const sections = ix.sectionsOf(focus);
  // Namespace sections that only repeat the module path add nothing to the breadcrumb.
  const moduleParts = new Set((d.module ?? '').split('.'));
  const crumbs = [
    d.module ?? 'other library',
    ...sections.map((s) => plainText(s.title)).filter((t) => !t.split('.').every((p) => moduleParts.has(p))),
  ];
  const uses = [...new Set([...d.deps.statement, ...d.deps.proof])].filter((i) => !ix.isNoise(i));
  const usedBy = [...new Set([...ix.usedBy.statement[focus]!, ...ix.usedBy.proof[focus]!])].filter(
    (i) => showNoise || !ix.isNoise(i),
  );
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
        <span className="fullname-text">{d.name}</span> <CopyButton text={d.name} />
      </div>
      <div className="badges">
        <Term term={d.kind} />
        {/* The rank only when it says more than the kind: a main result, or a lemma. */}
        {(d.rank === 'result' || d.rank === 'lemma') && <Term term={d.rank} />}
        {d.flags
          .filter((f) => !f.startsWith('noise:'))
          .map((f) => (
            <Term key={f} term={f} />
          ))}
        {d.external && <Term term="external" />}
      </div>
      <NeededFor ix={ix} id={focus} />
      <CheckedBy ix={ix} id={focus} />

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

      <BeforeSection ix={ix} id={focus} />

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

/** Where a sorry or an extra axiom comes from: always named in the sentence ("Rests on sorry in X"),
 * since the status covers everything below; "Why?" shows the chain down to it. */
function WhyItem({ ix, from, axiom }: { ix: Indexes; from: number; axiom: string }) {
  const [open, setOpen] = useState(false);
  const select = useStore((s) => s.select);
  const showChain = useStore((s) => s.showChain);
  const found = useMemo(() => whyChain(ix, from, axiom) ?? [], [ix, from, axiom]);
  const chain = open ? found : null;
  const isSorry = axiom === 'sorryAx';
  const source = found.length ? found[found.length - 1]! : null;
  const sourceLink =
    source !== null ? (
      <button className="linklike" onClick={() => select(source)}>
        {ix.decls[source]!.name}
      </button>
    ) : null;
  const sentence = isSorry ? (
    source === from ? (
      <>Its own proof has sorry.</>
    ) : sourceLink ? (
      <>Rests on sorry in {sourceLink}.</>
    ) : (
      <>Rests on sorry.</>
    )
  ) : trustsCompiledCode(axiom) ? (
    <>Trusts compiled code (native_decide).</>
  ) : (
    <>
      Uses the axiom <code>{axiom}</code>.
    </>
  );
  return (
    <div className="why-item">
      <p className="plain">
        <span className={`status status-${isSorry ? 'sorry' : 'axiom'}`}>{isSorry ? '✗' : '!'}</span> {sentence}{' '}
        {!open && found.length !== 1 && (
          <button className="icon-button" onClick={() => setOpen(true)}>
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
                {i === chain.length - 1 && (isSorry ? ' has sorry' : ' is the axiom')}
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

/** In a comparison: what a changed declaration was in the older version. */
function BeforeSection({ ix, id }: { ix: Indexes; id: number }) {
  const comparison = useStore((s) => s.comparison);
  const old = comparison?.before.get(id);
  if (!comparison || !old) return null;
  const d = ix.decls[id]!;
  const what = comparison.changed.find((c) => c.id === id)?.what ?? [];
  // The same words as the status badges; the axioms are named when there are extra ones.
  const status = (sorry: boolean, axioms: string[]) =>
    sorry ? 'Has sorry' : axioms.length ? `Extra axiom (${axioms.join(', ')})` : d.kind === 'theorem' ? 'Proved' : 'Complete';
  return (
    <section className="before" aria-label="In the compared version">
      <h3>In the compared version</h3>
      <p className="plain">Changed: {what.join(', ')}.</p>
      {what.includes('status') && (
        <p className="plain">
          Status: {status(old.sorry, old.nonstandardAxioms)} → {status(d.status.sorry, d.status.nonstandardAxioms)}
        </p>
      )}
      {what.includes('signature') && <pre className="signature">{old.signature}</pre>}
      {what.includes('code') && old.code && (
        <details>
          <summary>Lean code then</summary>
          <pre className="signature">{old.code}</pre>
        </details>
      )}
    </section>
  );
}

/** "copy" that confirms it copied. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      className="linklike"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      aria-label={`Copy the name ${text}`}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

/** A link named a declaration this build does not have (renamed or removed): say so, and offer
 * the closest matches. */
function Missing({ ix, name, onSelect }: { ix: Indexes; name: string; onSelect: (id: number) => void }) {
  const base = name.split('~')[0]!;
  const last = base.split('.').pop() ?? base;
  const hits = ix.search(last.replace(/_/g, ' '), 6);
  return (
    <section className="missing" role="alert">
      <p className="plain">
        <code>{base}</code> is not in this build. It may have been renamed or removed since the link was made.
      </p>
      {hits.length > 0 && (
        <>
          <h3>Closest matches</h3>
          <ul className="decl-list">
            {hits.map((h) => (
              <li key={h.id}>
                <StatusBadge decl={ix.decls[h.id]!} />{' '}
                <button className="linklike" onClick={() => onSelect(h.id)}>
                  {h.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A list of declarations, grouped: this project first, then each library; Lean core folded. */
function DeclList({ title, ids, ix, onSelect }: { title: string; ids: number[]; ix: Indexes; onSelect: (id: number) => void }) {
  const [filter, setFilter] = useState('');
  const shown = ids.filter((i) => !filter || ix.decls[i]!.name.toLowerCase().includes(filter.toLowerCase()));
  const groups = new Map<string, number[]>();
  for (const i of shown) {
    const d = ix.decls[i]!;
    const key = d.external ? libraryOf(d.module) : 'This project';
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const order = [...groups.keys()].sort((a, b) => rankGroup(a) - rankGroup(b) || a.localeCompare(b));
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
        order.map((g) => (
          <DeclGroup
            key={g}
            label={g}
            ids={groups.get(g)!}
            ix={ix}
            onSelect={onSelect}
            folded={isCoreLibrary(g) && !filter}
            single={order.length === 1}
          />
        ))
      )}
    </section>
  );
}

const rankGroup = (g: string) => (g === 'This project' ? 0 : isCoreLibrary(g) ? 2 : 1);

function DeclGroup({
  label,
  ids,
  ix,
  onSelect,
  folded,
  single,
}: {
  label: string;
  ids: number[];
  ix: Indexes;
  onSelect: (id: number) => void;
  folded: boolean;
  single: boolean;
}) {
  const [all, setAll] = useState(false);
  const limit = all ? ids.length : 30;
  const list = (
    <ul className="decl-list">
      {ids.slice(0, limit).map((i) => {
        const d = ix.decls[i]!;
        return (
          <li key={i}>
            <StatusBadge decl={d} />{' '}
            <button className="linklike" onClick={() => onSelect(i)} title={d.title}>
              {breakable(d.name)}
            </button>
            {ix.byName.get(d.name)!.length > 1 && <span className="muted"> · {d.module}</span>}
          </li>
        );
      })}
      {ids.length > limit && (
        <li>
          <button className="linklike" onClick={() => setAll(true)}>
            and {ids.length - limit} more
          </button>
        </li>
      )}
    </ul>
  );
  if (single && !folded) return list;
  return (
    <details className="decl-group" open={!folded}>
      <summary>
        {label} ({ids.length})
      </summary>
      {list}
    </details>
  );
}

/** How many of the main results rest on this declaration, as one line with a small meter (one
 * segment per main result). Not shown for a main result itself; its badge already says so. */
function NeededFor({ ix, id }: { ix: Indexes; id: number }) {
  const roots = ix.data.project.roots;
  if (!roots.length || roots.includes(id)) return null;
  const needing = mainResultsNeeding(ix, id);
  const n = needing.length;
  const names = needing.map((r) => ix.decls[r]!.title).join(', ');
  const words = n === 0 ? 'Needed for no main result' : `Needed for ${n} of ${roots.length} main result${roots.length === 1 ? '' : 's'}`;
  return (
    <div className={`needed${n === 0 ? ' muted' : ''}`} title={n ? names : undefined}>
      <span>{words}</span>
      <span className="needed-meter" aria-hidden="true">
        {roots.length <= 12 ? (
          roots.map((r, i) => <i key={r} className={i < n ? 'on' : ''} />)
        ) : (
          <b style={{ width: `${(100 * n) / roots.length}%` }} />
        )}
      </span>
    </div>
  );
}

/** The `#print axioms`, `#check` and `#eval` commands in the project's source that name this
 * declaration. They are not dependencies: for a declaration nothing uses, they say it is kept on
 * purpose. */
function CheckedBy({ ix, id }: { ix: Indexes; id: number }) {
  const refs = ix.decls[id]!.checkedBy ?? [];
  if (!refs.length) return null;
  const fileOf = (module: string) => ix.data.modules.find((m) => m.name === module)?.path ?? module;
  return (
    <p className="checked-by muted">
      Named by{' '}
      {refs.map((c, i) => (
        <span key={`${c.module}:${c.line}`}>
          {i > 0 && ', '}
          <code>#{c.command}</code> at {fileOf(c.module)}:{c.line}
        </span>
      ))}
    </p>
  );
}
