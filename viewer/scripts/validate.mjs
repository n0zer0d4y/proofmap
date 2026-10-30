// Validates proofmap.json files against schema/proofmap.schema.json, then checks the
// invariants JSON Schema cannot express (ids equal indexes, every id reference resolves).
// Usage: node scripts/validate.mjs FILE...
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(
  await readFile(new URL('../../schema/proofmap.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function invariantErrors(data) {
  const errors = [];
  const n = data.decls.length;
  const ref = (where, id) => {
    if (!Number.isInteger(id) || id < 0 || id >= n) errors.push(`${where}: id ${id} out of range`);
  };
  data.decls.forEach((d, i) => {
    if (d.id !== i) errors.push(`decls[${i}].id is ${d.id}`);
    for (const k of ['deps', 'directDeps'])
      for (const kind of ['statement', 'proof'])
        d[k][kind].forEach((id) => ref(`${d.name} ${k}.${kind}`, id));
    d.signatureHover.forEach((h) => ref(`${d.name} signatureHover`, h.decl));
    if (d.walkthrough !== null && d.walkthrough >= data.walkthroughs.length)
      errors.push(`${d.name}: walkthrough ${d.walkthrough} out of range`);
    if (d.status.sorry !== d.status.axioms.includes('sorryAx'))
      errors.push(`${d.name}: status.sorry disagrees with axioms`);
  });
  data.project.roots.forEach((id) => ref('project.roots', id));
  data.walkthroughs.forEach((w, i) => ref(`walkthroughs[${i}].decl`, w.decl));
  return errors;
}

let failed = false;
for (const file of process.argv.slice(2)) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const errors = validate(data)
    ? invariantErrors(data)
    : validate.errors.map((e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
  if (errors.length) {
    failed = true;
    console.error(`${file}: ${errors.length} error(s)`);
    for (const e of errors.slice(0, 50)) console.error(`  ${e}`);
  } else {
    console.log(`${file}: valid (${data.decls.length} declarations)`);
  }
}
process.exit(failed ? 1 : 0);
