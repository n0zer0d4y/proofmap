import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/components/Markdown';
import { buildIndexes } from '../src/data/indexes';
import type { ProofmapData } from '../src/data/schema';
import { extraAxioms, whyChain } from '../src/graph/why';

const data = JSON.parse(readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
const ix = buildIndexes(data);
const id = (n: string) => ix.byName.get(n)![0]!;
const names = (c: number[] | null) => c?.map((i) => ix.decls[i]!.name);

describe('why trace', () => {
  it('finds the chain to the custom axiom', () => {
    expect(names(whyChain(ix, id('Fixture.tainted_result'), 'Fixture.customAxiom'))).toEqual([
      'Fixture.tainted_result',
      'Fixture.uses_custom_axiom_indirectly',
      'Fixture.uses_custom_axiom',
      'Fixture.customAxiom',
    ]);
  });
  it('finds the declaration that contains the sorry', () => {
    expect(names(whyChain(ix, id('Fixture.tainted_result'), 'sorryAx'))).toEqual([
      'Fixture.tainted_result',
      'Fixture.downstream_of_sorry',
      'Fixture.unfinished',
    ]);
  });
  it('lists the extra axioms and gives no chain for clean results', () => {
    expect(extraAxioms(ix, id('Fixture.tainted_result'))).toEqual(['sorryAx', 'Fixture.customAxiom']);
    expect(extraAxioms(ix, id('Fixture.main_result'))).toEqual([]);
    expect(whyChain(ix, id('Fixture.main_result'), 'sorryAx')).toBeNull();
  });
});

describe('markdown', () => {
  it('renders maths as MathML and never raw HTML', () => {
    const html = renderMarkdown('Area $\\pi r^2$ and <script>alert(1)</script> [x](javascript:alert(1))');
    expect(html).toContain('<math');
    expect(html).not.toContain('<script>');
    // markdown-it refuses the link and prints it as text; no link may point at script.
    expect(html).not.toMatch(/href="javascript:/i);
  });
  it('leaves prices alone', () => {
    expect(renderMarkdown('costs $5 and $6')).not.toContain('<math');
  });
});
