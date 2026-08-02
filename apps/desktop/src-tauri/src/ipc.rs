//! Local IPC server for authenticated live CLI control.

use std::sync::{Arc, Mutex};

use inkfinite_core::ipc::{
    dispatch, endpoint_name, ensure_ipc_directory, random_secret, read_frame, remove_discovery, write_discovery,
    write_frame, AppRequest, AppResponse, DiscoveryRecord, IpcError, RequestEnvelope, RequestGuard, ResponseEnvelope,
    FOCUS_EVENT,
};
use inkfinite_core::proto::{ProtocolError, PROTOCOL_ID, PROTOCOL_VERSION};
use inkfinite_core::session::SessionService;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// Tauri event carrying a newly created or refreshed live proposal.
pub const PROPOSAL_EVENT: &str = "inkfinite-proposal";
/// Tauri event clearing the currently reviewed proposal.
pub const PROPOSAL_CLEARED_EVENT: &str = "inkfinite-proposal-cleared";
/// Tauri event carrying a commit made by a live client.
pub const COMMIT_EVENT: &str = "inkfinite-live-commit";
/// Tauri event carrying a remote synchronization result.
pub const SYNC_EVENT: &str = "inkfinite-sync";

/// Handle used by the Tauri lifecycle to stop the local server and clean up discovery.
pub struct IpcServerHandle {
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    discovery: DiscoveryRecord,
    endpoint: String,
}

impl IpcServerHandle {
    /// Requests shutdown and removes only this server's published endpoint metadata.
    pub fn stop(&self) {
        if let Ok(mut shutdown) = self.shutdown.lock() {
            if let Some(sender) = shutdown.take() {
                let _ = sender.send(());
            }
        }
        cleanup_owned_endpoint(&self.discovery, &self.endpoint);
    }
}

impl Drop for IpcServerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Starts the per-user local server for one desktop process.
///
/// # Errors
///
/// Returns [`IpcError`] when the endpoint or protected discovery record cannot
/// be created. The server is not published until both are ready.
pub async fn start(app: AppHandle, service: Arc<Mutex<SessionService>>) -> Result<IpcServerHandle, IpcError> {
    ensure_ipc_directory()?;
    let endpoint = endpoint_name();
    #[cfg(unix)]
    let listener = bind_unix_endpoint(&endpoint)?;
    #[cfg(windows)]
    let listener = create_named_pipe(&endpoint, true)?;

    let token = random_secret().map_err(|error| IpcError::Unavailable(error.to_string()))?;
    let discovery = DiscoveryRecord {
        protocol_id: PROTOCOL_ID.into(),
        version: PROTOCOL_VERSION,
        endpoint: endpoint.clone(),
        token: token.clone(),
    };
    if let Err(error) = write_discovery(&inkfinite_core::ipc::discovery_path(), &discovery) {
        remove_endpoint(&endpoint);
        return Err(error);
    }

    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let guard = Arc::new(Mutex::new(RequestGuard::new(token)));
    let discovery_for_task = discovery.clone();
    #[cfg(unix)]
    tauri::async_runtime::spawn(run_unix(
        listener,
        app,
        service,
        guard,
        shutdown_receiver,
        discovery_for_task,
    ));
    #[cfg(windows)]
    tauri::async_runtime::spawn(run_windows(
        listener,
        endpoint.clone(),
        app,
        service,
        guard,
        shutdown_receiver,
        discovery_for_task,
    ));

    Ok(IpcServerHandle { shutdown: Mutex::new(Some(shutdown_sender)), discovery, endpoint })
}

