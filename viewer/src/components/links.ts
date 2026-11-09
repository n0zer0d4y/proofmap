import type { Indexes } from '../data/indexes';
import { liveProjectRoot } from '../data/live';
import type { Decl } from '../data/schema';

/**
 * The project folder on this computer, for "Open in VS Code". Pages never record an absolute path:
 * a single-file page records where the project is relative to itself (`pageToRoot`), and the
 * folder is worked out from the page's own file location; under `proofmap serve` the local
 * server reports it. A page on a web host, or a JSON snapshot, has none.
 */
export function projectFolder(ix: Indexes, loc: { protocol: string; pathname: string } = location): string | null {
  const rel = ix.data.project.pageToRoot;
  if (loc.protocol !== 'file:') return liveProjectRoot();
  if (rel === null || rel === undefined) return null;
  const parts = decodeURIComponent(loc.pathname).split('/').slice(0, -1);
  for (const p of rel.split('/').filter(Boolean)) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  // `/C:/Users/...` on Windows: the drive letter starts the path.
  const path = parts.join('/');
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
}

/** "Open in VS Code" and "Open on GitHub" links for a project declaration. */
export function sourceLinks(ix: Indexes, d: Decl): { vscode?: string; github?: string } {
  if (d.external || !d.module || !d.range) return {};
  const mod = ix.data.modules.find((m) => m.name === d.module);
  if (!mod?.path) return {};
  const line = d.range.start[0];
  const out: { vscode?: string; github?: string } = {};
  const root = projectFolder(ix);
  if (root !== null) out.vscode = `vscode://file/${encodeURI(`${root.replace(/\/+$/, '')}/${mod.path}`)}:${line}`;
  const repo = ix.data.project.repoUrl?.replace(/\/+$/, '');
  // Module paths are relative to the project; a project in a folder of its repository (`lean/`)
  // records that folder, which goes between the commit and the path.
  const prefix = (ix.data.project.repoPathPrefix ?? '').replace(/^\/+/, '').replace(/\/*$/, '/').replace(/^\/$/, '');
  // A dependency's file (under `.lake/packages`) is not in the project's repository: no link.
  if (repo && !/^\.lake\//.test(mod.path)) out.github = `${repo}/blob/${ix.data.project.repoRef ?? 'HEAD'}/${prefix}${mod.path}#L${line}-L${d.range.end[0]}`;
  return out;
}
