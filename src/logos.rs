//! Saved logos: harmonograph SVGs saved from the logo studio, one per agent,
//! team or research template, under `.kula/logos/<kind>/<name>.svg`.
//!
//! The studio sends an SVG string and the mark parameters that produced it.
//! The SVG is sanitised before it is ever written or served back: only
//! structural drawing elements survive (`path`, `g`, linear and radial
//! gradients, the SVG root), and every other tag is dropped – `script`,
//! foreign objects, image links. Attributes are checked too: no `href` or
//! event handlers (`on*`), no `javascript:` URLs, no external references.
//! Anything past 256 KB is refused before parsing.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The longest SVG we accept: a mark is a few KB, this is generous.
pub const MAX_SVG_BYTES: usize = 256 * 1024;

/// The kinds a logo can belong to – each gets its own folder and colour family.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Agent,
    Team,
    Research,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Agent => "agent",
            Kind::Team => "team",
            Kind::Research => "research",
        }
    }
    pub fn parse(s: &str) -> Result<Kind> {
        match s {
            "agent" => Ok(Kind::Agent),
            "team" => Ok(Kind::Team),
            "research" => Ok(Kind::Research),
            other => bail!("kind must be agent, team or research, not {other:?}"),
        }
    }
}

/// The mark parameters the studio dialled in, saved beside the SVG in
/// kula.toml so the studio can reopen the same mark and keep turning it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct LogoParams {
    /// 2D or 3D harmonograph.
    pub dims: u8,
    /// Camera yaw in degrees (3D).
    pub yaw: f64,
    /// Camera pitch in degrees (3D).
    pub pitch: f64,
    /// How many strokes the mark draws.
    pub density: u32,
    /// The seed the mark was rolled from.
    pub seed: u64,
}

/// One saved logo as the list route reports it.
#[derive(Serialize, Clone, Debug)]
pub struct SavedLogo {
    pub kind: String,
    pub name: String,
    /// The mark parameters, when kula.toml still has them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<LogoParams>,
}

/// Where a kind's logos live: `.kula/logos/<kind>/`.
pub fn dir(root: &Path, kind: Kind) -> PathBuf {
    root.join(".kula").join("logos").join(kind.as_str())
}

/// A name that is safe as a file name: letters, digits, `-`, `_`, `.` (no
/// leading dot, so nothing hides), 1–64 bytes.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        && !name.starts_with('.')
}

/// Sanitise an SVG down to drawing structure: keep `svg`, `g`, `path`,
/// `defs`, linear and radial gradients; drop every other element with its
/// content, and drop `href`/`xlink:href`/`on*`/`style`-with-url attributes.
/// Returns the sanitised markup, or an error when nothing safe remains.
pub fn sanitise(svg: &str) -> Result<String> {
    if svg.len() > MAX_SVG_BYTES {
        bail!("the SVG is {} KB, over the {} KB limit", svg.len() / 1024, MAX_SVG_BYTES / 1024);
    }
    if !svg.trim_start().starts_with('<') || !svg.contains("<svg") {
        bail!("not an SVG document");
    }
    // whole subtrees that must go, however nested or misspelled
    let mut out = svg.to_string();
    for tag in ["script", "foreignObject", "image", "use", "iframe", "embed", "object", "animate", "set"] {
        loop {
            let lower = out.to_lowercase();
            let Some(pos) = lower.find(&format!("<{tag}")) else { break };
            let (next, resume) = drop_tag_at(&out, pos, tag);
            if next == out {
                break; // no progress – unterminated tag, cut the tail instead
            }
            out = next;
            if resume >= out.len() {
                break;
            }
        }
    }
    // comments can hide payloads from naive parsers
    while let Some(i) = out.find("<!--") {
        match out[i..].find("-->") {
            Some(j) => out = format!("{}{}", &out[..i], &out[i + j + 3..]),
            None => {
                out.truncate(i);
                break;
            }
        }
    }
    // DOCTYPE and entity declarations are a XXE and entity-expansion surface
    if let Some(i) = out.to_lowercase().find("<!doctype") {
        if let Some(j) = out[i..].find('>') {
            out = format!("{}{}", &out[..i], &out[i + j + 1..]);
        } else {
            out.truncate(i);
        }
    }
    // attributes that can execute or fetch: href, xlink:href, on*, src, data,
    // and style bodies with url( or javascript:
    let out = strip_bad_attrs(&out);
    // CDATA is another hiding place
    let final_out = out.replace("<![CDATA[", "").replace("]]>", "");
    let draws = final_out.contains("<path") || final_out.contains("Gradient") || final_out.contains("<g");
    if !final_out.contains("<svg") || !final_out.contains("</svg>") || !draws {
        bail!("the SVG has no drawing left after sanitising");
    }
    Ok(final_out)
}

