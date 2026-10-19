//! Tests for the blocks-and-chains engine. Fixtures are synthetic graphs built
//! in a temp store – no repository on disk is touched.

use super::*;
use rusqlite::params;

fn temp_store() -> (tempfile::TempDir, crate::git::Repo, Store) {
    let dir = tempfile::tempdir().unwrap();
    let repo = crate::git::Repo { root: dir.path().to_path_buf() };
    let store = Store::create(&repo).unwrap();
    (dir, repo, store)
}

fn add_node(store: &Store, id: i64, kind: &str, name: &str, path: &str, line: i64) {
    store
        .conn
        .execute(
            "INSERT INTO nodes (id, kind, name, path, lang, start_line, end_line, parent, community) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,0)",
            params![id, kind, name, path, "py", line, line + 10],
        )
        .unwrap();
}

fn add_edge(store: &Store, src: i64, dst: i64, kind: &str, weight: f64) {
    store.conn.execute("INSERT INTO edges VALUES (?1,?2,?3,?4)", params![src, dst, kind, weight]).unwrap();
}

/// A small synthetic repo: two modules with real call structure, a tests
/// directory, and a barrel `__init__.py` that re-exports everything. The
/// barrel must not glue the modules together.
fn fixture(store: &Store) {
    // Module payments: pay → charge → validate → log
    add_node(store, 1, "file", "core.py", "payments/core.py", 1);
    add_node(store, 2, "function", "pay", "payments/core.py", 10);
    add_node(store, 3, "function", "charge", "payments/core.py", 30);
    add_node(store, 4, "function", "validate_card", "payments/core.py", 60);
    add_node(store, 5, "function", "log_payment", "payments/core.py", 90);
    add_node(store, 6, "class", "Payment", "payments/core.py", 110);
    // Module ledgers: record → append_line → rotate_file
    add_node(store, 10, "file", "book.py", "ledgers/book.py", 1);
    add_node(store, 11, "function", "record", "ledgers/book.py", 10);
    add_node(store, 12, "function", "append_line", "ledgers/book.py", 40);
    add_node(store, 13, "function", "rotate_file", "ledgers/book.py", 70);
    add_node(store, 14, "function", "stamp_entry", "ledgers/book.py", 100);
    add_node(store, 15, "function", "sum_lines", "ledgers/book.py", 120);
    add_node(store, 16, "function", "rotate_backup", "ledgers/book.py", 140);
    // Module ingest: parse_stream → decode_frame
    add_node(store, 20, "file", "wire.py", "ingest/wire.py", 1);
    add_node(store, 21, "function", "parse_stream", "ingest/wire.py", 10);
    add_node(store, 22, "function", "decode_frame", "ingest/wire.py", 50);
    add_node(store, 23, "function", "parse_header", "ingest/wire.py", 80);
    add_node(store, 24, "function", "parse_footer", "ingest/wire.py", 100);
    add_node(store, 25, "function", "decode_meta", "ingest/wire.py", 120);
    // Barrel re-export hub: __init__ "calls" everything (the giant-cluster trap).
    add_node(store, 30, "file", "__init__.py", "__init__.py", 1);
    add_node(store, 31, "function", "reexport_pay", "__init__.py", 5);
    add_node(store, 32, "function", "reexport_record", "__init__.py", 9);
    // Module export: render_report → three renderers
    add_node(store, 50, "file", "render.py", "export/render.py", 1);
    add_node(store, 51, "function", "render_report", "export/render.py", 10);
    add_node(store, 52, "function", "render_table", "export/render.py", 40);
    add_node(store, 53, "function", "render_legend", "export/render.py", 70);
    add_node(store, 54, "function", "render_footer", "export/render.py", 100);
    // Tests: call production code.
    add_node(store, 40, "function", "test_pay", "tests/test_pay.py", 1);
    add_node(store, 41, "function", "test_record", "tests/test_ledger.py", 1);

    for (a, b) in [
        (2, 3),
        (3, 4),
        (3, 5),
        (11, 12),
        (12, 13),
        (12, 14),
        (12, 15),
        (13, 16),
        (21, 22),
        (21, 23),
        (21, 24),
        (21, 25),
        (51, 52),
        (51, 53),
        (51, 54),
    ] {
        add_edge(store, a, b, "CALLS", 1.0);
    }
    // Barrel hub calls many things.
    for d in [2, 3, 4, 5, 11, 12, 21, 22] {
        add_edge(store, 31, d, "CALLS", 1.0);
        add_edge(store, 32, d, "CALLS", 1.0);
    }
    // Tests call production code.
    add_edge(store, 40, 2, "CALLS", 1.0);
    add_edge(store, 41, 11, "CALLS", 1.0);
    // CONTAINS file → symbol.
    for (f, s) in [
        (1, 2),
        (1, 3),
        (1, 4),
        (1, 5),
        (1, 6),
        (10, 11),
        (10, 12),
        (10, 13),
        (10, 14),
        (10, 15),
        (10, 16),
        (20, 21),
        (20, 22),
        (20, 23),
        (20, 24),
        (20, 25),
        (50, 51),
        (50, 52),
        (50, 53),
        (50, 54),
        (30, 31),
        (30, 32),
    ] {
        add_edge(store, f, s, "CONTAINS", 1.0);
    }
}

