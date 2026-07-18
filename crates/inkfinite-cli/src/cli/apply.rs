use super::mutation::commit_mutation;
use super::support::{open_document, portable_path};
use super::{ApplyArgs, CliError, EXIT_INPUT, EXIT_INVALID, Path, Read, Result, TransactionDraft, Write, fs, io};

pub fn apply_transaction(args: &ApplyArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let transaction_json = if args.transaction == Path::new("-") {
        let mut input = String::new();
        io::stdin()
            .read_to_string(&mut input)
            .map_err(|error| CliError::new(EXIT_INPUT, error).context("could not read transaction from stdin"))?;
        input
    } else {
        fs::read_to_string(&args.transaction).map_err(|error| {
            CliError::new(EXIT_INPUT, error).context(format!(
                "could not read transaction {}",
                portable_path(&args.transaction)
            ))
        })?
    };
    let transaction: TransactionDraft = serde_json::from_str(&transaction_json)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse transaction JSON"))?;
    let mut file = open_document(&args.path)?;
    commit_mutation(&mut file, transaction, args.dry_run, json_output, stdout)
}
