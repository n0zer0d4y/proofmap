import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { breakable } from "../components/breakable";
import { StatusBadge } from "../components/StatusBadge";
import { badgeClass, JARGON, KIND_PLURAL, Term } from "../components/Term";
import { twinModule, type Indexes } from "../data/indexes";
import { plainText } from "../data/library";
import { computeHealth, type Health } from "../graph/health";
import { useStore } from "../state/store";

type ListKey = keyof Health["lists"];

const LIST_TITLES: Record<ListKey, string> = {
  theorems: "Theorems",
  definitions: "Definitions and types",
  main: "Main results",
  proved: "Complete",
  sorry: "Has sorry",
  nonstandard: "Extra axioms",
  deprecated: "Deprecated",
  unsafe: "Unsafe or partial",
};

/** Health and progress: computed from the code, not maintained by hand. Every count opens the
 * list of declarations behind it. */
export function HealthView({ ix }: { ix: Indexes }) {
  const h = useMemo(() => computeHealth(ix), [ix]);
  const select = useStore((s) => s.select);
  const [open, setOpen] = useState<ListKey | null>(null);
  const [axiom, setAxiom] = useState<string | null>(null);
  const name = (id: number) => {
    const twin = twinModule(ix, id);
    // One item in the row, so the module follows the name and wraps with it.
    return (
      <span className="decl-name">
        <button
          className="linklike"
          onClick={() => select(id)}
          title={ix.decls[id]!.title}
        >
          {breakable(ix.decls[id]!.name)}
        </button>
        {twin && <span className="muted"> · {breakable(twin)}</span>}
      </span>
    );
  };
  // For lists of declarations nothing uses: what tells a kept one from a leftover.
  const notes = (id: number) => notesOf(ix, id);
  const pct = (ok: number, total: number) =>
    total ? Math.round((100 * ok) / total) : 100;
  const stat = (
    key: ListKey,
    label: React.ReactNode,
    tone?: Tone,
    note?: React.ReactNode,
  ) => (
    <Stat
      label={label}
      value={h.lists[key].length}
      tone={tone}
      note={note}
      pressed={open === key}
      onClick={() => setOpen(open === key ? null : key)}
    />
  );
  // Next to the theorem count: all proved, or how many are not.
  const theoremNote =
    h.theorems === 0 ? undefined : h.theoremsSorry ? (
      <span className="stat-note sorry">
        {h.theoremsSorry.toLocaleString()} with sorry
      </span>
    ) : h.theoremsExtra ? (
      <span className="stat-note axiom">
        {h.theoremsExtra.toLocaleString()} with extra axioms
      </span>
    ) : (
      <span className="stat-note ok">✓ all proved</span>
    );
  const tiles = useEqualTileWidth([h]);
  return (
    <div className="health">
      <section className="health-tiles" aria-label="Counts" ref={tiles}>
        <div className="tile-group">
          <span className="tile-group-label">The project</span>
          <div className="tiles">
            {stat(
              "theorems",
              <Term term="theorem" plain>
                Theorems
              </Term>,
              "theorem",
              theoremNote,
            )}
            {/* Everything that is not a theorem: definitions (def, abbrev) and types (structures, inductive types and their constructors). */}
            {stat("definitions", "Definitions and types", "def")}
            {stat(
              "main",
              <Term term="result" plain>
                Main results
              </Term>,
              "main",
            )}
          </div>
        </div>
        <div className="tile-group">
          <span className="tile-group-label">Completeness</span>
          <div className="tiles">
            {stat("proved", "Complete", "ok")}
            {stat(
              "sorry",
              <Term term="sorry" plain>
                Has sorry
              </Term>,
              h.sorry ? "sorry" : undefined,
            )}
            {stat(
              "nonstandard",
              <Term term="axiom" plain>
                Extra axioms
              </Term>,
              h.nonstandard ? "axiom" : undefined,
            )}
          </div>
        </div>
        <div className="tile-group">
          <span className="tile-group-label">Hygiene</span>
          <div className="tiles">
            {stat(
              "deprecated",
              <Term term="deprecated" plain>
                Deprecated
              </Term>,
            )}
            {stat(
              "unsafe",
              <Term term="unsafe" plain>
                Unsafe or partial
              </Term>,
            )}
          </div>
        </div>
      </section>
      {h.definitionKinds.length > 0 && (
        <p className="kind-split">
          Definitions and types ({h.definitions.toLocaleString()}):{" "}
          {h.definitionKinds.map((k) => (
            <span key={k.kind} className={`badge ${badgeClass(k.kind)}`}>
              {k.count.toLocaleString()}{" "}
              {k.count === 1
                ? (JARGON[k.kind]?.label ?? k.kind)
                : (KIND_PLURAL[k.kind] ?? k.kind)}
            </span>
          ))}
        </p>
      )}
      {open && (
        <section aria-label={LIST_TITLES[open]} className="stat-list">
          <h3>
            {LIST_TITLES[open]} ({h.lists[open].length}){" "}
            <ListKind ix={ix} ids={h.lists[open]} />
          </h3>
          <DeclColumns ix={ix} ids={h.lists[open]} name={name} />
        </section>
      )}

      <section aria-label="Where the sorry is">
        <h3>Where the sorry is ({h.sorrySources.length})</h3>
        {h.sorrySources.length === 0 ? (
          <p className="plain">Nothing has sorry. ✓</p>
        ) : (
          <ul className="decl-list">
            {h.sorrySources.map((s) => (
              <li key={s.id}>
                <StatusBadge decl={ix.decls[s.id]!} /> {name(s.id)}:{" "}
                {s.downstream} result{s.downstream === 1 ? "" : "s"} rest on it
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Axioms">
        <h3>Axioms used</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Axiom</th>
              <th>Results using it</th>
              <th>Kind</th>
            </tr>
          </thead>
          <tbody>
            {h.axioms.map((a) => (
              <tr key={a.name}>
                <td className="mono">
                  {a.name === "sorryAx" ? "sorry" : a.name}
                </td>
                <td>
                  <button
                    className="linklike"
                    aria-expanded={axiom === a.name}
                    onClick={() => setAxiom(axiom === a.name ? null : a.name)}
                  >
                    {a.count}
                  </button>
                </td>
                <td>
                  {a.name === "sorryAx"
                    ? "sorry"
                    : a.standard
                      ? "standard"
                      : "extra axiom"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {axiom && (
          <div className="stat-list">
            <h3>
              Using {axiom === "sorryAx" ? "sorry" : axiom} (
              {h.axiomUsers.get(axiom)?.length ?? 0}){" "}
              <ListKind ix={ix} ids={h.axiomUsers.get(axiom) ?? []} />
            </h3>
            <DeclColumns
              ix={ix}
              ids={h.axiomUsers.get(axiom) ?? []}
              name={name}
            />
          </div>
        )}
      </section>

      <section aria-label="Largest proofs" className="two-col">
        <div>
          <h3>Longest (lines of source)</h3>
          <ol className="top-list" role="list">
            {h.largestByLines.map((id) => (
              <li key={id}>
                {name(id)}{" "}
                <span className="muted">{ix.decls[id]!.size.lines} lines</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Largest proof terms</h3>
          <ol className="top-list" role="list">
            {h.largestByTerm.map((id) => (
              <li key={id}>
                {name(id)}{" "}
                <span className="muted">
                  {ix.decls[id]!.size.exprNodes.toLocaleString()} nodes
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="Standalone results">
        <h3>
          Standalone results ({h.standalone.length}){" "}
          <ListKind ix={ix} ids={h.standalone} />
        </h3>
        <p className="muted plain">
          Documented theorems that no other declaration uses (main results
          excluded). Usually findings in their own right; list the important
          ones in a <code>## Main statements</code> section of their file&apos;s
          module docstring (or in <code>[project] roots</code> in{" "}
          <code>proofmap.toml</code>) to make them main results.
        </p>
        <DeclColumns ix={ix} ids={h.standalone} name={name} notes={notes} />
      </section>

      <section aria-label="Unused declarations">
        <h3>
          Possibly unused ({h.unused.length}){" "}
          <ListKind ix={ix} ids={h.unused} />
        </h3>
        <p className="muted plain">
          Other results and definitions that no other declaration in the project
          uses. A <code>#print axioms</code>, <code>#check</code> or{" "}
          <code>#eval</code> in the project&apos;s own files that names one is
          shown next to it, and so are <Term term="private" /> (usually a
          leftover helper) and <Term term="simp" /> (a rewriting lemma kept for
          the simp tactic). Scripts, tests outside Lean and documents are not
          read, so a result checked only there is listed too.
          {h.generated > 0 &&
            ` ${h.generated.toLocaleString()} declaration${h.generated === 1 ? "" : "s"} that Lean generated without a source location (match splitters, congruence lemmas, deriving helpers) ${h.generated === 1 ? "is" : "are"} not listed.`}
        </p>
        <DeclColumns ix={ix} ids={h.unused} name={name} notes={notes} />
      </section>

      <section aria-label="Progress" className="two-col">
        <div>
          <h3>By module</h3>
          {h.byModule.map((r) => (
            <Progress
              key={r.name}
              name={r.name}
              ok={r.ok}
              total={r.total}
              pct={pct}
              mono
            />
          ))}
        </div>
        <div>
          <h3>By step</h3>
          {h.byStep.map((r, i) => (
            <div key={`${r.module}:${r.name}`}>
              {(i === 0 || h.byStep[i - 1]!.module !== r.module) && (
                <div className="progress-module mono">{r.module}</div>
              )}
              <Progress
                name={plainText(r.name)}
                ok={r.ok}
                total={r.total}
                pct={pct}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Progress({
  name,
  ok,
  total,
  pct,
  mono = false,
}: {
  name: string;
  ok: number;
  total: number;
  pct: (ok: number, total: number) => number;
  mono?: boolean;
}) {
  return (
    <div className="progress">
      <span className={`progress-label${mono ? " mono" : ""}`} title={name}>
        {name}
      </span>
      <span
        className="bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct(ok, total)}
        aria-label={`${name}: ${pct(ok, total)}% proved`}
      >
        <span style={{ width: `${pct(ok, total)}%` }} />
      </span>
      <span className="muted">
        {ok}/{total}
      </span>
    </div>
  );
}

/** The commands that name a declaration nothing else uses, and its private and simp flags, on a
 * line of their own under the name; `null` when there are none. */
function notesOf(ix: Indexes, id: number): React.ReactNode {
  const d = ix.decls[id]!;
  const flags = d.flags.filter((f) => f === "private" || f === "simp");
  const refs = d.checkedBy ?? [];
  if (!flags.length && !refs.length) return null;
  const fileOf = (module: string) =>
    ix.data.modules.find((m) => m.name === module)?.path ?? module;
  const what = {
    "print axioms": "audited by #print axioms",
    check: "type-checked by #check",
    eval: "run by #eval",
  } as const;
  return (
    <span className="use-notes">
      {flags.map((f) => (
        <Term key={f} term={f} />
      ))}
      {refs.map((c) => (
        <span key={`${c.module}:${c.line}`} className="check-ref muted">
          {what[c.command]} at {fileOf(c.module)}:{c.line}
        </span>
      ))}
    </span>
  );
}

function DeclColumns({
  ix,
  ids,
  name,
  notes,
}: {
  ix: Indexes;
  ids: number[];
  name: (id: number) => React.ReactNode;
  notes?: (id: number) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const limit = all ? ids.length : 300;
  // When every row is the same kind, the heading carries the badge (ListKind) instead of each row.
  const sameKind = uniformKind(ix, ids) !== null;
  if (!ids.length) return <p className="empty plain">None</p>;
  return (
    <ul className="decl-list columns">
      {ids.slice(0, limit).map((id) => {
        const extra = notes?.(id);
        return (
          <li key={id} className={extra ? "with-notes" : undefined}>
            <StatusBadge decl={ix.decls[id]!} /> {name(id)}{" "}
            {!sameKind && <KindBadge kind={ix.decls[id]!.kind} />}
            {extra}
          </li>
        );
      })}
      {ids.length > limit && (
        <li>
          <button className="linklike" onClick={() => setAll(true)}>
            and {ids.length - limit} more
          </button>
        </li>
      )}
    </ul>
  );
}

type Tone = "ok" | "sorry" | "axiom" | "theorem" | "def" | "main";

/** The one kind every declaration in `ids` has, or null when they differ (or there are none). */
function uniformKind(ix: Indexes, ids: number[]): string | null {
  const kind = ids.length ? ix.decls[ids[0]!]!.kind : null;
  return kind !== null && ids.every((id) => ix.decls[id]!.kind === kind)
    ? kind
    : null;
}

/** Next to a list's heading: the kind all its rows share, if they share one. */
function ListKind({ ix, ids }: { ix: Indexes; ids: number[] }) {
  const kind = uniformKind(ix, ids);
  return kind ? <KindBadge kind={kind} /> : null;
}

/** A kind's badge in a list (the same colours as on the map cards and in the details panel). */
function KindBadge({ kind }: { kind: string }) {
  return (
    <span className={`badge ${badgeClass(kind)}`}>
      {JARGON[kind]?.label ?? kind}
    </span>
  );
}

/**
 * Gives every tile in `ref` the same width: the widest tile's content, never less than 136px.
 * Measured after the numbers are drawn, so a larger project widens all tiles together and nothing
 * is cut; whole groups wrap when the row does not fit.
 */
function useEqualTileWidth(deps: unknown[]) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.removeProperty("--tile-w");
    const tiles = [...box.querySelectorAll<HTMLElement>(".stat")];
    for (const t of tiles) t.style.width = "max-content";
    const widest = Math.max(
      136,
      ...tiles.map((t) => Math.ceil(t.getBoundingClientRect().width)),
    );
    for (const t of tiles) t.style.width = "";
    box.style.setProperty("--tile-w", `${widest}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export function Stat({
  label,
  value,
  tone,
  note,
  onClick,
  pressed,
}: {
  label: React.ReactNode;
  value: number;
  tone?: Tone;
  /** A short line next to the number (such as "✓ all proved"). */
  note?: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
}) {
  const body = (
    <>
      <div className="stat-top">
        <span className="stat-value">{value.toLocaleString()}</span>
        {note}
      </div>
      <div className="stat-label">{label}</div>
    </>
  );
  if (!onClick)
    return <div className={`stat${tone ? ` stat-${tone}` : ""}`}>{body}</div>;
  return (
    <button
      className={`stat stat-button${tone ? ` stat-${tone}` : ""}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
