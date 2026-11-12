//! Route scanners: pure text passes that find HTTP endpoint declarations and
//! string-literal API calls, one per framework family.

/// One endpoint found in a source: method, path, handler identifier, position.
#[derive(Debug, Clone, PartialEq)]
pub struct RouteHit {
    /// Upper-case HTTP method ("GET") or "ANY" for method-agnostic mounts.
    pub method: String,
    /// Path exactly as written, e.g. "/users/:id".
    pub path: String,
    /// Handler identifier as written, without the trailing `()`.
    pub handler: Option<String>,
    /// Byte of the route declaration (used for line and enclosing-symbol lookup).
    pub byte: usize,
}

const METHODS: &[&str] = &["get", "post", "put", "delete", "patch", "head", "options", "all"];
const GO_METHODS: &[&str] = &["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

/// First quoted string at or after `from`; returns (value, byte after the value).
fn quoted(src: &str, from: usize) -> Option<(String, usize)> {
    let rest = src[from..].trim_start();
    let pad = src[from..].len() - rest.len();
    let q = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let qb = q.len_utf8();
    let endq = rest[qb..].find(q)?; // byte offset of the closing quote
    Some((rest[qb..qb + endq].to_string(), from + pad + qb + endq + qb))
}

/// A bare identifier (possibly `a::b` or `a.b`) starting at `from`, up to a
/// delimiter. Returns (identifier, byte after it).
fn ident(src: &str, from: usize) -> Option<(String, usize)> {
    let trimmed = src[from..].trim_start_matches(|c: char| c.is_whitespace() || c == ',');
    let from = src.len() - trimmed.len();
    let rest = &src[from..];
    let end = rest.find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '.' || c == ':')).unwrap_or(rest.len());
    if end == 0 {
        return None;
    }
    Some((rest[..end].to_string(), from + end))
}

pub(crate) fn last_segment(s: &str) -> &str {
    s.rsplit(['.', ':']).next().unwrap_or(s)
}

/// Normalise a path for matching: `/users/{id}` `/users/<id>` `/users/:id`
/// and `/users/[id]` all become `/users/:param`; trailing slashes go.
pub fn norm_path(p: &str) -> String {
    let p = p.split('?').next().unwrap_or(p);
    let segs: Vec<String> = p
        .split('/')
        .filter(|s| !s.is_empty() && *s != "**")
        .map(|s| {
            if s.starts_with(':') || s.starts_with('{') || s.starts_with('<') || s.starts_with('[') || s.starts_with('*') {
                ":param".to_string()
            } else {
                s.to_string()
            }
        })
        .collect();
    let mut out = String::from("/");
    out.push_str(&segs.join("/"));
    out
}

/// True when concrete request path `url` (normalised) fits route pattern
/// `pat` (normalised): same segment count, `:param` matches any segment.
pub fn path_matches(pat: &str, url: &str) -> bool {
    let (a, b): (Vec<&str>, Vec<&str>) = (pat.split('/').collect(), url.split('/').collect());
    a.len() == b.len() && a.iter().zip(&b).all(|(x, y)| x == y || *x == ":param")
}

/// Express / Fastify: `receiver.method("/path", handler)`. Both a path that
/// starts with `/` and a plain handler identifier are required, so `map.get("k")`
/// and inline arrow handlers are skipped.
fn scan_js(src: &str, out: &mut Vec<RouteHit>) {
    for m in METHODS {
        let needle = format!(".{m}(");
        let mut from = 0;
        while let Some(i) = src[from..].find(&needle) {
            let open = from + i + needle.len() - 1;
            from = open + 1;
            let Some((path, after)) = quoted(src, open + 1) else { continue };
            if !path.starts_with('/') {
                continue;
            }
            let (tok, end) = match ident(src, after) {
                Some(x) => x,
                None => continue,
            };
            if tok == "async" || src[end..].trim_start().starts_with('(') {
                continue; // inline handler or middleware chain
            }
            let hit = RouteHit { method: m.to_uppercase(), path, handler: Some(tok), byte: open };
            if !out.contains(&hit) {
                out.push(hit);
            }
        }
    }
}

