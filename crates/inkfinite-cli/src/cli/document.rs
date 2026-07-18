use super::support::{
    default_document_id, map_file_error, map_output_error, open_document, portable_path, write_heads, write_json,
};
use super::{
    ACTOR_ID, ActorId, CliError, DocumentFile, DocumentId, EXIT_INVALID, FileOutputArgs, LayerId, NewArgs, PageId,
    Query, QueryArgs, RecordId, Result, Write, anyhow, blank_document, json, validate_document,
};

pub fn create_document(args: NewArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
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

pub fn inspect_document(args: &FileOutputArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
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

pub fn query_document(args: QueryArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
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

pub fn validate_file(args: &FileOutputArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
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
