//! Commands for inspecting and focusing a running desktop app.

use inkfinite_core::ipc::{self, AppRequest, AppResponse, IpcError, UiControl};
use inkfinite_core::proto::{Query, RecordId, SessionId};
use inkfinite_core::{LayerId, PageId, ShapeId};

use super::apply::read_transaction;
use super::args::{AppApplyArgs, AppCommand, AppInspectArgs, AppQueryArgs, AppRenderArgs, AppUiArgs};
use super::render::render_output_bytes;
use super::support::{map_output_error, portable_path, write_heads, write_json};
use super::{CliError, EXIT_CONFLICT, EXIT_INPUT, EXIT_INVALID, Result, Write, anyhow, fs, json};

/// Runs one authenticated desktop command.
pub fn run_app_command(command: AppCommand, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        AppCommand::Status => status(json_output, stdout),
        AppCommand::Context(args) => context(args, json_output, stdout),
        AppCommand::Inspect(args) => inspect(args, json_output, stdout),
        AppCommand::Query(args) => query(args, json_output, stdout),
        AppCommand::Render(args) => render(args, json_output, stdout),
        AppCommand::Ui(args) => control_ui(args, json_output, stdout),
        AppCommand::Apply(args) => apply(args, json_output, stdout),
        AppCommand::Focus => focus(json_output, stdout),
    }
}

fn context(args: AppInspectArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let response = send(AppRequest::Context { session_id: args.session_id.map(SessionId) })?;
    let AppResponse::Context(context) = response else {
        return unexpected_response("context");
    };
    if json_output {
        return write_json(stdout, &context);
    }
    writeln!(stdout, "Session: {}", context.session_id.0).map_err(map_output_error)?;
    writeln!(
        stdout,
        "Page: {}",
        context.page_id.as_ref().map_or("none", PageId::as_str)
    )
    .map_err(map_output_error)?;
    writeln!(
        stdout,
        "Active layer: {}",
        context.active_layer_id.as_ref().map_or("none", LayerId::as_str)
    )
    .map_err(map_output_error)?;
    writeln!(stdout, "Selection: {}", context.selection_ids.len()).map_err(map_output_error)?;
    if let Some(viewport) = context.viewport {
        writeln!(
            stdout,
            "Viewport: {},{},{},{}",
            viewport.x, viewport.y, viewport.width, viewport.height
        )
        .map_err(map_output_error)?;
    }
    if let Some(camera) = context.camera {
        writeln!(stdout, "Camera: {},{},{}", camera.x, camera.y, camera.zoom).map_err(map_output_error)?;
    }
    writeln!(stdout, "Occluded regions: {}", context.occluded_regions.len()).map_err(map_output_error)?;
    write_heads(stdout, &context.heads)
}

fn render(args: AppRenderArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let transaction = args.transaction.as_deref().map(read_transaction).transpose()?;
    let response = send(AppRequest::Render {
        session_id: args.session_id.map(SessionId),
        transaction,
        page_id: args.page.map(PageId::from),
        region: args.region,
    })?;
    let AppResponse::Rendered(rendered) = response else {
        return unexpected_response("render");
    };
    write_render_output(&args.output, &rendered.current_svg)?;
    if let (Some(path), Some(svg)) = (args.proposed_output.as_deref(), rendered.proposed_svg.as_deref()) {
        write_render_output(path, svg)?;
    }
    if json_output {
        write_json(
            stdout,
            &json!({
                "heads": rendered.heads,
                "current_output": portable_path(&args.output),
                "proposed_output": args.proposed_output.as_deref().map(portable_path),
                "preview": rendered.preview,
                "affected_regions": rendered.affected_regions,
                "warnings": rendered.warnings,
            }),
        )
    } else {
        writeln!(stdout, "Rendered {}", portable_path(&args.output)).map_err(map_output_error)?;
        if let Some(path) = args.proposed_output {
            writeln!(stdout, "Rendered proposed {}", portable_path(&path)).map_err(map_output_error)?;
        }
        Ok(())
    }
}

