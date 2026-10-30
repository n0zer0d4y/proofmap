import type { Indexes } from '../data/indexes';
import type { Decl } from '../data/schema';

/** A declaration's signature with the names in it linked to their declarations (hover shows the
 * name's title and summary; click selects it). Spans are code-point offsets. */
export function Statement({ decl, ix, onSelect }: { decl: Decl; ix: Indexes; onSelect: (id: number) => void }) {
  const cps = Array.from(decl.signature);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const h of decl.signatureHover) {
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
  return <pre className="signature">{parts}</pre>;
}
