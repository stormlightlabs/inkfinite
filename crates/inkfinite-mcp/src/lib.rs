//! Permission-aware MCP discovery and read access for Inkfinite.
//!
//! The server uses Inkfinite's local IPC contract for live desktop sessions and
//! the core transaction engine for explicitly configured files. It never
//! shells out to the CLI and does not treat an arbitrary path supplied by a
//! model as permission to read it.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use inkfinite_core::engine::TransactionEngine;
use inkfinite_core::ipc::{self, AppRequest, AppResponse, IpcError};
use inkfinite_core::proto::{Bounds, ProtocolError, Query, QueryResult};
use inkfinite_core::session::{SessionStatus, SyncState};
use inkfinite_core::{ActorId, BUILTIN_SHAPE_KINDS, DocumentSnapshot};
use rmcp::handler::server::wrapper::{Json, Parameters};
use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};
use rmcp::{ErrorData as McpError, ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Stable MCP server name advertised during initialization.
pub const SERVER_NAME: &str = "inkfinite-mcp";
/// Human-readable description of the server's current surface.
pub const SERVER_DESCRIPTION: &str = "Permissioned local discovery and read access for Inkfinite documents";
/// Environment variable containing the explicitly accessible document paths.
pub const DOCUMENTS_ENV: &str = "INKFINITE_MCP_DOCUMENTS";
const MCP_READER_ACTOR: &str = "actor:inkfinite-mcp-reader";

/// A document source selected by an MCP caller.
#[derive(Clone, Debug, Default, Deserialize, JsonSchema)]
pub struct DocumentTarget {
    /// Open desktop session to use.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Explicit file path from the server's configured allowlist.
    #[serde(default)]
    pub path: Option<String>,
}

/// Parameters for the document inspection tool.
#[derive(Clone, Debug, Default, Deserialize, JsonSchema)]
pub struct InspectDocumentParams {
    /// Document source to inspect. Omit both fields only when one source is available.
    #[serde(flatten)]
    pub target: DocumentTarget,
}

/// Parameters for querying records in one document.
#[derive(Clone, Debug, Default, Deserialize, JsonSchema)]
pub struct QueryRecordsParams {
    /// Document source to query. Omit both fields only when one source is available.
    #[serde(flatten)]
    pub target: DocumentTarget,
    /// Match one exact record ID.
    pub id: Option<String>,
    /// Match one exact page, layer, shape, or asset name.
    pub name: Option<String>,
    /// Match one exact semantic role.
    pub role: Option<String>,
    /// Match one exact semantic tag.
    pub tag: Option<String>,
    /// Match one exact built-in shape kind.
    pub shape_kind: Option<String>,
    /// Restrict results to one page.
    pub page_id: Option<String>,
    /// Restrict results to one layer.
    pub layer_id: Option<String>,
    /// Restrict shapes to one direct parent.
    pub parent_id: Option<String>,
    /// Restrict shapes to records whose world bounds intersect this rectangle.
    pub bounds: Option<Bounds>,
    /// Include complete matching records.
    #[serde(default)]
    pub include_records: bool,
    /// Maximum number of records to return.
    pub limit: Option<u32>,
}

/// Stable metadata describing the records in one document.
#[derive(Clone, Debug, JsonSchema, Serialize)]
pub struct DocumentCounts {
    /// Number of pages.
    pub pages: usize,
    /// Number of layers.
    pub layers: usize,
    /// Number of shapes.
    pub shapes: usize,
    /// Number of bindings.
    pub bindings: usize,
    /// Number of assets.
    pub assets: usize,
}

/// Source recorded in an inspection response.
#[derive(Clone, Debug, JsonSchema, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum InspectionSource {
    /// A document held open by the desktop application.
    Session {
        /// Desktop session identifier.
        session_id: String,
    },
    /// A file explicitly configured for this MCP process.
    File,
}

