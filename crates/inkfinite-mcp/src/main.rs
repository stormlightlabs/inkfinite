use std::path::PathBuf;

use inkfinite_mcp::{InkfiniteMcp, run_stdio};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let paths = std::env::args_os().skip(1).map(PathBuf::from).collect::<Vec<_>>();
    let server = if paths.is_empty() { InkfiniteMcp::from_environment() } else { InkfiniteMcp::new(paths) };
    if let Err(error) = run_stdio(server).await {
        eprintln!("inkfinite-mcp: {error}");
        std::process::exit(1);
    }
}
