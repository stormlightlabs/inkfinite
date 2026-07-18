//! File-mode command-line interface for Inkfinite documents.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use anyhow::{Error, anyhow};
use clap::{Args, Parser, Subcommand, ValueEnum};
use inkfinite_core::engine::validate_document;
use inkfinite_core::file::{DocumentFile, FileError};
use inkfinite_core::proto::{Bounds, PROTOCOL_ID, PROTOCOL_VERSION, Query, RecordId};
use inkfinite_core::{
    ActorId, DocumentId, INKFINITE_FORMAT_ID, INKFINITE_FORMAT_VERSION, LayerId, PageId, blank_document,
    builtin_shape_kinds,
};
use serde_json::{Value, json};

const ACTOR_ID: &str = "actor:inkfinite-cli";
const EXIT_INPUT: i32 = 3;
const EXIT_INVALID: i32 = 4;
const EXIT_CONFLICT: i32 = 5;

const DOCUMENT_SCHEMA: &str = include_str!("../../../../schemas/document-snapshot.schema.json");
const TRANSACTION_SCHEMA: &str = include_str!("../../../../schemas/transaction-draft.schema.json");
const PROTOCOL_REQUEST_SCHEMA: &str = include_str!("../../../../schemas/protocol-request.schema.json");
const PROTOCOL_RESPONSE_SCHEMA: &str = include_str!("../../../../schemas/protocol-response.schema.json");
const PROTOCOL_ERROR_SCHEMA: &str = include_str!("../../../../schemas/protocol-error.schema.json");

#[derive(Debug, Parser)]
#[command(
    name = "inkfinite",
    version,
    about = "Work with Inkfinite documents from the command line",
    long_about = "Create, inspect, query, and validate canonical Inkfinite documents while the desktop app is closed."
)]
#[command(after_help = "Examples:
  inkfinite new architecture.inkfinite
  inkfinite inspect architecture.inkfinite --json

Documentation: https://github.com/stormlightlabs/inkfinite#file-mode-cli
Report issues: https://github.com/stormlightlabs/inkfinite/issues

Exit codes:

0  Success
2  Invalid command usage
3  File or input error
4  Invalid document or data
5  Existing file, lock, or state conflict
")]
struct Cli {
    /// Disable interactive behavior. File-mode commands never prompt.
    #[arg(long, global = true, help_heading = "Global options")]
    non_interactive: bool,

    /// Write deterministic machine-readable JSON to stdout where supported.
    #[arg(long, global = true, help_heading = "Global options")]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Create a blank canonical document.
    #[command(after_help = "Examples:

    inkfinite new architecture.inkfinite
    inkfinite new system-map.inkfinite --document-id document:system-map --page-name Architecture
")]
    New(NewArgs),
    /// Print a materialized document snapshot or summary.
    #[command(after_help = "Examples:

    inkfinite inspect architecture.inkfinite
    inkfinite inspect architecture.inkfinite --json
")]
    Inspect(FileOutputArgs),
    /// Find records using semantic, hierarchy, kind, and bounds filters.
    #[command(after_help = "Examples:

    inkfinite query architecture.inkfinite --role architecture.service --json
    inkfinite query architecture.inkfinite --kind rect --bounds 0,0,1920,1080
")]
    Query(QueryArgs),
    /// Load and validate a canonical document.
    #[command(after_help = "Examples:

    inkfinite validate architecture.inkfinite
    inkfinite validate architecture.inkfinite --json
")]
    Validate(FileOutputArgs),
    /// Print a checked-in generated JSON Schema.
    #[command(after_help = "Examples:

    inkfinite schema document
    inkfinite schema protocol
")]
    Schema(SchemaArgs),
    /// Report the stable file-mode command contract.
    #[command(after_help = "Examples:

    inkfinite capabilities
    inkfinite capabilities --json
")]
    Capabilities,
}

#[derive(Debug, Args)]
struct NewArgs {
    /// Destination for the new canonical document.
    #[arg(value_name = "FILE")]
    path: PathBuf,

    /// Stable document ID. Defaults to one derived from the filename.
    #[arg(long, value_name = "ID")]
    document_id: Option<String>,

    /// Name of the initial page.
    #[arg(long, value_name = "NAME")]
    page_name: Option<String>,
}

#[derive(Debug, Args)]
struct FileOutputArgs {
    /// Canonical .inkfinite document to read.
    #[arg(value_name = "FILE")]
    path: PathBuf,
}

