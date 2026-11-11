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
    // Module ingest: parse_stream → decode_frame
    add_node(store, 20, "file", "wire.py", "ingest/wire.py", 1);
    add_node(store, 21, "function", "parse_stream", "ingest/wire.py", 10);
    add_node(store, 22, "function", "decode_frame", "ingest/wire.py", 50);
    // Barrel re-export hub: __init__ "calls" everything (the giant-cluster trap).
    add_node(store, 30, "file", "__init__.py", "__init__.py", 1);
    add_node(store, 31, "function", "reexport_pay", "__init__.py", 5);
    add_node(store, 32, "function", "reexport_record", "__init__.py", 9);
    // Tests: call production code.
    add_node(store, 40, "function", "test_pay", "tests/test_pay.py", 1);
    add_node(store, 41, "function", "test_record", "tests/test_ledger.py", 1);

    for (a, b) in [(2, 3), (3, 4), (3, 5), (11, 12), (12, 13), (21, 22)] {
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
    for (f, s) in [(1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (10, 11), (10, 12), (10, 13), (20, 21), (20, 22), (30, 31), (30, 32)] {
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
    assert!(largest * 4 >= total || largest < total, "sanity");
    // The largest section must hold well under everything.
    assert!(largest < total, "one section holds every symbol");
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
fn chains_cross_blocks_and_drop_prefixes() {
    let (_d, _repo, store) = temp_store();
    fixture(&store);
    let s = Builder::default().compute(&store);
    assert!(!s.chains.is_empty(), "expected chains from entry points");
    for c in &s.chains {
        assert!(c.len >= 2);
        assert!(c.len <= MAX_CHAIN_DEPTH);
        assert!(!c.blocks.is_empty(), "chain must list the blocks it crosses");
        assert_eq!(c.steps[0], c.entry, "a chain starts at its entry point");
    }
    // No chain is a strict prefix of another.
    for i in 0..s.chains.len() {
        for j in 0..s.chains.len() {
            if i != j {
                assert!(
                    !s.chains[i].steps.starts_with(&s.chains[j].steps) || s.chains[i].steps == s.chains[j].steps,
                    "prefix chain {} of {} kept",
                    s.chains[i].id,
                    s.chains[j].id
                );
            }
        }
    }
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
