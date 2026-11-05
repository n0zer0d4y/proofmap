import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MarkdownInline } from '../components/Markdown';
import { Statement } from '../components/Statement';
import { StatusBadge } from '../components/StatusBadge';
import type { Indexes } from '../data/indexes';
import { outlinePathTo, outlineRows } from '../graph/outline';
import { useStore } from '../state/store';

/** Expand all stops before the outline would show more rows than this at once. */
const MAX_ROWS = 2000;

/**
 * The outline: the same information as the map, as a collapsible list that
 * reads like the table of contents of a proof. A result used in several places is shown in full
 * once; elsewhere it is an "also used here" link. Print mode turns it into a document with
 * summaries and statements. What is open and the scroll position are kept in the store, so the
 * outline comes back as it was left after another view or Back.
 */
export function OutlineView({ ix }: { ix: Indexes }) {
  const roots = useMemo(() => (ix.data.project.roots.length ? ix.data.project.roots : ix.visible.slice(0, 1)), [ix]);
  const stored = useStore((s) => s.outlineOpen);
  const setStored = useStore((s) => s.setOutlineOpen);
  const open = useMemo(() => stored ?? new Set(roots), [stored, roots]);
  const setOpen = (next: Set<number>) => setStored(next);
  const focus = useStore((s) => s.focus);
  const select = useStore((s) => s.select);
  const namesSecondary = useStore((s) => s.namesSecondary);
  const rows = useMemo(() => outlineRows(ix, roots, open), [ix, roots, open]);
  const toggle = (id: number) => {
    const n = new Set(open);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setOpen(n);
  };
  // Expand all: open level after level. A very large project stops before the outline passes
  // MAX_ROWS rows, so the page stays responsive, and says so.
  const [capped, setCapped] = useState<number | null>(null);
  const expandAll = () => {
    let next = new Set<number>();
    for (let d = 0; d < 64; d++) {
      const level = outlineRows(ix, roots, next).filter((r) => r.depth === d && r.first && r.hasChildren).map((r) => r.id);
      if (!level.length) {
        setCapped(null);
        break;
      }
      const tried = new Set([...next, ...level]);
      if (outlineRows(ix, roots, tried).length > MAX_ROWS) {
        setCapped(d);
        break;
      }
      next = tried;
    }
    setOpen(next);
  };
  const collapseAll = () => {
    setCapped(null);
    setOpen(new Set());
  };
  const firstRow = (id: number) => document.getElementById(`outline-${id}`);

  // The statements for print are made only for printing (the button, or the browser's own print):
  // kept on screen for every row, they made a large outline slow to open and close.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  // Restore the scroll position on return, and remember it while scrolling.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = useStore.getState().outlineScroll;
  }, []);
  const onScroll = () => useStore.getState().setOutlineScroll(scroller.current?.scrollTop ?? 0);

  // Reveal a selection made elsewhere (search, the map, a link): open the way down to it and
  // bring its row into view. Only a change of selection does this.
  const lastFocus = useRef<number | null>(null);
  const pendingScroll = useRef<number | null>(null);
  // The way down to the selection; null when it is not below any main result, so the outline
  // cannot show it.
  const focusPath = useMemo(
    () => (focus === null || ix.decls[focus]?.external ? undefined : outlinePathTo(ix, roots, focus)),
    [focus, ix, roots],
  );
  const outside = focusPath === null ? focus : null;
  useEffect(() => {
    if (focus === lastFocus.current) return;
    lastFocus.current = focus;
    if (focus === null || !focusPath) return;
    if (!rows.some((r) => r.id === focus && r.first)) setStored(new Set([...open, ...focusPath]));
    pendingScroll.current = focus;
  }, [focus, focusPath, rows, open, setStored]);
  useEffect(() => {
    const id = pendingScroll.current;
    if (id === null) return;
    const el = firstRow(id);
    if (!el) return;
    pendingScroll.current = null;
    const box = el.getBoundingClientRect();
    const view = scroller.current?.getBoundingClientRect();
    if (!view || box.top < view.top + 40 || box.bottom > view.bottom) el.scrollIntoView({ block: 'center' });
  }, [rows]);

  return (
    <div className="outline" ref={scroller} onScroll={onScroll}>
      <div className="outline-toolbar" role="toolbar" aria-label="Outline controls">
        <button className="icon-button" onClick={expandAll}>
          Expand all
        </button>
        <button className="icon-button" onClick={collapseAll}>
          Collapse all
        </button>
        <button
          className="icon-button"
          onClick={() => {
            flushSync(() => setPrinting(true));
            document.documentElement.classList.add('printing');
            window.print();
            setTimeout(() => document.documentElement.classList.remove('printing'), 500);
          }}
        >
          Print / PDF
        </button>
      </div>
      {capped !== null && (
        <p className="outline-note" role="status">
          Expanded {capped} level{capped === 1 ? '' : 's'}: opening the next one would show more than {MAX_ROWS.toLocaleString()} rows at
          once. Open the rows you want to read further with ▸.
        </p>
      )}
      {outside !== null && (
        <p className="outline-note" role="status">
          <code>{ix.decls[outside]?.name}</code> is not part of the outline: the outline starts from the main results, and nothing
          below them uses it. The health view lists such results as standalone results; <code>roots</code> in{' '}
          <code>proofmap.toml</code> can make it a main result.
        </p>
      )}
      <ul role="tree" aria-label="Outline of the main results">
        {rows.map((r, i) => {
          const d = ix.decls[r.id]!;
          const isOpen = r.first && open.has(r.id);
          const kids = r.first && r.hasChildren && !isOpen ? outlineChildCount(ix, r.id) : 0;
          const twin = (ix.byName.get(d.name)?.length ?? 0) > 1;
          return (
            <li
              key={`${i}-${r.id}`}
              id={r.first ? `outline-${r.id}` : undefined}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.first && r.hasChildren ? isOpen : undefined}
              aria-selected={focus === r.id}
              className={`outline-row${focus === r.id ? ' selected' : ''}`}
              style={{ paddingLeft: 8 + r.depth * 20, ['--depth' as string]: r.depth }}
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
                <span className="outline-sub mono">{namesSecondary ? d.name : d.title}</span>
                {twin && <span className="outline-sub">· {d.module}</span>}
                {kids > 0 && (
                  <span className="outline-sub" title="Results under this one">
                    ({kids})
                  </span>
                )}
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
                <div className="outline-summary">
                  {d.summary.source === 'section' ? (
                    <em>
                      In section: <MarkdownInline text={d.summary.text} />
                    </em>
                  ) : (
                    <MarkdownInline text={d.summary.text} />
                  )}
                </div>
              )}
              {r.first && printing && (
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

/** How many results sit directly under a row (shown on a closed row). */
function outlineChildCount(ix: Indexes, id: number): number {
  return outlineRows(ix, [id], new Set([id]), 1).length - 1;
}
