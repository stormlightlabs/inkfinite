//! File-mode command-line interface for Inkfinite documents.

use std::io;

use clap::Parser;

#[path = "../cli/mod.rs"]
mod cli;

fn main() {
    let cli = cli::Cli::parse();
    let mut stdout = io::stdout().lock();
    if let Err(error) = cli::run(cli.command, cli.json, &mut stdout) {
        eprintln!("inkfinite: {:#}", error.source);
        std::process::exit(error.exit_code());
    }
}
