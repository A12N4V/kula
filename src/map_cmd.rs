//! `kula map` – the map command family. `blocks` and `chains` stay as hidden
//! aliases that print a one-line deprecation note.

use crate::map::{self, ChainCursor};
use crate::{git, store::Store, MapSub};

pub fn run(sub: Option<MapSub>, repo: &git::Repo, json: bool) -> anyhow::Result<()> {
    match sub.unwrap_or(MapSub::Summary) {
        MapSub::Summary => summary(repo, json),
        MapSub::Blocks { depth } => blocks(repo, json, depth),
        MapSub::Chains { from, to, all } => chains(repo, json, from.as_deref(), to.as_deref(), all),
        MapSub::Roles { role } => roles(repo, json, role.as_deref()),
    }
}

fn print_json(v: &impl serde::Serialize) -> anyhow::Result<()> {
    println!("{}", serde_json::to_string_pretty(v)?);
    Ok(())
}

fn opened(repo: &git::Repo) -> anyhow::Result<(Store, map::Syntagm)> {
    let st = Store::open(repo)?;
    let (idx, state) = crate::embed::similarity_for(repo, &st);
    let sim = idx.as_ref().map(|i| i as &dyn map::Similarity);
    let s = map::build_with(repo, &st, sim, state)?;
    Ok((st, s))
}

fn summary(repo: &git::Repo, json: bool) -> anyhow::Result<()> {
    let (_st, s) = opened(repo)?;
    if json {
        print_json(&s)?;
        return Ok(());
    }
    crate::header("map");
    let sections: Vec<&map::Block> = s.blocks.iter().filter(|b| b.depth == 0).collect();
    let leaves: usize = s.blocks.iter().filter(|b| b.children.is_empty()).map(|b| b.symbols.len()).sum();
    let rows: [(String, String); 8] = [
        ("sections".into(), sections.len().to_string()),
        ("blocks".into(), s.blocks.len().to_string()),
        ("leaves".into(), leaves.to_string()),
        ("families".into(), s.families.len().to_string()),
        ("chains".into(), if s.exact { s.total.to_string() } else { format!("{}+ (saturated)", s.total) }),
        ("loops".into(), s.loops.len().to_string()),
        ("ms".into(), s.stats.ms.to_string()),
        ("threads".into(), s.stats.threads.to_string()),
    ];
    for (k, v) in rows {
        println!("  {:<24} {}", k, v);
    }
    Ok(())
}

fn blocks(repo: &git::Repo, json: bool, depth: Option<usize>) -> anyhow::Result<()> {
    let (_st, s) = opened(repo)?;
    if json {
        print_json(&s.blocks)?;
        return Ok(());
    }
    map::print_blocks(&s, depth);
    Ok(())
}

fn chains(repo: &git::Repo, json: bool, from: Option<&str>, to: Option<&str>, all: bool) -> anyhow::Result<()> {
    let (st, s) = opened(repo)?;
    if all {
        // Stream every chain as NDJSON from the lazy cursor.
        let (cond, node_ids) = map::graph_condensation(&st)?;
        let names: std::collections::HashMap<i64, String> =
            crate::store::Store::open(repo)?.nodes_where("kind != 'file'", [])?.into_iter().map(|n| (n.id, n.name)).collect();
        let mut cur = ChainCursor::new();
        let stdout = std::io::stdout();
        use std::io::Write;
        let mut w = std::io::BufWriter::new(stdout.lock());
        while let Some(path) = ChainCursor::next(&cond, &mut cur) {
            let steps = map::expand_steps(&cond, &node_ids, &path);
            let source = steps[0];
            let terminal = steps[steps.len() - 1];
            if let (Some(f), Some(t)) = (from, to) {
                let fid = names.get(&source).map(|n| n.as_str());
                let tid = names.get(&terminal).map(|n| n.as_str());
                // Both filters given: stream the single (source, terminal)
                // family. The cursor walks every source lazily and skips
                // the rest, so this is O(chains of that family) amortised
                // but still visits the cursor state of all sources.
                if !(fid == Some(f) && tid == Some(t)) {
                    continue;
                }
            } else if from.is_some() && names.get(&source).map(|n| n.as_str()) != from {
                continue;
            }
            let steps_json: Vec<String> = steps.iter().map(|x| x.to_string()).collect();
            let blocks = {
                let by: std::collections::HashMap<i64, String> =
                    s.blocks.iter().flat_map(|b| b.symbols.iter().map(move |&x| (x, b.id.clone()))).collect();
                let mut seen = std::collections::HashSet::new();
                steps.iter().filter_map(|x| by.get(x)).filter(|b| seen.insert((*b).clone())).cloned().collect::<Vec<_>>()
            };
            serde_json::to_writer(
                &mut w,
                &serde_json::json!({ "source": source, "terminal": terminal, "steps": steps_json, "blocks": blocks, "len": steps.len() }),
            )?;
            w.write_all(b"\n")?;
        }
        w.flush()?;
        return Ok(());
    }
    if json {
        print_json(&s.chains)?;
        return Ok(());
    }
    map::print_chains(&st, &s, from)?;
    Ok(())
}

fn roles(repo: &git::Repo, json: bool, role: Option<&str>) -> anyhow::Result<()> {
    let (_st, s) = opened(repo)?;
    let by_role: std::collections::BTreeMap<&str, Vec<i64>> = {
        let mut m: std::collections::BTreeMap<&str, Vec<i64>> = std::collections::BTreeMap::new();
        for (id, r) in &s.roles {
            m.entry(r.as_str()).or_default().push(*id);
        }
        m
    };
    if json {
        print_json(&by_role)?;
        return Ok(());
    }
    crate::header("roles");
    for (r, ids) in &by_role {
        if role.is_some_and(|f| f != *r) {
            continue;
        }
        println!("  {:<12} {}  {}", r, ids.len(), map::role_rule(r));
    }
    Ok(())
}
