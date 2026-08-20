use super::mutation::commit_mutation;
use super::support::{open_document, portable_path};
use super::{ApplyArgs, CliError, EXIT_INPUT, EXIT_INVALID, Path, Read, Result, TransactionDraft, Write, fs, io};

pub fn apply_transaction(args: &ApplyArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let transaction = read_transaction(&args.transaction)?;
    let mut file = open_document(&args.path)?;
    commit_mutation(
        &mut file,
        transaction,
        args.dry_run,
        None,
        Vec::new(),
        json_output,
        stdout,
    )
}

/// Reads one transaction from a JSON file or standard input for file and live modes.
pub fn read_transaction(path: &Path) -> Result<TransactionDraft> {
    let transaction_json = if path == Path::new("-") {
        let mut input = String::new();
        io::stdin()
            .read_to_string(&mut input)
            .map_err(|error| CliError::new(EXIT_INPUT, error).context("could not read transaction from stdin"))?;
        input
    } else {
        fs::read_to_string(path).map_err(|error| {
            CliError::new(EXIT_INPUT, error).context(format!("could not read transaction {}", portable_path(path)))
        })?
    };
    serde_json::from_str(&transaction_json)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse transaction JSON"))
}
