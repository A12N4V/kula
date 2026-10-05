// Query: the knowledge graph as RDF, asked in SPARQL. The same vocabulary and
// endpoint agents get through the `sparql` MCP tool and `kula kg sparql`
// (src/kg.rs); results link back into the map.

import { useEffect, useRef, useState } from "react";
import { api, type SparqlResult, type SparqlValue } from "../api";
import { useCode } from "../CodePanel";
import type { Go, Target } from "../nav";
import { Empty, Icon, useToast } from "../ui";
import { Grip, listWidth } from "../resize";

type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };
type Ex = { title: string; query: string };
type Vocab = { term: string; kind: string; doc: string };

const KEY = "kula.query.v1";
const load = () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const save = (q: string) => { try { localStorage.setItem(KEY, q); } catch { /* private mode */ } };

/** `code:sym:src/a.rs#Repo.status` → path and name, for opening. */
function parseIri(v: SparqlValue): { path: string; name?: string } | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^code:(sym|file):([^#]+)(?:#([^~]+))?/);
  if (!m) return null;
  const path = decodeURIComponent(m[2]);
  const name = m[3] ? decodeURIComponent(m[3]).split(".").pop() : undefined;
  return { path, name };
}

export default function Query({ openSymbol }: Nav) {
  const [q, setQ] = useState(load);
  const [ex, setEx] = useState<Ex[]>([]);
  const [vocab, setVocab] = useState<Vocab[]>([]);
  const [res, setRes] = useState<SparqlResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<"examples" | "vocabulary">("examples");
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
  const open = async (v: SparqlValue) => {
    const t = parseIri(v);
    if (!t) return;
    if (!t.name) { code.open({ path: t.path }); return; }
    const hits = await api.search(t.name).catch(() => []);
    const hit = hits.find((h) => h.path === t.path && h.name === t.name) ?? hits.find((h) => h.name === t.name);
    if (hit) openSymbol(hit.id);
  };
  const download = async (format: "ttl" | "jsonld" | "nt" | "rdfxml") => {
    try {
      const r = await api.kgExport(format);
      const ext = { ttl: "ttl", jsonld: "jsonld", nt: "nt", rdfxml: "rdf" }[format];
      const url = URL.createObjectURL(new Blob([r.text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url; a.download = `kula-graph.${ext}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) { toast(e.message, "err"); }
  };

  const openNamed = async (name: string, path: string) => {
    const hits = await api.search(name).catch(() => []);
    const hit = hits.find((h) => h.path === path && h.name === name);
    if (hit) openSymbol(hit.id); else code.open({ path });
  };
  const cell = (v: SparqlValue | undefined, row?: Record<string, SparqlValue>, col?: string) => {
    if (v === undefined) return <span className="muted">–</span>;
    // A ?name beside a ?path names something in the map.
    if (col === "name" && typeof v === "string" && typeof row?.path === "string") return <button className="kq-iri mono" onClick={() => openNamed(v, row.path as string)} title="Open in the map">{v}</button>;
    if (col === "path" && typeof v === "string" && !v.startsWith("pkg:")) return <button className="kq-iri mono kq-path" onClick={() => code.open({ path: v })} title="Open source">{v}</button>;
    const iri = parseIri(v);
    if (iri) return <button className="kq-iri mono" onClick={() => open(v)} title="Open">{String(v).replace(/^code:/, "")}</button>;
    if (typeof v === "boolean") return <span className={v ? "kq-true" : "kq-false"}>{String(v)}</span>;
    if (typeof v === "number") return <span className="kq-num">{v.toLocaleString()}</span>;
    return <span className={String(v).startsWith("kula:") ? "kq-term mono" : ""}>{String(v)}</span>;
  };

  return (
    <div className="split kq" style={listWidth("query", 320)}>
      <div className="list">
        <div className="list-head">
          <div className="seg">
            <button className={side === "examples" ? "on" : ""} onClick={() => setSide("examples")}>Examples</button>
            <button className={side === "vocabulary" ? "on" : ""} onClick={() => setSide("vocabulary")}>Vocabulary</button>
          </div>
        </div>
        {side === "examples" ? ex.map((e) => (
          <button key={e.title} className="kq-ex" onClick={() => { setQ(e.query); run(e.query); }}>
            <b>{e.title}</b>
            <span className="mono muted">{e.query.split("\n")[0]}</span>
          </button>
        )) : (
          <div className="kq-vocab">
            {vocab.map((v) => (
              <button key={v.term} className="kq-v" onClick={() => {
                const el = area.current; if (!el) return;
                const at = el.selectionStart ?? q.length;
                setQ(q.slice(0, at) + v.term + q.slice(el.selectionEnd ?? at));
              }} title="Insert">
                <span className={`mono ${v.kind === "class" ? "kq-class" : "kq-prop"}`}>{v.term}</span>
                <span className="muted">{v.doc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Grip id="query" edge="right" target="prev" min={220} max={640} label="Resize examples" />
      <div className="detail kq-main">
        <div className="kq-editor">
          <div className="kq-bar">
            <span className="eyebrow">SPARQL 1.1 · read only</span>
            <span className="muted mono kq-prefixes">kula: code: rdf: rdfs: xsd: predeclared</span>
            <span className="spacer" />
            <span className="muted kq-export">export</span>
            {(["ttl", "jsonld", "nt", "rdfxml"] as const).map((f) => <button key={f} className="btn sm ghost mono" onClick={() => download(f)} title={`Download the graph as ${f}`}>{f}</button>)}
          </div>
          <textarea ref={area} className="textarea mono kq-text" value={q} spellCheck={false} aria-label="SPARQL query"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
              if (e.key === "Tab") { e.preventDefault(); const el = e.currentTarget; const a = el.selectionStart; setQ(q.slice(0, a) + "  " + q.slice(el.selectionEnd)); requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2)); }
            }} />
          <div className="kq-bar">
            <button className="btn sm primary" onClick={() => run()} disabled={busy || !q.trim()}><Icon.play /> Run</button>
            <span className="muted"><kbd>⌘</kbd><kbd>↵</kbd></span>
            <span className="spacer" />
            {res && !err && <span className="muted mono">{res.rows ? `${res.rows.length}${res.truncated ? "+" : ""} rows` : res.triples ? `${res.triples.length} triples` : "ask"}{res.millis != null ? ` · ${res.millis} ms` : ""}</span>}
          </div>
        </div>
        <div className="kq-out">
          {err && <pre className="kq-err">{err}</pre>}
          {!err && !res && <Empty title="Ask the graph">Pick an example or write a query. Classes and properties are under Vocabulary; symbols and files in results open in the map.</Empty>}
          {!err && res?.boolean !== undefined && <div className="kq-bool">{cell(res.boolean)}</div>}
          {!err && res?.rows && (res.rows.length === 0 ? <Empty title="No rows">The query matched nothing.</Empty> : (
            <table className="kq-table">
              <thead><tr>{res.vars!.map((v) => <th key={v}>?{v}</th>)}</tr></thead>
              <tbody>{res.rows.map((r, i) => <tr key={i}>{res.vars!.map((v) => <td key={v}>{cell(r[v], r, v)}</td>)}</tr>)}</tbody>
            </table>
          ))}
          {!err && res?.triples && (
            <table className="kq-table">
              <thead><tr><th>subject</th><th>predicate</th><th>object</th></tr></thead>
              <tbody>{res.triples.map((t, i) => <tr key={i}>{t.map((v, j) => <td key={j}>{cell(v)}</td>)}</tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