#[derive(Debug, Args)]
struct QueryArgs {
    /// Canonical .inkfinite document to query.
    #[arg(value_name = "FILE")]
    path: PathBuf,

    /// Match an exact record ID.
    #[arg(long)]
    id: Option<String>,
    /// Match an exact display name.
    #[arg(long)]
    name: Option<String>,
    /// Match an exact semantic role.
    #[arg(long)]
    role: Option<String>,
    /// Match one exact semantic tag.
    #[arg(long)]
    tag: Option<String>,
    /// Match an exact shape registry key.
    #[arg(long = "kind")]
    shape_kind: Option<String>,
    /// Restrict results to a page.
    #[arg(long)]
    page: Option<String>,
    /// Restrict results to a layer.
    #[arg(long)]
    layer: Option<String>,
    /// Restrict shapes to one direct parent.
    #[arg(long)]
    parent: Option<String>,
    /// Restrict shapes to bounds formatted as x,y,width,height.
    #[arg(long, value_name = "X,Y,WIDTH,HEIGHT", value_parser = parse_bounds)]
    bounds: Option<Bounds>,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum SchemaKind {
    Document,
    Transaction,
    Protocol,
    ProtocolRequest,
    ProtocolResponse,
    ProtocolError,
}

#[derive(Debug, Args)]
struct SchemaArgs {
    /// Contract to print.
    #[arg(value_enum, value_name = "KIND")]
    kind: SchemaKind,
}

#[derive(Debug)]
struct CliError {
    exit_code: i32,
    source: Error,
}

impl CliError {
    fn new(exit_code: i32, source: impl Into<Error>) -> Self {
        Self { exit_code, source: source.into() }
    }

    fn context(self, message: impl std::fmt::Display + Send + Sync + 'static) -> Self {
        Self { exit_code: self.exit_code, source: self.source.context(message) }
    }
}

fn main() {
    let cli = Cli::parse();
    let mut stdout = io::stdout().lock();
    if let Err(error) = run(cli.command, cli.json, &mut stdout) {
        eprintln!("inkfinite: {:#}", error.source);
        std::process::exit(error.exit_code);
    }
}

fn run(command: Command, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    match command {
        Command::New(args) => create_document(args, json_output, stdout),
        Command::Inspect(args) => inspect_document(&args, json_output, stdout),
        Command::Query(args) => query_document(args, json_output, stdout),
        Command::Validate(args) => validate_file(&args, json_output, stdout),
        Command::Schema(args) => print_schema(args.kind, stdout),
        Command::Capabilities => print_capabilities(json_output, stdout),
    }
}

fn create_document(args: NewArgs, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let document_id = DocumentId::from(args.document_id.unwrap_or_else(|| default_document_id(&args.path)));
    if document_id.as_str().trim().is_empty() {
        return Err(CliError::new(EXIT_INVALID, anyhow!("document ID must not be empty")));
    }
    let actor_id = ActorId::from(ACTOR_ID);
    let document = blank_document(&document_id, args.page_name.as_deref());
    let mut file = DocumentFile::create(&args.path, document_id.clone(), actor_id, document)
        .map_err(map_file_error)
        .map_err(|error| error.context(format!("could not create {}", portable_path(&args.path))))?;
    let snapshot = file.snapshot().map_err(map_file_error)?;

    if json_output {
        write_json(
            stdout,
            &json!({
                "document_id": document_id,
                "heads": snapshot.heads,
                "path": portable_path(&args.path),
            }),
        )
    } else {
        writeln!(stdout, "Created {} ({document_id})", portable_path(&args.path)).map_err(map_output_error)?;
        write_heads(stdout, &snapshot.heads)
    }
}

fn inspect_document(args: &FileOutputArgs, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let mut file = open_document(&args.path)?;
    let snapshot = file.snapshot().map_err(map_file_error)?;
    if json_output {
        return write_json(stdout, &snapshot);
    }

    writeln!(stdout, "Document: {}", snapshot.document_id).map_err(map_output_error)?;
    writeln!(stdout, "Format: {} {}", snapshot.format, snapshot.format_version).map_err(map_output_error)?;
    write_heads(stdout, &snapshot.heads)?;
    writeln!(stdout, "Pages: {}", snapshot.document.pages.len()).map_err(map_output_error)?;
    writeln!(stdout, "Layers: {}", snapshot.document.layers.len()).map_err(map_output_error)?;
    writeln!(stdout, "Shapes: {}", snapshot.document.shapes.len()).map_err(map_output_error)?;
    writeln!(stdout, "Bindings: {}", snapshot.document.bindings.len()).map_err(map_output_error)?;
    writeln!(stdout, "Assets: {}", snapshot.document.assets.len()).map_err(map_output_error)
}

fn query_document(args: QueryArgs, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let mut file = open_document(&args.path)?;
    let query = Query {
        id: args.id,
        name: args.name,
        role: args.role,
        tag: args.tag,
        shape_kind: args.shape_kind,
        page_id: args.page.map(PageId::from),
        layer_id: args.layer.map(LayerId::from),
        parent_id: args.parent,
        bounds: args.bounds,
    };
    let result = file
        .engine_mut()
        .query(&query)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not query document"))?;
    if json_output {
        return write_json(stdout, &result);
    }

    write_heads(stdout, &result.heads)?;
    writeln!(stdout, "Matches: {}", result.records.len()).map_err(map_output_error)?;
    for record in &result.records {
        match record {
            RecordId::Page(id) => writeln!(stdout, "page\t{id}"),
            RecordId::Layer(id) => writeln!(stdout, "layer\t{id}"),
            RecordId::Shape(id) => {
                let bounds = result.bounds.get(id);
                if let Some(bounds) = bounds {
                    writeln!(
                        stdout,
                        "shape\t{id}\t{},{},{},{}",
                        bounds.x, bounds.y, bounds.width, bounds.height
                    )
                } else {
                    writeln!(stdout, "shape\t{id}")
                }
            }
            RecordId::Binding(id) => writeln!(stdout, "binding\t{id}"),
            RecordId::Asset(id) => writeln!(stdout, "asset\t{id}"),
        }
        .map_err(map_output_error)?;
    }
    Ok(())
}

fn validate_file(args: &FileOutputArgs, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let mut file = open_document(&args.path)?;
    let snapshot = file.snapshot().map_err(map_file_error)?;
    validate_document(&snapshot.document)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("document validation failed"))?;
    if json_output {
        write_json(stdout, &json!({ "heads": snapshot.heads, "valid": true }))
    } else {
        writeln!(stdout, "Valid: {}", portable_path(&args.path)).map_err(map_output_error)?;
        write_heads(stdout, &snapshot.heads)
    }
}

