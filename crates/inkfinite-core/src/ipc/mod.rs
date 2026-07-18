//! Authenticated local IPC contracts, framing, discovery, and request dispatch.
//!
//! The transport stays deliberately small: one authenticated JSON request and
//! one response per local connection. Desktop owns the listener lifecycle and
//! frontend integration; this module owns the wire contract and shared session
//! behavior used by desktop and the CLI.

use std::collections::{BTreeSet, VecDeque};
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::DocumentSnapshot;
use crate::file::FileError;
use crate::proto::{
    ApplyAuthorization, PROTOCOL_ID, PROTOCOL_VERSION, Proposal, ProposalId, Query, QueryResult, SessionId,
};
use crate::session::{SessionCommit, SessionError, SessionService, SessionStatus};

pub use crate::engine::{CommitResult, TransactionDraft};
pub use crate::proto::{ProtocolError, Request, Response};

/// Largest accepted IPC payload, excluding the four-byte length prefix.
pub const MAX_FRAME_SIZE: usize = 1024 * 1024;

/// Largest accepted discovery record.
pub const MAX_DISCOVERY_SIZE: usize = 16 * 1024;

/// Tauri event emitted when a live client asks the desktop frontend to focus.
pub const FOCUS_EVENT: &str = "inkfinite-focus";

const REPLAY_WINDOW: usize = 4096;
const DISCOVERY_FILE: &str = "ipc.json";
const IPC_DIRECTORY_PREFIX: &str = "inkfinite-";

/// Local endpoint and authentication material published by the desktop process.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoveryRecord {
    /// Stable protocol identifier.
    pub protocol_id: String,
    /// Wire protocol version accepted by the server.
    pub version: u32,
    /// Unix-domain socket path or Windows named-pipe name.
    pub endpoint: String,
    /// Random token scoped to this desktop process.
    pub token: String,
}

/// Read-only operation accepted by the V2-17 desktop server.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum AppRequest {
    /// List open desktop document sessions.
    Status,
    /// Return the current snapshot for an open session.
    Inspect {
        /// Session to inspect, or the only open session when omitted.
        session_id: Option<SessionId>,
    },
    /// Run the shared query implementation against an open session.
    Query {
        /// Session to query, or the only open session when omitted.
        session_id: Option<SessionId>,
        /// Shared semantic and hierarchy filters.
        query: Query,
    },
    /// Validate and store an agent transaction for desktop review.
    Propose {
        /// Session to propose against, or the only open session when omitted.
        session_id: Option<SessionId>,
        /// Agent transaction to validate and preview.
        transaction: TransactionDraft,
    },
    /// Accept all or selected operations from a reviewed proposal.
    AcceptProposal {
        /// Session owning the proposal, or the only open session when omitted.
        session_id: Option<SessionId>,
        /// Proposal to accept.
        proposal_id: ProposalId,
        /// Zero-based operation positions, or all operations when omitted.
        operation_positions: Option<Vec<u32>>,
    },
    /// Reject a reviewed proposal without changing the document.
    RejectProposal {
        /// Session owning the proposal, or the only open session when omitted.
        session_id: Option<SessionId>,
        /// Proposal to reject.
        proposal_id: ProposalId,
    },
    /// Apply an agent transaction after consuming explicit desktop authorization.
    Apply {
        /// Session to change, or the only open session when omitted.
        session_id: Option<SessionId>,
        /// Agent transaction to validate and apply.
        transaction: TransactionDraft,
        /// One-time authorization issued by the desktop UI.
        authorization: ApplyAuthorization,
    },
    /// Ask the desktop frontend to bring its main window forward.
    Focus,
}

/// Authenticated, replay-protected request frame.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestEnvelope {
    /// Stable protocol identifier.
    pub protocol_id: String,
    /// Wire protocol version requested by the client.
    pub version: u32,
    /// Unique identifier used to reject replayed requests.
    pub request_id: String,
    /// Token read from the protected discovery record.
    pub token: String,
    /// Requested read-only operation.
    pub request: AppRequest,
}