/// Document metadata and causal identity returned by inspection.
#[derive(Clone, Debug, JsonSchema, Serialize)]
pub struct DocumentInspection {
    /// How this document was reached.
    pub source: InspectionSource,
    /// Canonical document path.
    pub path: String,
    /// Stable document identifier.
    pub document_id: String,
    /// Stable document format identifier.
    pub format: String,
    /// Document contract version.
    pub format_version: u32,
    /// Causal heads observed for this inspection.
    pub heads: Vec<String>,
    /// Ordered page identifiers.
    pub page_ids: Vec<String>,
    /// Materialized record counts.
    pub counts: DocumentCounts,
}

/// One open desktop session discoverable by the MCP server.
#[derive(Clone, Debug, JsonSchema, Serialize)]
pub struct SessionDiscovery {
    /// Stable desktop session identifier.
    pub session_id: String,
    /// Canonical path held by the desktop.
    pub path: String,
    /// Actor used by the desktop session.
    pub actor_id: String,
    /// Stable document identifier.
    pub document_id: String,
    /// Document format identifier.
    pub format: String,
    /// Document contract version.
    pub format_version: u32,
    /// Causal heads observed for the session.
    pub heads: Vec<String>,
    /// Whether unsaved changes are present.
    pub dirty: bool,
    /// Whether the desktop still owns the document lock.
    pub lock_held: bool,
    /// Whether interrupted-save recovery data is available.
    pub recovery_available: bool,
    /// Whether trusted peer synchronization is enabled.
    pub sync_enabled: bool,
}

/// One file explicitly made available to this MCP process.
#[derive(Clone, Debug, JsonSchema, Serialize)]
pub struct FileDiscovery {
    /// Canonical path from the process allowlist.
    pub path: String,
    /// Stable document identifier.
    pub document_id: String,
    /// Document format identifier.
    pub format: String,
    /// Document contract version.
    pub format_version: u32,
    /// Causal heads observed while reading the file.
    pub heads: Vec<String>,
    /// Materialized record counts.
    pub counts: DocumentCounts,
}

/// Open sessions and configured files visible to the MCP process.
#[derive(Clone, Debug, JsonSchema, Serialize)]
pub struct DocumentDiscovery {
    /// Whether Inkfinite Desktop responded to the discovery request.
    pub desktop_available: bool,
    /// Sessions currently published by Inkfinite Desktop.
    pub sessions: Vec<SessionDiscovery>,
    /// Files explicitly configured for standalone read access.
    pub files: Vec<FileDiscovery>,
}

/// Capability metadata for the Inkfinite MCP surface.
#[derive(Clone, Debug, JsonSchema, Serialize)]
pub struct CapabilityMetadata {
    /// MCP server name.
    pub server: String,
    /// Server description.
    pub description: String,
    /// Transport supported by this process.
    pub transport: String,
    /// Inkfinite document format identifier.
    pub document_format: String,
    /// Inkfinite document format version.
    pub document_format_version: u32,
    /// Core protocol identifier used by desktop IPC.
    pub protocol: String,
    /// Core protocol version used by desktop IPC.
    pub protocol_version: u32,
    /// Built-in shape kinds understood by the shared document model.
    pub shape_kinds: Vec<String>,
    /// Read operations currently exposed by this server.
    pub operations: Vec<String>,
    /// How a source becomes visible to this server.
    pub source_policy: String,
}

/// The stdio MCP server and its explicit file access policy.
#[derive(Clone, Debug, Default)]
pub struct InkfiniteMcp {
    accessible_paths: BTreeSet<PathBuf>,
}

impl InkfiniteMcp {
    /// Creates a server with the supplied file paths as its read allowlist.
    #[must_use]
    pub fn new(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        Self { accessible_paths: paths.into_iter().map(|path| normalize_path(&path)).collect() }
    }

    /// Creates a server from [`DOCUMENTS_ENV`].
    #[must_use]
    pub fn from_environment() -> Self {
        let paths = std::env::var_os(DOCUMENTS_ENV)
            .into_iter()
            .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        Self::new(paths)
    }

    /// Returns the configured file allowlist in stable path order.
    #[must_use]
    pub fn accessible_paths(&self) -> Vec<PathBuf> {
        self.accessible_paths.iter().cloned().collect()
    }

