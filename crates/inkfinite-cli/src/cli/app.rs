//! Commands for inspecting and focusing a running desktop app.

use inkfinite_core::ipc::{self, AppRequest, AppResponse, IpcError};
use inkfinite_core::proto::{ApplyAuthorization, ProposalId, Query, RecordId, SessionId};
use inkfinite_core::{LayerId, PageId};

use super::apply::read_transaction;
use super::args::{
    AppAcceptArgs, AppApplyArgs, AppCommand, AppInspectArgs, AppProposeArgs, AppQueryArgs, AppRejectArgs,
};
use super::support::{map_output_error, write_heads, write_json};
use super::{CliError, EXIT_CONFLICT, EXIT_INPUT, EXIT_INVALID, Result, Write, anyhow, json};

/// Runs one authenticated read-only desktop command.
pub fn run_app_command(command: AppCommand, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        AppCommand::Status => status(json_output, stdout),
        AppCommand::Inspect(args) => inspect(args, json_output, stdout),
        AppCommand::Query(args) => query(args, json_output, stdout),
        AppCommand::Propose(args) => propose(args, json_output, stdout),
        AppCommand::Accept(args) => accept(args, json_output, stdout),
        AppCommand::Reject(args) => reject(args, json_output, stdout),
        AppCommand::Apply(args) => apply(args, json_output, stdout),
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

fn propose(args: AppProposeArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let transaction = read_transaction(&args.transaction)?;
    let response = send(AppRequest::Propose { session_id: args.session_id.map(SessionId), transaction })?;
    let AppResponse::Proposal(proposal) = response else {
        return unexpected_response("propose");
    };
    if json_output {
        return write_json(stdout, &proposal);
    }
    writeln!(stdout, "Proposal: {}", proposal.id.0).map_err(map_output_error)?;
    write_heads(stdout, &proposal.transaction.base_heads)?;
    writeln!(stdout, "Created: {}", proposal.preview.created.len()).map_err(map_output_error)?;
    writeln!(stdout, "Changed: {}", proposal.preview.changed.len()).map_err(map_output_error)?;
    writeln!(stdout, "Deleted: {}", proposal.preview.deleted.len()).map_err(map_output_error)?;
    writeln!(stdout, "Affected regions: {}", proposal.affected_regions.len()).map_err(map_output_error)
}

fn accept(args: AppAcceptArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let operation_positions = (!args.operation_positions.is_empty()).then_some(args.operation_positions);
    let response = send(AppRequest::AcceptProposal {
        session_id: args.session_id.map(SessionId),
        proposal_id: ProposalId(args.proposal_id),
        operation_positions,
    })?;
    let AppResponse::Committed(commit) = response else {
        return unexpected_response("accept");
    };
    write_commit(&commit, json_output, stdout)
}

fn reject(args: AppRejectArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let response = send(AppRequest::RejectProposal {
        session_id: args.session_id.map(SessionId),
        proposal_id: ProposalId(args.proposal_id),
    })?;
    if !matches!(response, AppResponse::ProposalRejected) {
        return unexpected_response("reject");
    }
    if json_output {
        write_json(stdout, &json!({ "rejected": true }))
    } else {
        writeln!(stdout, "Proposal rejected").map_err(map_output_error)
    }
}

fn apply(args: AppApplyArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let transaction = read_transaction(&args.transaction)?;
    let session_id = resolve_session_id(args.session_id)?;
    let authorization = ApplyAuthorization {
        token: args.authorization,
        session_id: session_id.clone(),
        expires_at: inkfinite_core::Timestamp(0),
    };
    let response = send(AppRequest::Apply { session_id: Some(session_id), transaction, authorization })?;
    let AppResponse::Committed(commit) = response else {
        return unexpected_response("apply");
    };
    write_commit(&commit, json_output, stdout)
}

fn resolve_session_id(session_id: Option<String>) -> Result<SessionId> {
    if let Some(session_id) = session_id {
        return Ok(SessionId(session_id));
    }
    let response = send(AppRequest::Status)?;
    let AppResponse::Status(statuses) = response else {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("desktop app returned an unexpected response for status"),
        ));
    };
    let [status] = statuses.as_slice() else {
        return Err(CliError::new(
            EXIT_INPUT,
            anyhow!("--session-id is required when the desktop has zero or multiple open sessions"),
        ));
    };
    Ok(status.session_id.clone())
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
            "proposal_stale"
            | "proposal_conflict"
            | "stale_heads"
            | "authorization_required"
            | "invalid_authorization"
            | "authorization_expired"
            | "actor_mismatch"
            | "document_engine_error" => EXIT_CONFLICT,
            _ => EXIT_INVALID,
        };
        CliError::new(exit_code, anyhow!("[{}] {}", error.code, error.message))
    })
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
