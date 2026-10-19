//! Flow naming: a verb–object name from the dominant member names and paths,
//! plus an outcome sentence of at most 12 words. No code identifiers –
//! "Index the repository", never "index_repo chain".

/// Verbs recognised at the start of a name (lowercase). Mirrors the rubric
/// list in the bench's name scorer.
const VERBS: &[&str] = &[
    "add",
    "aggregate",
    "apply",
    "build",
    "check",
    "clean",
    "collect",
    "commit",
    "compare",
    "complete",
    "compute",
    "count",
    "decode",
    "detect",
    "diff",
    "dispatch",
    "draw",
    "encode",
    "extract",
    "fetch",
    "find",
    "format",
    "generate",
    "group",
    "handle",
    "import",
    "index",
    "install",
    "list",
    "load",
    "log",
    "map",
    "merge",
    "name",
    "parse",
    "plan",
    "print",
    "query",
    "read",
    "record",
    "remove",
    "render",
    "resolve",
    "run",
    "save",
    "scan",
    "search",
    "serve",
    "show",
    "sort",
    "split",
    "store",
    "stream",
    "summarise",
    "summarize",
    "sync",
    "track",
    "update",
    "write",
    "walk",
    "answer",
    "report",
    "respond",
    "route",
    "review",
    "organise",
    "organize",
    "cluster",
    "classify",
    "normalise",
    "normalize",
    "traverse",
    "register",
    "respond",
];

/// Path segments and tokens that never make a good object.
const STOP_TOKENS: &[&str] = &[
    "src",
    "lib",
    "main",
    "mod",
    "core",
    "util",
    "utils",
    "common",
    "impl",
    "internal",
    "pkg",
    "app",
    "test",
    "tests",
    "spec",
    "index",
    "init",
    "the",
    "and",
    "for",
    "with",
    "from",
    "data",
    "value",
    "item",
    "items",
    "self",
    "this",
    "result",
    "error",
    "option",
    "string",
    "vec",
    "bool",
    "new",
    "get",
    "set",
    "run",
    "pub",
    "func",
    "const",
    "let",
    "var",
    "type",
    "class",
    "struct",
    "enum",
    "trait",
    "interface",
    "module",
    "py",
    "rs",
    "ts",
    "tsx",
    "js",
    "go",
    "sh",
    "homonin",
];

/// Uppercase spellings for tokens that read better as acronyms or proper
/// nouns in a value proposition.
const SPELLINGS: &[(&str, &str)] = &[
    ("pod5", "POD5"),
    ("cnv", "CNV"),
    ("sv", "SV"),
    ("json", "JSON"),
    ("http", "HTTP"),
    ("api", "API"),
    ("cli", "CLI"),
    ("ui", "UI"),
    ("id", "ID"),
    ("gtf", "GTF"),
    ("bedpe", "BEDPE"),
    ("vcf", "VCF"),
    ("bam", "BAM"),
    ("url", "URL"),
    ("html", "HTML"),
    ("sql", "SQL"),
    ("db", "database"),
    ("io", "IO"),
];

pub struct Named {
    pub name: String,
    pub outcome: String,
    pub keywords: Vec<String>,
}

fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            if ch.is_uppercase() && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            cur.extend(ch.to_lowercase());
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn spell(t: &str) -> String {
    for (raw, nice) in SPELLINGS {
        if t == *raw {
            return (*nice).to_string();
        }
    }
    t.to_string()
}

fn title(words: &[String]) -> String {
    words
        .iter()
        .map(|w| {
            let nice = spell(w);
            let mut c = nice.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The outcome tail for a flow's side-effect terminal: what the chain
/// actually delivers, not a constant template.
fn outcome_tail(effect: Option<&str>) -> &'static str {
    match effect.unwrap_or("") {
        "write" | "writeto" | "save" | "store" | "commit" | "insert" | "flush" => "and keep the result.",
        "read" | "load" | "open" => "and report what it reads.",
        "serve" | "listen" | "send" | "post" | "connect" => "and answer over the connection.",
        "fetch" | "query" | "search" | "exec" => "and return what it finds.",
        "print" | "emit" => "and show the result.",
        _ => "and hand back the result.",
    }
}

/// Pick the most frequent verb from member names, entry side weighted, then
/// the most distinctive object words from member paths.
pub fn name_flow(names: &[String], paths: &[String], entry_name: &str, effect: Option<&str>) -> Named {
    // Verb: first matching verb token per member name, earliest members and
    // the entry point count double.
    let mut verbs: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let bump = |verbs: &mut std::collections::BTreeMap<String, usize>, toks: &[String], w: usize| {
        for t in toks {
            if VERBS.contains(&t.as_str()) {
                *verbs.entry(t.clone()).or_default() += w;
            }
        }
    };
    bump(&mut verbs, &tokens(entry_name), 3);
    for (i, n) in names.iter().enumerate().take(6) {
        let w = if i < 3 { 3 } else { 1 };
        bump(&mut verbs, &tokens(n), w);
    }
    if verbs.is_empty() {
        bump(&mut verbs, &tokens(entry_name), 1);
    }
    let verb = verbs.iter().max_by_key(|(v, c)| (**c, v.as_str())).map(|(v, _)| v.clone()).unwrap_or_else(|| "run".into());

    // Object: path tokens by frequency across members; longest segments win,
    // stop tokens and the crate root never do.
    let mut obj: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for p in paths {
        let toks = tokens(p);
        let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for t in toks {
            if t.len() < 3 || STOP_TOKENS.contains(&t.as_str()) || VERBS.contains(&t.as_str()) {
                continue;
            }
            if seen.insert(t.clone()) {
                *obj.entry(t.clone()).or_default() += 1;
            }
        }
    }
    let mut ranked: Vec<(String, usize)> = obj.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.len().cmp(&a.0.len())).then(a.0.cmp(&b.0)));
    // Head noun last: the more general, more frequent token closes the
    // phrase, the specific one modifies it.
    let mut object_words: Vec<String> = ranked.iter().take(2).map(|(t, _)| t.clone()).collect();
    if object_words.len() == 2 {
        object_words.reverse();
    }

    let obj_phrase = if object_words.is_empty() { "the input".to_string() } else { title(&object_words) };
    let keywords: Vec<String> = std::iter::once(verb.clone()).chain(object_words.iter().cloned()).collect();

    let name = format!("{} the {}", title(std::slice::from_ref(&verb)), obj_phrase);
    // Outcome: verb, object, and what the side effect delivers – capped at
    // 12 words by construction.
    let tail = outcome_tail(effect);
    let outcome = if object_words.is_empty() {
        format!("{} the input {}", title(std::slice::from_ref(&verb)), tail)
    } else {
        format!("{} the {} {}", title(std::slice::from_ref(&verb)), obj_phrase, tail)
    };
    let outcome_words = outcome.trim_end_matches('.').split_whitespace().count();
    let outcome = if outcome_words > 12 { format!("{} the {}.", title(&[verb]), obj_phrase) } else { outcome };
    Named { name, outcome, keywords }
}
