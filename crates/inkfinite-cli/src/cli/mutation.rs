use super::support::{map_file_error, map_output_error, portable_path, write_heads, write_json};
use super::{
    BTreeSet, CliError, DocumentFile, DocumentSnapshot, EXIT_INPUT, EXIT_INVALID, LayoutSelectionArgs, MutationOptions,
    Operation, Origin, Path, RecordId, Result, Serialize, ShapeId, Timestamp, TransactionDraft, TransactionId, Write,
    anyhow, fs, io,
};
use inkfinite_core::Document;
use inkfinite_core::proto::SessionId;
use inkfinite_core::session::SessionStatus;

/// Closed-file or live-session state used to build one structured transaction.
pub enum StructuredMutationTarget {
    File(Box<DocumentFile>),
    App {
        session_id: SessionId,
        status: Box<SessionStatus>,
    },
}

impl StructuredMutationTarget {
    /// Resolves exactly one file or desktop session target.
    pub fn open(path: Option<&Path>, options: &MutationOptions) -> Result<Self> {
        if options.app {
            if path.is_some() {
                return Err(CliError::new(EXIT_INVALID, anyhow!("omit FILE when using --app"))
                    .with_code("ambiguous_mutation_target"));
            }
            if options.dry_run || options.transaction_out.is_some() {
                return Err(CliError::new(
                    EXIT_INVALID,
                    anyhow!("--app cannot be combined with --dry-run or --transaction-out"),
                )
                .with_code("invalid_mutation_target_options"));
            }
            let status = super::app::resolve_session_status(options.session_id.clone())?;
            return Ok(Self::App { session_id: status.session_id.clone(), status: Box::new(status) });
        }
        let path = path.ok_or_else(|| {
            CliError::new(EXIT_INVALID, anyhow!("FILE is required unless --app is used"))
                .with_code("mutation_target_required")
        })?;
        Ok(Self::File(Box::new(super::support::open_document(path)?)))
    }

    /// Returns the actor that owns the target mutation stream.
    pub fn actor_id(&self) -> inkfinite_core::ActorId {
        match self {
            Self::File(file) => file.actor_id().clone(),
            Self::App { status, .. } => status.actor_id.clone(),
        }
    }

    /// Returns the document state used for selectors and generated IDs.
    pub fn snapshot(&mut self) -> Result<DocumentSnapshot> {
        match self {
            Self::File(file) => file.snapshot().map_err(map_file_error),
            Self::App { status, .. } => Ok(status.snapshot.clone()),
        }
    }

    /// Builds an agent transaction against the target's current heads and actor.
    pub fn transaction(
        &mut self, transaction_id: Option<String>, mut default_id: String, description: String, ops: Vec<Operation>,
    ) -> Result<TransactionDraft> {
        let (actor_id, base_heads) = match self {
            Self::File(file) => (file.actor_id().clone(), file.heads().map_err(map_file_error)?),
            Self::App { status, .. } => (status.actor_id.clone(), status.snapshot.heads.clone()),
        };
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
            actor_id,
            origin: Origin::Agent,
            base_heads,
            description,
            operations: ops,
            timestamp: Timestamp(0),
        })
    }

    /// Applies a file mutation or submits a live edit using the desktop access mode.
    pub fn finish(
        self, transaction: TransactionDraft, options: &MutationOptions, json_output: bool, stdout: &mut dyn Write,
    ) -> Result<()> {
        self.finish_with_warnings(transaction, options, json_output, stdout, Vec::new())
    }

    /// Applies a mutation while retaining non-fatal import diagnostics in file-mode output.
    pub fn finish_with_warnings(
        self, transaction: TransactionDraft, options: &MutationOptions, json_output: bool, stdout: &mut dyn Write,
        warnings: Vec<String>,
    ) -> Result<()> {
        match self {
            Self::File(mut file) => commit_mutation(
                &mut file,
                transaction,
                options.dry_run,
                options.transaction_out.as_deref(),
                warnings,
                json_output,
                stdout,
            ),
            Self::App { session_id, .. } => {
                super::app::mutate_transaction(transaction, Some(session_id), json_output, stdout)
            }
        }
    }
}

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
    transaction_output: Option<String>,
}

