import type { Indexes } from '../data/indexes';
import type { Decl } from '../data/schema';

/** Length in code points of the signature's head: the declaration's own name, its universe list
 * (`Even.{u_2}`) and the space after them. Cards show the name on its own line, so their statement
 * preview starts after the head; the details panel keeps the full signature. */
export function headLength(cps: string[]): number {
  let i = 0;
  while (i < cps.length && cps[i] !== ' ' && cps[i] !== '\n') {
    if (cps[i] === '«') {
      const close = cps.indexOf('»', i);
      i = close < 0 ? cps.length : close + 1;
    } else if (cps[i] === '.' && cps[i + 1] === '{') {
      const close = cps.indexOf('}', i);
      i = close < 0 ? cps.length : close + 1;
    } else i++;
  }
  while (i < cps.length && (cps[i] === ' ' || cps[i] === '\n')) i++;
  return i;
}

/** A declaration's signature with the names in it linked to their declarations (hover shows the
 * name's title and summary; click selects it). Spans are code-point offsets. `compact` (cards)
 * starts after the declaration's name and lets the card clamp the text instead of scrolling. */
export function Statement({ decl, ix, onSelect, compact = false }: { decl: Decl; ix: Indexes; onSelect: (id: number) => void; compact?: boolean }) {
  let cps = Array.from(decl.signature);
  let hover = decl.signatureHover;
  const head = compact ? headLength(cps) : 0;
  if (head > 0 && head < cps.length) {
    cps = cps.slice(head);
    hover = hover.filter((h) => h.start >= head).map((h) => ({ ...h, start: h.start - head, end: h.end - head }));
  }
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const h of hover) {
    if (h.start < at) continue;
    if (h.start > at) parts.push(cps.slice(at, h.start).join(''));
    const target = ix.decls[h.decl];
    const text = cps.slice(h.start, h.end).join('');
    parts.push(
      target ? (
        <button
          key={h.start}
          className="sig-link"
          title={`${target.title}${target.summary ? ` — ${target.summary.text}` : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(h.decl);
          }}
        >
          {text}
        </button>
      ) : (
        text
      ),
    );
    at = h.end;
  }
  if (at < cps.length) parts.push(cps.slice(at).join(''));
  return <pre className={compact ? 'signature compact' : 'signature'}>{parts}</pre>;
}