/// Successful result from a V2-17 read-only app command.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type", content = "value")]
pub enum AppResponse {
    /// Current state of every open document session.
    Status(Vec<SessionStatus>),
    /// Shared materialized document snapshot.
    Snapshot(DocumentSnapshot),
    /// Shared deterministic query result.
    QueryResult(QueryResult),
    /// A transaction was validated and stored for review.
    Proposal(Proposal),
    /// A proposal was rejected and removed.
    ProposalRejected,
    /// A directly authorized transaction was committed.
    Committed(Box<SessionCommit>),
    /// The focus notification was emitted.
    Focused,
}

/// Response frame correlated with one request.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseEnvelope {
    /// Request identifier supplied by the client.
    pub request_id: String,
    /// Successful response or stable protocol error.
    pub result: Result<AppResponse, ProtocolError>,
}

/// Local IPC framing, discovery, or connection failure.
#[derive(Debug, Error)]
pub enum IpcError {
    /// A frame exceeded [`MAX_FRAME_SIZE`].
    #[error("IPC frame size {size} exceeds the {max} byte limit")]
    FrameTooLarge { size: usize, max: usize },
    /// A discovery record exceeded [`MAX_DISCOVERY_SIZE`].
    #[error("IPC discovery record exceeds the {max} byte limit")]
    DiscoveryTooLarge { max: usize },
    /// The peer closed the stream before sending the declared frame length.
    #[error("IPC frame was truncated")]
    TruncatedFrame,
    /// A frame did not contain a valid JSON contract.
    #[error("IPC frame contains malformed JSON: {0}")]
    MalformedJson(#[from] serde_json::Error),
    /// Discovery metadata was unavailable or invalid.
    #[error("desktop app session is unavailable: {0}")]
    Unavailable(String),
    /// Local transport I/O failed.
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// Authentication and replay state retained for the lifetime of one server.
#[derive(Debug)]
pub struct RequestGuard {
    token: String,
    seen: BTreeSet<String>,
    order: VecDeque<String>,
}

impl RequestGuard {
    /// Creates a guard for one process-scoped authentication token.
    #[must_use]
    pub fn new(token: String) -> Self {
        Self { token, seen: BTreeSet::new(), order: VecDeque::new() }
    }

    /// Checks the protocol, version, token, and replay identifier.
    ///
    /// # Errors
    ///
    /// Returns a stable [`ProtocolError`] without dispatching invalid requests.
    pub fn validate(&mut self, request: &RequestEnvelope) -> Result<(), ProtocolError> {
        if request.protocol_id != PROTOCOL_ID {
            return Err(protocol_error(
                "unsupported_protocol",
                "unsupported IPC protocol identifier",
            ));
        }
        if request.version != PROTOCOL_VERSION {
            return Err(protocol_error(
                "unsupported_version",
                format!("unsupported IPC protocol version {}", request.version),
            ));
        }
        if request.token != self.token {
            return Err(protocol_error("unauthorized", "invalid IPC authentication token"));
        }
        if request.request_id.trim().is_empty() {
            return Err(protocol_error("invalid_request_id", "IPC request ID must not be empty"));
        }
        if !self.seen.insert(request.request_id.clone()) {
            return Err(protocol_error(
                "replayed_request",
                "IPC request ID has already been used",
            ));
        }
        self.order.push_back(request.request_id.clone());
        if self.order.len() > REPLAY_WINDOW {
            let Some(expired) = self.order.pop_front() else { return Ok(()) };
            self.seen.remove(&expired);
        }
        Ok(())
    }
}

/// Reads one length-prefixed JSON value with strict truncation and size checks.
///
/// # Errors
///
/// Returns [`IpcError`] for I/O, size, truncation, or JSON failures.
pub async fn read_frame<T: DeserializeOwned>(stream: &mut (impl AsyncRead + Unpin)) -> Result<T, IpcError> {
    let mut prefix = [0_u8; 4];
    read_exact_frame(stream, &mut prefix).await?;
    let size = u32::from_be_bytes(prefix) as usize;
    if size > MAX_FRAME_SIZE {
        return Err(IpcError::FrameTooLarge { size, max: MAX_FRAME_SIZE });
    }
    let mut payload = vec![0; size];
    read_exact_frame(stream, &mut payload).await?;
    Ok(serde_json::from_slice(&payload)?)
}

/// Writes one length-prefixed JSON value after enforcing the frame limit.
///
/// # Errors
///
/// Returns [`IpcError`] for serialization, size, or I/O failures.
pub async fn write_frame<T: Serialize>(stream: &mut (impl AsyncWrite + Unpin), value: &T) -> Result<(), IpcError> {
    let payload = serde_json::to_vec(value)?;
    if payload.len() > MAX_FRAME_SIZE {
        return Err(IpcError::FrameTooLarge { size: payload.len(), max: MAX_FRAME_SIZE });
    }
    let length = u32::try_from(payload.len())
        .map_err(|_| IpcError::FrameTooLarge { size: payload.len(), max: MAX_FRAME_SIZE })?;
    stream.write_all(&length.to_be_bytes()).await?;
    stream.write_all(&payload).await?;
    stream.flush().await?;
    Ok(())
}

/// Returns the per-user directory shared by the desktop and CLI.
#[must_use]
pub fn ipc_directory() -> PathBuf {
    runtime_directory().join(format!("{IPC_DIRECTORY_PREFIX}{}", user_component()))
}

/// Returns the protected discovery-file path shared by the desktop and CLI.
#[must_use]
pub fn discovery_path() -> PathBuf {
    ipc_directory().join(DISCOVERY_FILE)
}

/// Returns a platform-local endpoint name for this user.
#[must_use]
pub fn endpoint_name() -> String {
    #[cfg(unix)]
    {
        ipc_directory().join("control.sock").to_string_lossy().into_owned()
    }
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\inkfinite-{}", user_component())
    }
}

/// Creates and protects the per-user IPC directory.
///
/// # Errors
///
/// Returns [`IpcError::Unavailable`] when the directory cannot be made private.
pub fn ensure_ipc_directory() -> Result<PathBuf, IpcError> {
    let path = ipc_directory();
    ensure_private_directory(&path)?;
    Ok(path)
}

/// Generates a cryptographically random process token or request identifier.
///
/// # Errors
///
/// Returns the operating-system random source failure.
pub fn random_secret() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)?;
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(encoded)
}

