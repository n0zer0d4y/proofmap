import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef, useState } from 'react';
import guide from '../../../docs/guide.md?raw';
import { VIEW_NAMES } from '../state/presets';
import { useStore } from '../state/store';

/**
 * The page's own docs: the user guide (`docs/guide.md`), built into the page when the viewer is
 * built, so the page and the guide always say the same. The guide is proofmap's own text, so it
 * may use a few HTML tags (`<kbd>` key caps, status and badge spans) that GitHub shows as plain
 * text. Pictures are left out, so the page stays one small file.
 */
const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface DocHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

/** The guide without its pictures, rendered, with an id on every section heading. */
export function renderGuide(source: string): { html: string; headings: DocHeading[] } {
  const text = source
    .split('\n')
    .filter((l) => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l))
    .join('\n');
  const tokens = md.parse(text, {});
  const headings: DocHeading[] = [];
  tokens.forEach((t, i) => {
    if (t.type !== 'heading_open' || (t.tag !== 'h2' && t.tag !== 'h3')) return;
    const content = tokens[i + 1]?.content ?? '';
    const id = `doc-${slug(content)}`;
    t.attrSet('id', id);
    headings.push({ level: t.tag === 'h2' ? 2 : 3, text: content.replace(/<[^>]+>/g, ''), id });
  });
  return { html: md.renderer.render(tokens, md.options, {}), headings };
}

export function DocsView() {
  const { html, headings } = useMemo(() => renderGuide(guide), []);
  const docsFrom = useStore((s) => s.docsFrom);
  const setView = useStore((s) => s.setView);
  const content = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(headings[0]?.id ?? '');
  // The contents highlight the section being read: the last heading above the top of the view.
  useEffect(() => {
    const box = content.current;
    if (!box) return;
    const onScroll = () => {
      const top = box.getBoundingClientRect().top + 48;
      let id = headings[0]?.id ?? '';
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= top) id = h.id;
      }
      setCurrent(id);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, [headings]);
  const back = docsFrom === 'docs' ? 'map' : docsFrom;
  return (
    <div className="docs-view" data-view="docs">
      <nav className="docs-toc" aria-label="Contents">
        <button className="icon-button docs-back" onClick={() => setView(back)}>
          ← Back to the {VIEW_NAMES[back]}
        </button>
        <ul>
          {headings.map((h) => (
            <li key={h.id} className={`toc-${h.level}`}>
              <button
                className="toc-link"
                aria-current={current === h.id ? 'true' : undefined}
                onClick={() => {
                  document.getElementById(h.id)?.scrollIntoView({ block: 'start' });
                  setCurrent(h.id);
                }}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {/* Focusable, so the guide scrolls with the keyboard too. */}
      <div className="docs-content" ref={content} tabIndex={0} role="region" aria-label="User guide">
        <article className="markdown docs-article" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
