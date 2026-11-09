import { Handle, Position } from '@xyflow/react';
import type { Indexes } from '../data/indexes';
import { STATUS_LABEL, statusOf, statusText } from '../data/status';
import { isOpen, toggleOpen } from '../state/mapOpen';
import { useStore } from '../state/store';
import { sourceLinks } from './links';
import { Statement } from './Statement';
import { StatusBadge } from './StatusBadge';
import { badgeClass, JARGON } from './Term';

export const CARD_WIDTH = 270;

const SOURCE_CHIP: Record<string, string> = {
  attr: 'author',
  config: 'config',
  docstring: 'docstring',
  comment: 'comment',
  section: 'section',
  ai: 'AI',
};

/** Estimated card height, so layout does not wait for the DOM. The statement is a preview of at
 * most 4 lines; code is shown in a scrolling block of at most 16 lines. */
export function cardHeight(ix: Indexes, id: number, statement: boolean, code: boolean): number {
  const d = ix.decls[id]!;
  const sigLines = statement ? Math.min(d.signature.split('\n').length + Math.floor(d.signature.length / 44), 8) : 0;
  const codeLines = code && d.code ? Math.min(d.code.split('\n').length, 16) : 0;
  return 104 + (sigLines ? sigLines * 17 + 12 : 0) + (codeLines ? codeLines * 15 + 18 : 0);
}

/** A declaration card: title, Lean name, a statement preview (or the summary), kind, status and
 * counts. "+" shows what it rests on; with "Code in cards", opened and selected cards also show
 * their code in a scrolling block. The selected card adds its links. The full statement is in the
 * details panel. */
export function DeclCard({ ix, id }: { ix: Indexes; id: number }) {
  const d = ix.decls[id]!;
  const focus = useStore((s) => s.focus);
  const statementsExpanded = useStore((s) => s.statementsExpanded);
  const namesSecondary = useStore((s) => s.namesSecondary);
  const showCode = useStore((s) => s.showCode);
  const select = useStore((s) => s.select);
  const setWalkthrough = useStore((s) => s.setWalkthrough);
  const diff = useStore((s) => (s.comparison?.addedSet.has(id) ? 'new' : s.comparison?.changedSet.has(id) ? 'changed' : null));
  // The main result is open unless closed; other cards when opened (see state/mapOpen).
  const expanded = useStore((s) => isOpen(ix, s, id));
  const status = statusOf(d);
  // Project results only: the externals behind a tactic like `omega` would swamp the count.
  const restsOn = new Set([...d.deps.statement, ...d.deps.proof].filter((i) => !ix.decls[i]!.external && !ix.isNoise(i))).size;
  const usedBy = new Set([...ix.usedBy.statement[id]!, ...ix.usedBy.proof[id]!].filter((i) => !ix.isNoise(i))).size;
  const links = sourceLinks(ix, d);
  const selected = focus === id;
  const showStatement = statementsExpanded;
  return (
    <div
      className={`map-card status-border-${status}${focus === id ? ' selected' : ''}${expanded ? ' expanded' : ''}`}
      style={{ width: CARD_WIDTH }}
      data-decl={d.name}
      role="group"
      aria-label={`${d.title}, ${statusText(d)}`}
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
      {showStatement && <Statement decl={d} ix={ix} onSelect={select} compact />}
      {/* Code scrolls inside the card (and scrolling it does not zoom the map). */}
      {(selected || expanded) && showCode && d.code && <pre className="card-code nowheel nodrag">{d.code}</pre>}
      <div className="card-foot">
        <span className={`badge ${badgeClass(d.kind)}`}>{JARGON[d.kind]?.label ?? d.kind}</span>
        {!d.external && (
          <span
            className="counts"
            title={`Uses ${restsOn} and is used by ${usedBy} results of this project directly. The map leaves out a dependency already reached through another card.`}
          >
            uses {restsOn} · used by {usedBy}
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
              toggleOpen(ix, id);
            }}
          >
            {expanded ? '−' : '+'}
          </button>
        )}
      </div>
      {selected && (links.vscode || links.github || d.walkthrough !== null) && (
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
