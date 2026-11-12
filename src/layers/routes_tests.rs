//! Unit tests for the route scanners.

use super::*;

#[test]
fn scans_express() {
    let src =
        "app.get(\"/users\", listUsers);\napp.post(\"/users\", createUser);\nmap.get(\"k\");\napp.get(\"/inline\", (req, res) => {});\n";
    let hits = scan("typescript", "server.ts", src);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0], RouteHit { method: "GET".into(), path: "/users".into(), handler: Some("listUsers".into()), byte: 7 });
    assert_eq!(hits[1].method, "POST");
}

#[test]
fn scans_fastapi_and_flask() {
    let src = "@app.get(\"/items\")\ndef list_items(): pass\n@app.route(\"/old\", methods=[\"POST\"])\ndef old(): pass\n";
    let hits = scan("python", "api.py", src);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].method, "GET");
    assert_eq!(hits[0].handler.as_deref(), Some("list_items"));
    assert_eq!(hits[1].method, "POST");
}

#[test]
fn scans_axum() {
    let src = "let app = Router::new().route(\"/health\", get(health)).route(\"/u/:id\", post(save_user));\n";
    let hits = scan("rust", "main.rs", src);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].handler.as_deref(), Some("health"));
    assert_eq!(hits[1].method, "POST");
}

#[test]
fn scans_go() {
    let src = "http.HandleFunc(\"/work\", workHandler)\nr.GET(\"/ping\", pingHandler)\n";
    let hits = scan("go", "main.go", src);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].handler.as_deref(), Some("workHandler"));
    assert_eq!(hits[1].method, "GET");
}

#[test]
fn scans_next_routes() {
    let src = "export async function GET() {}\nexport async function POST() {}\n";
    let hits = scan("typescript", "app/api/users/route.ts", src);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].path, "/api/users");
    let hits = scan("typescript", "pages/api/health.ts", src);
    assert_eq!(hits[0].path, "/api/health");
    let hits = scan("typescript", "app/api/users/[id]/route.ts", "export function GET() {}");
    assert_eq!(hits[0].path, "/api/users/:id");
}

#[test]
fn normalises_params_and_slashes() {
    assert_eq!(norm_path("/users/:id/"), "/users/:param");
    assert_eq!(norm_path("/users/{id}"), "/users/:param");
    assert_eq!(norm_path("/users/<int:id>"), "/users/:param");
    assert_eq!(norm_path("/users/[id]"), "/users/:param");
    assert_eq!(norm_path("/a/b"), "/a/b");
}

#[test]
fn finds_fetch_urls() {
    let js = fetch_urls("typescript", "fetch(\"/api/x\").then(r => r.json());\nfetch(other);\n");
    assert_eq!(js, [("/api/x".to_string(), 6)]);
    let py = fetch_urls("python", "requests.get(\"/api/y\")\n");
    assert_eq!(py.len(), 1);
    assert!(fetch_urls("go", "http.Get(\"/x\")").is_empty());
}

#[test]
fn param_segments_match_concrete_urls() {
    use super::path_matches;
    assert!(path_matches("/items/:param", "/items/7"));
    assert!(!path_matches("/items/:param", "/items/7/x"));
    assert!(!path_matches("/users", "/items"));
}