/// Publishes a protected discovery record atomically.
///
/// # Errors
///
/// Returns [`IpcError`] when the record is invalid or cannot be written.
pub fn write_discovery(path: &Path, record: &DiscoveryRecord) -> Result<(), IpcError> {
    validate_discovery_record(record)?;
    let parent = path
        .parent()
        .ok_or_else(|| IpcError::Unavailable("IPC discovery path has no parent directory".into()))?;
    ensure_private_directory(parent)?;
    let payload = serde_json::to_vec(record)?;
    if payload.len() > MAX_DISCOVERY_SIZE {
        return Err(IpcError::DiscoveryTooLarge { max: MAX_DISCOVERY_SIZE });
    }

    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| IpcError::Unavailable("IPC discovery path has no valid filename".into()))?;
    let temporary = parent.join(format!(".{filename}.{}.tmp", std::process::id()));
    let write_result = write_private_file(&temporary, &payload).and_then(|()| {
        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(path)?;
        }
        fs::rename(&temporary, path).map_err(IpcError::from)
    });
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

/// Reads and validates a protected discovery record.
///
/// # Errors
///
/// Returns [`IpcError::Unavailable`] when no usable desktop server is published.
pub fn read_discovery(path: &Path) -> Result<DiscoveryRecord, IpcError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| IpcError::Unavailable(error.to_string()))?;
    if !metadata.file_type().is_file() {
        return Err(IpcError::Unavailable("IPC discovery path is not a regular file".into()));
    }
    if metadata.len() > MAX_DISCOVERY_SIZE as u64 {
        return Err(IpcError::DiscoveryTooLarge { max: MAX_DISCOVERY_SIZE });
    }
    let bytes = fs::read(path).map_err(|error| IpcError::Unavailable(error.to_string()))?;
    if bytes.len() > MAX_DISCOVERY_SIZE {
        return Err(IpcError::DiscoveryTooLarge { max: MAX_DISCOVERY_SIZE });
    }
    let record: DiscoveryRecord =
        serde_json::from_slice(&bytes).map_err(|error| IpcError::Unavailable(error.to_string()))?;
    validate_discovery_record(&record)?;
    Ok(record)
}

