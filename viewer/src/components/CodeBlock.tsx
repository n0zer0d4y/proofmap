import { useEffect, useRef, useState } from 'react';
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { ensureContrast } from '../theme/contrast';

/**
 * Lean source with syntax highlighting: Shiki's Lean 4 grammar with the
 * JavaScript regex engine (no WebAssembly to embed), light and dark themes at once through CSS
 * variables. Tokens are rendered as React spans, never as injected HTML. Line numbers start at
 * `firstLine`, so they match the file.
 */
let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
    langs: [import('@shikijs/langs/lean4')],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

/** The code background in each theme (`--bg-sunken` in theme.css); token colours are adjusted
to reach 5:1 against it, which leaves room for the current-line tint. */
export const CODE_BG = { light: '#f1f1ef', dark: '#0f1114' } as const;

const adjustedStyle = (style: ThemedToken['htmlStyle']): React.CSSProperties | undefined => {
  if (!style) return undefined;
  const out: Record<string, string> = { ...style };
  if (out['--shiki-light']) out['--shiki-light'] = ensureContrast(out['--shiki-light'], CODE_BG.light);
  if (out['--shiki-dark']) out['--shiki-dark'] = ensureContrast(out['--shiki-dark'], CODE_BG.dark);
  return out as React.CSSProperties;
};

export function CodeBlock({
  code,
  firstLine = 1,
  label,
  highlight,
}: {
  code: string;
  firstLine?: number;
  label?: string;
  /** File lines to highlight (inclusive); they are scrolled into view. */
  highlight?: { from: number; to: number };
}) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!highlight) return;
    pre.current?.querySelector(`[data-line="${highlight.from}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight?.from, highlight?.to, tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    getHighlighter()
      .then((h) => {
        const res = h.codeToTokens(code, { lang: 'lean4', themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
        if (live) setTokens(res.tokens);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code]);
  const lines = tokens ?? code.split('\n').map((l) => [{ content: l, offset: 0 } as ThemedToken]);
  return (
    // Focusable, so the code can be scrolled from the keyboard.
    <pre className="code" aria-label={label} ref={pre} tabIndex={0}>
      <code>
        {lines.map((line, i) => (
          <span
            className={`code-line${highlight && firstLine + i >= highlight.from && firstLine + i <= highlight.to ? ' current' : ''}`}
            key={i}
            data-line={firstLine + i}
          >
            <span className="line-no" aria-hidden="true">
              {firstLine + i}
            </span>
            {line.map((t, j) => (
              <span key={j} style={adjustedStyle(t.htmlStyle)}>
                {t.content}
              </span>
            ))}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}
