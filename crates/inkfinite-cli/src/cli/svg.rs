use super::mutation::StructuredMutationTarget;
use super::support::map_output_error;
use super::{
    CliError, EXIT_INPUT, EXIT_INVALID, ImportCommand, Origin, PageId, Result, SvgImportArgs, Timestamp, TransactionId,
    Write, anyhow, fs,
};
use inkfinite_core::svg_import::import_svg;
use inkfinite_core::svg_transaction::{SvgImportTransactionOptions, build_svg_import_transaction};

/// Runs external SVG import commands.
pub fn run_import_command(command: ImportCommand, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        ImportCommand::Svg(args) => import_svg_file(args, json_output, stdout),
    }
}

fn import_svg_file(args: SvgImportArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let source_path = &args.input;
    if source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        != Some("svg".into())
    {
        return Err(
            CliError::new(EXIT_INPUT, anyhow!("SVG input must use a .svg extension")).with_code("invalid_svg_input"),
        );
    }
    let source = fs::read(source_path).map_err(|error| {
        CliError::new(EXIT_INPUT, error).context(format!("could not read SVG input {}", source_path.display()))
    })?;
    let import =
        import_svg(&source).map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse SVG input"))?;

    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let snapshot = target.snapshot()?;
    let page_id = args
        .page
        .map(PageId::from)
        .or_else(|| snapshot.document.page_ids.first().cloned())
        .ok_or_else(|| CliError::new(EXIT_INVALID, anyhow!("document has no page for SVG import")))?;
    let page = snapshot
        .document
        .pages
        .get(&page_id)
        .ok_or_else(|| CliError::new(EXIT_INVALID, anyhow!("page {page_id} does not exist")))?;
    let layer_id = args
        .layer
        .map(inkfinite_core::LayerId::from)
        .or_else(|| page.layer_ids.first().cloned())
        .ok_or_else(|| CliError::new(EXIT_INVALID, anyhow!("page {page_id} has no layer for SVG import")))?;
    let actor_id = target.actor_id();
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned);
    let transaction = build_svg_import_transaction(
        &snapshot,
        &import,
        SvgImportTransactionOptions {
            actor_id,
            origin: Origin::Agent,
            page_id,
            layer_id,
            transaction_id: TransactionId(format!(
                "transaction:svg-import:{}",
                import.source_asset.digest.replace(':', "-")
            )),
            description: source_name
                .as_deref()
                .map(|name| format!("Import SVG {name}"))
                .unwrap_or_else(|| "Import SVG".into()),
            source_name,
            timestamp: Timestamp(0),
        },
    )
    .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not build SVG import transaction"))?;
    let warnings = import.warnings.iter().map(ToString::to_string).collect::<Vec<_>>();
    let omitted_image_count = transaction.omitted_image_count;
    let shape_count = transaction.shape_ids.len();
    let asset_count = transaction.asset_ids.len();
    target.finish_with_warnings(transaction.transaction, &args.mutation, json_output, stdout, warnings)?;

    if !json_output {
        if omitted_image_count > 0 {
            writeln!(
                stdout,
                "Warning: omitted {omitted_image_count} embedded image node(s); native image support is pending"
            )
            .map_err(map_output_error)?;
        }
        writeln!(stdout, "Imported shapes: {shape_count}").map_err(map_output_error)?;
        writeln!(stdout, "Imported assets: {asset_count}").map_err(map_output_error)?;
    }
    Ok(())
}
