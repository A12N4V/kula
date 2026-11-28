mod cli;

fn main() {
    cli::dispatch(std::env::args().collect());
}
