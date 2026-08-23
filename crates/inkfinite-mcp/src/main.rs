use std::path::PathBuf;

use inkfinite_mcp::{InkfiniteMcp, McpPolicy, run_stdio};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::format::FmtSpan;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    init_tracing();
    let paths = std::env::args_os().skip(1).map(PathBuf::from).collect::<Vec<_>>();
    let server = if paths.is_empty() {
        InkfiniteMcp::from_environment()
    } else {
        InkfiniteMcp::new_with_policy(paths, McpPolicy::from_environment())
    };
    if let Err(error) = run_stdio(server).await {
        eprintln!("inkfinite-mcp: {error}");
        std::process::exit(1);
    }
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("off"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_span_events(FmtSpan::CLOSE)
        .with_writer(std::io::stderr)
        .try_init();
}
