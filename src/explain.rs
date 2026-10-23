//! The plain-language map – names a non-coder can read, made once, shared
//! through git.
//!
//! Every map block gets a plain name (≤ 4 everyday words), one sentence on
//! what it does for the person using the software, and the journeys it is
//! part of. The words come from **the model the user already has plugged
//! in** – their coding agent (Claude Code, Codex, Gemini CLI, Cursor) runs
//! the shipped `kula-map` skill:
//!   `kula map explain todo`  → the blocks that need words, with context
//!   `kula map explain apply --model <label> <file>` → writes them
//! No local model server is needed. Re-mapping with another model is
//! `todo --all` + `apply --model other`; every entry records its model.
//!
//! Storage: `refs/kula/map` (one JSON document, `plain.json`, a commit per
//! apply), exactly like issues and notes on `refs/kula/meta`. `kula sync`
//! fetches and merges it, `kula share` pushes it, so anyone who clones the
//! project and installs kula gets the words without spending a token. Each
//! entry carries a content hash of its block: only blocks whose code changed
//! are ever asked for again. The graph and the map structure themselves are
//! deterministic local caches – rebuilding them costs CPU, not tokens.
//!
//! Until a model has named a block, the words fall back to its EmbeddingGemma
//! theme (computed locally by the map engine) or its humanised name.

use crate::git::Repo;
use crate::server::{blocking, ApiResult, AppState};
use anyhow::{bail, Result};
use axum::extract::{Query, State};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const REF: &str = "refs/kula/map";
const FILE: &str = "plain.json";
pub const SKILL: &str = "kula-map";

/// "build_with_inner" / "FlowCanvas" / "src · compare" → "Build with" …
pub fn humanise(s: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    for part in s.split(|c: char| c == '·' || c == '_' || c == '-' || c == '/' || c == '.' || c.is_whitespace()) {
        let mut cur = String::new();
        let mut prev_lower = false;
        for ch in part.chars() {
            if ch.is_uppercase() && prev_lower && !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
            prev_lower = ch.is_lowercase() || ch.is_ascii_digit();
            cur.push(ch);
        }
        if !cur.is_empty() {
            words.push(cur);
        }
    }
    const SKIP: [&str; 8] = ["src", "lib", "mod", "inner", "impl", "web", "index", "main"];
    let kept: Vec<String> = words.iter().map(|w| w.to_lowercase()).filter(|w| !SKIP.contains(&w.as_str())).collect();
    let pick = if kept.is_empty() { words.iter().map(|w| w.to_lowercase()).collect() } else { kept };
    let mut out = pick.into_iter().take(4).collect::<Vec<_>>().join(" ");
    if let Some(f) = out.get(0..1) {
        out = f.to_uppercase() + &out[1..];
    }
    out
}

fn role_sentence(role: &str) -> &'static str {
    match role {
        "entry" => "Where the software starts or a request first arrives",
        "orchestrator" => "Coordinates other parts and decides what happens next",
        "core" => "Does the main work",
        "adapter" => "Talks to the outside world – files, the network or other programs",
        "utility" => "Shared helpers the rest of the code leans on",
        "model" => "Describes the data the software works with",
        "config" => "Settings and options",
        "test" => "Checks that the rest works",
        _ => "Holds supporting code",
    }
}

/* ---- storage on refs/kula/map ------------------------------------------ */

pub fn load(repo: &Repo) -> Map<String, Value> {
    repo.run(&["show", &format!("{REF}:{FILE}")]).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(repo: &Repo, doc: &Map<String, Value>, message: &str) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(&Value::Object(doc.clone()))?;
    let blob = repo.run_stdin(&["hash-object", "-w", "--stdin"], &bytes)?.trim().to_string();
    let tree = repo.run_stdin(&["mktree"], format!("100644 blob {blob}\t{FILE}\n").as_bytes())?.trim().to_string();
    let parent = repo.run(&["rev-parse", "--verify", "--quiet", REF]).ok().map(|s| s.trim().to_string());
    let mut args = vec!["commit-tree".to_string(), tree, "-m".into(), format!("kula map: {message}")];
    if let Some(p) = parent.filter(|p| !p.is_empty()) {
        args.push("-p".into());
        args.push(p);
    }
    let commit = repo.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?.trim().to_string();
    repo.run(&["update-ref", REF, &commit])?;
    Ok(())
}

