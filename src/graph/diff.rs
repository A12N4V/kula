//! Diff between two graph snapshots: added/removed/modified symbols and edges.
use super::*;

#[derive(Serialize, Clone)]
pub struct DiffNode {
    pub id: i64,
    pub status: &'static str, // added | removed | modified | same
    pub kind: String,
    pub name: String,
    pub path: String,
    pub start_line: i64,
    pub community: i64,
    pub container: Option<String>,
}

#[derive(Serialize)]
pub struct DiffEdge {
    pub src: i64,
    pub dst: i64,
    pub kind: String,
    pub status: &'static str,
    /// Confidence tier carried from the side the edge came from.
    pub confidence: String,
}

#[derive(Serialize, Default)]
pub struct DiffSummary {
    pub added: usize,
    pub removed: usize,
    pub modified: usize,
    pub same: usize,
    pub edges_added: usize,
    pub edges_removed: usize,
    pub files_touched: usize,
}

#[derive(Serialize)]
pub struct GraphDiff {
    pub base: String,
    pub head: String,
    pub nodes: Vec<DiffNode>,
    pub edges: Vec<DiffEdge>,
    pub communities: Vec<Community>,
    pub summary: DiffSummary,
    /// true when only changed symbols and their neighbours are included.
    pub focused: bool,
}

/// Stable identity of a node across revisions: kind, path, container, name (+ ordinal for overloads).
fn node_keys(b: &crate::index::Built) -> Vec<String> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    b.nodes
        .iter()
        .map(|n| {
            let container = n.parent.map(|p| &b.nodes[p as usize]).filter(|p| p.kind != "file").map(|p| p.name.as_str()).unwrap_or("");
            let k = format!("{}|{}|{}|{}", n.kind, n.path, container, n.name);
            let c = seen.entry(k.clone()).or_default();
            *c += 1;
            if *c > 1 {
                format!("{k}#{c}")
            } else {
                k
            }
        })
        .collect()
}

/// Compare the knowledge graphs of two revisions. `focus` keeps only changed
/// symbols plus their direct neighbours (automatic for large graphs).
pub fn graph_diff(
    base: &crate::index::Built,
    head: &crate::index::Built,
    base_name: &str,
    head_name: &str,
    focus: Option<bool>,
) -> GraphDiff {
    let (bk, hk) = (node_keys(base), node_keys(head));
    let bmap: HashMap<&str, usize> = bk.iter().enumerate().map(|(i, k)| (k.as_str(), i)).collect();
    let hmap: HashMap<&str, usize> = hk.iter().enumerate().map(|(i, k)| (k.as_str(), i)).collect();

    let mut nodes: Vec<DiffNode> = Vec::new();
    let mut uid: HashMap<String, i64> = HashMap::new();
    let mut summary = DiffSummary::default();
    let mut touched_files: HashSet<String> = HashSet::new();
    let container =
        |b: &crate::index::Built, n: &Node| n.parent.map(|p| &b.nodes[p as usize]).filter(|p| p.kind != "file").map(|p| p.name.clone());

    for (i, n) in head.nodes.iter().enumerate() {
        let status = match bmap.get(hk[i].as_str()) {
            None => "added",
            Some(&j) if n.kind != "file" && base.hashes[j] != head.hashes[i] => "modified",
            Some(_) => "same",
        };
        if n.lang.is_empty() {
            continue; // non-source files add noise
        }
        if n.kind != "file" {
            match status {
                "added" => summary.added += 1,
                "modified" => summary.modified += 1,
                _ => summary.same += 1,
            }
        }
        if status != "same" {
            touched_files.insert(n.path.clone());
        }
        let id = nodes.len() as i64;
        uid.insert(hk[i].clone(), id);
        nodes.push(DiffNode {
            id,
            status,
            kind: n.kind.clone(),
            name: n.name.clone(),
            path: n.path.clone(),
            start_line: n.start_line,
            community: n.community,
            container: container(head, n),
        });
    }
    for (j, n) in base.nodes.iter().enumerate() {
        if hmap.contains_key(bk[j].as_str()) || n.lang.is_empty() {
            continue;
        }
        if n.kind != "file" {
            summary.removed += 1;
        }
        touched_files.insert(n.path.clone());
        let id = nodes.len() as i64;
        uid.insert(bk[j].clone(), id);
        nodes.push(DiffNode {
            id,
            status: "removed",
            kind: n.kind.clone(),
            name: n.name.clone(),
            path: n.path.clone(),
            start_line: n.start_line,
            community: n.community,
            container: container(base, n),
        });
    }
    summary.files_touched = touched_files.len();

    // Edge identity excludes confidence: a tier change is not churn.
    let ekeys = |b: &crate::index::Built, keys: &[String]| -> HashSet<(String, String, String)> {
        b.edges.iter().map(|e| (keys[e.src as usize].clone(), keys[e.dst as usize].clone(), e.kind.clone())).collect()
    };
    let econf = |b: &crate::index::Built, keys: &[String]| -> HashMap<(String, String, String), String> {
        b.edges
            .iter()
            .map(|e| ((keys[e.src as usize].clone(), keys[e.dst as usize].clone(), e.kind.clone()), e.confidence.clone()))
            .collect()
    };
    let (be, he) = (ekeys(base, &bk), ekeys(head, &hk));
    let (bc, hc) = (econf(base, &bk), econf(head, &hk));
    let mut edges = Vec::new();
    for (set, other, status) in [(&he, &be, "added"), (&be, &he, "removed")] {
        for k in set.iter() {
            let st = if other.contains(k) { "same" } else { status };
            if st == "same" && status == "removed" {
                continue; // already emitted from the head side
            }
            if let (Some(&s), Some(&d)) = (uid.get(&k.0), uid.get(&k.1)) {
                // Report the tier the head has: unchanged edges take the head's confidence.
                let conf = if status == "added" { hc[k].clone() } else { bc[k].clone() };
                if st == "added" && k.2 != "CONTAINS" {
                    summary.edges_added += 1;
                }
                if st == "removed" && k.2 != "CONTAINS" {
                    summary.edges_removed += 1;
                }
                edges.push(DiffEdge { src: s, dst: d, kind: k.2.clone(), status: st, confidence: conf });
            }
        }
    }

    // Focus: changed nodes + endpoints of changed edges + 1-hop neighbours.
    let focused = focus.unwrap_or(nodes.len() > 2500);
    if focused {
        let mut keep: HashSet<i64> = nodes.iter().filter(|n| n.status != "same").map(|n| n.id).collect();
        for e in &edges {
            if e.status != "same" {
                keep.insert(e.src);
                keep.insert(e.dst);
            }
        }
        let core = keep.clone();
        for e in &edges {
            if core.contains(&e.src) || core.contains(&e.dst) {
                keep.insert(e.src);
                keep.insert(e.dst);
            }
        }
        nodes.retain(|n| keep.contains(&n.id));
        edges.retain(|e| keep.contains(&e.src) && keep.contains(&e.dst));
    }
    GraphDiff { base: base_name.into(), head: head_name.into(), nodes, edges, communities: head.communities.clone(), summary, focused }
}

// ------------------------------------------------------------------ symbol history
