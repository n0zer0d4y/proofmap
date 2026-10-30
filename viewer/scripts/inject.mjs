// Inject proofmap.json into the single-file viewer template, exactly as the Lean side does
// (lean/Proofmap/Package/Template.lean): every `<` becomes `<` (JSON has `<` only inside
// strings, so this is lossless and no `</script>` or `<!--` can appear), and U+2028/U+2029 are
// escaped. Usage: node scripts/inject.mjs TEMPLATE.html DATA.json OUT.html [BASELINE.json]
// With a baseline, the older snapshot is embedded after the data, as `proofmap compare` does
// (lean/Proofmap/Compare.lean).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const PLACEHOLDER = '/*PROOFMAP_DATA*/';

export function escapeJson(json) {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const BS = String.fromCharCode(92); // backslash, written this way so no tool rewrites the escapes
  return json.replace(/</g, BS + "u003c").split(LS).join(BS + "u2028").split(PS).join(BS + "u2029");
}

export function inject(template, json, baseline) {
  const at = template.indexOf(PLACEHOLDER);
  if (at < 0 || template.indexOf(PLACEHOLDER, at + 1) >= 0)
    throw new Error('template must contain the data placeholder exactly once');
  const after = template.slice(at + PLACEHOLDER.length);
  const close = '</script>';
  if (baseline === undefined) return template.slice(0, at) + escapeJson(json) + after;
  if (!after.startsWith(close)) throw new Error('the data placeholder must end its script element');
  return (
    template.slice(0, at) + escapeJson(json) + close +
    '\n<script id="proofmap-baseline" type="application/json">' + escapeJson(baseline) + after
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [templateFile, dataFile, outFile, baselineFile] = process.argv.slice(2);
  const baseline = baselineFile ? (await readFile(baselineFile, 'utf8')).trim() : undefined;
  const html = inject(await readFile(templateFile, 'utf8'), (await readFile(dataFile, 'utf8')).trim(), baseline);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
  console.log(`wrote ${outFile}`);
}