    /// Returns the metadata advertised by the capability tool and server instructions.
    #[must_use]
    pub fn capabilities() -> CapabilityMetadata {
        CapabilityMetadata {
            server: SERVER_NAME.into(),
            description: SERVER_DESCRIPTION.into(),
            transport: "stdio".into(),
            document_format: inkfinite_core::INKFINITE_FORMAT_ID.into(),
            document_format_version: inkfinite_core::INKFINITE_FORMAT_VERSION,
            protocol: inkfinite_core::proto::PROTOCOL_ID.into(),
            protocol_version: inkfinite_core::proto::PROTOCOL_VERSION,
            shape_kinds: BUILTIN_SHAPE_KINDS.iter().map(|kind| (*kind).into()).collect(),
            operations: vec![
                "inkfinite_list_sessions".into(),
                "inkfinite_list_documents".into(),
                "inkfinite_inspect_document".into(),
                "inkfinite_query_records".into(),
            ],
            source_policy: format!(
                "Open desktop sessions are discovered through authenticated local IPC; standalone files must be listed in {DOCUMENTS_ENV} or supplied as server command-line paths."
            ),
        }
    }

    async fn session_statuses(&self) -> Result<Vec<SessionStatus>, McpError> {
        match ipc::send(AppRequest::Status).await {
            Ok(response) => match response.result {
                Ok(AppResponse::Status(statuses)) => Ok(statuses),
                Ok(_) => Err(internal_error("desktop returned an unexpected status response")),
                Err(error) => Err(protocol_mcp_error(error)),
            },
            Err(error) => Err(ipc_mcp_error(&error)),
        }
    }

    async fn session_inspection(&self, session_id: String) -> Result<DocumentInspection, McpError> {
        let path = self
            .session_statuses()
            .await?
            .into_iter()
            .find(|status| status.session_id.0 == session_id)
            .map(|status| PathBuf::from(status.path.0));
        let requested_session = Some(inkfinite_core::proto::SessionId(session_id.clone()));
        let response = ipc::send(AppRequest::Inspect { session_id: requested_session }).await;
        match response {
            Ok(response) => match response.result {
                Ok(AppResponse::Snapshot(snapshot)) => Ok(snapshot_inspection(
                    &snapshot,
                    InspectionSource::Session { session_id },
                    path,
                )),
                Ok(_) => Err(internal_error("desktop returned an unexpected inspection response")),
                Err(error) => Err(protocol_mcp_error(error)),
            },
            Err(error) => Err(ipc_mcp_error(&error)),
        }
    }

    fn file_path(&self, raw_path: &str) -> Result<PathBuf, McpError> {
        let path = normalize_path(Path::new(raw_path));
        if self.accessible_paths.contains(&path) {
            Ok(path)
        } else {
            Err(McpError::invalid_params(
                format!("file is not in the {DOCUMENTS_ENV} allowlist"),
                Some(serde_json::json!({ "path": raw_path })),
            ))
        }
    }

    fn file_engine(&self, raw_path: &str) -> Result<(PathBuf, TransactionEngine), McpError> {
        let path = self.file_path(raw_path)?;
        let bytes = fs::read(&path).map_err(|error| {
            internal_error(format!(
                "could not read configured Inkfinite file {}: {error}",
                path.display()
            ))
        })?;
        let engine = TransactionEngine::load(&bytes, ActorId::from(MCP_READER_ACTOR)).map_err(|error| {
            internal_error(format!(
                "could not load configured Inkfinite file {}: {error}",
                path.display()
            ))
        })?;
        Ok((path, engine))
    }

