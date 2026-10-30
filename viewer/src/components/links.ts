import type { Indexes } from '../data/indexes';
import type { Decl } from '../data/schema';

/** "Open in VS Code" and "Open on GitHub" links for a project declaration. */
export function sourceLinks(ix: Indexes, d: Decl): { vscode?: string; github?: string } {
  if (d.external || !d.module || !d.range) return {};
  const mod = ix.data.modules.find((m) => m.name === d.module);
  if (!mod?.path) return {};
  const line = d.range.start[0];
  const root = ix.data.project.rootDir.replace(/\/+$/, '');
  const out: { vscode?: string; github?: string } = {
    vscode: `vscode://file/${encodeURI(`${root}/${mod.path}`)}:${line}`,
  };
  const repo = ix.data.project.repoUrl?.replace(/\/+$/, '');
  if (repo) out.github = `${repo}/blob/${ix.data.project.repoRef ?? 'HEAD'}/${mod.path}#L${line}-L${d.range.end[0]}`;
  return out;
}
