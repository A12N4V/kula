pub struct Config;

impl Config {
    pub fn load() -> Result<Config, ()> {
        Ok(Config)
    }
    pub fn build() -> Self {
        Config
    }
    pub fn run(&self) {}
    pub fn map(&self) {}
}
