//! Confidence-aware paths: impact, trace and execution flows.
use super::*;

#[derive(Serialize)]
pub struct Impact {
    pub root: Node,
    pub direction: String,
    pub hits: Vec<ImpactHit>,
    pub files: usize,
    pub communities: Vec<String>,
    pub risk: String,
    /// Hit counts per tier: resolved / inferred / guessed.
    pub tiers: [usize; 3],
}

/// Blast radius: who (transitively) depends on `id` (upstream) or what it relies on (downstream).
pub fn impact(store: &Store, id: i64, upstream: bool, max_depth: usize) -> Result<Impact> {
    impact_min(store, id, upstream, max_depth, "guessed")
}

/// Like `impact`, but ignores call edges weaker than `min_conf`.
pub fn impact_min(store: &Store, id: i64, upstream: bool, max_depth: usize, min_conf: &str) -> Result<Impact> {
    let floor = conf_rank(min_conf);
    let Some(root) = store.node(id)? else { bail!("no node {id}") };
    let mut seen: HashSet<i64> = HashSet::from([id]);
    let mut q: VecDeque<(i64, usize)> = VecDeque::from([(id, 0)]);
    let mut path_conf: HashMap<i64, String> = HashMap::new();
    // A file's impact is the union of its symbols' impact plus its importers.
    if root.kind == "file" {
        for (c, _) in store.neighbours(id, "CONTAINS", true)? {
            seen.insert(c.id);
            q.push_back((c.id, 0));
        }
    }
    let mut hits = Vec::new();
    while let Some((cur, d)) = q.pop_front() {
        if d >= max_depth {
            continue;
        }
        let mut next = store.neighbours_conf(cur, "CALLS", !upstream)?;
        if root.kind == "file" {
            next.extend(store.neighbours_conf(cur, "IMPORTS", !upstream)?);
        }
        let base = path_conf.get(&cur).cloned().unwrap_or_else(|| "resolved".into());
        for (n, c) in next {
            if conf_rank(&c) < floor {
                continue;
            }
            if seen.insert(n.id) {
                let conf = if conf_rank(&c) < conf_rank(&base) { c } else { base.clone() };
                path_conf.insert(n.id, conf.clone());
                hits.push(ImpactHit { node: n.clone(), depth: d + 1, via: Some(cur), confidence: conf });
                q.push_back((n.id, d + 1));
            }
        }
        if hits.len() > 500 {
            break;
        }
    }
    let files: HashSet<&str> = hits.iter().map(|h| h.node.path.as_str()).collect();
    let comm_ids: HashSet<i64> = hits.iter().map(|h| h.node.community).collect();
    let mut communities = Vec::new();
    for c in comm_ids {
        if let Ok(l) = store.conn.query_row("SELECT label FROM communities WHERE id = ?1", [c], |r| r.get::<_, String>(0)) {
            communities.push(l);
        }
    }
    communities.sort();
    let direct = hits.iter().filter(|h| h.depth == 1).count();
    let risk = match (direct, hits.len(), communities.len()) {
        (_, t, c) if t >= 40 || c >= 5 => "high",
        (d, t, _) if d >= 5 || t >= 12 => "medium",
        (_, 0, _) => "none",
        _ => "low",
    };
    let mut tiers = [0usize; 3];
    for h in &hits {
        tiers[2 - conf_rank(&h.confidence) as usize] += 1;
    }
    Ok(Impact {
        tiers,
        root,
        direction: if upstream { "upstream" } else { "downstream" }.into(),
        files: files.len(),
        communities,
        risk: risk.into(),
        hits,
    })
}

/// Shortest call path from `a` to `b`.
#[derive(Serialize)]
pub struct TracePath {
    pub path: Vec<Node>,
    /// Edge tiers along the path: resolved / inferred / guessed counts.
    pub tiers: [usize; 3],
}

/// Like `trace`, but ignores call edges weaker than `min_conf` and reports the path's tier counts.
pub fn trace_conf(store: &Store, a: i64, b: i64, min_conf: &str) -> Result<TracePath> {
    let floor = conf_rank(min_conf);
    let mut prev: HashMap<i64, (i64, String)> = HashMap::new();
    let mut q = VecDeque::from([a]);
    let mut seen = HashSet::from([a]);
    while let Some(cur) = q.pop_front() {
        if cur == b {
            let mut path = vec![b];
            let mut tiers = [0usize; 3];
            let mut c = b;
            while let Some(&(p, ref conf)) = prev.get(&c) {
                tiers[2 - conf_rank(conf) as usize] += 1;
                path.push(p);
                c = p;
            }
            path.reverse();
            let path = path.into_iter().filter_map(|id| store.node(id).ok().flatten()).collect();
            return Ok(TracePath { path, tiers });
        }
        for (n, c) in store.neighbours_conf(cur, "CALLS", true)? {
            if conf_rank(&c) < floor {
                continue;
            }
            if seen.insert(n.id) {
                prev.insert(n.id, (cur, c));
                q.push_back(n.id);
            }
        }
        if seen.len() > 20_000 {
            break;
        }
    }
    Ok(TracePath { path: vec![], tiers: [0, 0, 0] })
}

#[derive(Serialize)]
pub struct Flow {
    pub entry: Node,
    pub steps: Vec<ImpactHit>,
    pub reach: usize,
}

/// Execution flows: entry points (nothing calls them, they call things) and what they reach.
pub fn flows(store: &Store, limit: usize) -> Result<Vec<Flow>> {
    let entries = store.nodes_where(
        "kind IN ('function','method') AND id NOT IN (SELECT dst FROM edges WHERE kind = 'CALLS')
         AND (SELECT count(*) FROM edges WHERE kind = 'CALLS' AND src = nodes.id) >= 2",
        [],
    )?;
    let mut out = Vec::new();
    for e in entries {
        let imp = impact(store, e.id, false, 4)?;
        out.push(Flow { reach: imp.hits.len(), entry: e, steps: imp.hits.into_iter().take(40).collect() });
    }
    out.sort_by(|a, b| b.reach.cmp(&a.reach).then(a.entry.name.cmp(&b.entry.name)));
    out.truncate(limit);
    Ok(out)
}
