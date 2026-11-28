// Ask: the knowledge graph as RDF, asked in SPARQL. The same vocabulary and
// endpoint agents get through the `sparql` MCP tool and `kula kg sparql`
// (src/kg.rs); results link back into the map. Examples, vocabulary and
// export are docked in the shell's sidebar.
import { useEffect, useRef, useState } from "react";
import { api, type SparqlResult, type SparqlValue } from "../../api";
import { useCode } from "../../CodePanel";
import { Docked } from "../../studio/Dock";
import { Icon, useToast } from "../../ui";
import { Seg, useSaved, WEmpty, Widget, type Nav } from "./parts";

type Ex = { title: string; query: string };
type Vocab = { term: string; kind: string; doc: string };
type Fmt = "ttl" | "jsonld" | "nt" | "rdfxml";

const KEY = "kula.query.v1";
const load = () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const save = (q: string) => { try { localStorage.setItem(KEY, q); } catch { /* private mode */ } };

/** `code:sym:src/a.rs#Repo.status` → path and name, for opening. */
export function parseIri(v: SparqlValue): { path: string; name?: string } | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^code:(sym|file):([^#]+)(?:#([^~]+))?/);
  if (!m) return null;
  return { path: decodeURIComponent(m[2]), name: m[3] ? decodeURIComponent(m[3]).split(".").pop() : undefined };
}

export default function Ask({ openSymbol }: Nav) {
  const [q, setQ] = useState(load);
  const [ex, setEx] = useState<Ex[]>([]);
  const [vocab, setVocab] = useState<Vocab[]>([]);
  const [res, setRes] = useState<SparqlResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useSaved<"examples" | "vocabulary">("kula.query.side", "examples");
  const area = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const code = useCode();
  useEffect(() => {
    api.kgExamples().then((r) => { setEx(r.examples); setVocab(r.vocabulary); if (!load()) setQ(r.examples[0]?.query ?? ""); }).catch(() => {});
  }, []);

  const run = async (text = q) => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null); save(text);
    try { setRes(await api.sparql(text)); }
    catch (e: any) { setErr(e.message); setRes(null); }
    finally { setBusy(false); }
  };
  const openNamed = async (name: string, path: string) => {
    const hits = await api.search(name).catch(() => []);
    const hit = hits.find((h) => h.path === path && h.name === name) ?? hits.find((h) => h.name === name);
    if (hit) openSymbol(hit.id); else code.open({ path });
  };
  const open = (v: SparqlValue) => {
    const t = parseIri(v);
    if (!t) return;
    if (t.name) openNamed(t.name, t.path); else code.open({ path: t.path });
  };
  const download = async (format: Fmt) => {
    try {
      const r = await api.kgExport(format);
      const ext = { ttl: "ttl", jsonld: "jsonld", nt: "nt", rdfxml: "rdf" }[format];
      const url = URL.createObjectURL(new Blob([r.text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url; a.download = `kula-graph.${ext}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) { toast(e.message, "err"); }
  };
  const insert = (term: string) => {
    const el = area.current;
    const a = el?.selectionStart ?? q.length, b = el?.selectionEnd ?? a;
    setQ(q.slice(0, a) + term + q.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + term.length, a + term.length); });
  };

  const cell = (v: SparqlValue | undefined, row?: Record<string, SparqlValue>, col?: string) => {
    if (v === undefined) return <span className="kq-none">none</span>;
    // A ?name beside a ?path names something in the map.
    if (col === "name" && typeof v === "string" && typeof row?.path === "string") return <button className="kq-iri mono" onClick={() => openNamed(v, row.path as string)} title="Open in the map">{v}</button>;
    if (col === "path" && typeof v === "string" && !v.startsWith("pkg:")) return <button className="kq-iri mono kq-path" onClick={() => code.open({ path: v })} title="Open source">{v}</button>;
    if (parseIri(v)) return <button className="kq-iri mono" onClick={() => open(v)} title="Open">{String(v).replace(/^code:/, "")}</button>;
    if (typeof v === "boolean") return <span className={v ? "kq-true" : "kq-false"}>{String(v)}</span>;
    if (typeof v === "number") return <span className="kq-num">{v.toLocaleString()}</span>;
    return <span className={String(v).startsWith("kula:") ? "kq-term mono" : ""}>{String(v)}</span>;
  };

  const status = res && !err
    ? `${res.rows ? `${res.rows.length}${res.truncated ? "+" : ""} rows` : res.triples ? `${res.triples.length} triples` : "ask"}${res.millis != null ? ` in ${res.millis} ms` : ""}`
    : undefined;

  let out;
  if (err) out = <pre className="kq-err">{err}</pre>;
  else if (!res) out = <WEmpty icon={<Icon.query />}>Run a query to see rows</WEmpty>;
  else if (res.boolean !== undefined) out = <div className="kq-bool">{cell(res.boolean)}</div>;
  else if (res.rows) out = res.rows.length === 0 ? <WEmpty icon={<Icon.query />}>No rows matched</WEmpty> : (
    <table className="kq-table">
      <thead><tr>{res.vars!.map((v) => <th key={v}>?{v}</th>)}</tr></thead>
      <tbody>{res.rows.map((r, i) => <tr key={i}>{res.vars!.map((v) => <td key={v}>{cell(r[v], r, v)}</td>)}</tr>)}</tbody>
    </table>
  );
  else if (res.triples) out = (
    <table className="kq-table">
      <thead><tr><th>subject</th><th>predicate</th><th>object</th></tr></thead>
      <tbody>{res.triples.map((t, i) => <tr key={i}>{t.map((v, j) => <td key={j}>{cell(v)}</td>)}</tr>)}</tbody>
    </table>
  );

  return (
    <div className="qv qv-ask" data-testid="query-ask">
      <header className="qv-head">
        <span className="spacer" />
        <span className="kq-hint mono">⌘↵</span>
        <button className="btn sm primary" onClick={() => run()} disabled={busy || !q.trim()}><Icon.play /> Run</button>
      </header>
      <div className="qv-stack">
        <Widget area="editor" title="SPARQL" count="read only" className="kq-editor">
          <textarea ref={area} className="textarea mono kq-text" value={q} spellCheck={false} aria-label="SPARQL query"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
              if (e.key === "Tab") { e.preventDefault(); insert("  "); }
            }} />
        </Widget>
        <Widget area="results" title="Results" count={status} className="kq-out">{out}</Widget>
      </div>
      <Docked label="Query">
        <div className="ct ct-side qv-side" data-testid="query-side">
          <div className="ct-side-head">
            <Seg label="Reference" value={side} set={setSide} opts={[{ id: "examples", label: "Examples" }, { id: "vocabulary", label: "Vocabulary" }]} />
          </div>
          <div className="ct-side-scroll">
            {side === "examples" ? (
              <section className="ct-card qv-list">
                {ex.length === 0 && <p className="ct-hint">No examples</p>}
                {ex.map((e) => (
                  <button key={e.title} className="kq-ex" onClick={() => { setQ(e.query); run(e.query); }}>
                    <b>{e.title}</b><span className="mono">{e.query.split("\n")[0]}</span>
                  </button>
                ))}
              </section>
            ) : (
              <section className="ct-card qv-list">
                {vocab.map((v) => (
                  <button key={v.term} className="kq-v" onClick={() => insert(v.term)} title="Insert at cursor">
                    <span className={`mono ${v.kind === "class" ? "kq-class" : "kq-prop"}`}>{v.term}</span>
                    <span>{v.doc}</span>
                  </button>
                ))}
              </section>
            )}
            <section className="ct-card">
              <h4>Export graph</h4>
              <div className="qv-export">
                {(["ttl", "jsonld", "nt", "rdfxml"] as const).map((f) => <button key={f} className="btn sm ghost mono" onClick={() => download(f)} title={`Download as ${f}`}>{f}</button>)}
              </div>
              <p className="ct-hint">Prefixes kula code rdf rdfs xsd are predeclared.</p>
            </section>
          </div>
        </div>
      </Docked>
    </div>
  );
}
