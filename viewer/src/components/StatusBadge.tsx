import type { Decl } from '../data/schema';
import { STATUS_LABEL, statusOf } from '../data/status';

export function StatusBadge({ decl, withText = false }: { decl: Decl; withText?: boolean }) {
  const s = statusOf(decl);
  const { icon, text } = STATUS_LABEL[s];
  return (
    <span className={`status status-${s}`} role="img" title={text} aria-label={text}>
      <span aria-hidden="true">{icon}</span>
      {withText && <span>{text}</span>}
    </span>
  );
}