/// Next.js App Router / Pages Router: the file is the route. App Router
/// `app/**/route.ts` and Pages Router `pages/api/**` both serve under `/api/…`.
fn scan_next(rel: &str, src: &str, out: &mut Vec<RouteHit>) {
    let route = if let Some(inner) = rel.split_once("pages/api/").map(|(_, i)| i) {
        let inner = inner.trim_end_matches(".tsx").trim_end_matches(".ts").trim_end_matches(".js");
        format!("api/{}", inner.trim_end_matches("/index").trim_end_matches("index"))
    } else if let Some((_, inner)) =
        rel.split_once("app/").filter(|(_, i)| i.ends_with("/route.ts") || i.ends_with("/route.js") || i.ends_with("/route.tsx"))
    {
        inner.rsplit_once('/').map(|(d, _)| d).unwrap_or("").to_string()
    } else {
        return;
    };
    let path = format!(
        "/{}",
        route
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| {
                if s.starts_with('[') {
                    if s.contains("...") || s.starts_with("[[..") {
                        "*".to_string()
                    } else {
                        format!(":{}", s.trim_matches(|c| c == '[' || c == ']'))
                    }
                } else {
                    s.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("/")
    );
    for m in ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] {
        for pat in [format!("export async function {m}"), format!("export function {m}"), format!("export const {m}")] {
            if let Some(i) = src.find(&pat) {
                out.push(RouteHit { method: m.to_string(), path: path.clone(), handler: Some(m.to_string()), byte: i });
                break;
            }
        }
    }
}

/// FastAPI / Flask: decorator line `@app.get("/p")` or `@app.route("/p", methods=[...])`,
/// handler is the `def` that follows.
fn scan_py(src: &str, out: &mut Vec<RouteHit>) {
    for (n, line) in src.lines().enumerate() {
        let l = line.trim();
        if !l.starts_with('@') {
            continue;
        }
        let Some(open) = l.find('(') else { continue };
        let Some((path, after)) = quoted(l, open + 1) else { continue };
        if !path.starts_with('/') {
            continue;
        }
        let methods: Vec<String> = if l.contains(".route(") {
            l[after..]
                .split('[')
                .nth(1)
                .map(|ms| ms.split(']').next().unwrap_or(""))
                .map(|ms| {
                    ms.split(',')
                        .map(|x| x.trim().trim_matches(|c| c == '\'' || c == '"').to_uppercase())
                        .filter(|x| !x.is_empty())
                        .collect()
                })
                .unwrap_or_else(|| vec!["GET".into()])
        } else {
            match METHODS.iter().find(|m| l[..=open].ends_with(&format!(".{m}("))) {
                Some(m) => vec![m.to_uppercase()],
                None => continue,
            }
        };
        // handler: the next `def` line, skipping further decorators.
        let mut handler = None;
        for later in src.lines().skip(n + 1) {
            let t = later.trim();
            if t.starts_with('@') {
                continue;
            }
            if let Some(d) = t.strip_prefix("async def ").or_else(|| t.strip_prefix("def ")) {
                handler = ident(d, 0).map(|(s, _)| s);
            }
            break;
        }
        let byte = src.lines().take(n).map(|x| x.len() + 1).sum();
        for m in methods {
            let hit = RouteHit { method: m, path: path.clone(), handler: handler.clone(), byte };
            if !out.contains(&hit) {
                out.push(hit);
            }
        }
    }
}

/// Rust axum: `.route("/p", get(handler))`.
fn scan_rs(src: &str, out: &mut Vec<RouteHit>) {
    let needle = ".route(";
    let mut from = 0;
    while let Some(i) = src[from..].find(needle) {
        let open = from + i + needle.len() - 1;
        from = open + 1;
        let Some((path, after)) = quoted(src, open + 1) else { continue };
        if !path.starts_with('/') {
            continue;
        }
        let Some((_, arg_end)) = match_paren(src, open) else { continue };
        let arg = &src[after..arg_end];
        let mut method = None;
        let mut handler = None;
        for m in METHODS.iter().filter(|m| **m != "all") {
            if let Some(mi) = arg.find(&format!("{m}(")) {
                let inner = &arg[mi + m.len() + 1..];
                let h = ident(inner, 0).map(|(s, _)| last_segment(&s).to_string());
                if h.is_some() {
                    method = Some(m.to_uppercase());
                    handler = h;
                }
                break;
            }
        }
        if let (Some(m), Some(h)) = (method, handler) {
            let hit = RouteHit { method: m, path, handler: Some(h), byte: open };
            if !out.contains(&hit) {
                out.push(hit);
            }
        }
    }
}

/// End of the `(...)` group that starts at `open` (byte of `(`).
fn match_paren(src: &str, open: usize) -> Option<(usize, usize)> {
    let bytes = src.as_bytes();
    if bytes.get(open) != Some(&b'(') {
        return None;
    }
    let mut depth = 0usize;
    for (i, b) in bytes[open..].iter().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some((open, open + i));
                }
            }
            _ => {}
        }
    }
    None
}