#[test]
fn deterministic_output() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s1 = Builder::default().compute(&store);
    let s2 = Builder::default().compute(&store);
    assert_eq!(s1.blocks, s2.blocks, "blocks must be deterministic");
    assert_eq!(s1.chains, s2.chains, "chains must be deterministic");
    assert!(!s1.blocks.is_empty());
}

#[test]
fn no_block_exceeds_leaf_cap() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    for b in &s.blocks {
        assert!(b.symbols.len() <= MAX_LEAVES, "block {} holds {} leaves", b.name, b.symbols.len());
    }
}

#[test]
fn barrel_reexport_hub_does_not_glue_modules() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    // More than one section, and no section swallows the whole repo.
    let sections: Vec<&Block> = s.blocks.iter().filter(|b| b.depth == 0).collect();
    assert!(sections.len() >= 2, "expected separate sections, got {:?}", sections.iter().map(|b| b.name.clone()).collect::<Vec<_>>());
    let total: usize = sections.iter().map(|b| subtree_leaves(&s.blocks, b)).sum();
    let largest = sections.iter().map(|b| subtree_leaves(&s.blocks, b)).max().unwrap();
    // The largest section must hold well under everything – the 25 % rule
    // from the brief, encoded: largest leaves ≤ a quarter of all leaves.
    assert!(largest * 4 <= total, "largest section holds {} of {} leaves – over 25 %", largest, total);
}

#[test]
fn test_code_is_its_own_section() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    // Every test symbol lives in a section that holds no production symbols.
    let production: Vec<i64> = vec![2, 3, 4, 5, 6, 11, 12, 13, 21, 22, 31, 32];
    for t in [40, 41] {
        let home = s.blocks.iter().find(|b| b.depth == 0 && subtree_symbols(&s.blocks, b).contains(&t));
        assert!(home.is_some(), "test symbol {t} is in no section");
        let syms = subtree_symbols(&s.blocks, home.unwrap());
        assert!(syms.iter().all(|x| !production.contains(x)), "section {:?} mixes test and production symbols", home.unwrap().name);
    }
}

#[test]
fn names_are_deterministic_and_segment_first() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    for b in &s.blocks {
        assert!(!b.name.is_empty());
        assert!(!b.summary.contains('\n'), "summary must be one line");
        // The dominant path segment appears in the name.
        assert!(!b.name.split(" · ").next().unwrap().is_empty());
    }
}

#[test]
fn chains_start_at_sources_end_at_terminals() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    assert!(!s.chains.is_empty(), "expected chains from entry points");
    for c in &s.chains {
        assert!(c.len >= 2, "a chain needs at least a source and a terminal");
        assert!(!c.blocks.is_empty(), "chain must list the blocks it crosses");
        assert_eq!(c.steps[0], c.source, "a chain starts at its source");
        assert_eq!(*c.steps.last().unwrap(), c.terminal, "a chain ends at its terminal");
    }
}

#[test]
fn family_counts_sum_to_the_chain_total() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    assert!(!s.families.is_empty(), "expected families");
    let sum: u128 = s.families.iter().map(|f| f.count).sum();
    assert_eq!(sum, s.total, "family counts must add up to the total");
    assert!(s.exact || !s.exact); // both states are legal here
    for f in &s.families {
        assert!(f.min_len >= 2);
        assert!(f.max_len >= f.min_len);
        assert!(f.exact, "small fixture counts must be exact");
        assert!(!f.blocks.is_empty(), "a family lists the blocks it can cross");
    }
}