    async fn query_target(&self, target: &DocumentTarget, query: Query) -> Result<QueryResult, McpError> {
        validate_target(target)?;
        if let Some(session_id) = &target.session_id {
            return query_session(Some(session_id), query).await;
        }
        if let Some(path) = &target.path {
            let (_, mut engine) = self.file_engine(path)?;
            return engine
                .query(&query)
                .map_err(|error| internal_error(format!("could not query document: {error}")));
        }

        let statuses = match self.session_statuses().await {
            Ok(statuses) => statuses,
            Err(_error) if !self.accessible_paths.is_empty() => Vec::new(),
            Err(error) => return Err(error),
        };
        if statuses.len() == 1 {
            return query_session(Some(&statuses[0].session_id.0), query).await;
        }
        if statuses.is_empty()
            && self.accessible_paths.len() == 1
            && let Some(path) = self.accessible_paths.iter().next()
        {
            let raw_path = path.to_string_lossy();
            let (_, mut engine) = self.file_engine(&raw_path)?;
            return engine
                .query(&query)
                .map_err(|error| internal_error(format!("could not query document: {error}")));
        }
        Err(McpError::invalid_params(
            if statuses.is_empty() {
                "document source is required; no open session or unique configured file is available"
            } else {
                "document source is required because multiple open sessions are available"
            },
            None,
        ))
    }

    async fn inspect_target(&self, target: &DocumentTarget) -> Result<DocumentInspection, McpError> {
        validate_target(target)?;
        if let Some(session_id) = &target.session_id {
            return self.session_inspection(session_id.clone()).await;
        }
        if let Some(path) = &target.path {
            let (path, mut engine) = self.file_engine(path)?;
            let snapshot = engine
                .snapshot()
                .map_err(|error| internal_error(format!("could not inspect configured Inkfinite file: {error}")))?;
            return Ok(snapshot_inspection(&snapshot, InspectionSource::File, Some(path)));
        }

        let statuses = match self.session_statuses().await {
            Ok(statuses) => statuses,
            Err(_error) if !self.accessible_paths.is_empty() => Vec::new(),
            Err(error) => return Err(error),
        };
        if statuses.len() == 1 {
            return self.session_inspection(statuses[0].session_id.0.clone()).await;
        }
        if statuses.is_empty()
            && self.accessible_paths.len() == 1
            && let Some(path) = self.accessible_paths.iter().next()
        {
            let (path, mut engine) = self.file_engine(&path.to_string_lossy())?;
            let snapshot = engine
                .snapshot()
                .map_err(|error| internal_error(format!("could not inspect configured Inkfinite file: {error}")))?;
            return Ok(snapshot_inspection(&snapshot, InspectionSource::File, Some(path)));
        }
        Err(McpError::invalid_params(
            if statuses.is_empty() {
                "document source is required; no open session or unique configured file is available"
            } else {
                "document source is required because multiple open sessions are available"
            },
            None,
        ))
    }

    async fn discover(&self) -> DocumentDiscovery {
        let (statuses, desktop_available) = match self.session_statuses().await {
            Ok(statuses) => (statuses, true),
            Err(_) => (Vec::new(), false),
        };
        let open_paths: BTreeSet<_> = statuses
            .iter()
            .map(|status| normalize_path(Path::new(&status.path.0)))
            .collect();
        let sessions = statuses.into_iter().map(session_discovery).collect();
        let files = self
            .accessible_paths
            .iter()
            .filter(|path| !open_paths.contains(*path))
            .filter_map(|path| {
                let raw_path = path.to_string_lossy();
                let (_, mut engine) = self.file_engine(&raw_path).ok()?;
                let snapshot = engine.snapshot().ok()?;
                Some(file_discovery(path, &snapshot))
            })
            .collect();
        DocumentDiscovery { desktop_available, sessions, files }
    }
}