fn write_render_output(path: &std::path::Path, svg: &str) -> Result<()> {
    let bytes = render_output_bytes(path, svg)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            CliError::new(
                if error.kind() == std::io::ErrorKind::AlreadyExists { EXIT_CONFLICT } else { EXIT_INPUT },
                error,
            )
            .with_code("render_output_error")
            .context(format!("could not create {}", portable_path(path)))
        })?;
    file.write_all(&bytes).map_err(|error| {
        CliError::new(EXIT_INPUT, error)
            .with_code("render_output_error")
            .context(format!("could not write {}", portable_path(path)))
    })
}

fn control_ui(args: AppUiArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let selection_ids = if args.clear_selection {
        Some(Vec::new())
    } else if args.selection.is_empty() {
        None
    } else {
        Some(args.selection.into_iter().map(ShapeId::from).collect())
    };
    let control = UiControl {
        page_id: args.page.map(PageId::from),
        active_layer_id: args.layer.map(LayerId::from),
        selection_ids,
        camera: args.camera,
    };
    let response = send(AppRequest::Ui { session_id: args.session_id.map(SessionId), control })?;
    if !matches!(response, AppResponse::UiControlled) {
        return unexpected_response("ui");
    }
    if json_output {
        write_json(stdout, &json!({ "controlled": true }))
    } else {
        writeln!(stdout, "Desktop UI updated").map_err(map_output_error)
    }
}

fn status(json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let response = send(AppRequest::Status)?;
    let AppResponse::Status(statuses) = response else {
        return unexpected_response("status");
    };
    if json_output {
        return write_json(stdout, &statuses);
    }

    writeln!(stdout, "Open sessions: {}", statuses.len()).map_err(map_output_error)?;
    for status in statuses {
        writeln!(
            stdout,
            "session\t{}\t{}\t{}",
            status.session_id.0,
            status.path.0,
            if status.dirty { "dirty" } else { "saved" }
        )
        .map_err(map_output_error)?;
        write_heads(stdout, &status.snapshot.heads)?;
    }
    Ok(())
}

fn inspect(args: AppInspectArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let response = send(AppRequest::Inspect { session_id: args.session_id.map(inkfinite_core::proto::SessionId) })?;
    let AppResponse::Snapshot(snapshot) = response else {
        return unexpected_response("inspect");
    };
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

fn query(args: AppQueryArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
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
        include_records: args.detail,
        limit: args.limit,
    };
    let response =
        send(AppRequest::Query { session_id: args.session_id.map(inkfinite_core::proto::SessionId), query })?;
    let AppResponse::QueryResult(result) = response else {
        return unexpected_response("query");
    };
    if json_output {
        return write_json(stdout, &result);
    }

    write_heads(stdout, &result.heads)?;
    writeln!(stdout, "Matches: {} of {}", result.records.len(), result.total).map_err(map_output_error)?;
    if result.truncated {
        writeln!(stdout, "Truncated: true").map_err(map_output_error)?;
    }
    for record in result.records {
        match record {
            RecordId::Page(id) => writeln!(stdout, "page\t{id}"),
            RecordId::Layer(id) => writeln!(stdout, "layer\t{id}"),
            RecordId::Shape(id) => match result.bounds.get(&id) {
                Some(bounds) => writeln!(
                    stdout,
                    "shape\t{id}\t{},{},{},{}",
                    bounds.x, bounds.y, bounds.width, bounds.height
                ),
                None => writeln!(stdout, "shape\t{id}"),
            },
            RecordId::Binding(id) => writeln!(stdout, "binding\t{id}"),
            RecordId::Asset(id) => writeln!(stdout, "asset\t{id}"),
        }
        .map_err(map_output_error)?;
    }
    Ok(())
}

fn focus(json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let response = send(AppRequest::Focus)?;
    if !matches!(response, AppResponse::Focused) {
        return unexpected_response("focus");
    }
    if json_output {
        write_json(stdout, &json!({ "focused": true }))
    } else {
        writeln!(stdout, "Desktop focus requested").map_err(map_output_error)
    }
}

/// Submits and applies a structured edit to the desktop session.
pub fn mutate_transaction(
    transaction: inkfinite_core::proto::TransactionDraft, session_id: Option<SessionId>, json_output: bool,
    stdout: &mut dyn Write,
) -> Result<()> {
    let response = send(AppRequest::Apply { session_id, transaction })?;
    let AppResponse::Committed(commit) = response else {
        return unexpected_response("apply");
    };
    write_commit(&commit, json_output, stdout)
}