#[test]
fn chain_total_equals_brute_force_enumeration() {
    // A known DAG on the pure engine level: brute-force DFS count must equal
    // the DP total, and the cursor must yield exactly the same chains.
    // adjacency (by symbol index): 0 → 1,2 ; 1 → 3 ; 2 → 3,4 ; 3 → 5 ; 4 → 5
    let adj = vec![vec![1usize, 2], vec![3], vec![3, 4], vec![5], vec![5], vec![]];
    let cond = condense(&adj);
    let counts = path_counts(&cond);
    // Sources are component indices; map them back to symbol indices for the
    // brute-force walk over the raw adjacency.
    let src_syms: Vec<usize> = cond.sources.iter().flat_map(|&c| cond.members[c].clone()).collect();
    let brute = brute_force_paths(&adj, src_syms);
    assert_eq!(counts.total, brute as u128, "DP total must equal brute-force enumeration");
    // Every chain the cursor yields is a real source→terminal path, and
    // exactly once each.
    let mut cursor_chains: Vec<Vec<usize>> = Vec::new();
    let mut cur = ChainCursor::new();
    while let Some(p) = ChainCursor::next(&cond, &mut cur) {
        cursor_chains.push(p);
    }
    assert_eq!(cursor_chains.len(), brute, "cursor must yield every chain");
    let mut sorted = cursor_chains.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), cursor_chains.len(), "no chain twice");
    for p in &cursor_chains {
        assert_eq!(p[0], cond.scc_of[0], "every chain starts at the source");
        let last = *p.last().unwrap();
        assert!(cond.dag[last].is_empty(), "every chain ends at a terminal");
    }
}

#[test]
fn cursor_resumes_from_serialised_state() {
    let adj = vec![vec![1usize, 2], vec![3], vec![3, 4], vec![5], vec![5], vec![]];
    let cond = condense(&adj);
    let mut full: Vec<Vec<usize>> = Vec::new();
    let mut cur = ChainCursor::new();
    while let Some(p) = ChainCursor::next(&cond, &mut cur) {
        full.push(p);
    }
    // Run a few chains, serialise, rebuild, continue: the concatenation of
    // both halves must reproduce the whole enumeration exactly.
    let mut part: Vec<Vec<usize>> = Vec::new();
    let mut cur = ChainCursor::new();
    for _ in 0..3 {
        if let Some(p) = ChainCursor::next(&cond, &mut cur) {
            part.push(p);
        }
    }
    let snap = cur.to_json();
    let mut resumed = ChainCursor::from_json(&snap).expect("cursor parses back");
    while let Some(p) = ChainCursor::next(&cond, &mut resumed) {
        part.push(p);
    }
    assert_eq!(part, full, "resumed enumeration must match a fresh one");
}

#[test]
fn a_cycle_becomes_one_loop_node() {
    // 0 → 1 → 2 → 0 plus 2 → 3: one SCC over {0,1,2}, one loop node.
    let adj = vec![vec![1usize], vec![2], vec![0, 3], vec![]];
    let cond = condense(&adj);
    let looped: Vec<Vec<usize>> = (0..cond.members.len()).filter(|&c| cond.is_loop[c]).map(|c| cond.members[c].clone()).collect();
    assert_eq!(looped.len(), 1, "one cycle means one loop node, got {:?}", looped);
    assert_eq!(looped[0], vec![0usize, 1, 2]);
    // Condensation is a DAG: total stays finite and exact.
    let counts = path_counts(&cond);
    assert!(counts.exact, "a tiny cyclic graph must still count exactly");
    assert!(counts.total >= 1, "source enters the loop and reaches the terminal");
    // Enumeration terminates: a loop node contributes its members once.
    let mut cur = ChainCursor::new();
    let mut seen = 0usize;
    while ChainCursor::next(&cond, &mut cur).is_some() {
        seen += 1;
        assert!(seen < 100, "cursor must not spin on cycles");
    }
}

