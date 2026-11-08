/**
 * Jargon with a hover card: hovering or focusing a term shows a one-line
 * explanation, so readers who do not know Lean can follow the badges and labels.
 */
export const JARGON: Record<string, { label: string; text: string }> = {
  theorem: { label: 'theorem', text: 'A statement proved in Lean. Its proof was checked by the computer.' },
  def: { label: 'definition', text: 'A definition: it introduces a new notion or function, nothing to prove.' },
  abbrev: { label: 'abbreviation', text: 'A short name for another expression; Lean unfolds it freely.' },
  structure: { label: 'structure', text: 'A record type: a bundle of named fields.' },
  inductive: { label: 'inductive type', text: 'A type defined by listing the ways to build its values.' },
  ctor: { label: 'constructor', text: 'One of the ways to build a value of an inductive type.' },
  recursor: { label: 'recursor', text: 'The principle for defining functions on, or proving facts about, an inductive type.' },
  instance: { label: 'instance', text: 'An implementation Lean finds automatically (for example how to add two points).' },
  axiom: { label: 'axiom', text: 'A statement assumed without proof. Lean uses three standard ones; anything else is an extra axiom.' },
  opaque: { label: 'opaque', text: 'A constant whose definition is hidden from the rest of the proof.' },
  quot: { label: 'quotient', text: 'A built-in operation for forming quotient types.' },
  result: { label: 'main result', text: 'One of the headline results of the project.' },
  lemma: { label: 'lemma', text: 'A helper theorem, used on the way to bigger results.' },
  sorry: { label: 'sorry', text: 'A placeholder for a missing proof. Anything that rests on it is not fully proved.' },
  private: { label: 'private', text: 'Only visible inside its own file.' },
  deprecated: { label: 'deprecated', text: 'Kept for compatibility; a newer name should be used instead.' },
  unsafe: { label: 'unsafe', text: 'Bypasses some of Lean’s checks; cannot be used in proofs.' },
  partial: { label: 'partial', text: 'A function that might not terminate, so Lean does not unfold it in proofs.' },
  external: { label: 'other library', text: 'Comes from a library this project uses (such as Mathlib), not from the project.' },
  'polynomial time': { label: 'polynomial time', text: 'Runs in a number of steps bounded by a polynomial in the input size: "efficient".' },
  'NP-complete': { label: 'NP-complete', text: 'Among the hardest problems whose solutions can be checked quickly.' },
};

export function Term({ term, children }: { term: string; children?: React.ReactNode }) {
  const j = JARGON[term];
  if (!j) return <span className="badge">{children ?? term}</span>;
  return (
    <span className="badge term" tabIndex={0} aria-describedby={`term-${term.replace(/\W/g, '-')}`}>
      {children ?? j.label}
      <span className="term-card" role="tooltip" id={`term-${term.replace(/\W/g, '-')}`}>
        <strong>{j.label}</strong>: {j.text}
      </span>
    </span>
  );
}
