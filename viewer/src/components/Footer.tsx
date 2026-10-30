import { useRef } from 'react';
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
      <dialog ref={dialog} aria-label="About proofmap">
        <h2 style={{ marginTop: 0 }}>proofmap {VERSION}</h2>
        <p>
          An interactive map of a Lean project's results and what they rest on. Licensed under the Apache
          License, Version 2.0.
        </p>
        <pre>{NOTICE}</pre>
        <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          Generated {ix.data.project.builtAt} with Lean {lean}.
        </p>
        <form method="dialog">
          <button className="icon-button">Close</button>
        </form>
      </dialog>
    </>
  );
}
