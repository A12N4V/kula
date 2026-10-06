// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Docs tab: the files agents read, and the generated brief (module S1).

import { useEffect, useState } from "react";
import { api, type AgentDoc, type AgentsInfo } from "../../api";
import { CodeField, LinkArea } from "../../Autofill";
import { Icon, useToast } from "../../ui";
import type { Act } from "./data";
import { Card, useListNav } from "./parts";

export default function Docs({ info, act }: { info: AgentsInfo; act: Act }) {
  const [sel, setSel] = useState<string>(info.docs[0]?.path ?? "AGENTS.md");
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [brief, setBrief] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const toast = useToast();
  useEffect(() => {
    setText(null);
    api.agentAction<{ text: string }>("doc_read", { path: sel }).then((r) => { setText(r.text); setSaved(r.text); }).catch((e) => toast(e.message, "err"));
  }, [sel, info]);
  const nav = useListNav(info.docs.length, (i) => setSel(info.docs[i].path));
  const doc = info.docs.find((d) => d.path === sel);
  const state = (d: AgentDoc) => (!d.exists ? ["missing", ""] : d.current ? ["brief current", "green"] : d.synced ? ["brief outdated", "yellow"] : ["no brief", ""]);
  const settings = (docs: string[]) => act("settings_save", { agents: { hide_secrets: info.secrets_hidden, memory: info.memory_enabled, docs } }, "Saved to kula.toml");
  return (
    <div className="docs-split">
      <div className="docs-list">
        <div className="section-title">Read by agents <span className="count">{info.docs.length}</span></div>
        <div {...nav.props}>
          {info.docs.map((d, i) => (
            <button key={d.path} className={`doc-item row-hover ${sel === d.path ? "on" : ""} ${nav.sel === i ? "kb-sel" : ""}`} data-idx={i} id={`list-item-${i}`} onClick={() => setSel(d.path)}>
              <span className="mono">{d.path}</span>
              <span className={`tag ${state(d)[1]}`}>{state(d)[0]}</span>
              <span className="muted doc-readers">{d.readers}</span>
            </button>
          ))}
        </div>
        <form className="row doc-add" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) { settings([...info.docs_list, adding.trim()]); setAdding(""); } }}>
          <CodeField value={adding} onChange={setAdding} as="pattern" placeholder="add a doc every agent reads" label="Add a doc" />
          <button className="btn sm" disabled={!adding.trim()} aria-label="Add doc"><Icon.plus /></button>
        </form>
        <div className="section-title">Settings</div>
        <label className="toggle"><input type="checkbox" checked={info.memory_enabled} onChange={(e) => act("settings_save", { agents: { hide_secrets: info.secrets_hidden, memory: e.target.checked, docs: info.docs_list } }, e.target.checked ? "Agent memory on" : "Agent memory off")} /> agents may keep memories</label>
        <label className="toggle"><input type="checkbox" checked={info.secrets_hidden} onChange={(e) => act("settings_save", { agents: { hide_secrets: e.target.checked, memory: info.memory_enabled, docs: info.docs_list } }, "Saved")} /> hide likely secrets</label>
        <div className="section-title">Brief</div>
        <div className="row"><button className="btn sm primary" onClick={() => act("docs_sync", {}, "Brief synced into the instruction files")}>Sync brief</button><button className="btn sm ghost" onClick={() => api.agentAction<{ text: string }>("brief").then((r) => setBrief(r.text))}>Preview</button></div>
      </div>
      <section className="card docs-edit">
        <div className="card-head">
          <h2 className="mono">{sel}</h2>{doc && <span className="muted">{doc.readers}</span>}<span className="spacer" />
          {info.docs_list.includes(sel) && <button className="btn sm ghost" onClick={() => settings(info.docs_list.filter((d) => d !== sel))}>Stop pointing agents here</button>}
          {text !== null && text !== saved && <button className="btn sm ghost" onClick={() => setText(saved)}>Revert</button>}
          <button className="btn sm primary" disabled={text === null || text === saved} onClick={() => act("doc_save", { path: sel, text }, `Saved ${sel}`).then(() => setSaved(text ?? "")).catch(() => {})}>Save</button>
        </div>
        {brief !== null && (
          <div className="brief-preview">
            <div className="row"><span className="eyebrow">generated brief</span><span className="spacer" /><button className="btn sm ghost" onClick={() => setBrief(null)} aria-label="Close preview"><Icon.close /></button></div>
            <pre className="code">{brief}</pre>
          </div>
        )}
        {text === null ? <div className="muted ag-empty">Loading…</div> : (
          <LinkArea value={text} onChange={setText} className="doc-text" placeholder={doc?.exists ? "" : `${sel} does not exist yet – write it, or Sync brief to start it.`} label={`Edit ${sel}`}
            onSubmit={() => act("doc_save", { path: sel, text }, `Saved ${sel}`).then(() => setSaved(text)).catch(() => {})} />
        )}
      </section>
    </div>
  );
}
