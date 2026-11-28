use crate::lib::compute;

pub enum Commands {
    Serve,
    Index,
}

pub fn dispatch(args: Vec<String>) {
    let cmd = args.get(1).cloned().unwrap_or_default();
    match cmd.as_str() {
        "serve" => serve(),
        "index" => index_now(),
        _ => serve(),
    }
}

pub fn serve() {
    println!("{}", compute(2));
}

pub fn index_now() {
    let _ = compute(3);
}

pub fn unused_helper() {
    compute(4);
}
