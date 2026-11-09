import { useEffect, useRef, useState } from 'react';
import type { Indexes } from '../data/indexes';
import { VERSION } from '../version';

/** NOTICE text that redistributions must carry (Apache-2.0, section 4(d)). */
export const NOTICE = `proofmap
Copyright 2026 Nozero Day
https://github.com/n0zer0d4y/proofmap

This product includes software developed by Nozero Day as part of the
proofmap project. Redistributions of proofmap, in source or binary form,
modified or not, must retain this NOTICE file as required by section 4(d)
of the Apache License, Version 2.0.`;

/** "Made with proofmap" footer (hidden with `[display] footer = false`) and the About dialog,
 * which is always reachable. */
export function Footer({ ix }: { ix: Indexes }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const showFooter = ix.data.project.footer !== false;
  const lean = ix.data.generator.lean;
  // The details a bug report needs, shown and copyable (like an application's About box).
  const facts: [string, string][] = [
    ['proofmap', VERSION],
    ['Lean', lean],
    ['Page built', ix.data.project.builtAt.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC')],
    ['Data format', String(ix.data.schema)],
    ['Browser', typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent],
  ];
  return (
    <>
      <footer className="footer" style={showFooter ? undefined : { justifyContent: 'flex-end' }}>
        {showFooter && (
          <span>
            Made with{' '}
            <a href="https://github.com/n0zer0d4y/proofmap" target="_blank" rel="noreferrer">
              proofmap
            </a>{' '}
            {VERSION} by Nozero Day · Lean {lean}
          </span>
        )}
        <button className="linklike" onClick={() => dialog.current?.showModal()}>
          About
        </button>
      </footer>
      <dialog ref={dialog} aria-label="About proofmap" className="about">
        {/* Title on the left, close at the top right, as in any window. */}
        <div className="dialog-head">
          <h2>proofmap {VERSION}</h2>
          <form method="dialog">
            <button className="dialog-close" aria-label="Close">
              ×
            </button>
          </form>
        </div>
        <p>
          An interactive map of a Lean project's results and what they rest on. Licensed under the Apache
          License, Version 2.0.
        </p>
        <dl className="about-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <pre>{NOTICE}</pre>
        <div className="dialog-foot">
          <CopyDetails text={facts.map(([k, v]) => `${k}: ${v}`).join('\n')} />
        </div>
      </dialog>
    </>
  );
}

/** Copies the About details, and says so for a moment. */
function CopyDetails({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button className="icon-button" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}>
      {copied ? 'Copied' : 'Copy details'}
    </button>
  );
}