/// Removes a discovery record only when it still belongs to this desktop session.
///
/// # Errors
///
/// Returns [`IpcError`] when the record cannot be read or removed.
pub fn remove_discovery(path: &Path, expected: &DiscoveryRecord) -> Result<(), IpcError> {
    let current = match read_discovery(path) {
        Ok(record) => record,
        Err(IpcError::Unavailable(_)) if !path.exists() => return Ok(()),
        Err(error) => return Err(error),
    };
    if current == *expected {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Dispatches one authenticated read-only app request through the shared session service.
///
/// # Errors
///
/// Returns a stable [`ProtocolError`] for unavailable sessions or document
/// failures. No request in this module mutates a document.
pub fn dispatch(service: &mut SessionService, request: AppRequest) -> Result<AppResponse, ProtocolError> {
    match request {
        AppRequest::Status => service
            .statuses()
            .map(AppResponse::Status)
            .map_err(|error| session_protocol_error(&error)),
        AppRequest::Inspect { session_id } => {
            let session_id = service
                .resolve_session_id(session_id.as_ref())
                .map_err(|error| session_protocol_error(&error))?;
            service
                .status(&session_id)
                .map(|status| AppResponse::Snapshot(status.snapshot))
                .map_err(|error| session_protocol_error(&error))
        }
        AppRequest::Query { session_id, query } => {
            let session_id = service
                .resolve_session_id(session_id.as_ref())
                .map_err(|error| session_protocol_error(&error))?;
            service
                .query(&session_id, &query)
                .map(AppResponse::QueryResult)
                .map_err(|error| session_protocol_error(&error))
        }
        AppRequest::Propose { session_id, transaction } => {
            let session_id = service
                .resolve_session_id(session_id.as_ref())
                .map_err(|error| session_protocol_error(&error))?;
            service
                .propose(&session_id, transaction)
                .map(AppResponse::Proposal)
                .map_err(|error| session_protocol_error(&error))
        }
        AppRequest::AcceptProposal { session_id, proposal_id, operation_positions } => {
            let session_id = service
                .resolve_session_id(session_id.as_ref())
                .map_err(|error| session_protocol_error(&error))?;
            service
                .accept_proposal(&session_id, &proposal_id, operation_positions.as_deref())
                .map(|commit| AppResponse::Committed(Box::new(commit)))
                .map_err(|error| session_protocol_error(&error))
        }
        AppRequest::RejectProposal { session_id, proposal_id } => {
            let session_id = service
                .resolve_session_id(session_id.as_ref())
                .map_err(|error| session_protocol_error(&error))?;
            service
                .reject_proposal(&session_id, &proposal_id)
                .map(|()| AppResponse::ProposalRejected)
                .map_err(|error| session_protocol_error(&error))
        }
        AppRequest::Apply { session_id, transaction, authorization } => {
            let session_id = service
                .resolve_session_id(session_id.as_ref())
                .map_err(|error| session_protocol_error(&error))?;
            service
                .apply_authorized(&session_id, &authorization, transaction)
                .map(|commit| AppResponse::Committed(Box::new(commit)))
                .map_err(|error| session_protocol_error(&error))
        }
        AppRequest::Focus => Ok(AppResponse::Focused),
    }
}

/// Converts a session failure into the shared protocol error contract.
#[must_use]
pub fn session_protocol_error(error: &SessionError) -> ProtocolError {
    let code = match &error {
        SessionError::NotFound(_) => "session_not_found",
        SessionError::SessionSelectionRequired { open_sessions: 0 } => "app_session_unavailable",
        SessionError::SessionSelectionRequired { .. } => "session_selection_required",
        SessionError::ActorMismatch { .. } => "actor_mismatch",
        SessionError::StaleHeads => "stale_heads",
        SessionError::ProposalLimit(_)
        | SessionError::ProposalTooLarge { .. }
        | SessionError::ProposalDescriptionTooLong { .. } => "proposal_limit",
        SessionError::AgentOriginRequired => "agent_origin_required",
        SessionError::ProposalNotFound(_) => "proposal_not_found",
        SessionError::ProposalExpired(_) => "proposal_expired",
        SessionError::ProposalStale { .. } => "proposal_stale",
        SessionError::ProposalConflict { .. } => "proposal_conflict",
        SessionError::InvalidProposalSelection(_) => "invalid_proposal_selection",
        SessionError::AuthorizationRequired => "authorization_required",
        SessionError::InvalidAuthorization => "invalid_authorization",
        SessionError::AuthorizationExpired => "authorization_expired",
        SessionError::AuthorizationUnavailable(_) => "authorization_unavailable",
        SessionError::AlreadyOpen { .. } => "document_already_open",
        SessionError::File(file_error) => match file_error {
            FileError::Locked { .. } => "document_locked",
            FileError::AlreadyExists { .. } => "document_already_exists",
            FileError::InvalidV1(_)
            | FileError::Json(_)
            | FileError::UnsupportedFormat { .. }
            | FileError::UnsupportedShapeKind { .. }
            | FileError::SamePath { .. }
            | FileError::RecoveryNotFound { .. }
            | FileError::InvalidRecovery(_)
            | FileError::RecoveryAhead { .. }
            | FileError::Engine(_)
            | FileError::Io { .. } => "document_file_error",
        },
        SessionError::Engine(_) => "document_engine_error",
    };
    let details = match error {
        SessionError::ProposalStale { proposal, .. } => serde_json::to_value(proposal).ok(),
        SessionError::ProposalConflict { proposal_id, message } => Some(serde_json::json!({
            "proposal_id": proposal_id,
            "message": message,
        })),
        _ => None,
    };
    ProtocolError { code: code.into(), message: error.to_string(), details }
}

/// Sends one request to the currently published desktop process.
///
/// # Errors
///
/// Returns discovery, connection, framing, or response-correlation failures.
pub async fn send(request: AppRequest) -> Result<ResponseEnvelope, IpcError> {
    let discovery = read_discovery(&discovery_path())?;
    if discovery.endpoint != endpoint_name() {
        return Err(IpcError::Unavailable(
            "IPC discovery endpoint is not the per-user Inkfinite endpoint".into(),
        ));
    }
    let request_id = random_secret().map_err(|error| IpcError::Unavailable(error.to_string()))?;
    let envelope = RequestEnvelope {
        protocol_id: PROTOCOL_ID.into(),
        version: PROTOCOL_VERSION,
        request_id: request_id.clone(),
        token: discovery.token,
        request,
    };
    let response = send_to_endpoint(&discovery.endpoint, &envelope).await?;
    if response.request_id != request_id {
        return Err(IpcError::Unavailable(
            "desktop response used the wrong request ID".into(),
        ));
    }
    Ok(response)
}

#[cfg(unix)]
async fn send_to_endpoint(endpoint: &str, request: &RequestEnvelope) -> Result<ResponseEnvelope, IpcError> {
    let mut stream = tokio::net::UnixStream::connect(endpoint).await?;
    write_frame(&mut stream, request).await?;
    read_frame(&mut stream).await
}

#[cfg(windows)]
async fn send_to_endpoint(endpoint: &str, request: &RequestEnvelope) -> Result<ResponseEnvelope, IpcError> {
    use tokio::net::windows::named_pipe::ClientOptions;

    let mut stream = ClientOptions::new().open(endpoint)?;
    write_frame(&mut stream, request).await?;
    read_frame(&mut stream).await
}

fn runtime_directory() -> PathBuf {
    #[cfg(unix)]
    if let Some(path) = std::env::var_os("XDG_RUNTIME_DIR").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    std::env::temp_dir()
}

fn user_component() -> String {
    let user = if cfg!(windows) {
        std::env::var("USERNAME").ok()
    } else {
        std::env::var("USER").ok().or_else(|| std::env::var("USERNAME").ok())
    };
    let sanitized: String = user
        .unwrap_or_else(|| "user".into())
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(32)
        .collect();
    if sanitized.is_empty() { "user".into() } else { sanitized }
}

fn validate_discovery_record(record: &DiscoveryRecord) -> Result<(), IpcError> {
    if record.protocol_id != PROTOCOL_ID {
        return Err(IpcError::Unavailable(
            "discovery record has an unsupported protocol identifier".into(),
        ));
    }
    if record.version != PROTOCOL_VERSION {
        return Err(IpcError::Unavailable(
            "discovery record has an unsupported protocol version".into(),
        ));
    }
    if record.endpoint.trim().is_empty() {
        return Err(IpcError::Unavailable("discovery record has an empty endpoint".into()));
    }
    if record.token.trim().is_empty() {
        return Err(IpcError::Unavailable(
            "discovery record has an empty authentication token".into(),
        ));
    }
    Ok(())
}

fn ensure_private_directory(path: &Path) -> Result<(), IpcError> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        return Err(IpcError::Unavailable(format!(
            "IPC path is not a directory: {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = metadata.permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn write_private_file(path: &Path, payload: &[u8]) -> Result<(), IpcError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;

        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(payload)?;
    file.sync_all()?;
    Ok(())
}

async fn read_exact_frame(stream: &mut (impl AsyncRead + Unpin), bytes: &mut [u8]) -> Result<(), IpcError> {
    match stream.read_exact(bytes).await {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Err(IpcError::TruncatedFrame),
        Err(error) => Err(IpcError::Io(error)),
    }
}

fn protocol_error(code: &str, message: impl Into<String>) -> ProtocolError {
    ProtocolError { code: code.into(), message: message.into(), details: None }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use tokio::io::AsyncWriteExt as _;

    use super::*;
    use crate::proto::Query;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn request(token: &str, request_id: &str) -> RequestEnvelope {
        RequestEnvelope {
            protocol_id: PROTOCOL_ID.into(),
            version: PROTOCOL_VERSION,
            request_id: request_id.into(),
            token: token.into(),
            request: AppRequest::Status,
        }
    }

    #[test]
    fn guard_rejects_wrong_tokens_versions_and_replays() {
        let mut guard = RequestGuard::new("secret".into());
        assert_eq!(
            guard.validate(&request("wrong", "one")).unwrap_err().code,
            "unauthorized"
        );

        let mut unsupported_protocol = request("secret", "protocol");
        unsupported_protocol.protocol_id = "other.protocol".into();
        assert_eq!(
            guard.validate(&unsupported_protocol).unwrap_err().code,
            "unsupported_protocol"
        );

        let mut unsupported = request("secret", "two");
        unsupported.version += 1;
        assert_eq!(guard.validate(&unsupported).unwrap_err().code, "unsupported_version");

        let valid = request("secret", "three");
        guard.validate(&valid).unwrap();
        assert_eq!(guard.validate(&valid).unwrap_err().code, "replayed_request");
    }

    #[tokio::test]
    async fn framing_rejects_oversized_truncated_and_malformed_frames() {
        let (mut writer, mut reader) = tokio::io::duplex(64);
        writer
            .write_all(
                &u32::try_from(MAX_FRAME_SIZE + 1)
                    .expect("test frame size fits")
                    .to_be_bytes(),
            )
            .await
            .unwrap();
        assert!(matches!(
            read_frame::<RequestEnvelope>(&mut reader).await,
            Err(IpcError::FrameTooLarge { .. })
        ));

        let (mut writer, mut reader) = tokio::io::duplex(64);
        writer.write_all(&8_u32.to_be_bytes()).await.unwrap();
        writer.write_all(b"{}").await.unwrap();
        drop(writer);
        assert!(matches!(
            read_frame::<RequestEnvelope>(&mut reader).await,
            Err(IpcError::TruncatedFrame)
        ));

        let (mut writer, mut reader) = tokio::io::duplex(64);
        writer.write_all(&2_u32.to_be_bytes()).await.unwrap();
        writer.write_all(b"{]").await.unwrap();
        assert!(matches!(
            read_frame::<RequestEnvelope>(&mut reader).await,
            Err(IpcError::MalformedJson(_))
        ));
    }

    #[test]
    fn discovery_is_atomic_and_rejects_invalid_records() {
        let root = test_directory();
        let path = root.join("ipc.json");
        let record = DiscoveryRecord {
            protocol_id: PROTOCOL_ID.into(),
            version: PROTOCOL_VERSION,
            endpoint: endpoint_name(),
            token: "secret".into(),
        };
        write_discovery(&path, &record).unwrap();
        assert_eq!(read_discovery(&path).unwrap(), record);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            assert_eq!(std::fs::metadata(&root).unwrap().permissions().mode() & 0o777, 0o700);
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }

        let malformed = root.join("malformed.json");
        std::fs::write(&malformed, b"[]").unwrap();
        assert!(matches!(read_discovery(&malformed), Err(IpcError::Unavailable(_))));

        remove_discovery(&path, &record).unwrap();
        assert!(!path.exists());
        remove_test_directory(root);
    }

    #[test]
    fn dispatch_returns_shared_records_and_reports_unavailable_sessions() {
        let root = test_directory();
        let path = root.join("board.inkfinite");
        let mut service = SessionService::new();
        let opened = service
            .create(
                &path,
                crate::DocumentId::from("document:ipc"),
                crate::ActorId::from("actor:test"),
                None,
            )
            .unwrap();

        let status = dispatch(&mut service, AppRequest::Status).unwrap();
        assert!(matches!(status, AppResponse::Status(statuses) if statuses.len() == 1));
        let snapshot = dispatch(&mut service, AppRequest::Inspect { session_id: None }).unwrap();
        assert!(matches!(snapshot, AppResponse::Snapshot(snapshot) if snapshot == opened.status.snapshot));
        let query = dispatch(
            &mut service,
            AppRequest::Query { session_id: None, query: Query::default() },
        )
        .unwrap();
        assert!(matches!(query, AppResponse::QueryResult(result) if result.heads == opened.status.snapshot.heads));

        service.close(&opened.session_id).unwrap();
        let error = dispatch(&mut service, AppRequest::Inspect { session_id: None }).unwrap_err();
        assert_eq!(error.code, "app_session_unavailable");
        remove_test_directory(root);
    }

    #[test]
    fn endpoint_is_scoped_to_a_user_directory() {
        let directory = ipc_directory();
        assert!(
            directory
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(IPC_DIRECTORY_PREFIX))
        );
        assert!(endpoint_name().contains(directory.to_string_lossy().as_ref()));
    }

    fn test_directory() -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("inkfinite-ipc-test-{id}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn remove_test_directory(path: PathBuf) {
        let _ = std::fs::remove_dir_all(path);
    }
}