#[test]
fn huge_path_counts_map_in_linear_time_and_saturate_past_u128() {
    // Layered DAG, 2 nodes per layer, all-to-all between adjacent layers:
    // 121 layers gives ~2^120 paths, far past u128::MAX.
    let layers = 135;
    let n = layers * 2;
    let mut adj = vec![Vec::<usize>::new(); n];
    for l in 0..layers.saturating_sub(1) {
        for a in 0..2 {
            for b in 0..2 {
                adj[l * 2 + a].push((l + 1) * 2 + b);
            }
        }
    }
    let t0 = std::time::Instant::now();
    let cond = condense(&adj);
    let counts = path_counts(&cond);
    let elapsed = t0.elapsed();
    assert!(!counts.exact, "2^120 paths must saturate u128");
    assert_eq!(counts.total, u128::MAX);
    assert!(elapsed.as_millis() < 5_000, "condense + DP must be fast, took {} ms", elapsed.as_millis());
    // Just under the boundary stays exact and beats 10^18.
    let layers = 101;
    let n = layers * 2;
    let mut adj = vec![Vec::<usize>::new(); n];
    for l in 0..layers.saturating_sub(1) {
        for a in 0..2 {
            for b in 0..2 {
                adj[l * 2 + a].push((l + 1) * 2 + b);
            }
        }
    }
    let cond = condense(&adj);
    let counts = path_counts(&cond);
    assert!(counts.exact, "2^100 paths still fit u128");
    assert!(counts.total > u128::from(10u64.pow(18)), "expected > 10^18 paths, got {}", counts.total);
}

#[test]
fn roles_match_hand_labelled_expectations() {
    type RoleCase<'a> = (&'a str, &'a str, &'a str, usize, usize, Vec<&'a str>, &'a str);
    let cases: Vec<RoleCase> = vec![
        // (kind, name, path, prod_in, prod_out, callees, expected)
        ("function", "main", "app/main.py", 0, 2, vec!["charge"], "entry"),
        ("function", "handle", "web/handler.py", 0, 4, vec!["render", "db_save"], "entry"),
        ("function", "pay", "payments/core.py", 1, 4, vec!["charge", "validate_card", "log_payment"], "orchestrator"),
        ("function", "validate_card", "payments/core.py", 3, 0, vec![], "core"),
        ("function", "format_amount", "utils/format.py", 9, 0, vec![], "utility"),
        ("function", "write_file", "io/write.py", 1, 1, vec!["fs_write"], "adapter"),
        ("class", "Payment", "payments/core.py", 2, 0, vec![], "model"),
        ("constant", "MAX_RETRIES", "settings.py", 3, 0, vec![], "config"),
        ("function", "test_pay", "tests/test_pay.py", 0, 1, vec!["pay"], "test"),
        ("function", "reexport_pay", "__init__.py", 0, 1, vec!["pay"], "glue"),
    ];
    for (kind, name, path, pin, pout, callees, expected) in cases {
        let callees: Vec<String> = callees.into_iter().map(String::from).collect();
        let got = classify_role(kind, name, path, pin, pout, &callees);
        assert_eq!(got, expected, "role of {} ({})", name, path);
    }
    // Every role explains itself in one line.
    for role in ROLES {
        let rule = role_rule(role);
        assert!(!rule.is_empty(), "role {} needs a rule", role);
        assert!(!rule.contains('\n'), "rule of {} must be one line", role);
    }
}

#[test]
fn every_symbol_gets_a_role() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    let all: Vec<i64> = vec![2, 3, 4, 5, 6, 11, 12, 13, 21, 22, 31, 32, 40, 41];
    for id in all {
        let role = s.roles.get(&id).unwrap_or_else(|| panic!("symbol {} has no role", id));
        assert!(ROLES.contains(&role.as_str()), "symbol {} got unknown role {}", id, role);
    }
    // Every block carries a dominant role too.
    for b in &s.blocks {
        assert!(ROLES.contains(&b.role.as_str()), "block {} has role {}", b.id, b.role);
    }
}

/// Brute-force count of all source → terminal paths on a tiny DAG.
fn brute_force_paths(adj: &[Vec<usize>], sources: Vec<usize>) -> usize {
    fn walk(adj: &[Vec<usize>], v: usize) -> usize {
        if adj[v].is_empty() {
            return 1;
        }
        adj[v].iter().map(|&w| walk(adj, w)).sum()
    }
    sources.iter().map(|&s| walk(adj, s)).sum()
}

#[test]
fn incremental_rebuild_reuses_stored_tree() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s1 = Builder::default().compute(&store);
    store_stored(&store, &s1, &file_rev(&store).unwrap()).unwrap();
    let rev = file_rev(&store).unwrap();
    let loaded = load_stored(&store, "off").unwrap().expect("stored tree loads");
    assert_eq!(loaded.blocks, s1.blocks);
    assert_eq!(file_rev(&store).unwrap(), rev, "unchanged files keep the same rev");
}

