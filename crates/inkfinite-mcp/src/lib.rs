//! Permission-aware MCP discovery and mutation access for Inkfinite.
//!
//! The server uses Inkfinite's local IPC contract for live desktop sessions and
//! the core transaction engine for explicitly configured files. It never
//! shells out to the CLI and does not treat an arbitrary path supplied by a
//! model as permission to read or change it.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

mod policy;

pub use policy::{HiddenLayerPolicy, McpDocumentPolicy, McpPermissions, McpPolicy, POLICY_ENV};

use inkfinite_core::engine::{EngineError, TransactionEngine};
use inkfinite_core::file::{DocumentFile, FileError};
use inkfinite_core::ipc::{self, AppRequest, AppResponse, IpcError};
use inkfinite_core::proto::{
    AffectedRegion, Bounds, CommitResult, DocumentPatch, Operation, Proposal, ProposalId, ProtocolError, Query,
    QueryResult, RecordId, TransactionDraft, TransactionId, Warning,
};
use inkfinite_core::session::{ProposalStatus, SessionStatus, SyncState};
use inkfinite_core::svg_import::import_svg as parse_svg;
use inkfinite_core::svg_transaction::{SvgImportTransactionOptions, build_svg_import_transaction};
use inkfinite_core::{ActorId, BUILTIN_SHAPE_KINDS, ChangeHash, DocumentSnapshot, LayerId, Origin, PageId, Timestamp};
use rmcp::handler::server::wrapper::{Json, Parameters};
use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};
use rmcp::{ErrorData as McpError, ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Stable MCP server name advertised during initialization.
pub const SERVER_NAME: &str = "inkfinite-mcp";
/// Human-readable description of the server's current surface.
pub const SERVER_DESCRIPTION: &str = "Permissioned local discovery and mutation access for Inkfinite documents";
/// Environment variable containing the explicitly accessible document paths.
pub const DOCUMENTS_ENV: &str = "INKFINITE_MCP_DOCUMENTS";
const MCP_ACTOR: &str = "actor:inkfinite-mcp";
const MAX_MUTATION_OPERATIONS: usize = 256;

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
    /// Match one exact semantic relationship type.
    pub relation_type: Option<String>,
    /// Restrict relationship records to those incoming to this shape.
    pub incoming_to: Option<String>,
    /// Restrict relationship records to those outgoing from this shape.
    pub outgoing_from: Option<String>,
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

/// Parameters shared by all transaction-backed MCP mutations.
#[derive(Clone, Debug, Default, Deserialize, JsonSchema)]
pub struct MutationParams {
    /// Document source to mutate. Omit both fields only when one source is available.
    #[serde(flatten)]
    pub target: DocumentTarget,
    /// Causal heads inspected by the caller. The current heads are used when omitted.
    pub base_heads: Option<Vec<ChangeHash>>,
    /// Stable transaction identifier. One is derived from the current heads when omitted.
    pub transaction_id: Option<String>,
    /// Human-readable history description.
    pub description: Option<String>,
    /// Ordered core operations to validate and commit as one transaction.
    pub operations: Vec<Operation>,
    /// Validate and return the patch without changing the document.
    #[serde(default)]
    pub dry_run: bool,
}

/// Parameters for importing SVG markup through the shared Rust importer.
#[derive(Clone, Debug, Default, Deserialize, JsonSchema)]
pub struct ImportSvgParams {
    /// Document source to mutate. Omit both fields only when one source is available.
    #[serde(flatten)]
    pub target: DocumentTarget,
    /// SVG markup to parse and import.
    pub svg: String,
    /// Optional source filename retained in provenance and the root name.
    pub source_name: Option<String>,
    /// Target page. The active page or first page is used when omitted.
    pub page_id: Option<String>,
    /// Target layer. The active layer or first layer on the page is used when omitted.
    pub layer_id: Option<String>,
    /// Stable transaction identifier. One is derived from the source asset when omitted.
    pub transaction_id: Option<String>,
    /// Human-readable history description.
    pub description: Option<String>,
    /// Validate and return the patch without changing the document.
    #[serde(default)]
    pub dry_run: bool,
}

/// Parameters for submitting a transaction to desktop review.
#[derive(Clone, Debug, Default, Deserialize, JsonSchema)]
pub struct ProposalParams {
    /// Open desktop session to use. Proposals are unavailable for standalone files.
    #[serde(flatten)]
    pub target: DocumentTarget,
    /// Causal heads inspected by the caller. The current heads are used when omitted.
    pub base_heads: Option<Vec<ChangeHash>>,
    /// Stable transaction identifier. One is derived from the current heads when omitted.
    pub transaction_id: Option<String>,
    /// Human-readable review description.
    pub description: Option<String>,
    /// Ordered core operations to preview and submit for review.
    pub operations: Vec<Operation>,
}

/// Parameters for polling a desktop proposal's review state.
#[derive(Clone, Debug, Deserialize, JsonSchema)]
pub struct ProposalStatusParams {
    /// Open desktop session that owns the proposal.
    #[serde(flatten)]
    pub target: DocumentTarget,
    /// Proposal identifier returned by `inkfinite_propose`.
    pub proposal_id: String,
}

/// Result returned by every MCP mutation, including dry runs.
#[derive(Clone, Debug, JsonSchema, Serialize)]
pub struct MutationResult {
    /// Transaction identifier used by the core engine.
    pub transaction_id: TransactionId,
    /// Causal heads observed before validation.
    pub previous_heads: Vec<ChangeHash>,
    /// Causal heads after commit, or the unchanged heads after a dry run.
    pub current_heads: Vec<ChangeHash>,
    /// Records created, changed, or deleted by the transaction.
    pub patch: DocumentPatch,
    /// Records affected directly or through deterministic hierarchy repairs.
    pub affected_ids: Vec<RecordId>,
    /// Visual regions invalidated by the transaction.
    pub affected_regions: Vec<AffectedRegion>,
    /// Non-fatal repairs performed by the core engine.
    pub warnings: Vec<Warning>,
    /// Parser or renderer diagnostics that are not core commit warnings.
    pub diagnostics: Vec<String>,
    /// Whether the document was left unchanged.
    pub dry_run: bool,
    /// Native shape IDs created by an SVG import.
    pub imported_shape_ids: Vec<inkfinite_core::ShapeId>,
    /// Asset IDs included by an SVG import.
    pub imported_asset_ids: Vec<inkfinite_core::AssetId>,
    /// SVG image nodes omitted because no native representation was available.
    pub omitted_image_count: usize,
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
    /// Default scopes advertised by this process.
    pub default_policy: McpDocumentPolicy,
    /// Environment variable used to configure source-specific policies.
    pub policy_source: String,
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
    /// Read and mutation operations currently exposed by this server.
    pub operations: Vec<String>,
    /// How a source becomes visible to this server.
    pub source_policy: String,
}

/// The stdio MCP server and its explicit file access policy.
#[derive(Clone, Debug, Default)]
pub struct InkfiniteMcp {
    accessible_paths: BTreeSet<PathBuf>,
    policy: McpPolicy,
}

enum MutationDestination {
    Session(String),
    File(Box<DocumentFile>),
}

struct MutationData {
    patch: DocumentPatch,
    affected_ids: Vec<RecordId>,
    affected_regions: Vec<AffectedRegion>,
    warnings: Vec<Warning>,
    diagnostics: Vec<String>,
}

struct ResolvedMutation {
    destination: MutationDestination,
    snapshot: DocumentSnapshot,
    actor_id: ActorId,
    policy: McpDocumentPolicy,
}

impl InkfiniteMcp {
    /// Creates a server with the supplied file paths as its file access allowlist.
    #[must_use]
    pub fn new(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        Self::new_with_policy(paths, McpPolicy::default())
    }

    /// Creates a server with an explicit file allowlist and access policy.
    #[must_use]
    pub fn new_with_policy(paths: impl IntoIterator<Item = PathBuf>, policy: McpPolicy) -> Self {
        Self {
            accessible_paths: paths.into_iter().map(|path| normalize_path(&path)).collect(),
            policy: policy.normalize_document_paths(),
        }
    }

    /// Creates a server from [`DOCUMENTS_ENV`] and [`POLICY_ENV`].
    #[must_use]
    pub fn from_environment() -> Self {
        let paths = std::env::var_os(DOCUMENTS_ENV)
            .into_iter()
            .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        Self::new_with_policy(paths, McpPolicy::from_environment())
    }

    /// Returns the configured file allowlist in stable path order.
    #[must_use]
    pub fn accessible_paths(&self) -> Vec<PathBuf> {
        self.accessible_paths.iter().cloned().collect()
    }

    /// Returns capability metadata with this server's default policy.
    #[must_use]
    pub fn capability_metadata(&self) -> CapabilityMetadata {
        let mut metadata = Self::capabilities();
        metadata.default_policy = self.policy.default.clone();
        metadata
    }

    /// Returns the policy used by this server.
    #[must_use]
    pub fn policy(&self) -> &McpPolicy {
        &self.policy
    }

    /// Returns the metadata advertised by the capability tool and server instructions.
    #[must_use]
    pub fn capabilities() -> CapabilityMetadata {
        CapabilityMetadata {
            server: SERVER_NAME.into(),
            description: SERVER_DESCRIPTION.into(),
            transport: "stdio".into(),
            default_policy: McpDocumentPolicy::default(),
            policy_source: format!("{POLICY_ENV} (JSON)"),
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
                "inkfinite_mutate".into(),
                "inkfinite_import_svg".into(),
                "inkfinite_propose".into(),
                "inkfinite_proposal_status".into(),
            ],
            source_policy: format!(
                "Open desktop sessions are discovered through authenticated local IPC; standalone files must be listed in {DOCUMENTS_ENV} or supplied as server command-line paths. Read-only access is the default; scopes, hidden-layer visibility, and agent_editable enforcement are configured through {POLICY_ENV}. Desktop review accepts or rejects proposals."
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
                    InspectionSource::Session { session_id: session_id.clone() },
                    path,
                    self.session_policy(&session_id).hidden_layers,
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
            Err(authorization_error(
                "file is not in the configured MCP document allowlist",
                Some(serde_json::json!({ "permission": "read", "path": raw_path })),
            ))
        }
    }

    fn session_policy(&self, session_id: &str) -> McpDocumentPolicy {
        self.policy.for_session(session_id)
    }

    fn document_policy(&self, path: &Path) -> McpDocumentPolicy {
        self.policy.for_document(path)
    }

    fn file_engine(&self, raw_path: &str) -> Result<(PathBuf, TransactionEngine), McpError> {
        let path = self.file_path(raw_path)?;
        let bytes = fs::read(&path).map_err(|error| {
            internal_error(format!(
                "could not read configured Inkfinite file {}: {error}",
                path.display()
            ))
        })?;
        let engine = TransactionEngine::load(&bytes, ActorId::from(MCP_ACTOR)).map_err(|error| {
            internal_error(format!(
                "could not load configured Inkfinite file {}: {error}",
                path.display()
            ))
        })?;
        Ok((path, engine))
    }

    async fn resolve_mutation_target(&self, target: &DocumentTarget) -> Result<ResolvedMutation, McpError> {
        validate_target(target)?;
        if let Some(session_id) = &target.session_id {
            return self.open_session_mutation(session_id).await;
        }
        if let Some(path) = &target.path {
            return self.open_file_mutation(path);
        }

        let statuses = match self.session_statuses().await {
            Ok(statuses) => statuses,
            Err(_error) if !self.accessible_paths.is_empty() => Vec::new(),
            Err(error) => return Err(error),
        };
        if statuses.len() == 1 {
            return self.open_session_mutation(&statuses[0].session_id.0).await;
        }
        if statuses.is_empty()
            && self.accessible_paths.len() == 1
            && let Some(path) = self.accessible_paths.iter().next()
        {
            return self.open_file_mutation(&path.to_string_lossy());
        }
        Err(McpError::invalid_params(
            if statuses.is_empty() {
                "document source is required; no open session or unique configured file is available"
            } else {
                "document source is required because multiple open sessions are available"
            },
            Some(serde_json::json!({ "code": "document_source_required" })),
        ))
    }

    async fn open_session_mutation(&self, session_id: &str) -> Result<ResolvedMutation, McpError> {
        let status = self
            .session_statuses()
            .await?
            .into_iter()
            .find(|status| status.session_id.0 == session_id)
            .ok_or_else(|| {
                McpError::invalid_params(
                    format!("desktop session {session_id} is not open"),
                    Some(serde_json::json!({ "code": "session_not_found", "session_id": session_id })),
                )
            })?;
        Ok(ResolvedMutation {
            destination: MutationDestination::Session(status.session_id.0.clone()),
            snapshot: status.snapshot,
            actor_id: status.actor_id,
            policy: self.session_policy(session_id),
        })
    }

    fn open_file_mutation(&self, raw_path: &str) -> Result<ResolvedMutation, McpError> {
        let path = self.file_path(raw_path)?;
        let file = DocumentFile::open(&path, ActorId::from(MCP_ACTOR)).map_err(|error| file_mutation_error(&error))?;
        let mut snapshot_file = file;
        let snapshot = snapshot_file.snapshot().map_err(|error| file_mutation_error(&error))?;
        let actor_id = snapshot_file.actor_id().clone();
        let policy = self.document_policy(&path);
        Ok(ResolvedMutation {
            destination: MutationDestination::File(Box::new(snapshot_file)),
            snapshot,
            actor_id,
            policy,
        })
    }

    async fn session_context(&self, session_id: &str) -> Result<inkfinite_core::session::SessionContext, McpError> {
        let response = ipc::send(AppRequest::Context {
            session_id: Some(inkfinite_core::proto::SessionId(session_id.to_owned())),
        })
        .await
        .map_err(|error| ipc_mcp_error(&error))?;
        match response.result {
            Ok(AppResponse::Context(context)) => Ok(context),
            Ok(_) => Err(internal_error("desktop returned an unexpected context response")),
            Err(error) => Err(protocol_mcp_error(error)),
        }
    }

    fn build_transaction(resolved: &ResolvedMutation, params: &MutationParams) -> Result<TransactionDraft, McpError> {
        Self::build_transaction_parts(
            resolved,
            params.base_heads.clone(),
            params.transaction_id.clone(),
            params.description.clone(),
            params.operations.clone(),
            "MCP mutation",
        )
    }

    fn build_transaction_parts(
        resolved: &ResolvedMutation, base_heads: Option<Vec<ChangeHash>>, transaction_id: Option<String>,
        description: Option<String>, operations: Vec<Operation>, default_description: &str,
    ) -> Result<TransactionDraft, McpError> {
        validate_mutation_limits(&operations, description.as_deref())?;
        let base_heads = base_heads.unwrap_or_else(|| resolved.snapshot.heads.clone());
        let transaction_id = transaction_id.unwrap_or_else(|| {
            let heads = base_heads.iter().map(ToString::to_string).collect::<Vec<_>>().join(".");
            format!("transaction:mcp:{heads}:{}", operations.len())
        });
        Ok(TransactionDraft {
            id: TransactionId(transaction_id),
            actor_id: resolved.actor_id.clone(),
            origin: Origin::Agent,
            base_heads,
            description: description.unwrap_or_else(|| default_description.into()),
            operations,
            timestamp: Timestamp(0),
        })
    }

    async fn execute_mutation(
        &self, resolved: ResolvedMutation, transaction: TransactionDraft, dry_run: bool,
    ) -> Result<MutationResult, McpError> {
        let previous_heads = resolved.snapshot.heads.clone();
        match resolved.destination {
            MutationDestination::File(mut file) => {
                if dry_run {
                    let preview = file
                        .engine_mut()
                        .preview(&transaction)
                        .map_err(|error| engine_mutation_error_with_heads(&error, &previous_heads))?;
                    return Ok(mutation_result(
                        transaction.id,
                        previous_heads,
                        MutationData {
                            patch: preview.patch,
                            affected_ids: preview.affected_ids,
                            affected_regions: preview.affected_regions,
                            warnings: Vec::new(),
                            diagnostics: Vec::new(),
                        },
                        true,
                    ));
                }
                let commit = file
                    .commit(transaction)
                    .map_err(|error| file_mutation_error_with_heads(&error, &previous_heads))?;
                let result = mutation_result_from_commit(commit, previous_heads, false);
                file.save().map_err(|error| file_mutation_error(&error))?;
                Ok(result)
            }
            MutationDestination::Session(session_id) => {
                let session_id = inkfinite_core::proto::SessionId(session_id);
                if dry_run {
                    let response = ipc::send(AppRequest::Render {
                        session_id: Some(session_id),
                        transaction: Some(transaction.clone()),
                        page_id: None,
                        region: None,
                    })
                    .await
                    .map_err(|error| ipc_mcp_error(&error))?;
                    let preview = match response.result {
                        Ok(AppResponse::Rendered(preview)) => *preview,
                        Ok(_) => {
                            return Err(internal_error(
                                "desktop returned an unexpected mutation preview response",
                            ));
                        }
                        Err(error) => return Err(mutation_protocol_error(error)),
                    };
                    let patch = preview.preview.ok_or_else(|| {
                        internal_error("desktop did not return a transaction patch for the mutation preview")
                    })?;
                    let affected_ids = patch_record_ids(&patch);
                    return Ok(mutation_result(
                        transaction.id,
                        previous_heads,
                        MutationData {
                            patch,
                            affected_ids,
                            affected_regions: preview.affected_regions,
                            warnings: Vec::new(),
                            diagnostics: preview.warnings,
                        },
                        true,
                    ));
                }
                let response = ipc::send(AppRequest::Apply { session_id: Some(session_id), transaction })
                    .await
                    .map_err(|error| ipc_mcp_error(&error))?;
                match response.result {
                    Ok(AppResponse::Committed(commit)) => {
                        Ok(mutation_result_from_commit(commit.commit, previous_heads, false))
                    }
                    Ok(_) => Err(internal_error("desktop returned an unexpected mutation response")),
                    Err(error) => Err(mutation_protocol_error(error)),
                }
            }
        }
    }

    async fn import_svg_mutation(&self, params: ImportSvgParams) -> Result<MutationResult, McpError> {
        if params.svg.trim().is_empty() {
            return Err(McpError::invalid_params(
                "SVG markup must not be empty",
                Some(serde_json::json!({ "code": "invalid_svg_input" })),
            ));
        }
        let resolved = self.resolve_mutation_target(&params.target).await?;
        let context = match &resolved.destination {
            MutationDestination::Session(session_id) => Some(self.session_context(session_id).await?),
            MutationDestination::File(_) => None,
        };
        let parsed = parse_svg(params.svg.as_bytes()).map_err(|error| {
            McpError::invalid_params(
                format!("could not parse SVG input: {error}"),
                Some(serde_json::json!({ "code": "svg_import_failed" })),
            )
        })?;
        let page_id = params
            .page_id
            .map(PageId::from)
            .or_else(|| context.as_ref().and_then(|context| context.page_id.clone()))
            .or_else(|| resolved.snapshot.document.page_ids.first().cloned())
            .ok_or_else(|| import_error("document has no page for SVG import"))?;
        let page = resolved
            .snapshot
            .document
            .pages
            .get(&page_id)
            .ok_or_else(|| import_error(format!("page {page_id} does not exist")))?;
        let layer_id = params
            .layer_id
            .map(LayerId::from)
            .or_else(|| {
                context.as_ref().and_then(|context| {
                    context
                        .active_layer_id
                        .clone()
                        .filter(|layer_id| page.layer_ids.contains(layer_id))
                })
            })
            .or_else(|| page.layer_ids.first().cloned())
            .ok_or_else(|| import_error(format!("page {page_id} has no layer for SVG import")))?;
        let digest = parsed.source_asset.digest.replace(':', "-");
        let transaction_id = params
            .transaction_id
            .map(TransactionId)
            .unwrap_or_else(|| TransactionId(format!("transaction:svg-import:{digest}")));
        let transaction = build_svg_import_transaction(
            &resolved.snapshot,
            &parsed,
            SvgImportTransactionOptions {
                actor_id: resolved.actor_id.clone(),
                origin: Origin::Agent,
                page_id,
                layer_id,
                transaction_id,
                description: params.description.unwrap_or_else(|| {
                    params
                        .source_name
                        .as_deref()
                        .map(|name| format!("Import SVG {name}"))
                        .unwrap_or_else(|| "Import SVG".into())
                }),
                source_name: params.source_name,
                timestamp: Timestamp(0),
            },
        )
        .map_err(|error| import_error(error.to_string()))?;
        validate_mutation_limits(
            &transaction.transaction.operations,
            Some(&transaction.transaction.description),
        )?;
        policy::authorize_operations(
            &resolved.snapshot,
            &transaction.transaction.operations,
            &resolved.policy,
        )
        .map_err(|violation| policy_violation_error(&violation))?;
        let shape_ids = transaction.shape_ids;
        let asset_ids = transaction.asset_ids;
        let omitted_image_count = transaction.omitted_image_count;
        let diagnostics: Vec<String> = parsed.warnings.iter().map(ToString::to_string).collect();
        let mut result = self
            .execute_mutation(resolved, transaction.transaction, params.dry_run)
            .await?;
        result.imported_shape_ids = shape_ids;
        result.imported_asset_ids = asset_ids;
        result.omitted_image_count = omitted_image_count;
        result.diagnostics.extend(diagnostics);
        Ok(result)
    }

    async fn propose_document(&self, params: ProposalParams) -> Result<Proposal, McpError> {
        let resolved = self.resolve_mutation_target(&params.target).await?;
        if !resolved.policy.permissions.propose {
            return Err(authorization_error(
                "proposal submission is not granted for this source",
                Some(serde_json::json!({ "permission": "propose" })),
            ));
        }
        policy::authorize_operations(&resolved.snapshot, &params.operations, &resolved.policy)
            .map_err(|violation| policy_violation_error(&violation))?;
        let transaction = Self::build_transaction_parts(
            &resolved,
            params.base_heads,
            params.transaction_id,
            params.description,
            params.operations,
            "MCP proposal",
        )?;
        let MutationDestination::Session(session_id) = resolved.destination else {
            return Err(authorization_error(
                "desktop review is available only for open sessions",
                Some(serde_json::json!({ "code": "proposal_requires_session" })),
            ));
        };
        let response = ipc::send(AppRequest::Propose {
            session_id: Some(inkfinite_core::proto::SessionId(session_id)),
            transaction,
        })
        .await
        .map_err(|error| ipc_mcp_error(&error))?;
        match response.result {
            Ok(AppResponse::Proposed(proposal)) => Ok(proposal),
            Ok(_) => Err(internal_error("desktop returned an unexpected proposal response")),
            Err(error) => Err(mutation_protocol_error(error)),
        }
    }

    async fn read_proposal_status(&self, params: ProposalStatusParams) -> Result<ProposalStatus, McpError> {
        validate_target(&params.target)?;
        if params.proposal_id.trim().is_empty() {
            return Err(McpError::invalid_params("proposal_id must not be empty", None));
        }
        if params.target.path.is_some() {
            return Err(authorization_error(
                "proposal review is available only for open sessions",
                Some(serde_json::json!({ "code": "proposal_requires_session" })),
            ));
        }
        let session_id = if let Some(session_id) = &params.target.session_id {
            session_id.clone()
        } else {
            let statuses = self.session_statuses().await?;
            if statuses.len() == 1 {
                statuses[0].session_id.0.clone()
            } else {
                return Err(McpError::invalid_params(
                    if statuses.is_empty() {
                        "no open desktop session is available for proposal review"
                    } else {
                        "session_id is required because multiple desktop sessions are open"
                    },
                    Some(serde_json::json!({ "code": "session_selection_required" })),
                ));
            }
        };
        let policy = self.session_policy(&session_id);
        ensure_read(&policy)?;
        if !policy.permissions.propose {
            return Err(authorization_error(
                "proposal review is not granted for this source",
                Some(serde_json::json!({ "permission": "propose" })),
            ));
        }
        let response = ipc::send(AppRequest::ProposalStatus {
            session_id: Some(inkfinite_core::proto::SessionId(session_id)),
            proposal_id: ProposalId(params.proposal_id),
        })
        .await
        .map_err(|error| ipc_mcp_error(&error))?;
        match response.result {
            Ok(AppResponse::ProposalStatus(status)) => Ok(status),
            Ok(_) => Err(internal_error(
                "desktop returned an unexpected proposal status response",
            )),
            Err(error) => Err(mutation_protocol_error(error)),
        }
    }

    async fn query_target(&self, target: &DocumentTarget, query: Query) -> Result<QueryResult, McpError> {
        validate_target(target)?;
        let limit = query.limit;
        let query = Query { limit: None, ..query };
        if let Some(session_id) = &target.session_id {
            let policy = self.session_policy(session_id);
            ensure_read(&policy)?;
            let snapshot = session_snapshot(session_id).await?;
            let result = query_session(Some(session_id), query).await?;
            return Ok(policy::filter_query_result(
                result,
                &snapshot,
                policy.hidden_layers,
                limit,
            ));
        }
        if let Some(path) = &target.path {
            let path = self.file_path(path)?;
            let policy = self.document_policy(&path);
            ensure_read(&policy)?;
            let (_, mut engine) = self.file_engine(&path.to_string_lossy())?;
            let snapshot = engine
                .snapshot()
                .map_err(|error| internal_error(format!("could not query document: {error}")))?;
            let result = engine
                .query(&query)
                .map_err(|error| internal_error(format!("could not query document: {error}")))?;
            return Ok(policy::filter_query_result(
                result,
                &snapshot,
                policy.hidden_layers,
                limit,
            ));
        }

        let statuses = match self.session_statuses().await {
            Ok(statuses) => statuses,
            Err(_error) if !self.accessible_paths.is_empty() => Vec::new(),
            Err(error) => return Err(error),
        };
        if statuses.len() == 1 {
            let session_id = &statuses[0].session_id.0;
            let policy = self.session_policy(session_id);
            ensure_read(&policy)?;
            let result = query_session(Some(session_id), query).await?;
            return Ok(policy::filter_query_result(
                result,
                &statuses[0].snapshot,
                policy.hidden_layers,
                limit,
            ));
        }
        if statuses.is_empty()
            && self.accessible_paths.len() == 1
            && let Some(path) = self.accessible_paths.iter().next()
        {
            let policy = self.document_policy(path);
            ensure_read(&policy)?;
            let raw_path = path.to_string_lossy();
            let (_, mut engine) = self.file_engine(&raw_path)?;
            let snapshot = engine
                .snapshot()
                .map_err(|error| internal_error(format!("could not query document: {error}")))?;
            let result = engine
                .query(&query)
                .map_err(|error| internal_error(format!("could not query document: {error}")))?;
            return Ok(policy::filter_query_result(
                result,
                &snapshot,
                policy.hidden_layers,
                limit,
            ));
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
            ensure_read(&self.session_policy(session_id))?;
            return self.session_inspection(session_id.clone()).await;
        }
        if let Some(path) = &target.path {
            let path = self.file_path(path)?;
            let policy = self.document_policy(&path);
            ensure_read(&policy)?;
            let (path, mut engine) = self.file_engine(&path.to_string_lossy())?;
            let snapshot = engine
                .snapshot()
                .map_err(|error| internal_error(format!("could not inspect configured Inkfinite file: {error}")))?;
            return Ok(snapshot_inspection(
                &snapshot,
                InspectionSource::File,
                Some(path),
                policy.hidden_layers,
            ));
        }

        let statuses = match self.session_statuses().await {
            Ok(statuses) => statuses,
            Err(_error) if !self.accessible_paths.is_empty() => Vec::new(),
            Err(error) => return Err(error),
        };
        if statuses.len() == 1 {
            ensure_read(&self.session_policy(&statuses[0].session_id.0))?;
            return self.session_inspection(statuses[0].session_id.0.clone()).await;
        }
        if statuses.is_empty()
            && self.accessible_paths.len() == 1
            && let Some(path) = self.accessible_paths.iter().next()
        {
            let policy = self.document_policy(path);
            ensure_read(&policy)?;
            let (path, mut engine) = self.file_engine(&path.to_string_lossy())?;
            let snapshot = engine
                .snapshot()
                .map_err(|error| internal_error(format!("could not inspect configured Inkfinite file: {error}")))?;
            return Ok(snapshot_inspection(
                &snapshot,
                InspectionSource::File,
                Some(path),
                policy.hidden_layers,
            ));
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
        let sessions = statuses
            .into_iter()
            .filter(|status| self.session_policy(&status.session_id.0).permissions.read)
            .map(session_discovery)
            .collect();
        let files = self
            .accessible_paths
            .iter()
            .filter(|path| !open_paths.contains(*path))
            .filter(|path| self.document_policy(path).permissions.read)
            .filter_map(|path| {
                let raw_path = path.to_string_lossy();
                let (_, mut engine) = self.file_engine(&raw_path).ok()?;
                let snapshot = engine.snapshot().ok()?;
                let hidden_layers = self.document_policy(path).hidden_layers;
                Some(file_discovery(path, &snapshot, hidden_layers))
            })
            .collect();
        DocumentDiscovery { desktop_available, sessions, files }
    }
}

#[tool_router]
impl InkfiniteMcp {
    /// Returns the document format, protocol, shape registry, and read/write surface.
    #[tool(
        name = "inkfinite_capabilities",
        description = "Describe Inkfinite MCP capabilities and source access policy"
    )]
    pub fn capabilities_tool(&self) -> Json<CapabilityMetadata> {
        Json(self.capability_metadata())
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
            .filter(|status| self.session_policy(&status.session_id.0).permissions.read)
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
            relation_type: params.relation_type,
            incoming_to: params.incoming_to.map(Into::into),
            outgoing_from: params.outgoing_from.map(Into::into),
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

    /// Validates and optionally commits one ordered core transaction.
    #[tool(
        name = "inkfinite_mutate",
        description = "Create, patch, move, reparent, delete, connect, and lay out Inkfinite records through one validated transaction"
    )]
    pub async fn mutate_document(
        &self, Parameters(params): Parameters<MutationParams>,
    ) -> Result<Json<MutationResult>, McpError> {
        let resolved = self.resolve_mutation_target(&params.target).await?;
        policy::authorize_operations(&resolved.snapshot, &params.operations, &resolved.policy)
            .map_err(|violation| policy_violation_error(&violation))?;
        let transaction = Self::build_transaction(&resolved, &params)?;
        Ok(Json(
            self.execute_mutation(resolved, transaction, params.dry_run).await?,
        ))
    }

    /// Parses SVG markup and commits its native shapes and retained assets as one transaction.
    #[tool(
        name = "inkfinite_import_svg",
        description = "Import SVG markup into the active or selected Inkfinite page and layer using the shared Rust importer"
    )]
    pub async fn import_svg(
        &self, Parameters(params): Parameters<ImportSvgParams>,
    ) -> Result<Json<MutationResult>, McpError> {
        Ok(Json(self.import_svg_mutation(params).await?))
    }

    /// Validates and submits a transaction to the open desktop session for human review.
    #[tool(
        name = "inkfinite_propose",
        description = "Submit a validated Inkfinite transaction for desktop review without changing the document"
    )]
    pub async fn propose(&self, Parameters(params): Parameters<ProposalParams>) -> Result<Json<Proposal>, McpError> {
        Ok(Json(self.propose_document(params).await?))
    }

    /// Polls the review state of a proposal created for an open desktop session.
    #[tool(
        name = "inkfinite_proposal_status",
        description = "Read the current or completed desktop review state for an Inkfinite proposal"
    )]
    pub async fn proposal_status(
        &self, Parameters(params): Parameters<ProposalStatusParams>,
    ) -> Result<Json<ProposalStatus>, McpError> {
        Ok(Json(self.read_proposal_status(params).await?))
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
                "Use the Inkfinite discovery and read tools to inspect current heads before mutating. Mutations are validated by inkfinite-core; open sessions use authenticated local IPC and standalone files are limited to the server's configured allowlist. Set dry_run to preview a transaction without changing the document.",
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

fn ensure_read(policy: &McpDocumentPolicy) -> Result<(), McpError> {
    if policy.permissions.read {
        Ok(())
    } else {
        Err(authorization_error(
            "read access is not granted for this source",
            Some(serde_json::json!({ "permission": "read" })),
        ))
    }
}

fn policy_violation_error(violation: &policy::PolicyViolation) -> McpError {
    authorization_error(
        format!(
            "{} is not authorized for {}: {}",
            violation.operation, violation.permission, violation.reason
        ),
        Some(serde_json::json!({
            "permission": violation.permission,
            "operation": violation.operation,
            "record_id": violation.record_id,
        })),
    )
}

fn authorization_error(message: impl Into<String>, details: Option<serde_json::Value>) -> McpError {
    let details = match details {
        Some(serde_json::Value::Object(mut details)) => {
            details.insert("code".into(), serde_json::Value::String("authorization_denied".into()));
            serde_json::Value::Object(details)
        }
        Some(details) => serde_json::json!({ "code": "authorization_denied", "details": details }),
        None => serde_json::json!({ "code": "authorization_denied" }),
    };
    McpError::invalid_params(message.into(), Some(details))
}

async fn session_snapshot(session_id: &str) -> Result<DocumentSnapshot, McpError> {
    let response =
        ipc::send(AppRequest::Inspect { session_id: Some(inkfinite_core::proto::SessionId(session_id.to_owned())) })
            .await
            .map_err(|error| ipc_mcp_error(&error))?;
    match response.result {
        Ok(AppResponse::Snapshot(snapshot)) => Ok(snapshot),
        Ok(_) => Err(internal_error("desktop returned an unexpected snapshot response")),
        Err(error) => Err(protocol_mcp_error(error)),
    }
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
    snapshot: &DocumentSnapshot, source: InspectionSource, path: Option<PathBuf>, hidden_layers: HiddenLayerPolicy,
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
        counts: counts(snapshot, hidden_layers),
    }
}