/// Union-merge a fetched copy into ours: per block, the newer entry wins.
pub fn sync(repo: &Repo, remote: &str, share: bool) -> Result<String> {
    let mut log = String::new();
    if repo.run(&["fetch", remote, &format!("+{REF}:refs/kula/remote-map")]).is_ok() {
        let theirs: Map<String, Value> = repo
            .run(&["show", &format!("refs/kula/remote-map:{FILE}")])
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut ours = load(repo);
        let tb = theirs.get("blocks").and_then(|v| v.as_object()).cloned().unwrap_or_default();
        let ob = ours.entry("blocks").or_insert_with(|| json!({})).as_object_mut().unwrap();
        let mut n = 0;
        for (id, t) in tb {
            let newer = ob.get(&id).map(|o| t["at"].as_i64().unwrap_or(0) > o["at"].as_i64().unwrap_or(0)).unwrap_or(true);
            if newer {
                ob.insert(id, t);
                n += 1;
            }
        }
        if n > 0 {
            save(repo, &ours, &format!("sync – {n} names from {remote}"))?;
        }
        log.push_str(&format!("map names: merged {n} from {remote}\n"));
    } else {
        log.push_str("map names: remote has none yet\n");
    }
    if share && repo.run(&["rev-parse", "--verify", "--quiet", REF]).is_ok() {
        repo.run(&["push", remote, &format!("{REF}:{REF}")])?;
        log.push_str("pushed refs/kula/map\n");
    }
    Ok(log)
}

/* ---- the map, as context ----------------------------------------------- */

pub fn load_map(repo: &Repo) -> Result<Value> {
    let store = crate::store::Store::open(repo)?;
    let (idx, embed_state) = crate::embed::similarity_for(repo, &store);
    let sim = idx.as_ref().map(|i| i as &dyn crate::map::Similarity);
    let mut v = crate::map::all_json_with(repo, &store, sim, embed_state)?;
    // blocks arrive as a list; key them by id
    if let Some(list) = v.get("blocks").and_then(|b| b.as_array()).cloned() {
        let keyed: Map<String, Value> = list.into_iter().filter_map(|b| Some((b.get("id")?.as_str()?.to_string(), b))).collect();
        v["blocks"] = Value::Object(keyed);
    }
    Ok(v)
}

struct Ctx<'a> {
    blocks: &'a Map<String, Value>,
    leaves: &'a Map<String, Value>,
    flows: Vec<(String, Vec<String>)>,
}