fn apply(args: AppApplyArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let transaction = read_transaction(&args.transaction)?;
    let session_id = resolve_session_id(args.session_id)?;
    let response = send(AppRequest::Apply { session_id: Some(session_id), transaction })?;
    let AppResponse::Committed(commit) = response else {
        return unexpected_response("apply");
    };
    write_commit(&commit, json_output, stdout)
}

fn resolve_session_id(session_id: Option<String>) -> Result<SessionId> {
    if let Some(session_id) = session_id {
        return Ok(SessionId(session_id));
    }
    Ok(resolve_session_status(None)?.session_id)
}

/// Resolves explicit session state or requires exactly one open session.
pub fn resolve_session_status(session_id: Option<String>) -> Result<inkfinite_core::session::SessionStatus> {
    let response = send(AppRequest::Status)?;
    let AppResponse::Status(statuses) = response else {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("desktop app returned an unexpected response for status"),
        ));
    };
    if let Some(session_id) = session_id {
        return statuses
            .into_iter()
            .find(|status| status.session_id.0 == session_id)
            .ok_or_else(|| {
                CliError::new(EXIT_INPUT, anyhow!("desktop session {session_id} is not open"))
                    .with_code("session_not_found")
            });
    }
    let [status] = statuses.as_slice() else {
        return Err(CliError::new(
            EXIT_INPUT,
            anyhow!("--session-id is required when the desktop has zero or multiple open sessions"),
        ));
    };
    Ok(status.clone())
}

fn write_commit(
    commit: &inkfinite_core::session::SessionCommit, json_output: bool, stdout: &mut dyn Write,
) -> Result<()> {
    if json_output {
        return write_json(stdout, commit);
    }
    writeln!(stdout, "Transaction: {}", commit.commit.transaction_id.0).map_err(map_output_error)?;
    write_heads(stdout, &commit.commit.heads)?;
    writeln!(stdout, "Created: {}", commit.commit.patch.created.len()).map_err(map_output_error)?;
    writeln!(stdout, "Changed: {}", commit.commit.patch.changed.len()).map_err(map_output_error)?;
    writeln!(stdout, "Deleted: {}", commit.commit.patch.deleted.len()).map_err(map_output_error)
}

fn send(request: AppRequest) -> Result<AppResponse> {
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|error| CliError::new(EXIT_INPUT, anyhow!(error)).context("could not start the IPC runtime"))?;
    let response = runtime.block_on(ipc::send(request)).map_err(map_ipc_error)?;
    response.result.map_err(|error| {
        let exit_code = match error.code.as_str() {
            "proposal_stale" | "proposal_conflict" | "stale_heads" | "actor_mismatch" | "document_engine_error" => {
                EXIT_CONFLICT
            }
            _ => EXIT_INVALID,
        };
        let retryable = matches!(
            error.code.as_str(),
            "proposal_stale"
                | "stale_heads"
                | "precondition_failed"
                | "session_selection_required"
                | "desktop_unavailable"
        );
        let mut diagnostic = CliError::new(exit_code, anyhow!(error.message)).with_code(error.code);
        if let Some(details) = error.details {
            diagnostic = diagnostic.with_details(details);
        }
        if retryable {
            diagnostic = diagnostic.retryable("Refresh desktop status and current heads before retrying.");
        }
        diagnostic
    })
}

fn map_ipc_error(error: IpcError) -> CliError {
    let exit_code = match &error {
        IpcError::FrameTooLarge { .. } | IpcError::DiscoveryTooLarge { .. } | IpcError::MalformedJson(_) => {
            EXIT_INVALID
        }
        IpcError::TruncatedFrame | IpcError::Unavailable(_) | IpcError::Io(_) => EXIT_INPUT,
    };
    CliError::new(exit_code, anyhow!(error))
        .with_code("desktop_unavailable")
        .retryable("Start Inkfinite Desktop, then retry the command.")
        .context("could not contact the running desktop app")
}

fn unexpected_response(command: &str) -> Result<()> {
    Err(CliError::new(
        EXIT_INVALID,
        anyhow!("desktop app returned an unexpected response for {command}"),
    ))
}