#[tool_router]
impl InkfiniteMcp {
    /// Returns the document format, protocol, shape registry, and read surface.
    #[tool(
        name = "inkfinite_capabilities",
        description = "Describe Inkfinite MCP capabilities and source access policy"
    )]
    pub fn capabilities_tool(&self) -> Json<CapabilityMetadata> {
        Json(Self::capabilities())
    }

    /// Lists open desktop sessions.
    #[tool(
        name = "inkfinite_list_sessions",
        description = "List open Inkfinite Desktop sessions with paths and causal heads"
    )]
    pub async fn list_sessions(&self) -> Result<Json<Vec<SessionDiscovery>>, McpError> {
        let sessions = self
            .session_statuses()
            .await?
            .into_iter()
            .map(session_discovery)
            .collect();
        Ok(Json(sessions))
    }

    /// Lists open sessions and explicitly configured standalone files.
    #[tool(
        name = "inkfinite_list_documents",
        description = "Discover open Inkfinite sessions and explicitly configured document files"
    )]
    pub async fn list_documents(&self) -> Json<DocumentDiscovery> {
        Json(self.discover().await)
    }

    /// Inspects document metadata and causal heads.
    #[tool(
        name = "inkfinite_inspect_document",
        description = "Inspect Inkfinite format metadata, record counts, page IDs, and causal heads"
    )]
    pub async fn inspect_document(
        &self, Parameters(params): Parameters<InspectDocumentParams>,
    ) -> Result<Json<DocumentInspection>, McpError> {
        Ok(Json(self.inspect_target(&params.target).await?))
    }

    /// Queries document records using the shared semantic and hierarchy filters.
    #[tool(
        name = "inkfinite_query_records",
        description = "Query Inkfinite records by role, kind, parent, bounds, and other shared filters"
    )]
    pub async fn query_records(
        &self, Parameters(params): Parameters<QueryRecordsParams>,
    ) -> Result<Json<QueryResult>, McpError> {
        let query = Query {
            id: params.id,
            name: params.name,
            role: params.role,
            tag: params.tag,
            shape_kind: params.shape_kind,
            page_id: params.page_id.map(Into::into),
            layer_id: params.layer_id.map(Into::into),
            parent_id: params.parent_id,
            bounds: params.bounds,
            include_records: params.include_records,
            limit: params.limit,
        };
        Ok(Json(self.query_target(&params.target, query).await?))
    }
}

#[tool_handler]
impl ServerHandler for InkfiniteMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new(SERVER_NAME, env!("CARGO_PKG_VERSION"))
                    .with_title("Inkfinite Permissioned MCP")
                    .with_description(SERVER_DESCRIPTION),
            )
            .with_instructions(
                "Use the Inkfinite discovery and read tools before proposing changes. Open sessions are reached through authenticated local IPC; standalone files are limited to the server's configured allowlist.",
            )
    }
}

/// Runs one MCP server over stdio until the client closes the transport.
///
/// # Errors
///
/// Returns an MCP initialization, transport, or service task failure.
pub async fn run_stdio(server: InkfiniteMcp) -> Result<(), rmcp::RmcpError> {
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}

fn validate_target(target: &DocumentTarget) -> Result<(), McpError> {
    if target.session_id.is_some() && target.path.is_some() {
        return Err(McpError::invalid_params(
            "choose either session_id or path, not both",
            None,
        ));
    }
    if target.session_id.as_deref().is_some_and(str::is_empty) || target.path.as_deref().is_some_and(str::is_empty) {
        return Err(McpError::invalid_params(
            "document source values must not be empty",
            None,
        ));
    }
    Ok(())
}

async fn query_session(session_id: Option<&str>, query: Query) -> Result<QueryResult, McpError> {
    let response = ipc::send(AppRequest::Query {
        session_id: session_id.map(|id| inkfinite_core::proto::SessionId(id.to_owned())),
        query,
    })
    .await
    .map_err(|error| ipc_mcp_error(&error))?;
    match response.result {
        Ok(AppResponse::QueryResult(result)) => Ok(result),
        Ok(_) => Err(internal_error("desktop returned an unexpected query response")),
        Err(error) => Err(protocol_mcp_error(error)),
    }
}

fn snapshot_inspection(
    snapshot: &DocumentSnapshot, source: InspectionSource, path: Option<PathBuf>,
) -> DocumentInspection {
    let path = path.map_or_else(
        || String::from("desktop session"),
        |path| path.to_string_lossy().into_owned(),
    );
    DocumentInspection {
        source,
        path,
        document_id: snapshot.document_id.to_string(),
        format: snapshot.format.to_string(),
        format_version: snapshot.format_version,
        heads: snapshot.heads.iter().map(ToString::to_string).collect(),
        page_ids: snapshot.document.page_ids.iter().map(ToString::to_string).collect(),
        counts: counts(snapshot),
    }
}

