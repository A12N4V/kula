//! Tiny terminal styling layer. Honours NO_COLOR and non-TTY output.

use std::io::IsTerminal;
use std::sync::OnceLock;

fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("NO_COLOR").is_none() && std::io::stdout().is_terminal())
}

fn paint(code: &str, s: &str) -> String {
    if enabled() {
        format!("\x1b[{code}m{s}\x1b[0m")
    } else {
        s.to_string()
    }
}

pub fn bold(s: &str) -> String {
    paint("1", s)
}
pub fn dim(s: &str) -> String {
    paint("2", s)
}
pub fn accent(s: &str) -> String {
    paint("38;5;215", s)
} // shell-coral
pub fn green(s: &str) -> String {
    paint("38;5;114", s)
}
pub fn red(s: &str) -> String {
    paint("38;5;203", s)
}
pub fn yellow(s: &str) -> String {
    paint("38;5;221", s)
}
pub fn blue(s: &str) -> String {
    paint("38;5;110", s)
}
pub fn magenta(s: &str) -> String {
    paint("38;5;176", s)
}

/// Stable colour per community id for terminal output.
pub fn community(id: i64, s: &str) -> String {
    const P: [&str; 8] = ["38;5;215", "38;5;110", "38;5;114", "38;5;176", "38;5;221", "38;5;80", "38;5;174", "38;5;147"];
    paint(P[(id.rem_euclid(8)) as usize], s)
}

pub fn kind_glyph(kind: &str) -> &'static str {
    match kind {
        "file" => "▤",
        "class" => "◆",
        "interface" => "◇",
        "method" => "◦",
        _ => "ƒ",
    }
}

pub fn header(title: &str) {
    println!("{} {}", accent("◯"), bold(title));
}

/// A label/value line, the label dim and padded so values line up in a block.
pub fn kv(width: usize, k: &str, v: &str) {
    println!("  {:<width$}{}", dim(k), v, width = width);
}

/// The next thing to run, after an output block: dim, indented.
pub fn hint(cmd: &str) {
    println!("  {}", dim(&format!("→ {cmd}")));
}

/// What failed and what to run next. Returns the strings for tests; main prints them.
pub fn failure(msg: &str, next: Option<&str>) -> String {
    match next {
        Some(n) => format!("{} {msg}\n{} {}", red("✗"), dim("→"), n),
        None => format!("{} {msg}", red("✗")),
    }
}

pub fn rel_time(ts: i64) -> String {
    let now = crate::meta::now();
    let d = (now - ts).max(0);
    match d {
        0..=59 => "just now".into(),
        60..=3599 => format!("{}m ago", d / 60),
        3600..=86_399 => format!("{}h ago", d / 3600),
        86_400..=2_591_999 => format!("{}d ago", d / 86_400),
        _ => format!("{}mo ago", d / 2_592_000),
    }
}

pub fn risk(r: &str) -> String {
    match r {
        "high" => red("● high"),
        "medium" => yellow("● medium"),
        "low" => green("● low"),
        _ => dim("○ none"),
    }
}

/// The kula mark – a ring of seven-by-seven pixels around a centre node – in
/// block characters (two per pixel, so they come out square), with the name.
const MARK: [&str; 7] = ["..###..", ".#...#.", "#.....#", "#..#..#", "#.....#", ".#...#.", "..###.."];

pub fn banner() -> String {
    let side = ["", "", &bold("k u l a"), &dim("git, with a map"), &dim(&format!("v{}", env!("CARGO_PKG_VERSION"))), "", ""];
    let mut out = String::from("\n");
    for (row, text) in MARK.iter().zip(side) {
        let px: String = row.chars().map(|c| if c == '#' { "██" } else { "  " }).collect();
        out.push_str(&format!("  {}    {}\n", paint("38;2;240;82;1", &px), text));
    }
    out
}