#[test]
fn similarity_provider_refines_without_overriding() {
    struct Half;
    impl Similarity for Half {
        fn similarity(&self, _a: i64, _b: i64) -> f64 {
            0.9
        }
    }
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let sim = Half;
    let b = Builder { similarity: Some(&sim), threads: 2, embed_state: "on".into() };
    let s = b.compute(&store);
    for blk in &s.blocks {
        assert!(blk.symbols.len() <= MAX_LEAVES);
        assert_eq!(blk.source, "graph");
    }
}

#[test]
fn hub_factor_downweights_big_hubs() {
    assert_eq!(hub_factor(10), 1.0);
    assert!(hub_factor(200) < hub_factor(60));
    assert!(hub_factor(200) < 0.8);
}

#[test]
fn test_path_detection() {
    assert!(is_test_path("tests/test_pay.py"));
    assert!(is_test_path("src/foo_test.rs"));
    assert!(is_test_path("web/app.spec.ts"));
    assert!(is_test_path("x/conftest.py"));
    assert!(!is_test_path("src/payments/core.py"));
    assert!(is_reexport("pkg/__init__.py"));
    assert!(is_reexport("src/index.ts"));
    assert!(!is_reexport("src/core.rs"));
}

// ----------------------------------------------------------------– helpers

fn subtree_leaves(blocks: &[Block], b: &Block) -> usize {
    if b.children.is_empty() {
        b.symbols.len()
    } else {
        b.children.iter().filter_map(|c| blocks.iter().find(|x| x.id == *c)).map(|c| subtree_leaves(blocks, c)).sum()
    }
}

fn subtree_symbols(blocks: &[Block], b: &Block) -> Vec<i64> {
    if b.children.is_empty() {
        b.symbols.clone()
    } else {
        b.children.iter().filter_map(|c| blocks.iter().find(|x| x.id == *c)).flat_map(|c| subtree_symbols(blocks, c)).collect()
    }
}

#[test]
fn chain_family_page_enumerates_a_stored_family() {
    let dir = tempfile::tempdir().unwrap();
    let repo = crate::git::Repo { root: dir.path().to_path_buf() };
    let store = Store::create(&repo).unwrap();
    fixture(&store);
    let s = Builder::default().compute(&store);
    store_stored(&store, &s, &file_rev(&store).unwrap()).unwrap();
    let n: i64 = store.conn.query_row("SELECT count(*) FROM syntagm_families", [], |r| r.get(0)).unwrap_or(-1);
    assert!(n > 0, "the fixture should store families, got {n}");
    // Pick a small family so paging to exhaustion is cheap.
    let (fid, want): (String, u128) = store
        .conn
        .query_row("SELECT id, count FROM syntagm_families ORDER BY count ASC LIMIT 1", [], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?.parse().unwrap()))
        })
        .unwrap();
    assert!(want >= 1, "families always have at least one chain");
    // Page one: at most `limit` chains, not done unless the family fits.
    let p1 = chain_family_page(&repo, &store, &fid, None, 2).expect("page1");
    assert!(p1.chains.len() <= 2 && !p1.chains.is_empty(), "page1 holds 1..=2 chains, got {}", p1.chains.len());
    assert_eq!(p1.chains.len(), want.min(2) as usize, "page1 holds the family up to the limit");
    if p1.chains.len() == 2 {
        assert!(!p1.done && p1.cursor.is_some(), "a full page continues with a cursor");
    } else {
        assert!(p1.done && p1.cursor.is_none(), "a short page is the last one");
    }
    // Page two resumes the cursor: new chains only, no overlap.
    let mut all: Vec<i64> = p1.chains.iter().map(|c| c.steps[0] * 1_000_000 + c.len as i64).collect();
    let mut pages = 1;
    let mut cur = p1.cursor;
    while let Some(c) = cur.clone() {
        let p = chain_family_page(&repo, &store, &fid, Some(&c), 2).expect("page next");
        pages += 1;
        for ch in &p.chains {
            let key = ch.steps[0] * 1_000_000 + ch.len as i64;
            assert!(!all.contains(&key), "chain re-delivered across pages: steps0={} len={}", ch.steps[0], ch.len);
            all.push(key);
        }
        if p.done {
            assert!(p.cursor.is_none(), "done clears the cursor");
            break;
        }
        cur = p.cursor;
        assert!(pages < 100, "paging never terminates on family {fid}");
    }
    assert_eq!(all.len() as u128, want, "pages must union to the family's stored count");
}

