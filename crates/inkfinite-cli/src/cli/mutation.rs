use super::support::{map_file_error, map_output_error, portable_path, write_heads, write_json};
use super::{
    ACTOR_ID, ActorId, BTreeSet, CliError, DocumentFile, EXIT_INPUT, EXIT_INVALID, LayoutSelectionArgs, Operation,
    Origin, Path, RecordId, Serialize, ShapeId, Timestamp, TransactionDraft, TransactionId, Write, anyhow, fs,
};

#[derive(Serialize)]
struct MutationResult {
    previous_heads: Vec<inkfinite_core::ChangeHash>,
    current_heads: Vec<inkfinite_core::ChangeHash>,
    transaction_id: TransactionId,
    created: Vec<RecordId>,
    updated: Vec<RecordId>,
    deleted: Vec<RecordId>,
    repairs: Vec<inkfinite_core::proto::Warning>,
    warnings: Vec<String>,
    dry_run: bool,
}

pub fn structured_transaction(
    file: &mut DocumentFile, transaction_id: Option<String>, mut default_id: String, description: String,
    operations: Vec<Operation>,
) -> Result<TransactionDraft, CliError> {
    let base_heads = file.heads().map_err(map_file_error)?;
    let transaction_id = transaction_id.unwrap_or_else(|| {
        let head_suffix = base_heads
            .iter()
            .map(inkfinite_core::ChangeHash::as_str)
            .collect::<Vec<_>>()
            .join(".");
        default_id.push(':');
        default_id.push_str(&head_suffix);
        default_id
    });
    Ok(TransactionDraft {
        id: TransactionId(transaction_id),
        actor_id: ActorId::from(ACTOR_ID),
        origin: Origin::Agent,
        base_heads,
        description,
        operations,
        timestamp: Timestamp(0),
    })
}

pub fn commit_mutation(
    file: &mut DocumentFile, transaction: TransactionDraft, dry_run: bool, json_output: bool, stdout: &mut dyn Write,
) -> Result<(), CliError> {
    let previous_heads = file.heads().map_err(map_file_error)?;
    let commit = file.commit(transaction).map_err(map_file_error)?;
    if !dry_run {
        file.save().map_err(map_file_error)?;
    }
    let result = MutationResult {
        previous_heads,
        current_heads: commit.heads,
        transaction_id: commit.transaction_id,
        created: commit.patch.created,
        updated: commit.patch.changed,
        deleted: commit.patch.deleted,
        repairs: commit.warnings,
        warnings: Vec::new(),
        dry_run,
    };
    if json_output {
        write_json(stdout, &result)
    } else {
        writeln!(stdout, "Transaction: {}", result.transaction_id.0).map_err(map_output_error)?;
        writeln!(stdout, "Dry run: {}", result.dry_run).map_err(map_output_error)?;
        writeln!(stdout, "Created: {}", result.created.len()).map_err(map_output_error)?;
        writeln!(stdout, "Updated: {}", result.updated.len()).map_err(map_output_error)?;
        writeln!(stdout, "Deleted: {}", result.deleted.len()).map_err(map_output_error)?;
        write_heads(stdout, &result.current_heads)
    }
}

pub fn select_unique_shape(
    file: &mut DocumentFile, shape_id: Option<&str>, name: Option<&str>, role: Option<&str>,
) -> Result<ShapeId, CliError> {
    let snapshot = file.snapshot().map_err(map_file_error)?;
    let matches: Vec<ShapeId> = snapshot
        .document
        .shapes
        .values()
        .filter(|shape| {
            shape_id.is_some_and(|id| shape.id.as_str() == id)
                || name.is_some_and(|value| shape.metadata.name.as_deref() == Some(value))
                || role.is_some_and(|value| shape.metadata.role.as_deref() == Some(value))
        })
        .map(|shape| shape.id.clone())
        .collect();
    match matches.as_slice() {
        [shape_id] => Ok(shape_id.clone()),
        [] => Err(CliError::new(
            EXIT_INVALID,
            anyhow!("shape selector matched no records"),
        )),
        _ => Err(CliError::new(
            EXIT_INVALID,
            anyhow!("shape selector matched {} records; use --shape-id", matches.len()),
        )),
    }
}

pub fn select_layout_shapes(
    file: &mut DocumentFile, selection: LayoutSelectionArgs,
) -> Result<Vec<ShapeId>, CliError> {
    let snapshot = file.snapshot().map_err(map_file_error)?;
    let mut selected: BTreeSet<ShapeId> = selection.shape_ids.into_iter().map(ShapeId::from).collect();
    if let Some(role) = selection.role {
        selected.extend(
            snapshot
                .document
                .shapes
                .values()
                .filter(|shape| shape.metadata.role.as_deref() == Some(role.as_str()))
                .map(|shape| shape.id.clone()),
        );
    }
    if selected.is_empty() {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("layout requires --shape or --role selectors"),
        ));
    }
    for shape_id in &selected {
        if !snapshot.document.shapes.contains_key(shape_id) {
            return Err(CliError::new(EXIT_INVALID, anyhow!("shape {shape_id} does not exist")));
        }
    }
    Ok(selected.into_iter().collect())
}

pub fn read_json_argument(argument: &str, description: &str) -> Result<String, CliError> {
    let Some(path) = argument.strip_prefix('@') else {
        return Ok(argument.to_owned());
    };
    fs::read_to_string(path).map_err(|error| {
        CliError::new(EXIT_INPUT, error).context(format!(
            "could not read {description} {}",
            portable_path(Path::new(path))
        ))
    })
}
