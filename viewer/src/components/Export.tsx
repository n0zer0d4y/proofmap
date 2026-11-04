import { useState } from 'react';
import type { SvgPalette } from '../graph/svg';

/** The page's theme colours, for the exported picture. */
export function currentPalette(): SvgPalette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: getComputedStyle(document.body).backgroundColor || v('--bg', '#ffffff'),
    card: v('--bg-raised', '#ffffff'),
    border: v('--border', '#d0d0d0'),
    text: v('--fg', '#1a1a1a'),
    muted: v('--fg-muted', '#666666'),
    edge: v('--edge', '#8a8f98'),
    status: { ok: v('--ok', '#2f8a4f'), sorry: v('--sorry', '#c0392b'), axiom: v('--axiom', '#c98a1e'), external: v('--fg-muted', '#9aa0aa') },
  };
}

/**
 * SVG and PNG of the whole map. `make` builds the picture from the map's layout, so every card is
 * included, not only the part on screen. The download is a data URL, so it works from a page
 * opened with file:// too.
 */
export function ExportButtons({ fileName, make }: { fileName: string; make: (kind: 'svg' | 'png') => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const run = async (kind: 'svg' | 'png') => {
    setBusy(true);
    try {
      const url = await make(kind);
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/[^\w.-]+/g, '_')}-map.${kind}`;
      a.click();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="export" role="group" aria-label="Export the map">
      <button className="icon-button" disabled={busy} onClick={() => void run('svg')} title="The whole map as a vector picture">
        SVG
      </button>
      <button className="icon-button" disabled={busy} onClick={() => void run('png')} title="The whole map as an image">
        PNG
      </button>
    </span>
  );
}
