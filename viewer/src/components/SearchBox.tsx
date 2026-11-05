import { useEffect, useMemo, useRef, useState } from 'react';
import type { Indexes } from '../data/indexes';
import { useStore } from '../state/store';

/**
 * A combobox over the declarations: type, then arrow keys and Enter (or click) choose one.
 * `allowed` limits the choices (the path finder offers only ends that make a path), and
 * `suggestions` are listed before anything is typed.
 */
export function DeclSearch({
  ix,
  onChoose,
  placeholder,
  label,
  inputRef,
  allowed,
  suggestions,
}: {
  ix: Indexes;
  onChoose: (id: number) => void;
  placeholder: string;
  label: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  allowed?: ReadonlySet<number>;
  suggestions?: number[];
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const hits = useMemo(() => {
    const q = query.trim();
    if (!q) return (suggestions ?? []).slice(0, 100).map((id) => ({ id, name: ix.decls[id]!.name, title: ix.decls[id]!.title }));
    if (!allowed) return ix.search(q, 12);
    return ix.search(q, 1000).filter((h) => allowed.has(h.id)).slice(0, 12);
  }, [ix, query, allowed, suggestions]);
  const listId = useMemo(() => `results-${label.replace(/\W/g, '-')}`, [label]);
  const choose = (id: number) => {
    onChoose(id);
    setQuery('');
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="search" role="search">
      <input
        ref={input}
        type="search"
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && hits[active] ? `${listId}-${hits[active].id}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && hits[active]) {
            choose(hits[active].id);
          } else if (e.key === 'Escape') {
            setQuery('');
            setOpen(false);
            input.current?.blur();
          }
        }}
      />
      {open && hits.length > 0 && (
        <ul id={listId} role="listbox" aria-label={`${label}: results`}>
          {hits.map((h, i) => (
            <li
              key={h.id}
              id={`${listId}-${h.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h.id);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <div>{h.title}</div>
              <div className="hit-name mono">{h.name}</div>
              {/* The same name in several modules: say which one. */}
              {(ix.byName.get(h.name)?.length ?? 0) > 1 && <div className="hit-module muted">{ix.decls[h.id]!.module}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The header search: `/` focuses it from anywhere, choosing a result selects it. */
export function SearchBox({ ix }: { ix: Indexes }) {
  const select = useStore((s) => s.select);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <DeclSearch ix={ix} onChoose={select} placeholder="Search results (/)" label="Search declarations" inputRef={input} />;
}
