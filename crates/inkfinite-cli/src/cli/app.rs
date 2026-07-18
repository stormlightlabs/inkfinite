//! Commands for inspecting and focusing a running desktop app.

use inkfinite_core::ipc::{self, AppRequest, AppResponse, IpcError};
use inkfinite_core::proto::{Query, RecordId};
use inkfinite_core::{LayerId, PageId};

use super::args::{AppCommand, AppInspectArgs, AppQueryArgs};
use super::support::{map_output_error, write_heads, write_json};
use super::{CliError, EXIT_INPUT, EXIT_INVALID, Result, Write, anyhow, json};

/// Runs one authenticated read-only desktop command.
pub fn run_app_command(command: AppCommand, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        AppCommand::Status => status(json_output, stdout),
        AppCommand::Inspect(args) => inspect(args, json_output, stdout),
        AppCommand::Query(args) => query(args, json_output, stdout),
        AppCommand::Focus => focus(json_output, stdout),
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
    writeln!(stdout, "Matches: {}", result.records.len()).map_err(map_output_error)?;
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

fn send(request: AppRequest) -> Result<AppResponse> {
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|error| CliError::new(EXIT_INPUT, anyhow!(error)).context("could not start the IPC runtime"))?;
    let response = runtime.block_on(ipc::send(request)).map_err(map_ipc_error)?;
    response
        .result
        .map_err(|error| CliError::new(EXIT_INVALID, anyhow!("[{}] {}", error.code, error.message)))
}

fn map_ipc_error(error: IpcError) -> CliError {
    let exit_code = match &error {
        IpcError::FrameTooLarge { .. } | IpcError::DiscoveryTooLarge { .. } | IpcError::MalformedJson(_) => {
            EXIT_INVALID
        }
        IpcError::TruncatedFrame | IpcError::Unavailable(_) | IpcError::Io(_) => EXIT_INPUT,
    };
    CliError::new(exit_code, anyhow!(error)).context("could not contact the running desktop app")
}

fn unexpected_response(command: &str) -> Result<()> {
    Err(CliError::new(
        EXIT_INVALID,
        anyhow!("desktop app returned an unexpected response for {command}"),
    ))
}
