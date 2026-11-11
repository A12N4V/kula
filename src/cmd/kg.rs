use crate::*;

pub(crate) fn kg_cmd(repo: &Repo, c: KgCmd, json: bool) -> Result<()> {
    let st = Store::open(repo)?;
    match c {
        KgCmd::Export { format, out } => {
            let bytes = kg::export(repo, &st, &format)?;
            match out {
                Some(p) => {
                    std::fs::write(&p, &bytes)?;
                    eprintln!("  {} {} ({} KB)", green("✓"), p.display(), bytes.len() / 1024);
                }
                None => std::io::Write::write_all(&mut std::io::stdout(), &bytes)?,
            }
        }
        KgCmd::Sparql { query, limit } => {
            let q = if query == "-" {
                let mut s = String::new();
                std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
                s
            } else if let Some(f) = query.strip_prefix('@') {
                std::fs::read_to_string(f)?
            } else {
                query
            };
            let r = kg::sparql(repo, &st, &q, limit)?;
            if json {
                println!("{r}");
                return Ok(());
            }
            print_sparql(&r);
        }
        KgCmd::Examples => {
            for (title, q) in kg::EXAMPLES {
                println!("{}\n{}\n", accent(&format!("# {title}")), q);
            }
            println!("{}", dim("run one: kula kg sparql 'SELECT …'   ·   prefixes kula: code: rdf: rdfs: xsd: are predeclared"));
        }
    }
    Ok(())
}

/// A SPARQL result as an aligned table.
pub(crate) fn print_sparql(r: &serde_json::Value) {
    let cell = |v: &serde_json::Value| match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if let Some(b) = r.get("boolean") {
        println!("  {}", if b.as_bool() == Some(true) { green("true") } else { red("false") });
        return;
    }
    if let Some(ts) = r.get("triples").and_then(|t| t.as_array()) {
        for t in ts {
            let t = t.as_array().cloned().unwrap_or_default();
            println!(
                "  {} {} {}",
                t.first().map(cell).unwrap_or_default(),
                dim(&t.get(1).map(cell).unwrap_or_default()),
                t.get(2).map(cell).unwrap_or_default()
            );
        }
        return;
    }
    let vars: Vec<String> =
        r["vars"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let rows = r["rows"].as_array().cloned().unwrap_or_default();
    let width: Vec<usize> = vars
        .iter()
        .map(|v| rows.iter().map(|row| row.get(v).map(cell).unwrap_or_default().chars().count().min(60)).max().unwrap_or(0).max(v.len()))
        .collect();
    let line = |vals: Vec<String>| {
        vals.iter()
            .zip(&width)
            .map(|(v, w)| format!("{:w$}", v.chars().take(60).collect::<String>(), w = *w))
            .collect::<Vec<_>>()
            .join("  ")
    };
    println!("  {}", dim(&line(vars.iter().map(|v| format!("?{v}")).collect())));
    for row in &rows {
        println!("  {}", line(vars.iter().map(|v| row.get(v).map(cell).unwrap_or_default()).collect()));
    }
    println!("  {}", dim(&format!("{} row(s){}", rows.len(), if r["truncated"] == true { ", truncated" } else { "" })));
}
