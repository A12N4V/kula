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
use anyhow::{anyhow, bail, Result};
use oxigraph::io::{RdfFormat, RdfSerializer};
use oxigraph::model::vocab::{rdf, rdfs, xsd};
use oxigraph::model::{GraphNameRef, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store as Rdf;
use serde_json::{json, Value};
use std::collections::HashMap;

pub const NS: &str = "https://kula.dev/ns#";
pub const CODE: &str = "urn:kula:";

/// Every class and property, with its meaning: loaded into the graph itself so
/// a query can discover the schema (`SELECT ?p ?c { ?p rdfs:comment ?c }`).
pub const SCHEMA: &[(&str, &str, &str)] = &[
    ("Repository", "class", "The repository; code:repo."),
    ("File", "class", "A source file, by repository-relative path."),
    ("Symbol", "class", "Anything defined in code; every Function, Method, Class and Interface is one."),
    ("Function", "class", "A free function."),
    ("Method", "class", "A function that belongs to a class, type or impl."),
    ("Class", "class", "A class, struct, enum, record, type or module."),
    ("Interface", "class", "An interface, trait or protocol."),
    ("Package", "class", "An external package the code imports."),
    ("Cluster", "class", "A functional cluster: symbols that call each other more than they call the rest."),
    ("Note", "class", "A person's note on the repo, a file or a symbol."),
    ("Memory", "class", "An agent's memory, anchored to the code it was written about."),
    ("Issue", "class", "A local issue, stored in git."),
    ("Guard", "class", "A rule from kula.toml that fences code off from agents."),
    ("name", "property", "The symbol, file or package name."),
    ("path", "property", "Repository-relative path of the file that defines it."),
    ("language", "property", "rust, python, javascript, typescript, tsx, go, java, c, cpp, csharp, ruby or php."),
    ("startLine", "property", "First line of the definition (1-based)."),
    ("endLine", "property", "Last line of the definition."),
    ("definedIn", "property", "Symbol → the File that defines it."),
    ("memberOf", "property", "Method or nested symbol → its enclosing Class."),
    ("calls", "property", "Symbol → Symbol it calls."),
    ("imports", "property", "File → File or Package it imports."),
    ("inCluster", "property", "Symbol or File → its Cluster."),
    ("label", "property", "A cluster's label."),
    ("about", "property", "Note, Memory or Issue → the Repository, File or Symbol it is about."),
    ("body", "property", "Text of a note, memory or issue."),
    ("author", "property", "Who wrote it: a git user, or agent:<name>."),
    ("created", "property", "When, as xsd:dateTime."),
    ("stale", "property", "Memory: true when the code it was written about has changed since."),
    ("status", "property", "Issue: open or closed."),
    ("guardLevel", "property", "File or Symbol → open, review, scope, locked or hidden, for agents."),
    ("reason", "property", "Why a guard applies."),
    ("fences", "property", "Guard → each File it covers."),
];

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
        if !matches!(n.kind.as_str(), "file" | "package") {
            b.a(s, "Symbol"); // stated, not inferred: queries need no reasoner
        }
        b.add(s, k("name"), Literal::new_simple_literal(&n.name));
        b.add(s, rdfs::LABEL.into_owned(), Literal::new_simple_literal(&n.name));
        if n.kind == "package" {
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

/// A term as people read it: prefixed IRIs, plain literal values.
fn show(t: &Term) -> Value {
    match t {
        Term::NamedNode(n) => {
            let s = n.as_str();
            for (p, iri) in PREFIXES {
                if let Some(rest) = s.strip_prefix(iri) {
                    return json!(format!("{p}:{rest}"));
                }
            }
            json!(s)
        }
        Term::Literal(l) => {
            let v = l.value();
            match l.datatype() {
                d if d == xsd::INTEGER => v.parse::<i64>().map(|i| json!(i)).unwrap_or(json!(v)),
                d if d == xsd::BOOLEAN => json!(v == "true"),
                d if d == xsd::DECIMAL || d == xsd::DOUBLE => v.parse::<f64>().map(|f| json!(f)).unwrap_or(json!(v)),
                _ => json!(v),
            }
        }
        other => json!(other.to_string()),
    }
}

/// Run a read-only SPARQL query. SELECT gives {vars, rows}; ASK {boolean};
/// CONSTRUCT and DESCRIBE {triples}. At most `limit` rows.
pub fn sparql(repo: &Repo, store: &Store, query: &str, limit: usize) -> Result<Value> {
    let g = build(repo, store)?;
    sparql_on(&g, query, limit)
}

pub fn sparql_on(g: &Rdf, query: &str, limit: usize) -> Result<Value> {
    // Built without an HTTP client, so SERVICE can never reach the network.
    let mut ev = SparqlEvaluator::new();
    for (p, iri) in PREFIXES {
        ev = ev.with_prefix(*p, *iri).map_err(|e| anyhow!("{e}"))?;
    }
    let prepared = ev.parse_query(query).map_err(|e| anyhow!("SPARQL: {e}"))?;
    match prepared.on_store(g).execute().map_err(|e| anyhow!("SPARQL: {e}"))? {
        QueryResults::Solutions(sol) => {
            let vars: Vec<String> = sol.variables().iter().map(|v| v.as_str().to_string()).collect();
            let mut rows = vec![];
            let mut more = false;
            for s in sol {
                if rows.len() >= limit {
                    more = true;
                    break;
                }
                let s = s.map_err(|e| anyhow!("SPARQL: {e}"))?;
                rows.push(Value::Object(vars.iter().filter_map(|v| s.get(v.as_str()).map(|t| (v.clone(), show(t)))).collect()));
            }
            Ok(json!({ "vars": vars, "rows": rows, "truncated": more }))
        }
        QueryResults::Boolean(b) => Ok(json!({ "boolean": b })),
        QueryResults::Graph(triples) => {
            let mut out = vec![];
            for t in triples.take(limit) {
                let t = t.map_err(|e| anyhow!("SPARQL: {e}"))?;
                out.push(json!([show(&Term::from(t.subject)), show(&Term::NamedNode(t.predicate)), show(&t.object)]));
            }
            Ok(json!({ "triples": out }))
        }
    }
}

/// Queries worth knowing, for `kula kg examples`, the UI and the MCP tool description.
pub const EXAMPLES: &[(&str, &str)] = &[
    (
        "Most-called symbols",
        "SELECT ?name ?path (COUNT(?caller) AS ?callers) WHERE {\n  ?s a kula:Symbol ; kula:name ?name ; kula:path ?path .\n  ?caller kula:calls ?s .\n} GROUP BY ?name ?path ORDER BY DESC(?callers) LIMIT 15",
    ),
    (
        "Functions no test reaches (by name)",
        "SELECT ?name ?path WHERE {\n  ?f a kula:Function ; kula:name ?name ; kula:path ?path .\n  FILTER NOT EXISTS { ?t kula:calls ?f ; kula:path ?tp . FILTER(CONTAINS(?tp, \"test\")) }\n  FILTER(!CONTAINS(?path, \"test\"))\n} ORDER BY ?path LIMIT 50",
    ),
    (
        "Files importing each other",
        "SELECT ?a ?b WHERE {\n  ?a kula:imports ?b . ?b kula:imports ?a .\n  FILTER(STR(?a) < STR(?b))\n}",
    ),
    (
        "Stale agent memories",
        "SELECT ?about ?body ?author WHERE {\n  ?m a kula:Memory ; kula:stale true ; kula:body ?body ; kula:author ?author ; kula:about ?about .\n}",
    ),
    (
        "Guarded code",
        "SELECT ?path ?level ?reason WHERE {\n  ?f a kula:File ; kula:path ?path ; kula:guardLevel ?level ; kula:reason ?reason .\n} ORDER BY ?level ?path",
    ),
    ("The vocabulary", "SELECT ?term ?meaning WHERE { ?term rdfs:comment ?meaning } ORDER BY ?term"),
];

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