/// Go: `http.HandleFunc("/p", handler)` and gin `r.GET("/p", handler)`.
fn scan_go(src: &str, out: &mut Vec<RouteHit>) {
    let one = |needle: &str, method: Option<&str>, src: &str, out: &mut Vec<RouteHit>| {
        let mut from = 0;
        while let Some(i) = src[from..].find(needle) {
            let open = from + i + needle.len() - 1;
            from = open + 1;
            let Some((path, after)) = quoted(src, open + 1) else { continue };
            if !path.starts_with('/') {
                continue;
            }
            let (tok, end) = match ident(src, after) {
                Some(x) => x,
                None => continue,
            };
            if tok == "nil" || tok.is_empty() || src[end..].trim_start().starts_with('(') {
                continue;
            }
            let m = method.map(str::to_string).unwrap_or_else(|| "ANY".into());
            let hit = RouteHit { method: m, path, handler: Some(tok), byte: open };
            if !out.contains(&hit) {
                out.push(hit);
            }
        }
    };
    one("http.HandleFunc(", None, src, out);
    one("http.Handle(", None, src, out);
    for m in GO_METHODS {
        one(&format!(".{m}("), Some(m), src, out);
    }
}

/// Every route declaration in one source. Pure: takes language id, repo-relative
/// path (for Next.js file-based routes) and text.
pub fn scan(lang: &str, rel: &str, src: &str) -> Vec<RouteHit> {
    let mut out = Vec::new();
    match lang {
        "javascript" | "typescript" | "tsx" => {
            scan_js(src, &mut out);
            scan_next(rel, src, &mut out);
        }
        "python" => scan_py(src, &mut out),
        "rust" => scan_rs(src, &mut out),
        "go" => scan_go(src, &mut out),
        _ => {}
    }
    out.sort_by_key(|r| r.byte);
    out
}

/// String-literal HTTP calls whose URL is a repo-relative API path:
/// `fetch("/api/x")`, `axios.get("/api/x")` (JS/TS), `requests.get("/api/x")`
/// (Python). Returns (url, byte of the literal).
pub fn fetch_urls(lang: &str, src: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let needles: &[&str] = match lang {
        "javascript" | "typescript" | "tsx" => &["fetch(", "axios.get(", "axios.post("],
        "python" => &["requests.get(", "requests.post(", "requests.put(", "requests.delete("],
        _ => &[],
    };
    for n in needles {
        let mut from = 0;
        while let Some(i) = src[from..].find(n) {
            let open = from + i + n.len();
            from = open;
            if let Some((url, _)) = quoted(src, open) {
                if url.starts_with('/') {
                    out.push((url, open));
                }
            }
        }
    }
    out.sort_by_key(|x| x.1);
    out.dedup();
    out
}

#[cfg(test)]
#[path = "routes_tests.rs"]
mod tests;
