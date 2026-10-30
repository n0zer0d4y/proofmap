import { useMemo, useState } from 'react';
import { Statement } from '../components/Statement';
import { StatusBadge } from '../components/StatusBadge';
import type { Indexes } from '../data/indexes';
import { outlineRows } from '../graph/outline';
import { useStore } from '../state/store';

/**
 * The outline: the same information as the map, as a collapsible list that
 * reads like the table of contents of a proof. A result used in several places is shown in full
 * once; elsewhere it is an "also used here" link. Print mode turns it into a document with
 * summaries and statements.
 */
export function OutlineView({ ix }: { ix: Indexes }) {
  const roots = ix.data.project.roots.length ? ix.data.project.roots : ix.visible.slice(0, 1);
  const [open, setOpen] = useState<Set<number>>(() => new Set(roots));
  const focus = useStore((s) => s.focus);
  const select = useStore((s) => s.select);
  const namesSecondary = useStore((s) => s.namesSecondary);
  const rows = useMemo(() => outlineRows(ix, roots, open), [ix, roots, open]);
  const toggle = (id: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const expandTo = (depth: number) => {
    // Open every first occurrence down to `depth` (bounded, so huge projects stay printable).
    const next = new Set<number>();
    for (let d = 0; d < depth; d++)
      for (const r of outlineRows(ix, roots, next)) if (r.depth === d && r.first && r.hasChildren && next.size < 2000) next.add(r.id);
    setOpen(next);
  };
  const firstRow = (id: number) => document.getElementById(`outline-${id}`);
  return (
    <div className="outline">
      <div className="outline-toolbar" role="toolbar" aria-label="Outline controls">
        <button className="icon-button" onClick={() => expandTo(3)}>
          Expand 3 levels
        </button>
        <button className="icon-button" onClick={() => setOpen(new Set(roots))}>
          Collapse
        </button>
        <button
          className="icon-button"
          onClick={() => {
            document.documentElement.classList.add('printing');
            window.print();
            setTimeout(() => document.documentElement.classList.remove('printing'), 500);
          }}
        >
          Print / PDF
        </button>
      </div>
      <ul role="tree" aria-label="Outline of the main results">
        {rows.map((r, i) => {
          const d = ix.decls[r.id]!;
          const isOpen = r.first && open.has(r.id);
          return (
            <li
              key={`${i}-${r.id}`}
              id={r.first ? `outline-${r.id}` : undefined}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.first && r.hasChildren ? isOpen : undefined}
              aria-selected={focus === r.id}
              className={`outline-row${focus === r.id ? ' selected' : ''}`}
              style={{ paddingLeft: 8 + r.depth * 20 }}
            >
              <div className="outline-line">
                {r.first && r.hasChildren ? (
                  <button className="chevron" onClick={() => toggle(r.id)} aria-label={isOpen ? `Collapse ${d.title}` : `Expand ${d.title}`}>
                    {isOpen ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="chevron" aria-hidden="true" />
                )}
                <StatusBadge decl={d} />
                {r.depth === 0 && <span aria-label="main result">★</span>}
                <button className="outline-title" onClick={() => select(r.id)}>
                  {namesSecondary ? d.title : d.name}
                </button>
                {!namesSecondary && <span className="outline-sub">{d.title}</span>}
                {!r.first && (
                  <button
                    className="linklike also"
                    onClick={() => {
                      select(r.id);
                      firstRow(r.id)?.scrollIntoView({ block: 'center' });
                    }}
                  >
                    ↪ also used here
                  </button>
                )}
              </div>
              {r.first && d.summary && (
                <div className="outline-summary">{d.summary.source === 'section' ? <em>In section: {d.summary.text}</em> : d.summary.text}</div>
              )}
              {r.first && (
                <div className="print-only">
                  <Statement decl={d} ix={ix} onSelect={select} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
