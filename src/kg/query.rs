//! SPARQL over the graph: run a query, render terms as JSON.

use super::{build, PREFIXES};
use crate::git::Repo;
use crate::store::Store;
use anyhow::{anyhow, Result};
use oxigraph::model::vocab::xsd;
use oxigraph::model::Term;
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store as Rdf;
use serde_json::{json, Value};

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