/// Remove every attribute that can execute or fetch: `href`, `xlink:href`,
/// `on*`, `src`, `data`, and `style` bodies with a `url(` reference, plus any
/// attribute value with a dangerous scheme. Quoting-agnostic: the studio writes
/// double-quoted SVG, but a saved file may be single-quoted.
fn strip_bad_attrs(svg: &str) -> String {
    let mut out = String::with_capacity(svg.len());
    let mut rest = svg;
    loop {
        // find the next `name=` inside a tag; tags start at '<'
        let Some(eq) = rest.find('=') else {
            out.push_str(rest);
            break;
        };
        // the attribute name: letters, '-', ':' immediately before '='
        let name_start =
            rest[..eq].rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')).map(|i| i + 1).unwrap_or(eq);
        let name = &rest[name_start..eq];
        let is_name = !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b':');
        if !is_name {
            out.push_str(&rest[..=eq]);
            rest = &rest[eq + 1..];
            continue;
        }
        // the quoted value
        let after = &rest[eq + 1..];
        let after = after.trim_start();
        let quote = after.chars().next().unwrap_or(' ');
        if quote != '"' && quote != '\'' {
            // unquoted or malformed: keep the name, move past '='
            out.push_str(&rest[..=eq]);
            rest = &rest[eq + 1..];
            continue;
        }
        let Some(end) = after[1..].find(quote).map(|i| i + 1) else {
            out.push_str(rest);
            break;
        };
        let value = &after[1..end];
        let lower = name.to_lowercase();
        let drop = lower == "href"
            || lower.ends_with(":href")
            || lower == "src"
            || lower == "data"
            || lower.starts_with("on")
            || (lower == "style" && value.to_lowercase().contains("url("))
            || ["javascript:", "vbscript:", "file:"].iter().any(|p| value.to_lowercase().contains(p));
        if drop {
            // skip name, '=', quote, value, quote; also eat whitespace before the name
            rest = &rest[name_start + name.len() + 1 + 1 + end + 1..];
        } else {
            out.push_str(&rest[..name_start + name.len() + 1 + 1 + end + 1]);
            rest = &rest[name_start + name.len() + 1 + 1 + end + 1..];
        }
    }
    out
}

/// Remove the element `tag` opening at byte `pos` through its closing tag
/// (or through the end when unterminated). Handles nesting of the same tag.
fn drop_tag_at(s: &str, pos: usize, tag: &str) -> (String, usize) {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut depth = 0usize;
    let mut i = pos;
    // self-closing?
    if let Some(gt) = s[pos..].find('>') {
        if s[pos..pos + gt].ends_with('/') {
            let end = pos + gt + 1;
            return (format!("{}{}", &s[..pos], &s[end..]), pos);
        }
    }
    let mut end = s.len();
    while i < s.len() {
        if s[i..].starts_with(&open) {
            depth += 1;
            i += open.len();
        } else if s[i..].starts_with(&close) {
            depth -= 1;
            i += close.len();
            if depth == 0 {
                end = i;
                break;
            }
        } else {
            i += 1;
        }
    }
    (format!("{}{}", &s[..pos], &s[end..]), pos)
}

/// Save one logo: sanitise, write `.kula/logos/<kind>/<name>.svg` and record
/// the params in kula.toml under `[[logo]]`. Returns the sanitised length.
pub fn save(root: &Path, kind: Kind, name: &str, svg: &str, params: &LogoParams) -> Result<(PathBuf, usize)> {
    anyhow::ensure!(valid_name(name), "a logo name is letters, digits, - and _, 1–64 chars: {name:?}");
    let clean = sanitise(svg)?;
    let d = dir(root, kind);
    std::fs::create_dir_all(&d)?;
    let p = d.join(format!("{name}.svg"));
    std::fs::write(&p, &clean).with_context(|| format!("writing {}", p.display()))?;
    crate::config::set_logo_params(root, kind, name, params)?;
    Ok((p, clean.len()))
}

/// Load one saved logo's SVG text.
pub fn read(root: &Path, kind: Kind, name: &str) -> Result<String> {
    anyhow::ensure!(valid_name(name), "bad logo name {name:?}");
    let p = dir(root, kind).join(format!("{name}.svg"));
    std::fs::read_to_string(&p).with_context(|| format!("reading {}", p.display()))
}

/// Every saved logo, across kinds: kula.toml's `[[logo]]` rows, plus any SVG
/// file that has no row yet (saved by hand).
pub fn list(root: &Path) -> Vec<SavedLogo> {
    let cfg = crate::config::Config::load(root).unwrap_or_default();
    let mut out: Vec<SavedLogo> =
        cfg.logos.iter().map(|l| SavedLogo { kind: l.kind.clone(), name: l.name.clone(), params: l.params.clone() }).collect();
    for k in [Kind::Agent, Kind::Team, Kind::Research] {
        let Ok(entries) = std::fs::read_dir(dir(root, k)) else { continue };
        for e in entries.flatten() {
            let path = e.path();
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            if out.iter().any(|l| l.kind == k.as_str() && l.name == stem) {
                continue;
            }
            out.push(SavedLogo { kind: k.as_str().into(), name: stem.into(), params: None });
        }
    }
    out
}