pub fn commit_mutation(
    file: &mut DocumentFile, transaction: TransactionDraft, dry_run: bool, transaction_output: Option<&Path>,
    warnings: Vec<String>, json_output: bool, stdout: &mut dyn Write,
) -> Result<()> {
    let transaction_json = transaction_output
        .map(|_| serde_json::to_vec_pretty(&transaction))
        .transpose()
        .map_err(|error| CliError::new(EXIT_INVALID, error).with_code("transaction_serialization_failed"))?;
    let previous_heads = file.heads().map_err(map_file_error)?;
    let commit = file.commit(transaction).map_err(|error| {
        let include_heads = matches!(
            &error,
            inkfinite_core::file::FileError::Engine(
                inkfinite_core::engine::EngineError::StaleHeads | inkfinite_core::engine::EngineError::Precondition(_)
            )
        );
        let diagnostic = map_file_error(error);
        if include_heads {
            diagnostic.with_details(serde_json::json!({ "current_heads": previous_heads }))
        } else {
            diagnostic
        }
    })?;
    let effective_dry_run = dry_run || transaction_output.is_some();
    if !effective_dry_run {
        file.save().map_err(map_file_error)?;
    }
    if let (Some(path), Some(mut bytes)) = (transaction_output, transaction_json) {
        bytes.push(b'\n');
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| {
                let code = if error.kind() == io::ErrorKind::AlreadyExists {
                    "transaction_output_exists"
                } else {
                    "transaction_output_error"
                };
                CliError::new(
                    if error.kind() == io::ErrorKind::AlreadyExists { super::EXIT_CONFLICT } else { EXIT_INPUT },
                    error,
                )
                .with_code(code)
                .context(format!("could not create transaction output {}", portable_path(path)))
            })?;
        output.write_all(&bytes).map_err(|error| {
            CliError::new(EXIT_INPUT, error)
                .with_code("transaction_output_error")
                .context(format!("could not write transaction output {}", portable_path(path)))
        })?;
    }
    let result = MutationResult {
        previous_heads,
        current_heads: commit.heads,
        transaction_id: commit.transaction_id,
        created: commit.patch.created,
        updated: commit.patch.changed,
        deleted: commit.patch.deleted,
        repairs: commit.warnings,
        warnings,
        dry_run: effective_dry_run,
        transaction_output: transaction_output.map(portable_path),
    };
    if json_output {
        write_json(stdout, &result)
    } else {
        writeln!(stdout, "Transaction: {}", result.transaction_id.0).map_err(map_output_error)?;
        writeln!(stdout, "Dry run: {}", result.dry_run).map_err(map_output_error)?;
        if let Some(path) = &result.transaction_output {
            writeln!(stdout, "Transaction output: {path}").map_err(map_output_error)?;
        }
        writeln!(stdout, "Created: {}", result.created.len()).map_err(map_output_error)?;
        writeln!(stdout, "Updated: {}", result.updated.len()).map_err(map_output_error)?;
        writeln!(stdout, "Deleted: {}", result.deleted.len()).map_err(map_output_error)?;
        for warning in &result.warnings {
            writeln!(stdout, "Warning: {warning}").map_err(map_output_error)?;
        }
        write_heads(stdout, &result.current_heads)
    }
}

pub fn select_unique_shape(
    document: &Document, shape_id: Option<&str>, name: Option<&str>, role: Option<&str>,
) -> Result<ShapeId> {
    let matches: Vec<ShapeId> = document
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

pub fn select_layout_shapes(document: &Document, selection: LayoutSelectionArgs) -> Result<Vec<ShapeId>> {
    let mut selected: BTreeSet<ShapeId> = selection.shape_ids.into_iter().map(ShapeId::from).collect();
    if let Some(role) = selection.role {
        selected.extend(
            document
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
        if !document.shapes.contains_key(shape_id) {
            return Err(CliError::new(EXIT_INVALID, anyhow!("shape {shape_id} does not exist")));
        }
    }
    Ok(selected.into_iter().collect())
}

pub fn read_json_argument(argument: &str, description: &str) -> Result<String> {
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
