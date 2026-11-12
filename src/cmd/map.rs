//! `kula map` and `kula explain`: thin CLI glue over the pure map modules.

use crate::*;

/// `kula map [--zoom …] [--format …]`.
pub(crate) fn run_map(repo: &Repo, zoom: &str, format: &str, json_flag: bool) -> Result<()> {
    let st = open_or_index(repo)?;
    let format = if json_flag { "json" } else { format };
    let tree = map::render::zoom(&map::tree::module_tree(&repo.root, &st), zoom);
    match format {
        "json" => println!("{}", map::render::json(&tree, zoom)),
        "mermaid" => println!("{}", map::render::mermaid(&st, &tree, zoom)),
        _ => println!("{}", map::render::markdown(&tree, zoom)),
    }
    Ok(())
}

/// `kula brief`: one page for an agent new to this repo. Under 1500 tokens.
pub(crate) fn run_brief(repo: &Repo, format: &str, json_flag: bool) -> Result<()> {
    let st = open_or_index(repo)?;
    let r = map::brief::report(&map::tree::module_tree(&repo.root, &st), &st);
    let format = if json_flag { "json" } else { format };
    if format == "json" {
        println!("{}", serde_json::to_string_pretty(&r)?);
    } else {
        println!("{}", map::brief::markdown(&r).trim_end());
    }
    Ok(())
}

/// `kula explain <module|symbol|file>`.
pub(crate) fn run_explain(repo: &Repo, target: &str, json_flag: bool) -> Result<()> {
    let st = open_or_index(repo)?;
    let memories = memory::recall(repo, &st, Some(target), None, 5).unwrap_or_default().into_iter().map(|r| r.body).collect();
    let r = map::explain::explain(repo, &st, target, memories)?;
    if json_flag {
        println!("{}", serde_json::to_string_pretty(&r)?);
    } else {
        println!("{}", map::explain::markdown(&r).trim_end());
    }
    Ok(())
}