fn ctx_of(map: &Value) -> Ctx<'_> {
    static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();
    let empty = EMPTY.get_or_init(Map::new);
    let flows = map
        .get("value_flows")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .map(|f| {
                    (
                        f.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        f.get("sections")
                            .and_then(|v| v.as_array())
                            .map(|s| s.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                            .unwrap_or_default(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    Ctx {
        blocks: map.get("blocks").and_then(|v| v.as_object()).unwrap_or(empty),
        leaves: map.get("leaves").and_then(|v| v.as_object()).unwrap_or(empty),
        flows,
    }
}

fn symbols_under(c: &Ctx, id: &str, out: &mut Vec<i64>) {
    let Some(b) = c.blocks.get(id) else { return };
    if let Some(a) = b.get("symbols").and_then(|v| v.as_array()) {
        out.extend(a.iter().filter_map(|v| v.as_i64()));
    }
    if let Some(a) = b.get("children").and_then(|v| v.as_array()) {
        for k in a.iter().filter_map(|v| v.as_str()) {
            symbols_under(c, k, out);
        }
    }
}

fn leaf<'a>(c: &'a Ctx, s: i64) -> Option<&'a Value> {
    c.leaves.get(&s.to_string())
}

/// What the block is made of, for the hash and for the model's context.
fn facts(c: &Ctx, id: &str) -> (Vec<String>, Vec<String>) {
    let mut syms = Vec::new();
    symbols_under(c, id, &mut syms);
    let mut names: Vec<String> = syms.iter().filter_map(|s| leaf(c, *s)?.get("name")?.as_str().map(String::from)).collect();
    let mut files: Vec<String> = syms.iter().filter_map(|s| leaf(c, *s)?.get("path")?.as_str().map(String::from)).collect();
    names.sort();
    names.dedup();
    files.sort();
    files.dedup();
    (names, files)
}

fn block_hash(c: &Ctx, id: &str) -> String {
    let (names, files) = facts(c, id);
    let mut h = Sha256::new();
    h.update(id.as_bytes());
    for n in names.iter().chain(files.iter()) {
        h.update(n.as_bytes());
        h.update([0]);
    }
    format!("{:x}", h.finalize())[..16].to_string()
}

fn journeys(c: &Ctx, id: &str) -> Vec<String> {
    c.flows.iter().filter(|(_, secs)| secs.iter().any(|x| x == id)).map(|(n, _)| n.clone()).take(3).collect()
}

/// The fallback words: EmbeddingGemma theme, role and functions.
fn fallback(c: &Ctx, id: &str) -> Value {
    let b = &c.blocks[id];
    let s = |k: &str| b.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let plain = if !s("theme").is_empty() { humanise(s("theme")) } else { humanise(s("name")) };
    let (names, _) = facts(c, id);
    let mut seen = std::collections::BTreeSet::new();
    let doing: Vec<String> =
        names.iter().map(|n| humanise(n).to_lowercase()).filter(|n| n.len() > 2 && seen.insert(n.clone())).take(3).collect();
    let mut sentence = role_sentence(s("role")).to_string();
    if !doing.is_empty() {
        sentence += &format!(" – for example: {}", doing.join(", "));
    }
    sentence.push('.');
    json!({ "plain": plain, "sentence": sentence, "source": if s("theme").is_empty() { "name" } else { "theme" } })
}

/// Every block's words: the stored model words where the hash still
/// matches, else the fallback. `stale` lists blocks the model should name.
fn resolve(repo: &Repo, map: &Value) -> (Map<String, Value>, Vec<String>) {
    let c = ctx_of(map);
    let doc = load(repo);
    let stored = doc.get("blocks").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let mut out = Map::new();
    let mut stale = Vec::new();
    for id in c.blocks.keys() {
        let hash = block_hash(&c, id);
        let mut v = fallback(&c, id);
        match stored.get(id) {
            Some(e) if e["hash"].as_str() == Some(hash.as_str()) => {
                for k in ["plain", "sentence", "area"] {
                    if let Some(x) = e.get(k).filter(|x| x.as_str().map(|s| !s.is_empty()).unwrap_or(false)) {
                        v[k] = x.clone();
                    }
                }
                v["source"] = json!("model");
                v["model"] = e.get("model").cloned().unwrap_or(Value::Null);
            }
            _ => stale.push(id.clone()),
        }
        let j = journeys(&c, id);
        v["journeys"] = json!(j);
        v["hash"] = json!(hash);
        out.insert(id.clone(), v);
    }
    stale.sort();
    (out, stale)
}

/* ---- the CLI the skill drives ------------------------------------------ */

/// `kula map explain todo [--all] [--limit N]` – the blocks that need words,
/// each with the context a model needs to name it (JSON).
pub fn todo(repo: &Repo, all: bool, limit: usize) -> Result<Value> {
    let map = load_map(repo)?;
    let c = ctx_of(&map);
    let (_, stale) = resolve(repo, &map);
    let ids: Vec<String> = if all {
        let mut k: Vec<String> = c.blocks.keys().cloned().collect();
        k.sort();
        k
    } else {
        stale
    };
    let total = ids.len();
    let items: Vec<Value> = ids
        .into_iter()
        .take(limit)
        .map(|id| {
            let b = &c.blocks[&id];
            let (names, files) = facts(&c, &id);
            json!({
                "id": id,
                "hash": block_hash(&c, &id),
                "code_name": b.get("name"),
                "role": b.get("role"),
                "theme": b.get("theme"),
                "parent": b.get("parent"),
                "files": files.into_iter().take(8).collect::<Vec<_>>(),
                "functions": names.into_iter().take(24).collect::<Vec<_>>(),
                "journeys": journeys(&c, &id),
            })
        })
        .collect();
    Ok(json!({
        "remaining": total,
        "batch": items,
        "write_back": "kula map explain apply --model <your model> <file.json>",
        "answer_shape": { "<id>": { "hash": "<hash from the batch>", "plain": "≤ 4 everyday words", "sentence": "one sentence on what it does for the person using the software", "area": "≤ 3 words: the product area – what the person is trying to get done (shared by related blocks)" } },
    }))
}

/// `kula map explain apply --model <label> <file>` – validate and store.
pub fn apply(repo: &Repo, model: &str, answers: &Value) -> Result<usize> {
    if model.trim().is_empty() {
        bail!("--model is required – name the model that wrote these words (e.g. claude-opus-5-5)");
    }
    let map = load_map(repo)?;
    let c = ctx_of(&map);
    let Some(ans) = answers.as_object() else { bail!("expected a JSON object keyed by block id") };
    let mut doc = load(repo);
    let at = crate::meta::now();
    let mut n = 0;
    {
        let blocks = doc.entry("blocks").or_insert_with(|| json!({})).as_object_mut().unwrap();
        for (id, a) in ans {
            if !c.blocks.contains_key(id) {
                continue; // a block that no longer exists
            }
            let plain = a["plain"].as_str().unwrap_or("").trim();
            let sentence = a["sentence"].as_str().unwrap_or("").trim();
            if plain.is_empty() || sentence.is_empty() {
                continue;
            }
            let plain: String = plain.split_whitespace().take(4).collect::<Vec<_>>().join(" ");
            // optional: the product area, so the map can group by intent
            let area: String = a["area"].as_str().unwrap_or("").split_whitespace().take(3).collect::<Vec<_>>().join(" ");
            // the words describe the code as it is now – re-hash, never trust a stale hash
            blocks.insert(
                id.clone(),
                {
                    let mut e = json!({ "hash": block_hash(&c, id), "plain": plain, "sentence": sentence.replace('—', "–"), "model": model, "at": at });
                    if !area.is_empty() {
                        e["area"] = json!(area);
                    }
                    e
                },
            );
            n += 1;
        }
    }
    let runs = doc.entry("runs").or_insert_with(|| json!([])).as_array_mut().unwrap();
    runs.push(json!({ "model": model, "at": at, "blocks": n }));
    if n > 0 {
        save(repo, &doc, &format!("{n} names by {model}"))?;
    }
    Ok(n)
}

pub fn status(repo: &Repo) -> Result<Value> {
    let map = load_map(repo)?;
    let (all, stale) = resolve(repo, &map);
    let mut by_model: HashMap<String, usize> = HashMap::new();
    for v in all.values() {
        if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
            *by_model.entry(m.to_string()).or_default() += 1;
        }
    }
    Ok(
        json!({ "blocks": all.len(), "named": all.len() - stale.len(), "stale": stale.len(), "by_model": by_model, "ref": REF, "skill": format!(".agents/skills/{SKILL}") }),
    )
}

/// The skill the user's own agent runs. Written into `.agents/skills/` on
/// first use; `kula skill sync` places it for every connected agent.
pub const SKILL_MD: &str = r#"---
name: kula-map
description: Name every part of this codebase in plain words for kula's map, so people who do not code can read it. Use when asked to map, re-map, or explain the codebase map.
---

# kula-map – plain words for the code map

You write the words a non-coder reads on kula's map: for each block (a part
of the codebase), a plain name and one sentence. You are the model doing the
naming; kula stores your words in git (`refs/kula/map`) so nobody has to pay
for them again.

