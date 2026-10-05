//! Workflows: work modes for AI agents.
//!
//! A task says *what* an agent is doing; a workflow says *how* that kind of work
//! is done in this repository. Each one carries its own fences (refactors may
//! not touch tests, test-writing may not touch the code under test), a default
//! scope, a memory policy, the steps an agent is expected to follow and the docs
//! it should read first. Start a task in a workflow and every agent-facing
//! answer – MCP, the pre-edit hook, `kula check` – applies them.
//!
//! Five are built in. `[[workflow]]` tables in kula.toml add more, or replace a
//! built-in by reusing its name.

use crate::config::Config;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Workflow {
    pub name: String,
    /// One line: what this kind of work is.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub about: String,
    /// Default task scope: agents may change only this (globs or symbol names).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub scope: Vec<String>,
    /// Read, never edit, while this workflow is active.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lock: Vec<String>,
    /// Never shown to agents while this workflow is active.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub hide: Vec<String>,
    /// Editable, flagged for a person.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub review: Vec<String>,
    /// write (default) · read: recall only · off.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub memory: String,
    /// What an agent should do, in order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<String>,
    /// Files to read before starting.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub docs: Vec<String>,
    /// Shipped with kula (not from kula.toml).
    #[serde(skip_deserializing, skip_serializing_if = "std::ops::Not::not")]
    pub builtin: bool,
}

impl Workflow {
    pub fn memory_policy(&self) -> &str {
        match self.memory.as_str() {
            "read" | "off" => &self.memory,
            _ => "write",
        }
    }
}

pub const TESTS: &[&str] = &[
    "**/tests/**",
    "**/test/**",
    "**/__tests__/**",
    "**/spec/**",
    "**/e2e/**",
    "**/*_test.*",
    "**/*_tests.*",
    "**/test_*.*",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*Test.java",
    "**/*Tests.cs",
];

pub const DOCS: &[&str] = &["**/*.md", "**/*.mdx", "**/*.rst", "**/*.adoc", "docs/**", "doc/**", "**/*.txt"];

fn v(s: &[&str]) -> Vec<String> {
    s.iter().map(|x| x.to_string()).collect()
}

/// The workflows kula ships with.
pub fn builtin() -> Vec<Workflow> {
    let b = |name: &str, about: &str| Workflow { name: name.into(), about: about.into(), builtin: true, ..Default::default() };
    vec![
        Workflow {
            lock: v(&["**"]),
            steps: v(&[
                "Answer from the graph first: context_pack, context, sparql",
                "Read code; change nothing – every file is locked",
                "remember what you learn that the next session would need",
            ]),
            ..b("explore", "Read and explain the code; change nothing")
        },
        Workflow {
            steps: v(&[
                "recall memories on the symbols involved",
                "pre_edit before changing a symbol: callers, tests, risk",
                "Make the smallest change that fixes it; add a regression test",
                "verify_edit: no dangling callers, no fenced files touched",
                "remember the root cause on the symbol you fixed",
            ]),
            ..b("fix", "Fix a bug with the smallest change that holds")
        },
        Workflow {
            lock: v(TESTS),
            steps: v(&[
                "pre_edit every symbol you move or rename",
                "Keep public signatures unless asked otherwise",
                "Tests are locked: they must pass unchanged",
                "verify_edit: modified symbols' callers in other files still fit",
            ]),
            ..b("refactor", "Restructure without changing behaviour; tests are the contract")
        },
        Workflow {
            scope: v(TESTS),
            steps: v(&[
                "context_pack the code under test",
                "Write tests only – the code under test is out of scope",
                "A failing test is a finding: report it, don't fix the code",
            ]),
            ..b("tests", "Write tests; leave the code under test alone")
        },
        Workflow {
            scope: v(DOCS),
            memory: "read".into(),
            steps: v(&[
                "context_pack the code you document; quote names exactly",
                "Only documentation is in scope",
                "Check examples against the current signatures",
            ]),
            ..b("docs", "Write documentation; no code changes")
        },
    ]
}

/// Built-ins, overridden by name and extended by kula.toml.
pub fn all(cfg: &Config) -> Vec<Workflow> {
    let mut out = builtin();
    for w in &cfg.workflows {
        let mut w = w.clone();
        w.builtin = false;
        match out.iter_mut().find(|x| x.name == w.name) {
            Some(x) => *x = w,
            None => out.push(w),
        }
    }
    out
}

pub fn find(cfg: &Config, name: &str) -> Option<Workflow> {
    all(cfg).into_iter().find(|w| w.name == name)
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 40 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_can_be_replaced_and_extended() {
        let cfg: Config = toml::from_str(
            r#"
            [[workflow]]
            name = "refactor"
            about = "ours"
            lock = ["api/**"]
            [[workflow]]
            name = "migrate"
            scope = ["migrations/**"]
            memory = "off"
            "#,
        )
        .unwrap();
        let all = all(&cfg);
        assert_eq!(all.iter().filter(|w| w.name == "refactor").count(), 1);
        let r = find(&cfg, "refactor").unwrap();
        assert_eq!(r.lock, vec!["api/**"]);
        assert!(!r.builtin);
        assert!(find(&cfg, "explore").unwrap().builtin);
        assert_eq!(find(&cfg, "migrate").unwrap().memory_policy(), "off");
        assert_eq!(find(&cfg, "fix").unwrap().memory_policy(), "write");
        assert!(valid_name("db-migrate") && !valid_name("no spaces"));
    }
}