fn counts(snapshot: &DocumentSnapshot, hidden_layers: HiddenLayerPolicy) -> DocumentCounts {
    DocumentCounts {
        pages: snapshot.document.pages.len(),
        layers: snapshot
            .document
            .layers
            .keys()
            .filter(|id| policy::record_visible(snapshot, &RecordId::Layer((*id).clone()), hidden_layers))
            .count(),
        shapes: snapshot
            .document
            .shapes
            .keys()
            .filter(|id| policy::record_visible(snapshot, &RecordId::Shape((*id).clone()), hidden_layers))
            .count(),
        bindings: snapshot
            .document
            .bindings
            .keys()
            .filter(|id| policy::record_visible(snapshot, &RecordId::Binding((*id).clone()), hidden_layers))
            .count(),
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

fn file_discovery(path: &Path, snapshot: &DocumentSnapshot, hidden_layers: HiddenLayerPolicy) -> FileDiscovery {
    FileDiscovery {
        path: path.to_string_lossy().into_owned(),
        document_id: snapshot.document_id.to_string(),
        format: snapshot.format.to_string(),
        format_version: snapshot.format_version,
        heads: snapshot.heads.iter().map(ToString::to_string).collect(),
        counts: counts(snapshot, hidden_layers),
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

fn validate_mutation_limits(operations: &[Operation], description: Option<&str>) -> Result<(), McpError> {
    if operations.len() > MAX_MUTATION_OPERATIONS {
        return Err(McpError::invalid_params(
            format!(
                "mutation contains {} operations; the limit is {MAX_MUTATION_OPERATIONS}",
                operations.len()
            ),
            Some(serde_json::json!({ "code": "mutation_too_large", "max_operations": MAX_MUTATION_OPERATIONS })),
        ));
    }
    if description.is_some_and(|description| description.len() > 4096) {
        return Err(McpError::invalid_params(
            "mutation description is too long",
            Some(serde_json::json!({ "code": "description_too_long", "max_bytes": 4096 })),
        ));
    }
    Ok(())
}

fn mutation_result(
    transaction_id: TransactionId, previous_heads: Vec<ChangeHash>, data: MutationData, dry_run: bool,
) -> MutationResult {
    MutationResult {
        transaction_id,
        current_heads: previous_heads.clone(),
        previous_heads,
        patch: data.patch,
        affected_ids: data.affected_ids,
        affected_regions: data.affected_regions,
        warnings: data.warnings,
        diagnostics: data.diagnostics,
        dry_run,
        imported_shape_ids: Vec::new(),
        imported_asset_ids: Vec::new(),
        omitted_image_count: 0,
    }
}

fn mutation_result_from_commit(commit: CommitResult, previous_heads: Vec<ChangeHash>, dry_run: bool) -> MutationResult {
    MutationResult {
        transaction_id: commit.transaction_id,
        previous_heads,
        current_heads: commit.heads,
        patch: commit.patch,
        affected_ids: commit.affected_ids,
        affected_regions: commit.affected_regions,
        warnings: commit.warnings,
        diagnostics: Vec::new(),
        dry_run,
        imported_shape_ids: Vec::new(),
        imported_asset_ids: Vec::new(),
        omitted_image_count: 0,
    }
}

fn patch_record_ids(patch: &DocumentPatch) -> Vec<RecordId> {
    let mut ids = Vec::new();
    for id in patch.created.iter().chain(&patch.changed).chain(&patch.deleted) {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    ids
}

fn import_error(message: impl Into<String>) -> McpError {
    McpError::invalid_params(message.into(), Some(serde_json::json!({ "code": "svg_import_failed" })))
}

fn engine_error_code(error: &EngineError) -> &'static str {
    match error {
        EngineError::StaleHeads => "stale_heads",
        EngineError::Precondition(_) => "precondition_failed",
        EngineError::Permission(_) => "document_locked",
        EngineError::Schema(_) => "validation_error",
        EngineError::Invariant(_) => "validation_error",
        EngineError::Crdt(_) | EngineError::Sync(_) | EngineError::EmptyHistory { .. } => "document_engine_error",
    }
}

fn mutation_error(code: &str, message: impl Into<String>, invalid_params: bool) -> McpError {
    let data = Some(serde_json::json!({ "code": code }));
    if invalid_params {
        McpError::invalid_params(message.into(), data)
    } else {
        McpError::internal_error(message.into(), data)
    }
}

fn engine_mutation_error(error: &EngineError) -> McpError {
    let code = engine_error_code(error);
    mutation_error(code, format!("Inkfinite mutation failed [{code}]: {error}"), true)
}

fn engine_mutation_error_with_heads(error: &EngineError, heads: &[ChangeHash]) -> McpError {
    add_current_heads(engine_mutation_error(error), error, heads)
}

fn file_mutation_error(error: &FileError) -> McpError {
    let code = match error {
        FileError::Locked { .. } => "document_locked",
        FileError::Engine(error) => engine_error_code(error),
        FileError::InvalidDocument(_)
        | FileError::Json(_)
        | FileError::UnsupportedFormat { .. }
        | FileError::UnsupportedShapeKind { .. }
        | FileError::SamePath { .. }
        | FileError::RecoveryNotFound { .. }
        | FileError::InvalidRecovery(_)
        | FileError::RecoveryAhead { .. }
        | FileError::Io { .. }
        | FileError::AlreadyExists { .. }
        | FileError::Sync(_) => "document_file_error",
    };
    mutation_error(code, format!("Inkfinite mutation failed [{code}]: {error}"), true)
}

fn file_mutation_error_with_heads(error: &FileError, heads: &[ChangeHash]) -> McpError {
    match error {
        FileError::Engine(engine @ (EngineError::StaleHeads | EngineError::Precondition(_))) => {
            add_current_heads(file_mutation_error(error), engine, heads)
        }
        _ => file_mutation_error(error),
    }
}

fn add_current_heads(mut mapped: McpError, error: &EngineError, heads: &[ChangeHash]) -> McpError {
    if !matches!(error, EngineError::StaleHeads | EngineError::Precondition(_)) {
        return mapped;
    }
    let current_heads = serde_json::to_value(heads).unwrap_or_else(|_| serde_json::json!([]));
    match mapped.data.as_mut() {
        Some(serde_json::Value::Object(details)) => {
            details.insert("current_heads".into(), current_heads);
        }
        _ => mapped.data = Some(serde_json::json!({ "current_heads": current_heads })),
    }
    mapped
}

fn mutation_protocol_error(error: ProtocolError) -> McpError {
    let code = error.code;
    let message = format!("Inkfinite mutation failed [{code}]: {}", error.message);
    let details = match error.details {
        Some(serde_json::Value::Object(mut details)) => {
            details.insert("code".into(), serde_json::Value::String(code));
            serde_json::Value::Object(details)
        }
        Some(details) => serde_json::json!({ "code": code, "details": details }),
        None => serde_json::json!({ "code": code }),
    };
    McpError::invalid_params(message, Some(details))
}

fn internal_error(message: impl Into<String>) -> McpError {
    McpError::internal_error(message.into(), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use inkfinite_core::{
        DocumentId, Provenance, RecordVersion, SemanticMetadata, ShapeId, ShapeKind, ShapeParent, ShapeRecord,
        ShapeStyle, SiblingAnchor, Transform, Vec2, blank_document,
    };
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn blank_file(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("inkfinite-mcp-{label}-{suffix}.inkfinite"));
        let document_id = DocumentId::from(format!("document:mcp-{label}-{suffix}"));
        let mut engine = TransactionEngine::create(
            document_id.clone(),
            ActorId::from(MCP_ACTOR),
            blank_document(&document_id, None),
        )
        .expect("blank document should be valid");
        fs::write(&path, engine.save().expect("document should save")).expect("document should write");
        path
    }

    #[test]
    fn capabilities_identify_stdio_read_write_surface() {
        let metadata = InkfiniteMcp::capabilities();
        assert_eq!(metadata.server, SERVER_NAME);
        assert_eq!(metadata.transport, "stdio");
        assert!(metadata.operations.contains(&"inkfinite_query_records".into()));
        assert!(metadata.operations.contains(&"inkfinite_mutate".into()));
        assert!(metadata.operations.contains(&"inkfinite_import_svg".into()));
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

    #[tokio::test(flavor = "current_thread")]
    async fn default_policy_rejects_mutations_with_authorization_error() {
        let path = blank_file("read-only");
        let server = InkfiniteMcp::new([path.clone()]);
        let snapshot = {
            let (_, mut engine) = server
                .file_engine(path.to_str().expect("temporary path is UTF-8"))
                .expect("file should load");
            engine.snapshot().expect("snapshot should load")
        };
        let page_id = snapshot.document.page_ids[0].clone();
        let result = server
            .mutate_document(Parameters(MutationParams {
                target: DocumentTarget { path: Some(path.to_string_lossy().into_owned()), ..DocumentTarget::default() },
                operations: vec![Operation::RenamePage { page_id, name: "Denied".into(), expected_version: None }],
                ..MutationParams::default()
            }))
            .await;
        let error = match result {
            Ok(_) => panic!("the default policy must be read-only"),
            Err(error) => error,
        };
        assert_eq!(
            error
                .data
                .as_ref()
                .and_then(|data| data.get("code"))
                .and_then(serde_json::Value::as_str),
            Some("authorization_denied")
        );
        let _ = fs::remove_file(path);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn restricted_write_policy_allows_modify_but_not_delete() {
        let path = blank_file("restricted-write");
        let mut policy = McpPolicy::default();
        policy.default.permissions =
            McpPermissions { read: true, create: false, modify: true, delete: false, layout: false, propose: false };
        let server = InkfiniteMcp::new_with_policy([path.clone()], policy);
        let snapshot = {
            let (_, mut engine) = server
                .file_engine(path.to_str().expect("temporary path is UTF-8"))
                .expect("file should load");
            engine.snapshot().expect("snapshot should load")
        };
        let page_id = snapshot.document.page_ids[0].clone();
        let committed = server
            .mutate_document(Parameters(MutationParams {
                target: DocumentTarget { path: Some(path.to_string_lossy().into_owned()), ..DocumentTarget::default() },
                operations: vec![Operation::RenamePage {
                    page_id: page_id.clone(),
                    name: "Modified".into(),
                    expected_version: None,
                }],
                ..MutationParams::default()
            }))
            .await
            .expect("modify scope should allow page rename");
        assert!(!committed.0.dry_run);
        let result = server
            .mutate_document(Parameters(MutationParams {
                target: DocumentTarget { path: Some(path.to_string_lossy().into_owned()), ..DocumentTarget::default() },
                operations: vec![Operation::DeletePage { page_id, expected_version: None }],
                ..MutationParams::default()
            }))
            .await;
        let error = match result {
            Ok(_) => panic!("delete scope must remain denied"),
            Err(error) => error,
        };
        assert_eq!(
            error
                .data
                .as_ref()
                .and_then(|data| data.get("code"))
                .and_then(serde_json::Value::as_str),
            Some("authorization_denied")
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn file_query_uses_core_query_filters() {
        let path = blank_file("query");
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

    #[tokio::test(flavor = "current_thread")]
    async fn file_mutation_supports_preview_and_commit() {
        let path = blank_file("mutation");
        let server = InkfiniteMcp::new_with_policy([path.clone()], McpPolicy::all());
        let snapshot = {
            let (_, mut engine) = server
                .file_engine(path.to_str().expect("temporary path is UTF-8"))
                .expect("file should load");
            engine.snapshot().expect("snapshot should load")
        };
        let layer_id = snapshot
            .document
            .page_ids
            .first()
            .and_then(|page_id| snapshot.document.pages[page_id].layer_ids.first().cloned())
            .expect("blank document should have a layer");
        let shape_id = ShapeId::from("shape:mcp-rect");
        let shape = ShapeRecord {
            id: shape_id.clone(),
            kind: ShapeKind::from("rect"),
            parent: ShapeParent::Layer(layer_id),
            transform: Transform { translation: Vec2 { x: 10.0, y: 20.0 }, rotation: 0.0, scale_x: 1.0, scale_y: 1.0 },
            child_ids: Vec::new(),
            layout: None,
            properties: BTreeMap::from([("width".into(), json!(100.0)), ("height".into(), json!(60.0))]),
            metadata: SemanticMetadata {
                name: Some("MCP rectangle".into()),
                title: None,
                role: Some("test.rectangle".into()),
                description: None,
                body: None,
                tags: vec!["test".into()],
                source: None,
                link: None,
                custom_metadata: BTreeMap::new(),
                locked: false,
                agent_editable: true,
                provenance: Provenance {
                    actor_id: ActorId::from(MCP_ACTOR),
                    origin: Origin::Agent,
                    timestamp: Timestamp(0),
                    source: None,
                },
            },
            style: ShapeStyle { opacity: inkfinite_core::Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
            version: RecordVersion(1),
        };
        let operation = Operation::CreateShape { shape, anchor: SiblingAnchor::Last };
        let preview = server
            .mutate_document(Parameters(MutationParams {
                target: DocumentTarget { path: Some(path.to_string_lossy().into_owned()), ..DocumentTarget::default() },
                operations: vec![operation.clone()],
                dry_run: true,
                ..MutationParams::default()
            }))
            .await
            .expect("dry run should succeed")
            .0;
        assert!(preview.dry_run);
        assert!(preview.patch.created.contains(&RecordId::Shape(shape_id.clone())));

        let committed = server
            .mutate_document(Parameters(MutationParams {
                target: DocumentTarget { path: Some(path.to_string_lossy().into_owned()), ..DocumentTarget::default() },
                operations: vec![operation],
                ..MutationParams::default()
            }))
            .await
            .expect("mutation should commit")
            .0;
        assert!(!committed.dry_run);
        assert!(committed.affected_ids.contains(&RecordId::Shape(shape_id.clone())));
        assert_ne!(committed.previous_heads, committed.current_heads);

        let (_, mut engine) = server
            .file_engine(path.to_str().expect("temporary path is UTF-8"))
            .expect("committed file should load");
        let result = engine
            .query(&Query { id: Some(shape_id.to_string()), ..Query::default() })
            .expect("committed shape should be queryable");
        assert_eq!(result.total, 1);
        let _ = fs::remove_file(path);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn svg_mutation_uses_shared_import_transaction() {
        let path = blank_file("svg");
        let server = InkfiniteMcp::new_with_policy([path.clone()], McpPolicy::all());
        let result = server
            .import_svg(Parameters(ImportSvgParams {
                target: DocumentTarget { path: Some(path.to_string_lossy().into_owned()), ..DocumentTarget::default() },
                svg: r#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" /></svg>"#.into(),
                source_name: Some("mcp.svg".into()),
                ..ImportSvgParams::default()
            }))
            .await
            .expect("SVG import should commit")
            .0;
        assert!(!result.imported_shape_ids.is_empty());
        assert!(!result.imported_asset_ids.is_empty());
        assert!(result.affected_ids.iter().any(|id| matches!(id, RecordId::Shape(_))));
        let _ = fs::remove_file(path);
    }
}
