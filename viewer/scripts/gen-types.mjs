// Generates src/data/schema.ts from schema/proofmap.schema.json (the source of truth).
// Run with `npm run gen:types`; CI checks that the committed file is up to date.
import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const schemaUrl = new URL('../../schema/proofmap.schema.json', import.meta.url);
const outUrl = new URL('../src/data/schema.ts', import.meta.url);

const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));
const ts = await compile(schema, 'ProofmapData', {
  bannerComment:
    '/* Generated from schema/proofmap.schema.json by scripts/gen-types.mjs. Do not edit. */',
  additionalProperties: false,
  style: { singleQuote: true },
});

if (process.argv.includes('--check')) {
  const current = await readFile(outUrl, 'utf8').catch(() => '');
  if (current !== ts) {
    console.error('src/data/schema.ts is out of date: run `npm run gen:types`.');
    process.exit(1);
  }
  console.log('src/data/schema.ts is up to date.');
} else {
  await writeFile(outUrl, ts);
  console.log('wrote src/data/schema.ts');
}