## Loop
1. `kula map explain todo --limit 25` – JSON: `batch` (blocks with their code
   name, role, files, functions and the journeys they are part of) and
   `remaining`. Add `--all` only when asked to **re-map** everything.
2. For each block, write:
   - `plain` – at most 4 everyday words a shop owner would understand
     ("Saves your work", "Search box", "Talks to GitHub"). No code words, no
     file names, no camelCase.
   - `sentence` – one short sentence on what it does **for the person using
     the software**. Read the files when the names are not enough.
   - `area` – at most 3 words for the product area: what the person is
     trying to get done ("Agent safety", "Seeing changes", "Promo films").
     Reuse the same area for related blocks – the map groups by it, so aim
     for 5–9 areas over the whole codebase, never one per block.
3. Save `{ "<id>": { "hash": "…", "plain": "…", "sentence": "…", "area": "…" } }` to a
   temp file and run `kula map explain apply --model <your model id> <file>`.
4. Repeat until `remaining` is 0. Then `kula map explain status`.

## Rules
- Be accurate over clever: if a block only formats dates, say so.
- Siblings must be distinguishable – two blocks never share a plain name.
- Use en dashes (–), never em dashes.
- Do not edit code. Only the map words change.
- To share the words with everyone who clones the project: `kula share`.
"#;