#[cfg(unix)]
fn bind_unix_endpoint(endpoint: &str) -> Result<tokio::net::UnixListener, IpcError> {
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};

    let path = std::path::Path::new(endpoint);
    let listener = match std::os::unix::net::UnixListener::bind(path) {
        Ok(listener) => listener,
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            let metadata = std::fs::symlink_metadata(path)?;
            if !metadata.file_type().is_socket() {
                return Err(IpcError::Unavailable(format!(
                    "IPC endpoint is not a Unix socket: {}",
                    path.display()
                )));
            }
            if std::os::unix::net::UnixStream::connect(path).is_ok() {
                return Err(IpcError::Unavailable(
                    "another Inkfinite desktop process owns the IPC endpoint".into(),
                ));
            }
            std::fs::remove_file(path)?;
            std::os::unix::net::UnixListener::bind(path)?
        }
        Err(error) => return Err(IpcError::Io(error)),
    };
    listener.set_nonblocking(true)?;
    let mut permissions = std::fs::metadata(path)?.permissions();
    permissions.set_mode(0o600);
    std::fs::set_permissions(path, permissions)?;
    tokio::net::UnixListener::from_std(listener).map_err(IpcError::from)
}

#[cfg(windows)]
fn create_named_pipe(
    endpoint: &str, first: bool,
) -> Result<tokio::net::windows::named_pipe::NamedPipeServer, IpcError> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let mut options = ServerOptions::new();
    options.reject_remote_clients(true).first_pipe_instance(first);
    options.create(endpoint).map_err(IpcError::from)
}

#[cfg(unix)]
async fn run_unix(
    listener: tokio::net::UnixListener, app: AppHandle, service: Arc<Mutex<SessionService>>,
    guard: Arc<Mutex<RequestGuard>>, mut shutdown: oneshot::Receiver<()>, discovery: DiscoveryRecord,
) {
    let mut connections = tokio::task::JoinSet::new();
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    let app = app.clone();
                    let service = Arc::clone(&service);
                    let guard = Arc::clone(&guard);
                    connections.spawn(handle_connection(stream, app, service, guard));
                }
                Err(_) => break,
            },
        }
    }
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    cleanup_owned_endpoint(&discovery, &discovery.endpoint);
}

#[cfg(windows)]
async fn run_windows(
    mut listener: tokio::net::windows::named_pipe::NamedPipeServer, endpoint: String, app: AppHandle,
    service: Arc<Mutex<SessionService>>, guard: Arc<Mutex<RequestGuard>>, mut shutdown: oneshot::Receiver<()>,
    discovery: DiscoveryRecord,
) {
    loop {
        let connected = tokio::select! {
            _ = &mut shutdown => break,
            result = listener.connect() => result,
        };
        if connected.is_err() {
            break;
        }
        let app = app.clone();
        let service = Arc::clone(&service);
        let guard = Arc::clone(&guard);
        tokio::select! {
            _ = &mut shutdown => break,
            _ = handle_connection(listener, app, service, guard) => {},
        }
        listener = match create_named_pipe(&endpoint, false) {
            Ok(listener) => listener,
            Err(_) => break,
        };
    }
    cleanup_owned_endpoint(&discovery, &discovery.endpoint);
}

async fn handle_connection<S>(
    mut stream: S, app: AppHandle, service: Arc<Mutex<SessionService>>, guard: Arc<Mutex<RequestGuard>>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let request = match read_frame::<RequestEnvelope>(&mut stream).await {
        Ok(request) => request,
        Err(_) => return,
    };
    let request_id = request.request_id.clone();
    let result = match guard.lock() {
        Ok(mut guard) => match guard.validate(&request) {
            Ok(()) => dispatch_request(&app, &service, request.request),
            Err(error) => Err(error),
        },
        Err(_) => Err(protocol_error(
            "ipc_guard_unavailable",
            "the IPC authentication guard is unavailable",
        )),
    };
    let response = ResponseEnvelope { request_id, result };
    let _ = write_frame(&mut stream, &response).await;
}

