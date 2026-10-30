import type { ProofmapData } from './schema';
import { decode } from './wire';

/**
 * Loads the data: inlined in the page (single-file mode) or fetched from `data/page.json`
 * next to the page (site mode), and decodes it (`wire.ts`). Inlined data is a JSON object, so it starts with `{`;
 * anything else (the untouched template placeholder) means "fetch". The placeholder text itself
 * must not appear in the bundle, or the page would contain it twice.
 */
/** The older snapshot embedded by `proofmap compare`, if any. */
export function loadBaseline(doc: Document = document): ProofmapData | null {
  const inline = doc.getElementById('proofmap-baseline')?.textContent?.trim() ?? '';
  return inline.startsWith('{') ? decode(JSON.parse(inline)) : null;
}

export async function loadData(doc: Document = document): Promise<ProofmapData> {
  const inline = doc.getElementById('proofmap-data')?.textContent?.trim() ?? '';
  if (inline.startsWith('{')) return decode(JSON.parse(inline));
  const res = await fetch('data/page.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`proofmap: could not load data/page.json (${res.status})`);
  return decode(await res.json());
}