fn counts(snapshot: &DocumentSnapshot) -> DocumentCounts {
    DocumentCounts {
        pages: snapshot.document.pages.len(),
        layers: snapshot.document.layers.len(),
        shapes: snapshot.document.shapes.len(),
        bindings: snapshot.document.bindings.len(),
        assets: snapshot.document.assets.len(),
    }
}

fn session_discovery(status: SessionStatus) -> SessionDiscovery {
    SessionDiscovery {
        session_id: status.session_id.0,
        path: status.path.0,
        actor_id: status.actor_id.to_string(),
        document_id: status.snapshot.document_id.to_string(),
        format: status.snapshot.format.to_string(),
        format_version: status.snapshot.format_version,
        heads: status.snapshot.heads.into_iter().map(|head| head.to_string()).collect(),
        dirty: status.dirty,
        lock_held: status.lock_held,
        recovery_available: status.recovery_available,
        sync_enabled: matches!(status.sync, SyncState::Enabled { .. }),
    }
}

fn file_discovery(path: &Path, snapshot: &DocumentSnapshot) -> FileDiscovery {
    FileDiscovery {
        path: path.to_string_lossy().into_owned(),
        document_id: snapshot.document_id.to_string(),
        format: snapshot.format.to_string(),
        format_version: snapshot.format_version,
        heads: snapshot.heads.iter().map(ToString::to_string).collect(),
        counts: counts(snapshot),
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| {
        if path.is_absolute() {
            path.to_owned()
        } else {
            std::env::current_dir().map_or_else(|_| path.to_owned(), |directory| directory.join(path))
        }
    })
}

fn ipc_mcp_error(error: &IpcError) -> McpError {
    internal_error(format!("Inkfinite Desktop is unavailable: {error}"))
}

fn protocol_mcp_error(error: ProtocolError) -> McpError {
    McpError::internal_error(
        format!("Inkfinite desktop request failed [{}]: {}", error.code, error.message),
        error.details,
    )
}

fn internal_error(message: impl Into<String>) -> McpError {
    McpError::internal_error(message.into(), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use inkfinite_core::{DocumentId, blank_document};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn capabilities_identify_read_only_stdio_surface() {
        let metadata = InkfiniteMcp::capabilities();
        assert_eq!(metadata.server, SERVER_NAME);
        assert_eq!(metadata.transport, "stdio");
        assert!(metadata.operations.contains(&"inkfinite_query_records".into()));
        assert!(metadata.shape_kinds.contains(&"rect".into()));
    }

    #[test]
    fn configured_paths_are_normalized_and_deduplicated() {
        let server = InkfiniteMcp::new([PathBuf::from("."), PathBuf::from("./")]);
        assert_eq!(server.accessible_paths().len(), 1);
    }

    #[test]
    fn target_rejects_ambiguous_sources() {
        let error = validate_target(&DocumentTarget {
            session_id: Some("session:one".into()),
            path: Some("board.inkfinite".into()),
        })
        .expect_err("both sources should be rejected");
        assert_eq!(error.code, rmcp::model::ErrorCode::INVALID_PARAMS);
    }

    #[test]
    fn file_query_uses_core_query_filters() {
        let directory = std::env::temp_dir();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = directory.join(format!("inkfinite-mcp-test-{suffix}.inkfinite"));
        let mut engine = TransactionEngine::create(
            DocumentId::from("document:mcp-test"),
            ActorId::from(MCP_READER_ACTOR),
            blank_document(&DocumentId::from("document:mcp-test"), None),
        )
        .expect("blank document should be valid");
        fs::write(&path, engine.save().expect("document should save")).expect("document should write");

        let server = InkfiniteMcp::new([path.clone()]);
        let (_, mut engine) = server
            .file_engine(path.to_str().expect("temporary path is UTF-8"))
            .expect("file should load");
        let result = engine
            .query(&Query { name: Some("Page 1".into()), ..Query::default() })
            .expect("query should use the core engine");
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.total, 1);
        let _ = fs::remove_file(path);
    }
}
