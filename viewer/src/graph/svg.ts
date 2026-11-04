import type { Indexes } from '../data/indexes';
import { statusOf, type StatusKind } from '../data/status';
import type { Positions } from '../layout/elk-graph';
import type { Folded } from './fold';
import { worstStatus } from './propagate';

/** Colours of the exported picture, read from the page's theme at export time. */
export interface SvgPalette {
  background: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  edge: string;
  status: Record<StatusKind, string>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Words of `text` in lines of at most `max` characters, at most `lines` lines (the last cut with …). */
export function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= max) cur = next;
    else {
      if (cur) out.push(cur);
      cur = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = `${kept[lines - 1]!.slice(0, max - 1)}…`;
    return kept;
  }
  return out;
}

/**
 * The whole map as a standalone SVG made of shapes and text (no HTML inside), so it can be
 * placed in a paper or opened in a vector editor. Every card and edge on the map is included,
 * not only the part on screen.
 */
export function mapSvg(
  ix: Indexes,
  folded: Folded,
  positions: Positions,
  size: (id: string) => { width: number; height: number },
  palette: SvgPalette,
  title: string,
): { svg: string; width: number; height: number } {
  const pad = 24;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of folded.nodes) {
    const p = positions[n.id];
    if (!p) continue;
    const s = size(n.id);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + s.width);
    y1 = Math.max(y1, p.y + s.height);
  }
  if (x0 === Infinity) x0 = y0 = x1 = y1 = 0;
  const width = Math.ceil(x1 - x0 + 2 * pad);
  const height = Math.ceil(y1 - y0 + 2 * pad);
  const X = (x: number) => (x - x0 + pad).toFixed(1);
  const Y = (y: number) => (y - y0 + pad).toFixed(1);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">`,
    `<title>${esc(title)}</title>`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${palette.edge}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="${palette.background}"/>`,
  );
  for (const e of folded.edges) {
    const a = positions[e.source], b = positions[e.target];
    if (!a || !b) continue;
    const sa = size(e.source), sb = size(e.target);
    const sx = a.x + sa.width, sy = a.y + sa.height / 2, tx = b.x, ty = b.y + sb.height / 2;
    const mid = (sx + tx) / 2;
    const dash = e.viaNoise ? ' stroke-dasharray="2 5"' : e.kind === 'statement' ? ' stroke-dasharray="7 5"' : '';
    out.push(`<path d="M${X(sx)} ${Y(sy)}C${X(mid)} ${Y(sy)} ${X(mid)} ${Y(ty)} ${X(tx)} ${Y(ty)}" fill="none" stroke="${palette.edge}" stroke-width="1.4"${dash} marker-end="url(#arrow)"/>`);
  }
  for (const n of folded.nodes) {
    const p = positions[n.id];
    if (!p) continue;
    const s = size(n.id);
    const status: StatusKind = n.kind === 'decl' ? statusOf(ix.decls[n.decl!]!) : worstStatus(ix, n.members ?? []);
    const x = Number(X(p.x)), y = Number(Y(p.y));
    out.push(
      `<g>`,
      `<rect x="${x}" y="${y}" width="${s.width}" height="${s.height}" rx="8" fill="${palette.card}" stroke="${palette.border}"/>`,
      `<rect x="${x}" y="${y}" width="4" height="${s.height}" rx="2" fill="${palette.status[status]}"/>`,
    );
    const chars = Math.floor((s.width - 28) / 7.2);
    let ty = y + 22;
    if (n.kind === 'decl') {
      const d = ix.decls[n.decl!]!;
      for (const line of wrap(d.title, chars, 2)) {
        out.push(`<text x="${x + 14}" y="${ty}" font-size="13" font-weight="600" fill="${palette.text}">${esc(line)}</text>`);
        ty += 17;
      }
      out.push(`<text x="${x + 14}" y="${ty}" font-size="11" font-family="ui-monospace, Menlo, Consolas, monospace" fill="${palette.muted}">${esc(wrap(d.name, Math.floor((s.width - 28) / 6.6), 1)[0] ?? '')}</text>`);
      ty += 18;
      const summary = d.summary?.text.replace(/[`*]/g, '');
      if (summary)
        for (const line of wrap(summary, Math.floor((s.width - 28) / 6.4), 2)) {
          if (ty > y + s.height - 24) break;
          out.push(`<text x="${x + 14}" y="${ty}" font-size="11.5" fill="${palette.muted}">${esc(line)}</text>`);
          ty += 15;
        }
      out.push(`<text x="${x + 14}" y="${y + s.height - 10}" font-size="11" fill="${palette.muted}">${esc(d.kind)}</text>`);
    } else {
      const label = n.kind === 'external' ? `${n.label} (${n.members!.length})` : `+${n.members!.length} in ${n.label}`;
      out.push(`<text x="${x + 14}" y="${ty}" font-size="13" font-weight="600" fill="${palette.text}">${esc(wrap(label, chars, 1)[0] ?? '')}</text>`);
      out.push(
        `<text x="${x + 14}" y="${ty + 18}" font-size="11.5" fill="${palette.muted}">${n.kind === 'external' ? 'Results used from this library' : 'Grouped to keep the map readable'}</text>`,
      );
    }
    out.push(`</g>`);
  }
  out.push('</svg>');
  return { svg: out.join('\n'), width, height };
}

/** The SVG drawn on a canvas at `scale`, as a PNG data URL. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}
