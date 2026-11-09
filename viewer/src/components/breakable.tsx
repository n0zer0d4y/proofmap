import { Fragment } from 'react';

/**
 * A Lean name with line-break opportunities after each `.` and `_`, so a long name that has to
 * wrap breaks between its parts ("caps_attacker_" / "window") instead of inside a word.
 */
export function breakable(name: string): React.ReactNode {
  const parts = name.split(/(?<=[._])/);
  if (parts.length < 2) return name;
  return parts.map((p, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {p}
    </Fragment>
  ));
}