fn dispatch_request(
    app: &AppHandle, service: &Arc<Mutex<SessionService>>, request: AppRequest,
) -> Result<AppResponse, ProtocolError> {
    let requested_session = match &request {
        AppRequest::Context { session_id }
        | AppRequest::Inspect { session_id }
        | AppRequest::Query { session_id, .. }
        | AppRequest::Propose { session_id, .. }
        | AppRequest::Mutate { session_id, .. }
        | AppRequest::ProposalStatus { session_id, .. }
        | AppRequest::Apply { session_id, .. } => session_id.clone(),
        AppRequest::Status | AppRequest::Focus => None,
    };
    let mut service = service.lock().map_err(|_| {
        protocol_error(
            "session_service_unavailable",
            "the desktop session service lock is poisoned",
        )
    })?;
    let mut response = match dispatch(&mut service, request) {
        Ok(response) => response,
        Err(error) => {
            emit_refreshed_proposal(app, &error)?;
            return Err(error);
        }
    };
    if let AppResponse::Committed(commit) = &mut response {
        let saved = service
            .save(&commit.status.session_id, &commit.status.snapshot.heads)
            .map_err(|error| inkfinite_core::ipc::session_protocol_error(&error))?;
        commit.status = saved.status;
    }
    if matches!(&response, AppResponse::Focused) {
        app.emit(FOCUS_EVENT, json!({ "source": "cli" })).map_err(|error| {
            protocol_error(
                "focus_notification_failed",
                format!("could not notify the desktop frontend: {error}"),
            )
        })?;
    }
    match &response {
        AppResponse::Proposal(proposal) => app
            .emit(
                PROPOSAL_EVENT,
                json!({ "session_id": requested_session, "proposal": proposal }),
            )
            .map_err(|error| {
                protocol_error(
                    "proposal_notification_failed",
                    format!("could not notify the desktop frontend: {error}"),
                )
            })?,
        AppResponse::Committed(commit) => app
            .emit(
                COMMIT_EVENT,
                json!({ "session_id": requested_session, "commit": commit }),
            )
            .map_err(|error| {
                protocol_error(
                    "commit_notification_failed",
                    format!("could not notify the desktop frontend: {error}"),
                )
            })?,
        AppResponse::Status(_)
        | AppResponse::Context(_)
        | AppResponse::Snapshot(_)
        | AppResponse::QueryResult(_)
        | AppResponse::ProposalStatus(_)
        | AppResponse::Focused => {}
    }
    Ok(response)
}

fn emit_refreshed_proposal(app: &AppHandle, error: &ProtocolError) -> Result<(), ProtocolError> {
    match error.code.as_str() {
        "proposal_stale" => {
            let Some(proposal) = error.details.as_ref() else {
                return Ok(());
            };
            app.emit(PROPOSAL_EVENT, json!({ "proposal": proposal }))
                .map_err(|emit_error| {
                    protocol_error(
                        "proposal_notification_failed",
                        format!("could not notify the desktop frontend: {emit_error}"),
                    )
                })
        }
        "proposal_conflict" => app
            .emit(PROPOSAL_CLEARED_EVENT, json!({ "message": error.message }))
            .map_err(|emit_error| {
                protocol_error(
                    "proposal_notification_failed",
                    format!("could not notify the desktop frontend: {emit_error}"),
                )
            }),
        _ => Ok(()),
    }
}

fn protocol_error(code: &str, message: impl Into<String>) -> ProtocolError {
    ProtocolError { code: code.into(), message: message.into(), details: None }
}

fn cleanup_owned_endpoint(discovery: &DiscoveryRecord, endpoint: &str) {
    let path = inkfinite_core::ipc::discovery_path();
    let owns_discovery = inkfinite_core::ipc::read_discovery(&path).is_ok_and(|current| current == *discovery);
    if owns_discovery {
        let _ = remove_discovery(&path, discovery);
        remove_endpoint(endpoint);
    }
}

#[cfg(unix)]
fn remove_endpoint(endpoint: &str) {
    use std::os::unix::fs::FileTypeExt;

    let path = std::path::Path::new(endpoint);
    if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_socket()) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(windows)]
fn remove_endpoint(_endpoint: &str) {}
