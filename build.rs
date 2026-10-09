// Ensure the embedded UI folder exists so `cargo build` works before the web app is built.
fn main() {
    let dist = std::path::Path::new("web/dist");
    if !dist.join("index.html").exists() {
        std::fs::create_dir_all(dist).ok();
        std::fs::write(
            dist.join("index.html"),
            "<!doctype html><title>Kula</title><body style=\"font-family:system-ui;background:#0c0d10;color:#e8e6e1;padding:3rem\"><h1>Kula</h1><p>The web UI was not built into this binary. Run <code>pnpm -C web build</code> then rebuild.</p>",
        )
        .ok();
    }
    println!("cargo:rerun-if-changed=web/dist");

    // Language-pack queries: every src/index/queries/*.scm, embedded by id.
    let dir = std::path::Path::new("src/index/queries");
    let mut files: Vec<_> = std::fs::read_dir(dir).map(|d| d.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    files.retain(|p| p.extension().is_some_and(|e| e == "scm"));
    files.sort();
    let mut out = String::from("pub static QUERIES: &[(&str, &str)] = &[\n");
    for p in &files {
        let id = p.file_stem().unwrap().to_string_lossy();
        let abs = std::fs::canonicalize(p).unwrap();
        out.push_str(&format!("    ({id:?}, include_str!({:?})),\n", abs.to_string_lossy()));
    }
    out.push_str("];\n");
    let dest = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("queries.rs");
    std::fs::write(dest, out).unwrap();
    println!("cargo:rerun-if-changed=src/index/queries");
    println!("cargo:rustc-env=KULA_TARGET={}", std::env::var("TARGET").unwrap());
}