pub fn ensure_skill(repo: &Repo) -> Result<bool> {
    let dir = repo.root.join(crate::skills::SOURCE).join(SKILL);
    let p = dir.join("SKILL.md");
    if p.exists() {
        return Ok(false);
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&p, SKILL_MD)?;
    Ok(true)
}

/// The command line that asks the user's default agent to run the skill
/// headless. Returns None when no agent is configured.
pub fn agent_command(repo: &Repo, agent: Option<&str>, all: bool) -> Option<Vec<String>> {
    let cfg = crate::config::Config::load(&repo.root).ok()?;
    let id = agent.map(String::from).filter(|a| !a.is_empty()).unwrap_or(cfg.agents.default.clone());
    let task = format!(
        "Use the {SKILL} skill to {} kula's code map in plain words, until `kula map explain todo` reports 0 remaining.",
        if all { "re-map every block of" } else { "name the unnamed blocks of" }
    );
    match id.as_str() {
        "claude" => {
            Some(vec!["claude".into(), "-p".into(), task, "--allowedTools".into(), "Bash(kula map explain:*) Read Glob Grep Write".into()])
        }
        "codex" => Some(vec!["codex".into(), "exec".into(), task]),
        "gemini" => Some(vec!["gemini".into(), "-p".into(), task]),
        _ => None,
    }
}

/* ---- HTTP ---------------------------------------------------------------- */

/// GET /api/map/explain
pub(crate) async fn explain(State(s): State<AppState>) -> ApiResult {
    blocking(move || {
        let map = load_map(&s.repo)?;
        let (blocks, stale) = resolve(&s.repo, &map);
        let st = status_from(&blocks, stale.len());
        Ok(json!({ "blocks": blocks, "stale": stale.len(), "status": st, "agent": crate::config::Config::load(&s.repo.root).map(|c| c.agents.default).unwrap_or_default() }))
    })
    .await
}

fn status_from(all: &Map<String, Value>, stale: usize) -> Value {
    json!({ "named": all.len() - stale, "total": all.len() })
}

/// True on test/probe servers: `KULA_NO_AGENT` set, or the test tokens the
/// e2e fixture and the team probe servers use.
fn agent_runs_disabled() -> bool {
    std::env::var_os("KULA_NO_AGENT").is_some() || matches!(std::env::var("KULA_TOKEN").as_deref(), Ok("test") | Ok("probe"))
}

#[derive(Deserialize, Default)]
pub struct RunBody {
    pub agent: Option<String>,
    #[serde(default)]
    pub all: bool,
}

