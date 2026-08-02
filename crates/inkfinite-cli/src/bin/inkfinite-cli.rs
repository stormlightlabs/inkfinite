//! File-mode command-line interface for Inkfinite documents.

use std::io;

use clap::Parser;

#[path = "../cli/mod.rs"]
mod cli;

fn main() {
    let arguments = std::env::args_os().collect::<Vec<_>>();
    let json_output = arguments.iter().any(|argument| argument == "--json");
    let cli = match cli::Cli::try_parse_from(arguments) {
        Ok(cli) => cli,
        Err(error) if json_output && error.exit_code() != 0 => {
            let diagnostic = serde_json::json!({
                "error": {
                    "code": "invalid_usage",
                    "message": error.to_string(),
                    "details": null,
                    "retryable": false,
                    "suggestion": "Run the command with --help to inspect its accepted arguments."
                }
            });
            eprintln!("{diagnostic}");
            std::process::exit(error.exit_code());
        }
        Err(error) => error.exit(),
    };
    let mut stdout = io::stdout().lock();
    if let Err(error) = cli::run(cli.command, cli.json, &mut stdout) {
        if cli.json {
            eprintln!("{}", error.diagnostic());
        } else {
            eprintln!("inkfinite: {:#}", error.source);
        }
        std::process::exit(error.exit_code());
    }
}