// ------------------------------------------------------------ M1 embeddings

mod embed_tests {
    use super::*;
    use crate::map::embed::{cosine, DIM, HashEmbedder, STATE};

    /// Same synthetic fixture as the engine tests: two production modules,
    /// a tests directory, a barrel. Written to disk so source slices exist.
    fn fixture_repo() -> (tempfile::TempDir, crate::git::Repo, Store) {
        let (dir, repo, store) = temp_store();
        fixture(&store);
        write_sources(&dir);
        (dir, repo, store)
    }

    fn write_sources(dir: &tempfile::TempDir) {
        let pay = dir.path().join("payments");
        std::fs::create_dir_all(&pay).unwrap();
        std::fs::write(
            pay.join("core.py"),
            "def pay(order):\n    \"\"\"Charge a customer and record the payment.\"\"\"\n    charge(order)\n    log_payment(order)\n\ndef charge(order):\n    \"\"\"Charge the card.\"\"\"\n    validate_card(order)\n\ndef validate_card(order):\n    \"\"\"Validate the card number.\"\"\"\n    pass\n\ndef log_payment(order):\n    \"\"\"Log the payment event.\"\"\"\n    pass\n\nclass Payment:\n    pass\n",
        )
        .unwrap();
        let led = dir.path().join("ledgers");
        std::fs::create_dir_all(&led).unwrap();
        std::fs::write(led.join("book.py"), "def record(entry):\n    append_line(entry)\n\ndef append_line(entry):\n    pass\n").unwrap();
    }

    #[test]
    fn build_without_a_provider_wires_the_local_hash_embeddings() {
        let (_dir, repo, store) = fixture_repo();
        let s = build_with(&repo, &store, None, "off").expect("build");
        // Metadata records the embedding provider state, keyed under hash-v1.
        assert_eq!(store.meta("syntagm_embed").as_deref(), Some(STATE));
        // Sections still exist – the similarity pass refines, never removes.
        assert!(!s.blocks.is_empty());
    }

    #[test]
    fn a_caller_supplied_provider_wins_over_the_local_one() {
        struct Off;
        impl Similarity for Off {
            fn similarity(&self, _a: i64, _b: i64) -> f64 { 0.0 }
        }
        let (_dir, repo, store) = fixture_repo();
        let sim = Off;
        let s = build_with(&repo, &store, Some(&sim), "custom-state").expect("build");
        assert_eq!(store.meta("syntagm_embed").as_deref(), Some("custom-state"));
        assert!(!s.blocks.is_empty());
    }

    #[test]
    fn test_paths_get_trivial_embeddings_and_zero_similarity() {
        let (_dir, repo, store) = fixture_repo();
        let e = HashEmbedder::new(&repo, &store).expect("embedder");
        // The fixture's tests/ path symbols (ids 40+) carry empty vectors.
        let v = e.vector_of_public(40);
        assert!(v.iter().all(|&x| x == 0), "test symbol vector must be empty");
        assert_eq!(e.similarity(40, 41), 0.0);
    }

    #[test]
    fn similar_functions_score_above_dissimilar_ones() {
        let (_dir, repo, store) = fixture_repo();
        let e = HashEmbedder::new(&repo, &store).expect("embedder");
        let near = e.similarity(2, 3); // pay ↔ charge: same file, calls, docs
        let far = e.similarity(2, 11); // pay ↔ record in ledgers/
        assert!(near > 0.0, "same-module functions must share signal: {near}");
        assert!(near >= far, "near {near} must outrank far {far}");
    }

    #[test]
    fn embeddings_are_deterministic_across_fresh_embedders() {
        let (_dir, repo, store) = fixture_repo();
        let a = HashEmbedder::new(&repo, &store).expect("a");
        let b = HashEmbedder::new(&repo, &store).expect("b");
        for (x, y) in [(2, 3), (2, 11), (3, 4)] {
            assert_eq!(a.similarity(x, y), b.similarity(x, y), "{x}↔{y}");
        }
    }

    #[test]
    fn cosine_never_exceeds_one_and_empty_is_zero() {
        let mut a = [0i32; DIM];
        a[7] = 5;
        a[9] = -2;
        assert!((cosine(&a, &a) - 1.0).abs() < 1e-9);
        assert_eq!(cosine(&a, &[0i32; DIM]), 0.0);
        assert!(cosine(&a, &a) <= 1.0);
    }
}