/// POST /api/map/explain/run {agent?, all?} – start the user's agent on the
/// skill in the background. Without an agent, returns the command to run.
pub(crate) async fn explain_run(State(s): State<AppState>, body: Option<axum::Json<RunBody>>) -> ApiResult {
    let b = body.map(|j| j.0).unwrap_or_default();
    blocking(move || {
        ensure_skill(&s.repo)?;
        // Test and probe servers never start an agent: a click in a test would
        // otherwise run the user's real agent (and bill it) on a fixture.
        if agent_runs_disabled() {
            return Ok(json!({ "started": false, "reason": "agent runs are off on this server (test mode)", "command": "kula map explain todo" }));
        }
        let Some(cmd) = agent_command(&s.repo, b.agent.as_deref(), b.all) else {
            return Ok(json!({ "started": false, "reason": "no default agent – connect one in Agents, or run the kula-map skill from your agent", "command": "kula map explain todo" }));
        };
        let root = s.repo.root.clone();
        let shown = cmd.join(" ");
        std::thread::spawn(move || {
            let _ = std::process::Command::new(&cmd[0]).args(&cmd[1..]).current_dir(&root)
                .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
        });
        Ok(json!({ "started": true, "command": shown }))
    })
    .await
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
}

fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2)
        .map(String::from)
        .chain(humanise(s).to_lowercase().split_whitespace().map(String::from))
        .collect()
}

/// GET /api/search/semantic?q=&limit= – blocks ranked for a plain question:
/// EmbeddingGemma (local, already installed with kula's embeddings) when
/// present, word overlap over the plain words otherwise (`mode` says which).
pub(crate) async fn semantic(State(s): State<AppState>, Query(q): Query<SearchQuery>) -> ApiResult {
    blocking(move || {
        let text = q.q.unwrap_or_default();
        let limit = q.limit.unwrap_or(8).clamp(1, 50);
        if text.trim().is_empty() {
            return Ok(json!({ "hits": [], "mode": "empty" }));
        }
        let map = load_map(&s.repo)?;
        let c = ctx_of(&map);
        let (plain, _) = resolve(&s.repo, &map);
        let mut scored: Vec<(String, f32)> = Vec::new();
        let mut mode = "words";
        if crate::embed::installed() {
            if let (Some(idx), Ok(prov)) = (crate::embed::load_index(&s.repo), provider()) {
                if let Ok(mut v) = prov.embed(&[format!("task: search result | query: {text}")]) {
                    let qv = crate::embed::truncate(&v.remove(0), idx.dim);
                    for id in c.blocks.keys() {
                        let mut syms = Vec::new();
                        symbols_under(&c, id, &mut syms);
                        if let Some(cen) = crate::embed::block_centroid(&idx, &syms) {
                            scored.push((id.clone(), crate::embed::cosine(&qv, &cen)));
                        }
                    }
                    mode = "semantic";
                }
            }
        }
        if scored.is_empty() {
            let qw = words(&text);
            for (id, e) in &plain {
                let hay = format!("{} {} {}", e["plain"].as_str().unwrap_or(""), e["sentence"].as_str().unwrap_or(""), c.blocks[id].get("name").and_then(|v| v.as_str()).unwrap_or(""));
                let hw: std::collections::HashSet<String> = words(&hay).into_iter().collect();
                let hit = qw.iter().filter(|w| hw.contains(*w)).count() as f32;
                if hit > 0.0 {
                    scored.push((id.clone(), hit / qw.len().max(1) as f32));
                }
            }
        }
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let hits: Vec<Value> = scored.into_iter().take(limit).map(|(id, sc)| json!({ "id": id, "score": (sc * 1000.0).round() / 1000.0, "plain": plain.get(&id).and_then(|e| e.get("plain")).cloned().unwrap_or(Value::Null) })).collect();
        Ok(json!({ "hits": hits, "mode": mode }))
    })
    .await
}

fn provider() -> Result<std::sync::Arc<dyn crate::embed::EmbedProvider>> {
    static P: std::sync::OnceLock<std::sync::Arc<dyn crate::embed::EmbedProvider>> = std::sync::OnceLock::new();
    if let Some(p) = P.get() {
        return Ok(p.clone());
    }
    let p = crate::embed::real_provider()?;
    let _ = P.set(p.clone());
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::humanise;

    #[test]
    fn humanise_reads_like_words() {
        assert_eq!(humanise("build_with_inner"), "Build with");
        assert_eq!(humanise("FlowCanvas"), "Flow canvas");
        assert_eq!(humanise("src · compare"), "Compare");
    }
}
