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
}
