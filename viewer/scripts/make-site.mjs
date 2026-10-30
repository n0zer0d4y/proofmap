// Assembles a site folder for the e2e tests: the built viewer as index.html
// plus the fixture site's data folder, as written by `proofmap build --site`.
// Usage: node scripts/make-site.mjs VIEWER_HTML SITE_DATA_DIR OUT_DIR
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [viewer, siteDir, out] = process.argv.slice(2);
if (!viewer || !siteDir || !out) {
  console.error('usage: node scripts/make-site.mjs VIEWER_HTML SITE_DATA_DIR OUT_DIR');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(viewer, join(out, 'index.html'));
cpSync(join(siteDir, 'data'), join(out, 'data'), { recursive: true });
console.log(`wrote site ${out}`);
