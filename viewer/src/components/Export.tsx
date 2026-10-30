import { toPng, toSvg } from 'html-to-image';
import { useState } from 'react';
import { useStore } from '../state/store';

/**
 * Export the current view as SVG or PNG, as it is on screen. The download is
 * a data URL, so it works from a page opened with file:// too.
 */
export function ExportButton({ title }: { title: string }) {
  const [busy, setBusy] = useState(false);
  const view = useStore((s) => s.view);
  const run = async (kind: 'svg' | 'png') => {
    const el = document.querySelector<HTMLElement>(`[data-view="${view}"] .react-flow`) ?? document.querySelector<HTMLElement>(`[data-view="${view}"]`);
    if (!el) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const options = {
        backgroundColor: bg,
        // Controls are not part of the picture.
        filter: (n: Node) => !(n instanceof HTMLElement && (n.classList.contains('react-flow__minimap') || n.classList.contains('map-legend'))),
      };
      const url = kind === 'svg' ? await toSvg(el, options) : await toPng(el, { ...options, pixelRatio: 2 });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^\w.-]+/g, '_')}-${view}.${kind}`;
      a.click();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="export" role="group" aria-label="Export the current view">
      <button className="icon-button" disabled={busy} onClick={() => void run('svg')}>
        SVG
      </button>
      <button className="icon-button" disabled={busy} onClick={() => void run('png')}>
        PNG
      </button>
    </span>
  );
}
