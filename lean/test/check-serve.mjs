// Checks `proofmap serve`: routes, live-reload build id, and the safety rules
// (127.0.0.1 only, no paths outside the served folder, foreign Host headers refused).
// Usage: node check-serve.mjs COMMAND... (for example `lake env .lake/build/bin/proofmap`)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

const [exe, ...prefix] = process.argv.slice(2);
if (!exe) {
  console.error('usage: node check-serve.mjs COMMAND...');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'proofmap-serve-'));
mkdirSync(join(dir, 'site', 'data'), { recursive: true });
writeFileSync(join(dir, 'site', 'page.html'), '<!doctype html><title>t</title>first');
writeFileSync(join(dir, 'site', 'data', 'extra.json'), '{"ok":true}');
writeFileSync(join(dir, 'secret.txt'), 'outside the served folder');

const failures = [];
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};

/** Raw GET so the request target and Host header are sent exactly as given. */
const get = (port, path, { method = 'GET', host } = {}) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: host ? { host } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });

// `lake env` runs proofmap as its own child, so stopping `lake` alone would leave the server
// running on Linux with this script's pipes open. On POSIX the server gets its own process group
// and the whole group is stopped; on Windows, ending `lake` ends the server too.
const posix = process.platform !== 'win32';
const child = spawn(exe, [...prefix, 'serve', '--no-build', '--out', join(dir, 'site', 'page.html')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: posix,
});
const stop = () => {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (posix) process.kill(-child.pid, 'SIGTERM');
      else child.kill();
    } catch {
      // Already gone.
    }
  }
  child.stdout.destroy();
  child.stderr.destroy();
};
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
const port = await new Promise((resolve, reject) => {
  let out = '';
  const timer = setTimeout(() => reject(new Error(`no serving line within 20 s; stdout: ${out}; stderr: ${stderr}`)), 20000);
  child.stdout.on('data', (d) => {
    out += d;
    const m = /at http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
    if (m) {
      clearTimeout(timer);
      resolve(Number(m[1]));
    }
  });
  child.on('exit', (code) => reject(new Error(`serve exited with ${code}: ${stderr}`)));
});

try {
  const index = await get(port, '/');
  check('GET / serves the page', index.status === 200 && index.body.endsWith('first'), JSON.stringify(index));
  check('page content type', index.type === 'text/html; charset=utf-8', index.type);
  const head = await get(port, '/', { method: 'HEAD' });
  check('HEAD / has no body', head.status === 200 && head.body === '');
  const data = await get(port, '/data/extra.json?x=1');
  check('GET /data/* serves files', data.status === 200 && data.body === '{"ok":true}' && data.type === 'application/json', JSON.stringify(data));
  const v1 = await get(port, '/__proofmap/version');
  check('version endpoint', v1.status === 200 && v1.type === 'application/json' && JSON.parse(v1.body).build.length > 0, JSON.stringify(v1));
  const same = await get(port, '/__proofmap/version');
  check('build id is stable', same.body === v1.body);
  await new Promise((r) => setTimeout(r, 50));
  writeFileSync(join(dir, 'site', 'page.html'), '<!doctype html><title>t</title>second build');
  const v2 = await get(port, '/__proofmap/version');
  check('build id changes when the page is rewritten', v2.body !== v1.body, `${v1.body} -> ${v2.body}`);
  check('the new page is served', (await get(port, '/')).body.endsWith('second build'));
  check('missing file is 404', (await get(port, '/data/missing.json')).status === 404);
  check('directory is 404', (await get(port, '/data')).status === 404);
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/data/..%2f..%2fsecret.txt', '/..\\secret.txt', '/C:/Windows/win.ini',
    '/%5c..%5csecret.txt', '/data/%5c%5clocalhost%5cc$%5cwindows%5cwin.ini', '/page.html::$DATA', '/CON', '/data/nul.json']) {
    const r = await get(port, p);
    check(`no escape: ${p}`, r.status === 400 || r.status === 404, `${r.status} ${r.body}`);
    check(`no escape (content): ${p}`, !r.body.includes('outside the served folder'));
  }
  check('POST is 405', (await get(port, '/', { method: 'POST' })).status === 405);
  check('foreign Host is 403', (await get(port, '/', { host: 'evil.example:80' })).status === 403);
  check('Host without the port is 403', (await get(port, '/', { host: 'localhost' })).status === 403);
  check('localhost Host is fine', (await get(port, '/', { host: `localhost:${port}` })).status === 200);
} finally {
  stop();
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`serve check FAILED (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`serve OK (port ${port})`);
