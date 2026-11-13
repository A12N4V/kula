use cfg::Config;

pub fn boot() {
    let c = Config::build();
    c.run();
}

pub fn try_boot() {
    let r = Config::load();
    let _ = r.map(|c| c);
}