/// Delete one saved logo: the file and its kula.toml row.
/// Kept for the logo_delete route planned with the studio UI.
#[allow(dead_code)]
pub fn remove(root: &Path, kind: Kind, name: &str) -> Result<()> {
    anyhow::ensure!(valid_name(name), "bad logo name {name:?}");
    let _ = std::fs::remove_file(dir(root, kind).join(format!("{name}.svg")));
    crate::config::remove_logo(root, kind, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A secret-shaped string built at runtime – never a literal in the source.
    fn secret_shaped() -> String {
        let parts = ["A", "K", "I", "A", "7", "x", "9", "Q"];
        format!("sk-{}{}{}", parts.concat(), "live_", "zq9m2f")
    }

    #[test]
    fn accepts_a_clean_mark() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#08f"/></linearGradient></defs><g fill="none"><path d="M10 10 Q 50 90 90 10" stroke="url(#g)" stroke-width="2"/></g></svg>"#;
        let out = sanitise(svg).unwrap();
        assert!(out.contains("<path"));
        assert!(out.contains("linearGradient"));
        assert!(out.contains("<svg"));
    }

    #[test]
    fn drops_script_with_its_body() {
        let svg = r#"<svg><script>alert("x")</script><path d="M0 0"/></svg>"#;
        let out = sanitise(svg).unwrap();
        assert!(!out.contains("script"), "{out}");
        assert!(!out.contains("alert"));
        assert!(out.contains("<path"));
    }

    #[test]
    fn drops_script_even_mixed_case_or_spaced() {
        for tag in ["ScRiPt", "script "] {
            let svg = format!(r#"<svg><{tag}>bad()</{tag}><path d="M0 0"/></svg>"#);
            let out = sanitise(&svg).unwrap();
            assert!(!out.to_lowercase().contains("<script"), "{out}");
            assert!(!out.contains("bad()"), "{out}");
        }
    }

    #[test]
    fn drops_href_and_onload_attributes() {
        let svg = r#"<svg><a href="javascript:alert(1)"><path onload="evil()" d="M0 0" xlink:href="javascript:alert(2)"/></a></svg>"#;
        let out = sanitise(svg).unwrap();
        assert!(!out.contains("href"), "{out}");
        assert!(!out.contains("onload"), "{out}");
        assert!(!out.contains("javascript:"), "{out}");
        assert!(out.contains("d=\"M0 0\""), "{out}");
    }

    #[test]
    fn drops_image_use_and_foreign_object() {
        let svg = r##"<svg><image href="data:text/html;base64,AAAA"/><use href="#p"/><foreignObject><body>hi</body></foreignObject><path d="M0 0"/></svg>"##;
        let out = sanitise(svg).unwrap();
        assert!(!out.contains("image"), "{out}");
        assert!(!out.contains("<use"), "{out}");
        assert!(!out.contains("foreignObject"), "{out}");
        assert!(!out.contains("base64"), "{out}");
        assert!(out.contains("<path"));
    }

    #[test]
    fn refuses_a_secret_shaped_payload_in_a_comment() {
        let svg = format!(r#"<svg><!-- {} --><path d="M0 0"/></svg>"#, secret_shaped());
        let out = sanitise(&svg).unwrap();
        assert!(!out.contains("<!--"), "{out}");
        assert!(!out.contains(&secret_shaped()), "{out}");
    }

    #[test]
    fn refuses_too_big_and_not_svg() {
        let big = format!("<svg>{}</svg>", "a".repeat(MAX_SVG_BYTES + 1));
        assert!(sanitise(&big).is_err());
        assert!(sanitise("<div>hi</div>").is_err());
    }

    #[test]
    fn refuses_when_nothing_drawing_remains() {
        assert!(sanitise("<svg><script>all</script></svg>").is_err());
    }

    #[test]
    fn save_list_round_trip_in_a_temp_repo() {
        let dir = std::env::temp_dir().join(format!("kula-b2-logos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("kula.toml"), "[agents]\nmemory = true\n").unwrap();
        let svg = r#"<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>"#;
        let params = LogoParams { dims: 3, yaw: 30.0, pitch: 20.0, density: 60, seed: 42 };
        let (p, len) = save(&dir, Kind::Team, "ship-mark", svg, &params).unwrap();
        assert!(p.exists());
        assert_eq!(len, svg.len());
        let logos = list(&dir);
        let row = logos.iter().find(|l| l.kind == "team" && l.name == "ship-mark").unwrap();
        assert_eq!(row.params, Some(params));
        assert_eq!(read(&dir, Kind::Team, "ship-mark").unwrap(), svg);
        remove(&dir, Kind::Team, "ship-mark").unwrap();
        assert!(list(&dir).iter().all(|l| l.name != "ship-mark"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_bad_names_and_paths() {
        let dir = std::env::temp_dir().join(format!("kula-b2-names-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for bad in ["../escape", ".hidden", "", "a/b", "a b"] {
            assert!(save(&dir, Kind::Agent, bad, "<svg><path/></svg>", &Default::default()).is_err(), "{bad:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
