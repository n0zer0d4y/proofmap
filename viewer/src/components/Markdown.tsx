import katex from 'katex';
import MarkdownIt from 'markdown-it';
import { useMemo } from 'react';

/**
 * Docstrings and module docs as Markdown with maths. Raw HTML in the source is
 * not rendered (`html: false`), so the output is safe to insert. Maths between `$...$` or
 * `$$...$$` is rendered by KaTeX as MathML, which browsers display natively, so no KaTeX fonts
 * have to be embedded in the single-file page.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, output: 'mathml', throwOnError: false });
  } catch {
    return md.utils.escapeHtml(tex);
  }
}

md.inline.ruler.after('escape', 'math', (state, silent) => {
  const src = state.src;
  const start = state.pos;
  if (src[start] !== '$') return false;
  const display = src[start + 1] === '$';
  const open = display ? 2 : 1;
  // `$` followed by a space or a digit (prices, `$5`) is not maths.
  if (!display && (/\s/.test(src[start + 1] ?? ' ') || /\d/.test(src[start + 1] ?? ''))) return false;
  const close = src.indexOf(display ? '$$' : '$', start + open);
  if (close < 0 || close === start + open) return false;
  if (!silent) {
    const token = state.push('math', '', 0);
    token.content = src.slice(start + open, close);
    token.markup = display ? '$$' : '$';
  }
  state.pos = close + open;
  return true;
});
md.renderer.rules['math'] = (tokens, idx) => renderMath(tokens[idx]!.content, tokens[idx]!.markup === '$$');

// Links open in a new tab and never run script.
md.renderer.rules['link_open'] = (tokens, idx, options, _env, self) => {
  const t = tokens[idx]!;
  const href = String(t.attrGet('href') ?? '');
  if (/^\s*javascript:/i.test(href)) t.attrSet('href', '#');
  t.attrSet('target', '_blank');
  t.attrSet('rel', 'noreferrer');
  return self.renderToken(tokens, idx, options);
};

export function renderMarkdown(text: string): string {
  return md.render(text);
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`markdown ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
