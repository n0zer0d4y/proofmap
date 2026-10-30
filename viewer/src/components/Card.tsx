import { Handle, Position } from '@xyflow/react';
import type { Indexes } from '../data/indexes';
import { STATUS_LABEL, statusOf } from '../data/status';
import { useStore } from '../state/store';
import { sourceLinks } from './links';
import { Statement } from './Statement';
import { StatusBadge } from './StatusBadge';

export const CARD_WIDTH = 270;

const SOURCE_CHIP: Record<string, string> = {
  attr: 'author',
  config: 'config',
  docstring: 'docstring',
  comment: 'comment',
  section: 'section',
  ai: 'AI',
};

/** Estimated card height, so layout does not wait for the DOM (cards clamp their content). */
export function cardHeight(ix: Indexes, id: number, expanded: boolean, showCode: boolean): number {
  if (!expanded) return 112;
  const d = ix.decls[id]!;
  const sigLines = Math.min(d.signature.split('\n').length + Math.floor(d.signature.length / 40), 14);
  const codeLines = showCode && d.code ? Math.min(d.code.split('\n').length, 16) : 0;
  return 150 + sigLines * 17 + (codeLines ? codeLines * 16 + 24 : 0);
}

/** A declaration card: collapsed shows title, summary with its source chip,
 * kind badge, status and counts; expanded adds the statement with linked names, code and links. */
export function DeclCard({ ix, id }: { ix: Indexes; id: number }) {
  const d = ix.decls[id]!;
  const focus = useStore((s) => s.focus);
  const expandedSet = useStore((s) => s.expanded);
  const statementsExpanded = useStore((s) => s.statementsExpanded);
  const namesSecondary = useStore((s) => s.namesSecondary);
  const showCode = useStore((s) => s.showCode);
  const select = useStore((s) => s.select);
  const toggleExpanded = useStore((s) => s.toggleExpanded);
  const setWalkthrough = useStore((s) => s.setWalkthrough);
  const diff = useStore((s) => (s.comparison?.addedSet.has(id) ? 'new' : s.comparison?.changedSet.has(id) ? 'changed' : null));
  const expanded = expandedSet.has(id);
  const status = statusOf(d);
  // Project results only: the externals behind a tactic like `omega` would swamp the count.
  const restsOn = [...d.deps.statement, ...d.deps.proof].filter((i) => !ix.decls[i]!.external).length;
  const usedBy = ix.usedBy.statement[id]!.length + ix.usedBy.proof[id]!.length;
  const links = sourceLinks(ix, d);
  const showStatement = expanded || statementsExpanded;
  return (
    <div
      className={`map-card status-border-${status}${focus === id ? ' selected' : ''}${expanded ? ' expanded' : ''}`}
      style={{ width: CARD_WIDTH }}
      data-decl={d.name}
      role="group"
      aria-label={`${d.title}, ${STATUS_LABEL[status].text}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="card-head">
        <StatusBadge decl={d} />
        <span className="card-title" title={d.title}>
          {namesSecondary ? d.title : d.name}
        </span>
        {d.rank === 'result' && <span className="badge" title="Main result">★</span>}
        {diff && (
          <span className={`badge-diff ${diff}`} title={diff === 'new' ? 'Added since the compared version' : 'Changed since the compared version'}>
            {diff}
          </span>
        )}
      </div>
      <div className="card-name mono" title={d.name}>
        {namesSecondary ? d.name : d.title}
      </div>
      {d.summary && !showStatement && (
        <div className="card-summary">
          {d.summary.source === 'section' ? <em>In section: {d.summary.text}</em> : d.summary.text}{' '}
          <span className="chip">{SOURCE_CHIP[d.summary.source] ?? d.summary.source}</span>
        </div>
      )}
      {showStatement && <Statement decl={d} ix={ix} onSelect={select} />}
      {expanded && showCode && d.code && <pre className="card-code">{d.code}</pre>}
      <div className="card-foot">
        <span className="badge">{d.kind}</span>
        {!d.external && (
          <span className="counts" title="Direct dependencies / direct users">
            rests on {restsOn} · used by {usedBy}
          </span>
        )}
        <span className="spacer" />
        {!d.external && restsOn > 0 && (
          <button
            className="card-toggle nodrag"
            aria-expanded={expanded}
            aria-label={expanded ? `Hide what ${d.title} rests on` : `Show what ${d.title} rests on`}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(id);
            }}
          >
            {expanded ? '−' : '+'}
          </button>
        )}
      </div>
      {expanded && (links.vscode || links.github || d.walkthrough !== null) && (
        <div className="card-links">
          {d.walkthrough !== null && (
            <button
              className="linklike nodrag"
              onClick={(e) => {
                e.stopPropagation();
                select(id);
                setWalkthrough(true);
              }}
            >
              Walk through proof
            </button>
          )}
          {links.vscode && <a href={links.vscode}>Open in VS Code</a>}
          {links.github && (
            <a href={links.github} target="_blank" rel="noreferrer">
              GitHub
            </a>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/** A "+N" group card or a library boundary card; opening it reveals the members. */
export function GroupCard({
  label,
  count,
  external,
  status,
  open,
}: {
  label: string;
  count: number;
  external: boolean;
  status: keyof typeof STATUS_LABEL;
  open: () => void;
}) {
  return (
    <div className={`map-card group-card status-border-${status}`} style={{ width: CARD_WIDTH }} role="group" aria-label={`${label}: ${count} results`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="card-head">
        <span className={`status status-${status}`} aria-hidden="true">
          {STATUS_LABEL[status].icon}
        </span>
        <span className="card-title">{external ? `${label} (${count})` : `+${count} in ${label}`}</span>
      </div>
      <div className="card-summary">{external ? 'Results used from this library' : 'Grouped to keep the map readable'}</div>
      <div className="card-foot">
        <span className="spacer" />
        <button className="card-toggle nodrag" onClick={open} aria-label={`Open ${label}`}>
          Open
        </button>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
