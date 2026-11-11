use crate::*;

pub(crate) fn task_cmd(repo: &Repo, c: TaskCmd, json: bool) -> Result<()> {
    let show = |t: &guard::Task| {
        if json {
            println!("{}", serde_json::to_string(t).unwrap_or_default());
        } else {
            println!("  {} {}", accent("task"), bold(&t.title));
            if !t.workflow.is_empty() {
                println!("  {} {}", dim("workflow"), t.workflow);
            }
            println!("  {} {}", dim("scope"), if t.scope.is_empty() { "whole repository".into() } else { t.scope.join(", ") });
        }
    };
    match c {
        TaskCmd::Start { title, scope, workflow } => {
            let t = guard::task_start(repo, &title, scope, workflow.as_deref(), &repo.user())?;
            show(&t);
            if !json {
                println!("  {}", dim("agents may change only what is in scope until `kula task done`"));
            }
        }
        TaskCmd::Show => match guard::task(repo) {
            Some(t) => show(&t),
            None if json => println!("null"),
            None => println!("  {}", dim("no active task – agents follow kula.toml's guards only")),
        },
        TaskCmd::Done => match guard::task_done(repo)? {
            Some(t) if !json => println!("  {} {}", green("✓ done"), t.title),
            _ if json => println!("null"),
            _ => println!("  {}", dim("no active task")),
        },
    }
    Ok(())
}