fn print_schema(kind: SchemaKind, stdout: &mut dyn Write) -> Result<(), CliError> {
    match kind {
        SchemaKind::Document => stdout.write_all(DOCUMENT_SCHEMA.as_bytes()).map_err(map_output_error),
        SchemaKind::Transaction => stdout
            .write_all(TRANSACTION_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::ProtocolRequest => stdout
            .write_all(PROTOCOL_REQUEST_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::ProtocolResponse => stdout
            .write_all(PROTOCOL_RESPONSE_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::ProtocolError => stdout
            .write_all(PROTOCOL_ERROR_SCHEMA.as_bytes())
            .map_err(map_output_error),
        SchemaKind::Protocol => {
            let request: Value = serde_json::from_str(PROTOCOL_REQUEST_SCHEMA).map_err(map_json_error)?;
            let response: Value = serde_json::from_str(PROTOCOL_RESPONSE_SCHEMA).map_err(map_json_error)?;
            let error: Value = serde_json::from_str(PROTOCOL_ERROR_SCHEMA).map_err(map_json_error)?;
            write_json(
                stdout,
                &json!({ "error": error, "request": request, "response": response }),
            )
        }
    }
}

fn print_capabilities(json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    let capabilities = json!({
        "commands": ["new", "inspect", "query", "validate", "schema", "capabilities"],
        "exit_codes": {
            "conflict": EXIT_CONFLICT,
            "input": EXIT_INPUT,
            "invalid": EXIT_INVALID,
            "success": 0,
            "usage": 2
        },
        "file_mode": true,
        "format": { "id": INKFINITE_FORMAT_ID, "version": INKFINITE_FORMAT_VERSION },
        "global_options": ["--json", "--non-interactive"],
        "json_stdout_is_machine_only": true,
        "path_format": "forward_slashes",
        "protocol": { "id": PROTOCOL_ID, "version": PROTOCOL_VERSION },
        "query_filters": ["id", "name", "role", "tag", "kind", "page", "layer", "parent", "bounds"],
        "schemas": ["document", "transaction", "protocol", "protocol-request", "protocol-response", "protocol-error"],
        "shape_kinds": builtin_shape_kinds()
    });
    if json_output {
        return write_json(stdout, &capabilities);
    }

    writeln!(stdout, "File mode: supported").map_err(map_output_error)?;
    writeln!(
        stdout,
        "Document format: {INKFINITE_FORMAT_ID} {INKFINITE_FORMAT_VERSION}"
    )
    .map_err(map_output_error)?;
    writeln!(stdout, "Commands: new, inspect, query, validate, schema, capabilities").map_err(map_output_error)?;
    writeln!(stdout, "Global options: --json, --non-interactive").map_err(map_output_error)?;
    writeln!(stdout, "Schemas: document, transaction, protocol").map_err(map_output_error)?;
    writeln!(stdout, "JSON: machine data on stdout; diagnostics on stderr").map_err(map_output_error)
}

fn open_document(path: &Path) -> Result<DocumentFile, CliError> {
    DocumentFile::open(path, ActorId::from(ACTOR_ID))
        .map_err(map_file_error)
        .map_err(|error| error.context(format!("could not open {}", portable_path(path))))
}

fn default_document_id(path: &Path) -> String {
    let displayed = portable_path(path);
    let filename = displayed.rsplit('/').next().unwrap_or("document");
    let stem = filename.strip_suffix(".inkfinite").unwrap_or(filename);
    let normalized: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() { "document:untitled".into() } else { format!("document:{normalized}") }
}

fn portable_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn parse_bounds(value: &str) -> Result<Bounds, String> {
    let values = value
        .split(',')
        .map(str::trim)
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "bounds must contain four numbers: x,y,width,height".to_owned())?;
    let [x, y, width, height] = values.as_slice() else {
        return Err("bounds must contain four numbers: x,y,width,height".into());
    };
    if !values.iter().all(|number| number.is_finite()) || *width < 0.0 || *height < 0.0 {
        return Err("bounds must be finite and width and height must be non-negative".into());
    }
    Ok(Bounds { x: *x, y: *y, width: *width, height: *height })
}

fn write_heads(stdout: &mut dyn Write, heads: &[inkfinite_core::ChangeHash]) -> Result<(), CliError> {
    writeln!(
        stdout,
        "Heads: {}",
        heads
            .iter()
            .map(inkfinite_core::ChangeHash::as_str)
            .collect::<Vec<_>>()
            .join(",")
    )
    .map_err(map_output_error)
}

fn write_json(stdout: &mut dyn Write, value: &impl serde::Serialize) -> Result<(), CliError> {
    serde_json::to_writer_pretty(&mut *stdout, value).map_err(map_json_error)?;
    writeln!(stdout).map_err(map_output_error)
}

fn map_file_error(error: FileError) -> CliError {
    let exit_code = match &error {
        FileError::AlreadyExists { .. } | FileError::Locked { .. } | FileError::SamePath { .. } => EXIT_CONFLICT,
        FileError::Io { .. } | FileError::RecoveryNotFound { .. } => EXIT_INPUT,
        _ => EXIT_INVALID,
    };
    CliError::new(exit_code, error)
}

fn map_json_error(error: serde_json::Error) -> CliError {
    let exit_code = if error.is_io() { EXIT_INPUT } else { EXIT_INVALID };
    CliError::new(exit_code, error).context("could not write JSON output")
}

fn map_output_error(error: io::Error) -> CliError {
    CliError::new(EXIT_INPUT, error).context("could not write stdout")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_output_is_stable_for_unix_and_windows_conventions() {
        assert_eq!(
            portable_path(Path::new("boards/system.inkfinite")),
            "boards/system.inkfinite"
        );
        assert_eq!(
            portable_path(Path::new(r"boards\system.inkfinite")),
            "boards/system.inkfinite"
        );
        assert_eq!(
            default_document_id(Path::new(r"C:\boards\System Map.inkfinite")),
            "document:system-map"
        );
    }

    #[test]
    fn bounds_require_four_finite_values_and_non_negative_size() {
        assert_eq!(
            parse_bounds("1,2,3,4").unwrap(),
            Bounds { x: 1.0, y: 2.0, width: 3.0, height: 4.0 }
        );
        assert!(parse_bounds("1,2,-3,4").is_err());
        assert!(parse_bounds("1,2,3").is_err());
        assert!(parse_bounds("1,2,NaN,4").is_err());
    }
}
