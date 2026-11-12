//! The knowledge graph, formalised as RDF.
//!
//! `.kula/graph.db` is kula's working store: fast, but its shape is kula's own.
//! This module states the same graph – symbols, files, packages, clusters, calls
//! and imports, plus the notes, memories, issues and guards people and agents
//! attach to it – as RDF under a small published vocabulary (`kula:`), so any
//! tool that speaks W3C standards can read it: export it as Turtle, N-Triples,
//! JSON-LD or RDF/XML, or ask it questions in SPARQL 1.1. Oxigraph holds it in
//! memory and evaluates the queries.
//!
//! Instances are `urn:kula:` IRIs (prefix `code:`), stable across reindexes
//! because they come from paths and names, not row ids:
//!   code:file:src/git.rs   code:sym:src/git.rs#Repo.status   code:pkg:serde
//!   code:cluster:3   code:note:12   code:issue:4   code:guard:1   code:repo

use crate::git::Repo;
use crate::guard::{Guards, Level};
use crate::meta;
use crate::store::{Node, Store};
use anyhow::{bail, Result};
use oxigraph::io::{RdfFormat, RdfSerializer};
use oxigraph::model::vocab::{rdf, rdfs, xsd};
use oxigraph::model::{GraphNameRef, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::store::Store as Rdf;
use std::collections::HashMap;

mod query;
mod vocab;

pub const NS: &str = "https://kula.dev/ns#";
pub const CODE: &str = "urn:kula:";

pub use query::sparql;
pub use vocab::{EXAMPLES, SCHEMA, VOCAB_VERSION};

/// Prefixes every query may use without declaring them.
pub const PREFIXES: &[(&str, &str)] = &[
    ("kula", NS),
    ("code", CODE),
    ("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
    ("rdfs", "http://www.w3.org/2000/01/rdf-schema#"),
    ("xsd", "http://www.w3.org/2001/XMLSchema#"),
];

fn k(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{NS}{local}"))
}

/// Percent-encode what an IRI may not hold; keep paths readable.
fn enc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b'@' | b'+' | b'$' | b'!' => o.push(b as char),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

pub fn file_iri(path: &str) -> String {
    format!("{CODE}file:{}", enc(path))
}

fn iri(s: String) -> NamedNode {
    NamedNode::new(s.clone()).unwrap_or_else(|_| NamedNode::new_unchecked(format!("{CODE}x:{}", enc(&s))))
}

fn class_of(kind: &str) -> &'static str {
    match kind {
        "function" => "Function",
        "method" => "Method",
        "class" => "Class",
        "interface" => "Interface",
        "file" => "File",
        "package" => "Package",
        "dependency" => "Dependency",
        "route" => "Route",
        "env" => "Env",
        "table" => "Table",
        _ => "Symbol",
    }
}

fn dt(secs: i64) -> Literal {
    // RFC 3339 in UTC without a date library: days from the civil-from-days algorithm.
    let (d, s) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = d + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    Literal::new_typed_literal(format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", s / 3600, s % 3600 / 60, s % 60), xsd::DATE_TIME)
}

struct Builder {
    quads: Vec<Quad>,
}

impl Builder {
    fn add(&mut self, s: &NamedNode, p: NamedNode, o: impl Into<Term>) {
        self.quads.push(Quad::new(s.clone(), p, o.into(), GraphNameRef::DefaultGraph));
    }
    fn a(&mut self, s: &NamedNode, class: &str) {
        self.quads.push(Quad::new(s.clone(), rdf::TYPE.into_owned(), k(class), GraphNameRef::DefaultGraph));
    }
}

/// Symbol IRIs, unique and stable: path#Owner.name, with ~line only to break a tie.
fn symbol_iris(nodes: &[Node]) -> HashMap<i64, NamedNode> {
    let by_id: HashMap<i64, &Node> = nodes.iter().map(|n| (n.id, n)).collect();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out = HashMap::new();
    for n in nodes {
        let s = match n.kind.as_str() {
            "file" => file_iri(&n.path),
            "package" => format!("{CODE}pkg:{}", enc(&n.name)),
            // dep:npm:express → code:dep:npm/express · env:PORT → code:env:PORT
            "dependency" => format!("{CODE}dep:{}", enc(&n.path[4..].replace(':', "/"))),
            "env" => format!("{CODE}env:{}", enc(&n.name)),
            "table" => format!("{CODE}table:{}", enc(&n.name)),
            // "GET /api/users" → code:route:GET%20/api/users
            "route" => format!("{CODE}route:{}", enc(&n.name)),
            _ => {
                let owner =
                    n.parent.and_then(|p| by_id.get(&p)).filter(|p| p.kind != "file").map(|p| format!("{}.", p.name)).unwrap_or_default();
                let base = format!("{CODE}sym:{}#{}", enc(&n.path), enc(&format!("{owner}{}", n.name)));
                let c = seen.entry(base.clone()).or_insert(0);
                *c += 1;
                if *c > 1 {
                    format!("{base}~{}", n.start_line)
                } else {
                    base
                }
            }
        };
        out.insert(n.id, iri(s));
    }
    out
}

/// Build the whole RDF graph for this repository, in memory.
pub fn build(repo: &Repo, store: &Store) -> Result<Rdf> {
    let nodes = store.nodes_where("1 = 1 ORDER BY id", [])?;
    let ids = symbol_iris(&nodes);
    let guards = Guards::load(repo)?;
    let mut b = Builder { quads: Vec::with_capacity(nodes.len() * 8) };

    for (local, what, doc) in SCHEMA {
        let s = k(local);
        b.quads.push(Quad::new(
            s.clone(),
            rdf::TYPE.into_owned(),
            if *what == "class" { rdfs::CLASS.into_owned() } else { rdf::PROPERTY.into_owned() },
            GraphNameRef::DefaultGraph,
        ));
        b.add(&s, rdfs::COMMENT.into_owned(), Literal::new_simple_literal(*doc));
    }
    for sub in ["Function", "Method", "Class", "Interface"] {
        b.add(&k(sub), rdfs::SUB_CLASS_OF.into_owned(), k("Symbol"));
    }

    let repo_iri = iri(format!("{CODE}repo"));
    b.a(&repo_iri, "Repository");
    b.add(&repo_iri, k("name"), Literal::new_simple_literal(repo.name()));
    b.add(&repo_iri, k("vocabVersion"), Literal::from(VOCAB_VERSION));

    let clusters: HashMap<i64, String> = store.communities()?.into_iter().map(|c| (c.id, c.label)).collect();
    for (id, label) in &clusters {
        let c = iri(format!("{CODE}cluster:{id}"));
        b.a(&c, "Cluster");
        b.add(&c, k("label"), Literal::new_simple_literal(label));
    }
    let by_id: HashMap<i64, &Node> = nodes.iter().map(|n| (n.id, n)).collect();
    let file_of: HashMap<&str, &NamedNode> =
        nodes.iter().filter(|n| n.kind == "file").filter_map(|n| ids.get(&n.id).map(|i| (n.path.as_str(), i))).collect();
    for n in &nodes {
        let s = &ids[&n.id];
        b.a(s, class_of(&n.kind));
        if matches!(n.kind.as_str(), "function" | "method" | "class" | "interface") {
            b.a(s, "Symbol"); // stated, not inferred: queries need no reasoner
        }
        b.add(s, k("name"), Literal::new_simple_literal(&n.name));
        b.add(s, rdfs::LABEL.into_owned(), Literal::new_simple_literal(&n.name));
        if matches!(n.kind.as_str(), "package" | "dependency" | "env" | "table") {
            continue;
        }
        b.add(s, k("path"), Literal::new_simple_literal(&n.path));
        if !n.lang.is_empty() {
            b.add(s, k("language"), Literal::new_simple_literal(&n.lang));
        }
        if n.kind != "file" {
            b.add(s, k("startLine"), Literal::from(n.start_line));
            b.add(s, k("endLine"), Literal::from(n.end_line));
            if let Some(f) = file_of.get(n.path.as_str()) {
                b.add(s, k("definedIn"), (*f).clone());
            }
            if let Some(p) = n.parent.and_then(|p| by_id.get(&p)).filter(|p| p.kind != "file") {
                b.add(s, k("memberOf"), ids[&p.id].clone());
            }
        }
        if clusters.contains_key(&n.community) {
            b.add(s, k("inCluster"), iri(format!("{CODE}cluster:{}", n.community)));
        }
        let v = guards.node(n);
        if v.level != Level::Open {
            b.add(s, k("guardLevel"), Literal::new_simple_literal(v.level.as_str()));
            b.add(s, k("reason"), Literal::new_simple_literal(&v.reason));
        }
    }
    for e in store.all_edges()? {
        let (Some(s), Some(o)) = (ids.get(&e.src), ids.get(&e.dst)) else { continue };
        match e.kind.as_str() {
            "CALLS" => b.add(s, k("calls"), o.clone()),
            "IMPORTS" => b.add(s, k("imports"), o.clone()),
            "USED_BY" => b.add(s, k("usedBy"), o.clone()),
            "READS_ENV" => b.add(s, k("readsEnv"), o.clone()),
            "HANDLES" => b.add(s, k("handles"), o.clone()),
            "MAPS_TABLE" => b.add(s, k("mapsTable"), o.clone()),
            "MIGRATES_TABLE" => b.add(s, k("migratesTable"), o.clone()),
            "USES_TABLE" => b.add(s, k("usesTable"), o.clone()),
            _ => {}
        }
    }

    for (i, (rule, level)) in guards.rules().iter().enumerate() {
        let g = iri(format!("{CODE}guard:{}", i + 1));
        b.a(&g, "Guard");
        b.add(&g, k("guardLevel"), Literal::new_simple_literal(level.as_str()));
        if !rule.reason.is_empty() {
            b.add(&g, k("reason"), Literal::new_simple_literal(&rule.reason));
        }
        let one = Guards::new(
            &crate::config::Config {
                guards: vec![rule.clone()],
                agents: crate::config::Agents { hide_secrets: false, memory: true, ..Default::default() },
                ..Default::default()
            },
            None,
        )?;
        for n in nodes.iter().filter(|n| n.kind == "file") {
            if one.path(&n.path).level != Level::Open {
                b.add(&g, k("fences"), ids[&n.id].clone());
            }
        }
    }

    // Notes, memories and issues, pointed at what they are about.
    let target_iri = |t: &str| -> Option<NamedNode> {
        if t == "repo" {
            return Some(repo_iri.clone());
        }
        if let Some(p) = t.strip_prefix("file:") {
            return Some(iri(file_iri(p)));
        }
        let rest = t.strip_prefix("symbol:")?;
        // symbol:<path>:<name>, or just symbol:<name> as `kula note add` documents.
        let (path, name) = rest.rsplit_once(':').map(|(p, n)| (Some(p), n)).unwrap_or((None, rest));
        nodes
            .iter()
            .find(|n| {
                n.name == name
                    && n.kind != "file"
                    && n.kind != "package"
                    && path.map_or(true, |p| n.path == p || n.path.ends_with(&format!("/{p}")))
            })
            .map(|n| ids[&n.id].clone())
    };
    let m = meta::load(repo).unwrap_or_default();
    let mems: HashMap<u64, bool> = crate::memory::recall(repo, store, None, None, usize::MAX)
        .map(|v| v.into_iter().map(|r| (r.id, r.stale)).collect())
        .unwrap_or_default();
    for n in &m.notes {
        let memory = n.kind == "memory";
        if memory && !mems.contains_key(&n.id) {
            continue; // hidden from agents
        }
        let s = iri(format!("{CODE}note:{}", n.id));
        b.a(&s, if memory { "Memory" } else { "Note" });
        b.add(&s, k("body"), Literal::new_simple_literal(&n.body));
        b.add(&s, k("author"), Literal::new_simple_literal(&n.author));
        b.add(&s, k("created"), dt(n.created));
        if let Some(t) = target_iri(&n.target) {
            b.add(&s, k("about"), t);
        }
        if memory {
            b.add(&s, k("stale"), Literal::from(mems[&n.id]));
        }
    }
    for i in &m.issues {
        let s = iri(format!("{CODE}issue:{}", i.id));
        b.a(&s, "Issue");
        b.add(&s, k("name"), Literal::new_simple_literal(&i.title));
        b.add(&s, k("body"), Literal::new_simple_literal(&i.body));
        b.add(&s, k("status"), Literal::new_simple_literal(&i.status));
        b.add(&s, k("author"), Literal::new_simple_literal(&i.author));
        b.add(&s, k("created"), dt(i.created));
        for a in &i.anchors {
            let t = if a.contains(':') && !a.starts_with("file:") && !a.starts_with("symbol:") { format!("symbol:{a}") } else { a.clone() };
            if let Some(t) = target_iri(&t).or_else(|| target_iri(&format!("file:{a}"))) {
                b.add(&s, k("about"), t);
            }
        }
    }

    // Hidden code never reaches the graph agents query.
    let hidden: std::collections::HashSet<NamedNode> =
        nodes.iter().filter(|n| !guards.node(n).level.readable()).map(|n| ids[&n.id].clone()).collect();
    let rdf_store = Rdf::new()?;
    rdf_store.extend(b.quads.into_iter().filter(|q| {
        let subj = matches!(&q.subject, NamedOrBlankNode::NamedNode(s) if hidden.contains(s));
        let obj = matches!(&q.object, Term::NamedNode(o) if hidden.contains(o));
        !subj && !obj
    }))?;
    Ok(rdf_store)
}

/// Serialise the graph: ttl | nt | jsonld | rdfxml.
pub fn export(repo: &Repo, store: &Store, format: &str) -> Result<Vec<u8>> {
    let g = build(repo, store)?;
    let fmt = match format {
        "ttl" | "turtle" => RdfFormat::Turtle,
        "nt" | "ntriples" => RdfFormat::NTriples,
        "jsonld" | "json-ld" => RdfFormat::JsonLd { profile: Default::default() },
        "rdf" | "xml" | "rdfxml" => RdfFormat::RdfXml,
        other => bail!("unknown format {other}: ttl, nt, jsonld or rdfxml"),
    };
    let mut ser = RdfSerializer::from_format(fmt);
    // Instances print as full <urn:kula:…> IRIs: paths don't survive as prefixed names.
    for (p, iri) in PREFIXES.iter().filter(|(p, _)| *p != "code") {
        ser = ser.with_prefix(*p, *iri)?;
    }
    Ok(g.dump_graph_to_writer(GraphNameRef::DefaultGraph, ser, Vec::new())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iris_and_dates() {
        assert_eq!(file_iri("src/a b.rs"), "urn:kula:file:src/a%20b.rs");
        assert_eq!(dt(0).value(), "1970-01-01T00:00:00Z");
        assert_eq!(dt(1_759_622_400).value(), "2025-10-05T00:00:00Z");
    }
}
