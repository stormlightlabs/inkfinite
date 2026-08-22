//! Document sessions used by desktop and local adapters.
//!
//! A session keeps the file, the materialized snapshot, and actor-scoped
//! history together.
//!
//! Adapters can expose this service over Tauri, local IPC, or a CLI without
//! moving document bytes into the frontend.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::editor::{
    EditorPatch, EditorProjection, EditorReconciliationRequest, project_editor, reconcile_editor_patches,
};
use crate::engine::geometry::world_shape_bounds;
use crate::engine::{EngineError, SyncApplyResult, validate_document};
use crate::file::{DocumentFile, FileError};
use crate::proto::{
    Bounds, CameraState, CommitResult, DocumentPath, Operation, Proposal, ProposalId, ProposalOperationPreview, Query,
    QueryResult, RecordId, SaveResult, SessionId, TransactionDraft, TransactionId, Warning,
};
use crate::render::{SvgRenderError, SvgRenderOptions, render_svg};
use crate::svg_import::import_svg;
use crate::svg_transaction::{SvgImportTransactionOptions, build_svg_import_transaction};
use crate::sync::{PeerSyncStatus, SyncMessage};
use crate::{
    ActorId, ChangeHash, Document, DocumentId, DocumentSnapshot, LayerId, Origin, PageId, ShapeId, Timestamp,
    blank_document,
};

/// Maximum number of pending proposals held by one live session.
pub const MAX_PROPOSALS_PER_SESSION: usize = 32;
/// Maximum number of completed proposal outcomes retained for agent polling.
pub const MAX_PROPOSAL_OUTCOMES_PER_SESSION: usize = 64;
/// Maximum number of operations accepted by a proposal or direct live apply.
pub const MAX_PROPOSAL_OPERATIONS: usize = 256;
/// Maximum UTF-8 byte length of a proposal description.
pub const MAX_PROPOSAL_DESCRIPTION_BYTES: usize = 4096;
/// Monotonic lifetime of an unaccepted proposal.
pub const PROPOSAL_TTL: Duration = Duration::from_secs(5 * 60);
/// State of the session's trusted peer synchronization boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum SyncState {
    /// No trusted peer checkpoint is configured for this local session.
    Disabled,
    /// Peer checkpoints loaded and retained for this session.
    Enabled {
        /// Connected peers in stable actor order.
        peers: Vec<PeerSyncStatus>,
        /// A checkpoint warning that did not invalidate the document.
        warning: Option<String>,
    },
}

/// Materialized state tracked for one open document session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct SessionStatus {
    /// Stable identifier assigned by the session service.
    pub session_id: SessionId,
    /// Canonical file path held by the session.
    pub path: DocumentPath,
    /// Actor used for local commits and history operations.
    pub actor_id: ActorId,
    /// Current materialized CRDT snapshot.
    pub snapshot: DocumentSnapshot,
    /// Rust-owned flat editor projection of the current snapshot.
    pub editor_projection: EditorProjection,
    /// Whether the current heads differ from the last successful save.
    pub dirty: bool,
    /// Whether this service instance still owns the advisory lock.
    pub lock_held: bool,
    /// Whether interrupted-save recovery data is available.
    pub recovery_available: bool,
    /// Whether the session actor can undo its latest transaction.
    pub can_undo: bool,
    /// Whether the session actor can redo its latest compensated transaction.
    pub can_redo: bool,
    /// Trusted peer synchronization state and bounded checkpoints.
    pub sync: SyncState,
}

/// Result returned after creating or opening a session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionOpened {
    /// Newly assigned session identifier.
    pub session_id: SessionId,
    /// Initial session state.
    pub status: SessionStatus,
}

/// Result returned after a commit, undo, or redo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionCommit {
    /// Patch and causal heads returned by the transaction engine.
    pub commit: CommitResult,
    /// Session state after the commit.
    pub status: SessionStatus,
}

/// Result returned after importing one SVG through the desktop session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SvgImportCommit {
    /// Commit and session state returned by the shared transaction engine.
    pub session: SessionCommit,
    /// Warnings emitted while unsupported SVG content was omitted.
    pub warnings: Vec<String>,
    /// Number of embedded image nodes omitted until a native image kind exists.
    pub omitted_image_count: usize,
    /// Native shape IDs created by the import.
    pub shape_ids: Vec<ShapeId>,
    /// Retained source asset ID.
    pub source_asset_id: crate::AssetId,
}

/// Review state exposed to an agent without granting review authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalReviewState {
    /// The proposal is waiting for a desktop review decision.
    Pending,
    /// The proposal was revalidated against current heads or given more review time.
    Refreshed,
    /// A human accepted the proposal in the desktop UI.
    Accepted,
    /// A human accepted a strict subset of the proposal operations.
    PartiallyAccepted,
    /// A human rejected the proposal in the desktop UI.
    Rejected,
    /// The proposal was not reviewed before its bounded lifetime elapsed.
    Expired,
}

/// Pollable proposal state for agent workflows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProposalStatus {
    /// Stable proposal identifier.
    pub proposal_id: ProposalId,
    /// Current review state.
    pub state: ProposalReviewState,
    /// Current document heads when this status was observed or recorded.
    pub heads: Vec<ChangeHash>,
    /// Records affected by an accepted proposal, empty for non-committing outcomes.
    pub affected_ids: Vec<RecordId>,
    /// Full proposal while review is still pending.
    pub proposal: Option<Proposal>,
}

/// Current desktop editing context exposed to read-only agent workflows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionContext {
    /// Session whose editor state is represented.
    pub session_id: SessionId,
    /// Canonical path currently held by the desktop.
    pub path: DocumentPath,
    /// Actor used to build proposals for this session.
    pub actor_id: ActorId,
    /// Current causal heads.
    pub heads: Vec<ChangeHash>,
    /// Page currently visible in the editor.
    pub page_id: Option<PageId>,
    /// Layer currently receiving new editor shapes.
    pub active_layer_id: Option<LayerId>,
    /// Shapes selected by the user in stable UI order.
    pub selection_ids: Vec<ShapeId>,
    /// Visible world-space rectangle, when the renderer has reported one.
    pub viewport: Option<Bounds>,
    /// Exact camera center and zoom reported by the renderer.
    pub camera: Option<CameraState>,
    /// World-space regions hidden by floating editor UI.
    pub occluded_regions: Vec<Bounds>,
    /// Wall-clock time of the latest editor context update.
    pub updated_at: Timestamp,
}

/// Editor-only drawing state published by the mounted desktop canvas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EditorContextUpdate {
    /// Page currently visible in the editor.
    pub page_id: Option<PageId>,
    /// Layer currently receiving new editor shapes.
    pub active_layer_id: Option<LayerId>,
    /// Shapes selected by the user in stable UI order.
    pub selection_ids: Vec<ShapeId>,
    /// Visible world-space rectangle.
    pub viewport: Option<Bounds>,
    /// Exact camera center and zoom.
    pub camera: Option<CameraState>,
    /// World-space regions hidden by floating editor UI.
    pub occluded_regions: Vec<Bounds>,
}

/// Result returned after a successful save or save-as.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionSaved {
    /// Persisted path and causal heads.
    pub save: SaveResult,
    /// Session state after persistence.
    pub status: SessionStatus,
}

/// Result returned after adopting or quarantining a peer message.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionSync {
    /// Merge disposition, patch, heads, and repair warnings.
    pub sync: SyncApplyResult,
    /// Session state after the exchange.
    pub status: SessionStatus,
}

/// Deterministic current and proposed SVG projections for a live session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LiveSvgPreview {
    /// Current causal heads used for both projections.
    pub heads: Vec<ChangeHash>,
    /// SVG for the current live document.
    pub current_svg: String,
    /// SVG after the proposed transaction, when one was supplied.
    pub proposed_svg: Option<String>,
    /// Created, changed, and deleted records in the proposed result.
    pub preview: Option<crate::proto::DocumentPatch>,
    /// Geometry invalidated by the proposed transaction.
    pub affected_regions: Vec<crate::proto::AffectedRegion>,
    /// Renderer fallback warnings from either projection.
    pub warnings: Vec<String>,
}

/// Recoverable failure from session lookup, authorization, or document I/O.
#[derive(Debug, Error)]
pub enum SessionError {
    /// No open session has the requested identifier.
    #[error("session not found: {0:?}")]
    NotFound(SessionId),
    /// A live command omitted its session while zero or multiple sessions exist.
    #[error("session selection required; {open_sessions} sessions are open")]
    SessionSelectionRequired {
        /// Number of sessions currently available for selection.
        open_sessions: usize,
    },
    /// The frontend reported editor context that does not belong to the session document.
    #[error("invalid editor context: {0}")]
    InvalidContext(String),
    /// A semantic editor patch could not be translated to native operations.
    #[error("editor reconciliation failed: {0}")]
    EditorReconciliation(String),
    /// Deterministic SVG rendering rejected the requested live projection.
    #[error(transparent)]
    Render(#[from] SvgRenderError),
    /// The actor does not own the session's local mutation stream.
    #[error("actor {actual} does not own session actor {expected}")]
    ActorMismatch {
        /// Actor configured when the session was opened.
        expected: ActorId,
        /// Actor supplied by the command caller.
        actual: ActorId,
    },
    /// The caller inspected heads that are no longer current.
    #[error("stale session heads")]
    StaleHeads,
    /// A live proposal exceeded the session's bounded proposal store.
    #[error("the session already holds {0} pending proposals")]
    ProposalLimit(usize),
    /// A proposal contains more operations than the live control boundary permits.
    #[error("proposal contains {count} operations; the limit is {max}")]
    ProposalTooLarge {
        /// Number of operations supplied by the caller.
        count: usize,
        /// Maximum number of operations accepted by the boundary.
        max: usize,
    },
    /// A proposal description exceeds the live control boundary.
    #[error("proposal description exceeds the {max} byte limit")]
    ProposalDescriptionTooLong {
        /// Maximum UTF-8 byte length.
        max: usize,
    },
    /// The live proposal boundary only accepts agent-originated transactions.
    #[error("live proposals and direct applies require agent origin")]
    AgentOriginRequired,
    /// No pending proposal has the requested identifier.
    #[error("proposal not found: {0:?}")]
    ProposalNotFound(ProposalId),
    /// A pending proposal passed its review window.
    #[error("proposal expired: {0:?}")]
    ProposalExpired(ProposalId),
    /// A proposal was refreshed after its inspected heads changed.
    #[error("proposal {proposal_id:?} is stale; its preview was refreshed")]
    ProposalStale {
        /// Proposal whose preview was refreshed.
        proposal_id: ProposalId,
        /// Refreshed proposal for the UI or caller to review.
        proposal: Box<Proposal>,
    },
    /// A proposal could not be refreshed after intervening edits.
    #[error("proposal {proposal_id:?} conflicts with the current document: {message}")]
    ProposalConflict {
        /// Proposal that could not be refreshed.
        proposal_id: ProposalId,
        /// Actionable conflict detail.
        message: String,
    },
    /// A partial acceptance selected no valid operations.
    #[error("invalid proposal operation selection: {0}")]
    InvalidProposalSelection(String),
    /// Two commands attempted to open the same path through one service.
    #[error("document is already open in session {session_id:?}: {path:?}")]
    AlreadyOpen {
        /// Existing session holding the path.
        session_id: SessionId,
        /// Canonical path that was requested.
        path: DocumentPath,
    },
    /// The durable file boundary rejected the operation.
    #[error(transparent)]
    File(#[from] FileError),
    /// The transaction engine rejected a history or validation operation.
    #[error(transparent)]
    Engine(#[from] EngineError),
    /// SVG parsing or transaction construction rejected the import.
    #[error("SVG import failed: {0}")]
    SvgImport(String),
}

struct DocumentSession {
    file: DocumentFile,
    proposals: BTreeMap<ProposalId, PendingProposal>,
    expired_proposals: BTreeMap<ProposalId, Proposal>,
    proposal_outcomes: BTreeMap<ProposalId, ProposalStatus>,
    proposal_outcome_order: VecDeque<ProposalId>,
    page_id: Option<PageId>,
    active_layer_id: Option<LayerId>,
    selection_ids: Vec<ShapeId>,
    viewport: Option<Bounds>,
    camera: Option<CameraState>,
    occluded_regions: Vec<Bounds>,
    context_updated_at: Timestamp,
}

#[derive(Clone)]
struct PendingProposal {
    proposal: Proposal,
    created_at: Instant,
    state: ProposalReviewState,
}

/// In-process owner of all open desktop document sessions.
pub struct SessionService {
    sessions: BTreeMap<SessionId, DocumentSession>,
    next_session_number: u64,
    next_proposal_number: u64,
}

impl Default for SessionService {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionService {
    /// Creates an empty service with no open files.
    #[must_use]
    pub fn new() -> Self {
        Self { sessions: BTreeMap::new(), next_session_number: 0, next_proposal_number: 0 }
    }

    /// Creates and persists a new canonical document session.
    ///
    /// # Errors
    ///
    /// Returns a typed file or validation error when the document cannot be
    /// created safely.
    pub fn create(
        &mut self, path: impl AsRef<Path>, document_id: DocumentId, actor_id: ActorId, page_name: Option<&str>,
    ) -> Result<SessionOpened, SessionError> {
        let document = blank_document(&document_id, page_name);
        let file = DocumentFile::create(path, document_id, actor_id, document)?;
        self.insert(file)
    }

    /// Opens a canonical `.inkfinite` document.
    ///
    /// # Errors
    ///
    /// Returns a typed file, lock, or validation error when the document cannot
    /// be opened safely.
    pub fn open(&mut self, path: impl AsRef<Path>, actor_id: ActorId) -> Result<SessionOpened, SessionError> {
        let file = DocumentFile::open(path, actor_id)?;
        self.insert(file)
    }

    /// Returns the current status for an open session.
    ///
    /// # Errors
    ///
    /// Returns [`SessionError::NotFound`] or a snapshot/recovery error.
    pub fn status(&mut self, session_id: &SessionId) -> Result<SessionStatus, SessionError> {
        let session = self.session_mut(session_id)?;
        session.expire_state();
        session.status(session_id)
    }

    /// Returns current state for every open session in stable identifier order.
    ///
    /// # Errors
    ///
    /// Returns a snapshot or recovery error from any open session.
    pub fn statuses(&mut self) -> Result<Vec<SessionStatus>, SessionError> {
        self.sessions
            .iter_mut()
            .map(|(session_id, session)| session.status(session_id))
            .collect()
    }

    /// Returns the latest drawing context reported by the desktop editor.
    ///
    /// # Errors
    ///
    /// Returns a session lookup or snapshot error.
    pub fn context(&mut self, session_id: &SessionId) -> Result<SessionContext, SessionError> {
        let session = self.session_mut(session_id)?;
        let snapshot = session.file.snapshot()?;
        Ok(SessionContext {
            session_id: session_id.clone(),
            path: DocumentPath(session.file.path().to_string_lossy().into_owned()),
            actor_id: session.file.actor_id().clone(),
            heads: snapshot.heads,
            page_id: session.page_id.clone(),
            active_layer_id: session.active_layer_id.clone(),
            selection_ids: session.selection_ids.clone(),
            viewport: session.viewport,
            camera: session.camera,
            occluded_regions: session.occluded_regions.clone(),
            updated_at: session.context_updated_at,
        })
    }

    /// Records the current frontend drawing context.
    ///
    /// # Errors
    ///
    /// Returns a session, snapshot, or context validation error.
    pub fn update_context(&mut self, session_id: &SessionId, update: EditorContextUpdate) -> Result<(), SessionError> {
        let session = self.session_mut(session_id)?;
        if update.page_id != session.page_id
            || update.active_layer_id != session.active_layer_id
            || update.selection_ids != session.selection_ids
        {
            let snapshot = session.file.snapshot()?;
            if let Some(page_id) = &update.page_id
                && !snapshot.document.pages.contains_key(page_id)
            {
                return Err(SessionError::InvalidContext(format!("page {page_id} does not exist")));
            }
            if let Some(shape_id) = update
                .selection_ids
                .iter()
                .find(|shape_id| !snapshot.document.shapes.contains_key(*shape_id))
            {
                return Err(SessionError::InvalidContext(format!("shape {shape_id} does not exist")));
            }
            if update.page_id.is_none() && !update.selection_ids.is_empty() {
                return Err(SessionError::InvalidContext(
                    "a selection requires an active page".into(),
                ));
            }
            if let Some(layer_id) = &update.active_layer_id {
                let layer = snapshot
                    .document
                    .layers
                    .get(layer_id)
                    .ok_or_else(|| SessionError::InvalidContext(format!("layer {layer_id} does not exist")))?;
                if Some(&layer.page_id) != update.page_id.as_ref() {
                    return Err(SessionError::InvalidContext(format!(
                        "layer {layer_id} is not on the active page"
                    )));
                }
            }
            if let Some(page_id) = &update.page_id {
                for selected_shape_id in &update.selection_ids {
                    let mut shape_id = selected_shape_id;
                    let layer_id = loop {
                        let shape = &snapshot.document.shapes[shape_id];
                        match &shape.parent {
                            crate::ShapeParent::Layer(layer_id) => break layer_id,
                            crate::ShapeParent::Shape(parent_id) => shape_id = parent_id,
                        }
                    };
                    if snapshot.document.layers[layer_id].page_id != *page_id {
                        return Err(SessionError::InvalidContext(format!(
                            "shape {selected_shape_id} is not on page {page_id}"
                        )));
                    }
                }
            }
        }
        if update.viewport.is_some_and(|bounds| !valid_bounds(bounds))
            || update
                .occluded_regions
                .iter()
                .copied()
                .any(|bounds| !valid_bounds(bounds))
        {
            return Err(SessionError::InvalidContext(
                "viewport and occluded regions must be finite with non-negative dimensions".into(),
            ));
        }
        if update.camera.is_some_and(|camera| {
            !camera.x.is_finite() || !camera.y.is_finite() || !camera.zoom.is_finite() || camera.zoom <= 0.0
        }) {
            return Err(SessionError::InvalidContext(
                "camera coordinates must be finite and zoom must be positive".into(),
            ));
        }
        session.page_id = update.page_id;
        session.active_layer_id = update.active_layer_id;
        session.selection_ids = update.selection_ids;
        session.viewport = update.viewport;
        session.camera = update.camera;
        session.occluded_regions = update.occluded_regions;
        session.context_updated_at = timestamp_now();
        Ok(())
    }

    /// Resolves an explicit session, or the only open session when omitted.
    ///
    /// # Errors
    ///
    /// Returns a typed error when no session is open or more than one session
    /// requires the caller to choose explicitly.
    pub fn resolve_session_id(&self, requested: Option<&SessionId>) -> Result<SessionId, SessionError> {
        if let Some(session_id) = requested {
            if self.sessions.contains_key(session_id) {
                return Ok(session_id.clone());
            }
            return Err(SessionError::NotFound(session_id.clone()));
        }
        match self.sessions.len() {
            1 => self
                .sessions
                .keys()
                .next()
                .cloned()
                .ok_or(SessionError::SessionSelectionRequired { open_sessions: 0 }),
            _ => Err(SessionError::SessionSelectionRequired { open_sessions: self.sessions.len() }),
        }
    }

    /// Commits one actor-owned transaction and returns its materialized patch.
    ///
    /// # Errors
    ///
    /// Returns a typed authorization, transaction, or persistence error.
    pub fn commit(
        &mut self, session_id: &SessionId, transaction: TransactionDraft,
    ) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        ensure_actor(session.file.actor_id(), &transaction.actor_id)?;
        let commit = session.file.commit(transaction)?;
        let status = session.status(session_id)?;
        Ok(SessionCommit { commit, status })
    }

    /// Reconciles semantic editor changes through the native transaction engine.
    ///
    /// The editor supplies world-space transforms and field-level changes. Rust
    /// converts those changes to parent-relative operations without rebuilding
    /// unrelated scene records.
    ///
    /// # Errors
    ///
    /// Returns a typed reconciliation, transaction, or persistence error.
    pub fn reconcile_editor_patches(
        &mut self, session_id: &SessionId, patches: Vec<EditorPatch>,
    ) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        let snapshot = session.file.snapshot()?;
        let timestamp = timestamp_now();
        let request = EditorReconciliationRequest {
            patches,
            actor_id: session.file.actor_id().clone(),
            origin: Origin::Human,
            transaction_id: TransactionId(format!("transaction:editor:{}", timestamp.0)),
            description: "Update editor document".into(),
            timestamp,
        };
        let transaction = reconcile_editor_patches(&snapshot, request)
            .map_err(|error| SessionError::EditorReconciliation(error.to_string()))?;
        let commit = session.file.commit(transaction)?;
        let status = session.status(session_id)?;
        Ok(SessionCommit { commit, status })
    }

    /// Parses and commits one SVG into the session's active layer.
    ///
    /// The source is parsed before the session changes. The resulting assets,
    /// root container, groups, and native shapes then enter the document as one
    /// actor-owned transaction.
    ///
    /// # Errors
    ///
    /// Returns a typed session, SVG parser, target, transaction, or persistence
    /// error. No document state changes when parsing or transaction construction
    /// fails.
    pub fn import_svg(
        &mut self, session_id: &SessionId, source: &[u8], source_name: Option<&str>,
    ) -> Result<SvgImportCommit, SessionError> {
        let import = import_svg(source).map_err(|error| SessionError::SvgImport(error.to_string()))?;
        let session = self.session_mut(session_id)?;
        let snapshot = session.file.snapshot()?;
        let page_id = session
            .page_id
            .clone()
            .or_else(|| snapshot.document.page_ids.first().cloned())
            .ok_or_else(|| SessionError::SvgImport("document has no page for SVG import".into()))?;
        let page = snapshot
            .document
            .pages
            .get(&page_id)
            .ok_or_else(|| SessionError::SvgImport(format!("page {page_id} does not exist")))?;
        let layer_id = session
            .active_layer_id
            .clone()
            .filter(|layer_id| page.layer_ids.contains(layer_id))
            .or_else(|| page.layer_ids.first().cloned())
            .ok_or_else(|| SessionError::SvgImport(format!("page {page_id} has no import layer")))?;
        let source_label = source_name.map(str::to_owned);
        let transaction = build_svg_import_transaction(
            &snapshot,
            &import,
            SvgImportTransactionOptions {
                actor_id: session.file.actor_id().clone(),
                origin: Origin::Human,
                page_id,
                layer_id,
                transaction_id: crate::proto::TransactionId(format!(
                    "transaction:svg-import:{}",
                    import.source_asset.digest.replace(':', "-")
                )),
                description: source_label
                    .as_deref()
                    .map(|name| format!("Import SVG {name}"))
                    .unwrap_or_else(|| "Import SVG".into()),
                source_name: source_label,
                timestamp: timestamp_now(),
            },
        )
        .map_err(|error| SessionError::SvgImport(error.to_string()))?;
        let shape_ids = transaction.shape_ids;
        let omitted_image_count = transaction.omitted_image_count;
        let source_asset_id = import.source_asset.id;
        let warnings = import.warnings.iter().map(ToString::to_string).collect();
        let commit = session.file.commit(transaction.transaction)?;
        let status = session.status(session_id)?;
        Ok(SvgImportCommit {
            session: SessionCommit { commit, status },
            warnings,
            omitted_image_count,
            shape_ids,
            source_asset_id,
        })
    }

    /// Validates and stores one agent transaction for explicit desktop review.
    ///
    /// The document, CRDT heads, and history remain unchanged.
    ///
    /// # Errors
    ///
    /// Returns a typed limit, authorization, validation, or session error.
    pub fn propose(&mut self, session_id: &SessionId, transaction: TransactionDraft) -> Result<Proposal, SessionError> {
        self.next_proposal_number = self.next_proposal_number.saturating_add(1);
        let proposal_id = ProposalId(format!("proposal:{}", self.next_proposal_number));
        let session = self.session_mut(session_id)?;
        session.expire_state();
        if session.proposals.len() >= MAX_PROPOSALS_PER_SESSION {
            return Err(SessionError::ProposalLimit(MAX_PROPOSALS_PER_SESSION));
        }
        ensure_actor(session.file.actor_id(), &transaction.actor_id)?;
        validate_live_transaction(&transaction)?;
        let proposal = create_proposal(&mut session.file, proposal_id, transaction, None)?;
        session.proposals.insert(
            proposal.id.clone(),
            PendingProposal {
                proposal: proposal.clone(),
                created_at: Instant::now(),
                state: ProposalReviewState::Pending,
            },
        );
        Ok(proposal)
    }

    /// Accepts all or selected operations from a pending proposal.
    ///
    /// The original causal heads must still be current. When they changed,
    /// the stored proposal is refreshed and [`SessionError::ProposalStale`]
    /// returns the new preview without committing anything.
    ///
    /// # Errors
    ///
    /// Returns a typed proposal, validation, permission, or stale-head error.
    pub fn accept_proposal(
        &mut self, session_id: &SessionId, proposal_id: &ProposalId, operation_positions: Option<&[u32]>,
    ) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        session.expire_state();
        let pending = session.proposals.get(proposal_id).cloned().ok_or_else(|| {
            if session.expired_proposals.contains_key(proposal_id) {
                SessionError::ProposalExpired(proposal_id.clone())
            } else {
                SessionError::ProposalNotFound(proposal_id.clone())
            }
        })?;
        let current_heads = session.file.snapshot()?.heads;
        if !same_heads(&current_heads, &pending.proposal.transaction.base_heads) {
            let mut refreshed_transaction = pending.proposal.transaction.clone();
            refreshed_transaction.base_heads = current_heads;
            let refreshed = match create_proposal(
                &mut session.file,
                pending.proposal.id.clone(),
                refreshed_transaction,
                Some(pending.proposal.expires_at),
            ) {
                Ok(proposal) => proposal,
                Err(error) => {
                    return Err(SessionError::ProposalConflict {
                        proposal_id: proposal_id.clone(),
                        message: error.to_string(),
                    });
                }
            };
            session.proposals.insert(
                proposal_id.clone(),
                PendingProposal {
                    proposal: refreshed.clone(),
                    created_at: pending.created_at,
                    state: ProposalReviewState::Refreshed,
                },
            );
            return Err(SessionError::ProposalStale {
                proposal_id: proposal_id.clone(),
                proposal: Box::new(refreshed),
            });
        }

        let operations = select_operations(&pending.proposal.transaction.operations, operation_positions)?;
        let partial = operations.len() < pending.proposal.transaction.operations.len();
        let transaction = if !partial {
            pending.proposal.transaction
        } else {
            let mut transaction = pending.proposal.transaction.clone();
            transaction.id = TransactionId(format!("{}:partial", pending.proposal.id.0));
            transaction.description = format!("{} (partial proposal acceptance)", transaction.description);
            transaction.operations = operations;
            transaction
        };
        let commit = session.file.commit(transaction)?;
        session.proposals.remove(proposal_id);
        session.record_proposal_outcome(ProposalStatus {
            proposal_id: proposal_id.clone(),
            state: if partial { ProposalReviewState::PartiallyAccepted } else { ProposalReviewState::Accepted },
            heads: commit.heads.clone(),
            affected_ids: commit.affected_ids.clone(),
            proposal: None,
        });
        let status = session.status(session_id)?;
        Ok(SessionCommit { commit, status })
    }

    /// Rejects and removes a pending proposal without changing the document.
    ///
    /// # Errors
    ///
    /// Returns [`SessionError::ProposalNotFound`] or [`SessionError::ProposalExpired`].
    pub fn reject_proposal(&mut self, session_id: &SessionId, proposal_id: &ProposalId) -> Result<(), SessionError> {
        let session = self.session_mut(session_id)?;
        session.expire_state();
        if session.proposals.remove(proposal_id).is_some() {
            let heads = session.file.snapshot()?.heads;
            session.record_proposal_outcome(ProposalStatus {
                proposal_id: proposal_id.clone(),
                state: ProposalReviewState::Rejected,
                heads,
                affected_ids: Vec::new(),
                proposal: None,
            });
            Ok(())
        } else if session.expired_proposals.contains_key(proposal_id) {
            Err(SessionError::ProposalExpired(proposal_id.clone()))
        } else {
            Err(SessionError::ProposalNotFound(proposal_id.clone()))
        }
    }

    /// Returns the current or retained review state for a proposal.
    ///
    /// # Errors
    ///
    /// Returns a session, snapshot, or proposal lookup error.
    pub fn proposal_status(
        &mut self, session_id: &SessionId, proposal_id: &ProposalId,
    ) -> Result<ProposalStatus, SessionError> {
        let session = self.session_mut(session_id)?;
        session.expire_state();
        if let Some(pending) = session.proposals.get(proposal_id) {
            return Ok(ProposalStatus {
                proposal_id: proposal_id.clone(),
                state: pending.state,
                heads: session.file.snapshot()?.heads,
                affected_ids: Vec::new(),
                proposal: Some(pending.proposal.clone()),
            });
        }
        session
            .proposal_outcomes
            .get(proposal_id)
            .cloned()
            .ok_or_else(|| SessionError::ProposalNotFound(proposal_id.clone()))
    }

    /// Revalidates a pending or recently expired proposal and starts a new review window.
    ///
    /// # Errors
    ///
    /// Returns a session, proposal lookup, authorization, or transaction preview error.
    pub fn renew_proposal(
        &mut self, session_id: &SessionId, proposal_id: &ProposalId,
    ) -> Result<Proposal, SessionError> {
        let session = self.session_mut(session_id)?;
        session.expire_state();
        let old = session
            .proposals
            .remove(proposal_id)
            .map(|pending| pending.proposal)
            .or_else(|| session.expired_proposals.remove(proposal_id))
            .ok_or_else(|| SessionError::ProposalNotFound(proposal_id.clone()))?;
        let mut transaction = old.transaction;
        transaction.base_heads = session.file.snapshot()?.heads;
        let refreshed = create_proposal(&mut session.file, proposal_id.clone(), transaction, None)?;
        session.proposals.insert(
            proposal_id.clone(),
            PendingProposal {
                proposal: refreshed.clone(),
                created_at: Instant::now(),
                state: ProposalReviewState::Refreshed,
            },
        );
        session.proposal_outcomes.remove(proposal_id);
        session.proposal_outcome_order.retain(|id| id != proposal_id);
        Ok(refreshed)
    }

    /// Validates and applies one live transaction.
    ///
    /// # Errors
    ///
    /// Returns a typed validation, lock, or persistence error.
    pub fn apply(
        &mut self, session_id: &SessionId, transaction: TransactionDraft,
    ) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        ensure_actor(session.file.actor_id(), &transaction.actor_id)?;
        validate_live_transaction(&transaction)?;
        let commit = session.file.commit(transaction)?;
        let status = session.status(session_id)?;
        Ok(SessionCommit { commit, status })
    }

    /// Compensates the latest transaction owned by `actor_id`.
    ///
    /// # Errors
    ///
    /// Returns a typed authorization, history, or transaction error.
    pub fn undo(&mut self, session_id: &SessionId, actor_id: &ActorId) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        ensure_actor(session.file.actor_id(), actor_id)?;
        let commit = session.file.engine_mut().undo(actor_id)?;
        let status = session.status(session_id)?;
        Ok(SessionCommit { commit, status })
    }

    /// Reapplies the latest transaction compensated by `actor_id`.
    ///
    /// # Errors
    ///
    /// Returns a typed authorization, history, or transaction error.
    pub fn redo(&mut self, session_id: &SessionId, actor_id: &ActorId) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        ensure_actor(session.file.actor_id(), actor_id)?;
        let commit = session.file.engine_mut().redo(actor_id)?;
        let status = session.status(session_id)?;
        Ok(SessionCommit { commit, status })
    }

    /// Saves the current session after checking the caller's inspected heads.
    ///
    /// # Errors
    ///
    /// Returns [`SessionError::StaleHeads`] when the caller's heads are old,
    /// or a typed persistence error when the write fails.
    pub fn save(
        &mut self, session_id: &SessionId, expected_heads: &[crate::ChangeHash],
    ) -> Result<SessionSaved, SessionError> {
        let session = self.session_mut(session_id)?;
        ensure_heads(&mut session.file, expected_heads)?;
        let save = to_protocol_save(session.file.save()?);
        let status = session.status(session_id)?;
        Ok(SessionSaved { save, status })
    }

    /// Saves the current session to a replacement path after checking heads.
    ///
    /// # Errors
    ///
    /// Returns [`SessionError::StaleHeads`] when the caller's heads are old,
    /// or a typed lock, recovery, or filesystem error when the replacement
    /// cannot be written.
    pub fn save_as(
        &mut self, session_id: &SessionId, path: impl AsRef<Path>, expected_heads: &[crate::ChangeHash],
    ) -> Result<SessionSaved, SessionError> {
        let session = self.session_mut(session_id)?;
        ensure_heads(&mut session.file, expected_heads)?;
        let save = to_protocol_save(session.file.save_as(path)?);
        let status = session.status(session_id)?;
        Ok(SessionSaved { save, status })
    }

    /// Runs a deterministic semantic query against the current snapshot.
    ///
    /// # Errors
    ///
    /// Returns [`SessionError::NotFound`] or a typed query error.
    pub fn query(&mut self, session_id: &SessionId, query: &Query) -> Result<QueryResult, SessionError> {
        let session = self.session_mut(session_id)?;
        Ok(session.file.engine_mut().query(query)?)
    }

    /// Renders the current live document and, optionally, a validated proposed result.
    ///
    /// The supplied transaction is previewed without changing CRDT heads, history, or bytes.
    ///
    /// # Errors
    ///
    /// Returns a session, transaction preview, or deterministic rendering error.
    pub fn render_live(
        &mut self, session_id: &SessionId, transaction: Option<&TransactionDraft>, page_id: Option<PageId>,
        region: Option<Bounds>,
    ) -> Result<LiveSvgPreview, SessionError> {
        let session = self.session_mut(session_id)?;
        let snapshot = session.file.snapshot()?;
        let options = SvgRenderOptions { page_id, region, ..SvgRenderOptions::default() };
        let current = render_svg(&snapshot, &options)?;
        let mut warnings = current.warnings.iter().map(ToString::to_string).collect::<Vec<_>>();
        let Some(transaction) = transaction else {
            return Ok(LiveSvgPreview {
                heads: snapshot.heads,
                current_svg: current.svg,
                proposed_svg: None,
                preview: None,
                affected_regions: Vec::new(),
                warnings,
            });
        };
        ensure_actor(session.file.actor_id(), &transaction.actor_id)?;
        validate_live_transaction(transaction)?;
        let preview = session.file.engine_mut().preview(transaction)?;
        let proposed_snapshot = DocumentSnapshot {
            format: snapshot.format,
            format_version: snapshot.format_version,
            document_id: snapshot.document_id,
            heads: snapshot.heads.clone(),
            document: preview.document,
        };
        let proposed = render_svg(&proposed_snapshot, &options)?;
        warnings.extend(proposed.warnings.iter().map(ToString::to_string));
        warnings.sort();
        warnings.dedup();
        Ok(LiveSvgPreview {
            heads: snapshot.heads,
            current_svg: current.svg,
            proposed_svg: Some(proposed.svg),
            preview: Some(preview.patch),
            affected_regions: preview.affected_regions,
            warnings,
        })
    }

    /// Validates the current materialized snapshot without changing it.
    ///
    /// # Errors
    ///
    /// Returns a typed invariant or snapshot error when validation fails.
    pub fn validate(&mut self, session_id: &SessionId) -> Result<SessionStatus, SessionError> {
        let session = self.session_mut(session_id)?;
        let status = session.status(session_id)?;
        validate_document(&status.snapshot.document)?;
        Ok(status)
    }

    /// Trusts a peer actor and persists its empty or previously loaded
    /// synchronization checkpoint.
    ///
    /// # Errors
    ///
    /// Returns a typed session, peer, or filesystem error.
    pub fn connect_peer(&mut self, session_id: &SessionId, peer_id: ActorId) -> Result<SessionStatus, SessionError> {
        let session = self.session_mut(session_id)?;
        session.file.connect_peer(peer_id)?;
        session.status(session_id)
    }

    /// Removes a peer checkpoint without changing the document.
    ///
    /// # Errors
    ///
    /// Returns a typed session or filesystem error.
    pub fn disconnect_peer(
        &mut self, session_id: &SessionId, peer_id: &ActorId,
    ) -> Result<SessionStatus, SessionError> {
        let session = self.session_mut(session_id)?;
        session.file.disconnect_peer(peer_id)?;
        session.status(session_id)
    }

    /// Produces one message for a connected peer. The returned `None` means
    /// Automerge is waiting for an acknowledgement or the peer is current.
    ///
    /// # Errors
    ///
    /// Returns a typed session, peer, CRDT, or filesystem error.
    pub fn next_sync_message(
        &mut self, session_id: &SessionId, peer_id: &ActorId,
    ) -> Result<Option<SyncMessage>, SessionError> {
        let session = self.session_mut(session_id)?;
        Ok(session.file.next_sync_message(peer_id)?)
    }

    /// Adopts one peer message through the validated transaction boundary and
    /// persists a changed replica before returning to the transport.
    ///
    /// # Errors
    ///
    /// Returns a typed session, merge, repair, or filesystem error. Malformed
    /// payloads are represented by a quarantined result and do not replace the
    /// open valid document.
    pub fn receive_sync_message(
        &mut self, session_id: &SessionId, message: &SyncMessage,
    ) -> Result<SessionSync, SessionError> {
        let session = self.session_mut(session_id)?;
        let sync = session.file.receive_sync_message(message)?;
        let status = session.status(session_id)?;
        Ok(SessionSync { sync, status })
    }

    /// Closes a session and releases its advisory lock.
    ///
    /// Closing deliberately does not save dirty state. Callers can inspect the
    /// returned status first and choose [`Self::save`] or [`Self::save_as`].
    ///
    /// # Errors
    ///
    /// Returns [`SessionError::NotFound`] when the session is unknown.
    pub fn close(&mut self, session_id: &SessionId) -> Result<(), SessionError> {
        self.sessions
            .remove(session_id)
            .map(|_| ())
            .ok_or_else(|| SessionError::NotFound(session_id.clone()))
    }

    /// Returns the number of currently open sessions.
    #[must_use]
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Reports whether no document sessions are open.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    fn insert(&mut self, mut file: DocumentFile) -> Result<SessionOpened, SessionError> {
        let path = file.path().to_owned();
        if let Some((session_id, _)) = self.sessions.iter().find(|(_, session)| session.file.path() == path) {
            return Err(SessionError::AlreadyOpen {
                session_id: session_id.clone(),
                path: DocumentPath(path.to_string_lossy().into_owned()),
            });
        }

        self.next_session_number = self.next_session_number.saturating_add(1);
        let session_id = SessionId(format!("session:{}", self.next_session_number));
        let snapshot = file.snapshot()?;
        let page_id = snapshot.document.page_ids.first().cloned();
        let active_layer_id = page_id
            .as_ref()
            .and_then(|page_id| snapshot.document.pages.get(page_id))
            .and_then(|page| page.layer_ids.first())
            .cloned();
        let mut session = DocumentSession {
            file,
            proposals: BTreeMap::new(),
            expired_proposals: BTreeMap::new(),
            proposal_outcomes: BTreeMap::new(),
            proposal_outcome_order: VecDeque::new(),
            page_id,
            active_layer_id,
            selection_ids: Vec::new(),
            viewport: None,
            camera: None,
            occluded_regions: Vec::new(),
            context_updated_at: timestamp_now(),
        };
        let status = session.status(&session_id)?;
        self.sessions.insert(session_id.clone(), session);
        Ok(SessionOpened { session_id, status })
    }

    fn session_mut(&mut self, session_id: &SessionId) -> Result<&mut DocumentSession, SessionError> {
        self.sessions
            .get_mut(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.clone()))
    }
}

impl DocumentSession {
    fn expire_state(&mut self) {
        let now = Instant::now();
        let expired = self
            .proposals
            .iter()
            .filter(|(_, pending)| now.duration_since(pending.created_at) >= PROPOSAL_TTL)
            .map(|(proposal_id, _)| proposal_id.clone())
            .collect::<Vec<_>>();
        for proposal_id in expired {
            let Some(pending) = self.proposals.remove(&proposal_id) else { continue };
            self.expired_proposals.insert(proposal_id.clone(), pending.proposal);
            if let Ok(snapshot) = self.file.snapshot() {
                self.record_proposal_outcome(ProposalStatus {
                    proposal_id,
                    state: ProposalReviewState::Expired,
                    heads: snapshot.heads,
                    affected_ids: Vec::new(),
                    proposal: None,
                });
            }
        }
        while self.expired_proposals.len() > MAX_PROPOSALS_PER_SESSION {
            let Some(oldest) = self.expired_proposals.keys().next().cloned() else { break };
            self.expired_proposals.remove(&oldest);
        }
    }

    fn record_proposal_outcome(&mut self, status: ProposalStatus) {
        let proposal_id = status.proposal_id.clone();
        if !self.proposal_outcomes.contains_key(&proposal_id) {
            self.proposal_outcome_order.push_back(proposal_id.clone());
        }
        self.proposal_outcomes.insert(proposal_id, status);
        while self.proposal_outcome_order.len() > MAX_PROPOSAL_OUTCOMES_PER_SESSION {
            let Some(oldest) = self.proposal_outcome_order.pop_front() else { break };
            self.proposal_outcomes.remove(&oldest);
        }
    }

    fn status(&mut self, session_id: &SessionId) -> Result<SessionStatus, SessionError> {
        let snapshot = self.file.snapshot()?;
        let dirty = self.file.is_dirty()?;
        let recovery_available = self.file.recovery_available()?;
        Ok(SessionStatus {
            session_id: session_id.clone(),
            path: DocumentPath(self.file.path().to_string_lossy().into_owned()),
            actor_id: self.file.actor_id().clone(),
            editor_projection: project_editor(&snapshot),
            snapshot,
            dirty,
            lock_held: true,
            recovery_available,
            can_undo: self.file.can_undo(),
            can_redo: self.file.can_redo(),
            sync: {
                let sync = self.file.sync_status();
                if sync.peers.is_empty() && sync.warning.is_none() {
                    SyncState::Disabled
                } else {
                    SyncState::Enabled { peers: sync.peers, warning: sync.warning }
                }
            },
        })
    }
}

fn create_proposal(
    file: &mut DocumentFile, id: ProposalId, transaction: TransactionDraft, expires_at: Option<Timestamp>,
) -> Result<Proposal, SessionError> {
    let before = file.snapshot()?.document;
    let preview = file.engine_mut().preview(&transaction)?;
    let operation_previews = transaction
        .operations
        .iter()
        .enumerate()
        .map(|(position, operation)| operation_preview(position, operation, &before, &preview.document))
        .collect();
    Ok(Proposal {
        id,
        transaction,
        preview: preview.patch,
        affected_regions: preview.affected_regions,
        operation_previews,
        warnings: Vec::<Warning>::new(),
        expires_at: expires_at.unwrap_or_else(|| timestamp_after(PROPOSAL_TTL)),
    })
}

fn operation_preview(
    position: usize, operation: &Operation, before: &Document, after: &Document,
) -> ProposalOperationPreview {
    let (label, record_ids, shape_ids) = match operation {
        Operation::CreatePage { page, .. } => (
            format!("Create page ‘{}’", page.name),
            vec![RecordId::Page(page.id.clone())],
            Vec::new(),
        ),
        Operation::RenamePage { page_id, .. } => (
            format!("Rename page {page_id}"),
            vec![RecordId::Page(page_id.clone())],
            Vec::new(),
        ),
        Operation::DeletePage { page_id, .. } => (
            format!("Delete page {page_id}"),
            vec![RecordId::Page(page_id.clone())],
            Vec::new(),
        ),
        Operation::CreateLayer { layer, .. } => (
            format!("Create layer ‘{}’", layer.name),
            vec![RecordId::Layer(layer.id.clone())],
            Vec::new(),
        ),
        Operation::PatchLayer { layer_id, .. } => (
            format!("Update layer {layer_id}"),
            vec![RecordId::Layer(layer_id.clone())],
            Vec::new(),
        ),
        Operation::ReorderLayer { layer_id, .. } => (
            format!("Reorder layer {layer_id}"),
            vec![RecordId::Layer(layer_id.clone())],
            Vec::new(),
        ),
        Operation::DeleteLayer { layer_id, .. } => (
            format!("Delete layer {layer_id}"),
            vec![RecordId::Layer(layer_id.clone())],
            Vec::new(),
        ),
        Operation::CreateShape { shape, .. } => (
            format!("Create {}", shape_description(shape)),
            vec![RecordId::Shape(shape.id.clone())],
            vec![shape.id.clone()],
        ),
        Operation::PatchShape { shape_id, .. } => (
            format!("Update {}", shape_description_from_documents(shape_id, before, after)),
            vec![RecordId::Shape(shape_id.clone())],
            vec![shape_id.clone()],
        ),
        Operation::ConvertShape { shape_id, kind, .. } => (
            format!(
                "Convert {} to {kind}",
                shape_description_from_documents(shape_id, before, after)
            ),
            vec![RecordId::Shape(shape_id.clone())],
            vec![shape_id.clone()],
        ),
        Operation::ReparentShape { shape_id, .. } => (
            format!("Move {}", shape_description_from_documents(shape_id, before, after)),
            vec![RecordId::Shape(shape_id.clone())],
            vec![shape_id.clone()],
        ),
        Operation::DeleteShape { shape_id, .. } => (
            format!("Delete {}", shape_description_from_documents(shape_id, before, after)),
            vec![RecordId::Shape(shape_id.clone())],
            vec![shape_id.clone()],
        ),
        Operation::CreateBinding { binding } => (
            format!("Connect {} to {}", binding.source_shape_id, binding.target_shape_id),
            vec![RecordId::Binding(binding.id.clone())],
            vec![binding.source_shape_id.clone(), binding.target_shape_id.clone()],
        ),
        Operation::DeleteBinding { binding_id, .. } => (
            format!("Delete connection {binding_id}"),
            vec![RecordId::Binding(binding_id.clone())],
            Vec::new(),
        ),
        Operation::CreateAsset { asset } => (
            format!("Create asset ‘{}’", asset.name),
            vec![RecordId::Asset(asset.id.clone())],
            Vec::new(),
        ),
        Operation::PatchAsset { asset_id, .. } => (
            format!("Update asset {asset_id}"),
            vec![RecordId::Asset(asset_id.clone())],
            Vec::new(),
        ),
        Operation::DeleteAsset { asset_id, .. } => (
            format!("Delete asset {asset_id}"),
            vec![RecordId::Asset(asset_id.clone())],
            Vec::new(),
        ),
        Operation::AlignShapes { shape_ids, .. } => (
            format!("Align {} shapes", shape_ids.len()),
            shape_ids.iter().cloned().map(RecordId::Shape).collect(),
            shape_ids.clone(),
        ),
        Operation::DistributeShapes { shape_ids, .. } => (
            format!("Distribute {} shapes", shape_ids.len()),
            shape_ids.iter().cloned().map(RecordId::Shape).collect(),
            shape_ids.clone(),
        ),
        Operation::StackShapes { shape_ids, .. } => (
            format!("Stack {} shapes", shape_ids.len()),
            shape_ids.iter().cloned().map(RecordId::Shape).collect(),
            shape_ids.clone(),
        ),
        Operation::GridShapes { shape_ids, .. } => (
            format!("Arrange {} shapes in a grid", shape_ids.len()),
            shape_ids.iter().cloned().map(RecordId::Shape).collect(),
            shape_ids.clone(),
        ),
        Operation::TidyShapes { shape_ids, .. } => (
            format!("Tidy {} shapes", shape_ids.len()),
            shape_ids.iter().cloned().map(RecordId::Shape).collect(),
            shape_ids.clone(),
        ),
    };
    let mut bounds = Vec::new();
    for shape_id in shape_ids {
        if before.shapes.contains_key(&shape_id) {
            bounds.push(world_shape_bounds(before, &shape_id));
        }
        if after.shapes.contains_key(&shape_id) {
            let candidate = world_shape_bounds(after, &shape_id);
            if !bounds.contains(&candidate) {
                bounds.push(candidate);
            }
        }
    }
    ProposalOperationPreview { position: u32::try_from(position).unwrap_or(u32::MAX), label, record_ids, bounds }
}

fn shape_description_from_documents(shape_id: &ShapeId, before: &Document, after: &Document) -> String {
    before
        .shapes
        .get(shape_id)
        .or_else(|| after.shapes.get(shape_id))
        .map_or_else(|| shape_id.to_string(), shape_description)
}

fn shape_description(shape: &crate::ShapeRecord) -> String {
    if let Some(role) = shape.metadata.role.as_deref() {
        format!("{} ({role})", shape.id)
    } else if let Some(name) = shape.metadata.name.as_deref() {
        format!("{} (‘{name}’)", shape.id)
    } else {
        shape.id.to_string()
    }
}

fn validate_live_transaction(transaction: &TransactionDraft) -> Result<(), SessionError> {
    if transaction.origin != Origin::Agent {
        return Err(SessionError::AgentOriginRequired);
    }
    if transaction.operations.len() > MAX_PROPOSAL_OPERATIONS {
        return Err(SessionError::ProposalTooLarge {
            count: transaction.operations.len(),
            max: MAX_PROPOSAL_OPERATIONS,
        });
    }
    if transaction.description.len() > MAX_PROPOSAL_DESCRIPTION_BYTES {
        return Err(SessionError::ProposalDescriptionTooLong { max: MAX_PROPOSAL_DESCRIPTION_BYTES });
    }
    Ok(())
}

fn select_operations(
    operations: &[crate::proto::Operation], positions: Option<&[u32]>,
) -> Result<Vec<crate::proto::Operation>, SessionError> {
    let Some(positions) = positions else {
        return Ok(operations.to_vec());
    };
    if positions.is_empty() {
        return Err(SessionError::InvalidProposalSelection(
            "at least one operation is required".into(),
        ));
    }
    let mut selected = BTreeSet::new();
    for position in positions {
        let index = usize::try_from(*position)
            .map_err(|_| SessionError::InvalidProposalSelection(format!("operation position {position} is invalid")))?;
        if index >= operations.len() {
            return Err(SessionError::InvalidProposalSelection(format!(
                "operation position {position} is outside the proposal"
            )));
        }
        if !selected.insert(index) {
            return Err(SessionError::InvalidProposalSelection(format!(
                "operation position {position} was selected more than once"
            )));
        }
    }
    Ok(selected.into_iter().map(|index| operations[index].clone()).collect())
}

fn same_heads(left: &[crate::ChangeHash], right: &[crate::ChangeHash]) -> bool {
    let mut left = left.to_vec();
    let mut right = right.to_vec();
    left.sort();
    right.sort();
    left == right
}

fn timestamp_after(duration: Duration) -> Timestamp {
    let now = timestamp_now().0;
    let millis = i64::try_from(duration.as_millis()).unwrap_or(i64::MAX);
    Timestamp(now.saturating_add(millis))
}

fn valid_bounds(bounds: Bounds) -> bool {
    bounds.x.is_finite()
        && bounds.y.is_finite()
        && bounds.width.is_finite()
        && bounds.height.is_finite()
        && bounds.width >= 0.0
        && bounds.height >= 0.0
}

fn timestamp_now() -> Timestamp {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    Timestamp(i64::try_from(millis).unwrap_or(i64::MAX))
}

fn ensure_actor(expected: &ActorId, actual: &ActorId) -> Result<(), SessionError> {
    if expected == actual {
        Ok(())
    } else {
        Err(SessionError::ActorMismatch { expected: expected.clone(), actual: actual.clone() })
    }
}

fn ensure_heads(file: &mut DocumentFile, expected_heads: &[crate::ChangeHash]) -> Result<(), SessionError> {
    let mut current = file.heads()?;
    let mut expected = expected_heads.to_vec();
    current.sort();
    expected.sort();
    if current == expected { Ok(()) } else { Err(SessionError::StaleHeads) }
}

fn to_protocol_save(save: crate::file::SaveResult) -> SaveResult {
    SaveResult { path: DocumentPath(save.path.to_string_lossy().into_owned()), heads: save.heads }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;
    use crate::engine::TransactionDraft;
    use crate::proto::{Operation, TransactionId};
    use crate::{Origin, PageId, RecordVersion, Timestamp};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn proposal_operation_previews_use_human_labels_and_stable_positions() {
        let document_id = DocumentId::from("document:operation-label");
        let document = blank_document(&document_id, Some("Overview"));
        let page_id = document.page_ids[0].clone();
        let preview = operation_preview(
            2,
            &Operation::RenamePage { page_id: page_id.clone(), name: "System".into(), expected_version: None },
            &document,
            &document,
        );

        assert_eq!(preview.position, 2);
        assert_eq!(preview.label, format!("Rename page {page_id}"));
        assert_eq!(preview.record_ids, vec![RecordId::Page(page_id)]);
        assert!(preview.bounds.is_empty());
    }

    #[test]
    fn editor_context_tracks_page_selection_viewport_actor_and_heads() {
        let root = test_directory();
        let path = root.join("context.inkfinite");
        let actor = ActorId::from("actor:context");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:context"), actor.clone(), None)
            .expect("create session");
        let page_id = opened.status.snapshot.document.page_ids[0].clone();
        let viewport = Bounds { x: -100.0, y: -50.0, width: 200.0, height: 100.0 };

        service
            .update_context(
                &opened.session_id,
                EditorContextUpdate {
                    page_id: Some(page_id.clone()),
                    active_layer_id: None,
                    selection_ids: Vec::new(),
                    viewport: Some(viewport),
                    camera: Some(CameraState { x: 0.0, y: 0.0, zoom: 2.0 }),
                    occluded_regions: vec![Bounds { x: -100.0, y: -50.0, width: 20.0, height: 100.0 }],
                },
            )
            .expect("update context");
        let context = service.context(&opened.session_id).expect("read context");

        assert_eq!(context.page_id, Some(page_id));
        assert_eq!(context.viewport, Some(viewport));
        assert_eq!(context.camera, Some(CameraState { x: 0.0, y: 0.0, zoom: 2.0 }));
        assert_eq!(context.occluded_regions.len(), 1);
        assert_eq!(context.actor_id, actor);
        assert_eq!(context.heads, opened.status.snapshot.heads);

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn stale_save_is_rejected_without_changing_the_session() {
        let root = test_directory();
        let path = root.join("stale.inkfinite");
        let actor = ActorId::from("actor:session-test");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:stale"), actor.clone(), None)
            .expect("create session");
        let old_heads = opened.status.snapshot.heads.clone();

        service
            .commit(
                &opened.session_id,
                rename_transaction(&opened.status.snapshot, actor, "Changed"),
            )
            .expect("commit edit");

        assert!(matches!(
            service.save(&opened.session_id, &old_heads),
            Err(SessionError::StaleHeads)
        ));
        let status = service.status(&opened.session_id).expect("status");
        assert!(status.dirty);
        assert_eq!(status.snapshot.document.pages.values().next().unwrap().name, "Changed");

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn failed_validation_leaves_canonical_bytes_and_heads_unchanged() {
        let root = test_directory();
        let path = root.join("invalid.inkfinite");
        let actor = ActorId::from("actor:session-test");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:invalid"), actor.clone(), None)
            .expect("create session");
        let before_bytes = fs::read(&path).expect("read canonical bytes");
        let before_heads = opened.status.snapshot.heads.clone();
        let mut transaction = rename_transaction(&opened.status.snapshot, actor, "Never saved");
        transaction.operations = vec![Operation::RenamePage {
            page_id: PageId::from("page:missing"),
            name: "Never saved".into(),
            expected_version: Some(RecordVersion(1)),
        }];

        assert!(matches!(
            service.commit(&opened.session_id, transaction),
            Err(SessionError::File(FileError::Engine(_)))
        ));
        assert_eq!(fs::read(&path).expect("read canonical bytes"), before_bytes);
        let status = service.status(&opened.session_id).expect("status");
        assert_eq!(status.snapshot.heads, before_heads);
        assert!(!status.dirty);

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn failed_write_keeps_recovery_available_to_the_open_session() {
        let root = test_directory();
        let path = root.join("write-failure.inkfinite");
        let actor = ActorId::from("actor:session-test");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:write-failure"), actor.clone(), None)
            .expect("create session");
        let snapshot = service.status(&opened.session_id).expect("status").snapshot;
        service
            .commit(&opened.session_id, rename_transaction(&snapshot, actor, "Recovery"))
            .expect("commit edit");
        let current_heads = service.status(&opened.session_id).expect("status").snapshot.heads;

        let backup = root.join("write-failure.backup");
        fs::rename(&path, &backup).expect("move canonical aside");
        fs::create_dir(&path).expect("make replacement fail");

        assert!(matches!(
            service.save(&opened.session_id, &current_heads),
            Err(SessionError::File(FileError::Io { .. }))
        ));
        let status = service.status(&opened.session_id).expect("status after failure");
        assert!(status.dirty);
        assert!(status.recovery_available);

        service.close(&opened.session_id).expect("close session");
        fs::remove_dir(&path).expect("remove failure directory");
        fs::rename(&backup, &path).expect("restore canonical");
        remove_test_directory(root);
    }

    #[test]
    fn proposal_rejection_leaves_heads_and_bytes_unchanged() {
        let root = test_directory();
        let path = root.join("proposal-reject.inkfinite");
        let actor = ActorId::from("actor:proposal");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:proposal-reject"), actor.clone(), None)
            .expect("create session");
        let before = service.status(&opened.session_id).expect("status");
        let before_bytes = fs::read(&path).expect("read canonical file");
        let proposal = service
            .propose(
                &opened.session_id,
                agent_rename(&before.snapshot, actor, "Preview only"),
            )
            .expect("propose transaction");

        assert_eq!(
            proposal.preview.changed,
            vec![crate::proto::RecordId::Page(PageId::from(
                "page:document:proposal-reject:1"
            ))]
        );
        assert_eq!(
            service
                .status(&opened.session_id)
                .expect("status after proposal")
                .snapshot,
            before.snapshot
        );
        service
            .reject_proposal(&opened.session_id, &proposal.id)
            .expect("reject proposal");
        let review = service
            .proposal_status(&opened.session_id, &proposal.id)
            .expect("retain rejected status");
        assert_eq!(review.state, ProposalReviewState::Rejected);
        assert_eq!(fs::read(&path).expect("read unchanged canonical file"), before_bytes);
        assert_eq!(
            service.status(&opened.session_id).expect("final status").snapshot,
            before.snapshot
        );

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn partial_acceptance_commits_only_selected_operations() {
        let root = test_directory();
        let path = root.join("proposal-partial.inkfinite");
        let actor = ActorId::from("actor:proposal");
        let mut service = SessionService::new();
        let opened = service
            .create(
                &path,
                DocumentId::from("document:proposal-partial"),
                actor.clone(),
                None,
            )
            .expect("create session");
        let snapshot = opened.status.snapshot.clone();
        let page_id = snapshot.document.page_ids[0].clone();
        let layer_id = snapshot.document.pages[&page_id].layer_ids[0].clone();
        let transaction = TransactionDraft {
            id: TransactionId("transaction:proposal-partial".into()),
            actor_id: actor,
            origin: Origin::Agent,
            base_heads: snapshot.heads,
            description: "rename page and layer".into(),
            operations: vec![
                Operation::RenamePage { page_id, name: "Renamed page".into(), expected_version: None },
                Operation::PatchLayer {
                    layer_id,
                    patch: crate::proto::LayerPatch { name: Some("Renamed layer".into()), ..Default::default() },
                    expected_version: None,
                },
            ],
            timestamp: Timestamp(2),
        };
        let proposal = service
            .propose(&opened.session_id, transaction)
            .expect("propose transaction");
        let accepted = service
            .accept_proposal(&opened.session_id, &proposal.id, Some(&[1_u32]))
            .expect("accept selected operation");

        let review = service
            .proposal_status(&opened.session_id, &proposal.id)
            .expect("retain accepted status");
        assert_eq!(review.state, ProposalReviewState::PartiallyAccepted);
        assert_eq!(review.heads, accepted.commit.heads);
        assert_eq!(review.affected_ids, accepted.commit.affected_ids);

        assert_eq!(accepted.commit.patch.changed.len(), 1);
        let status = service
            .status(&opened.session_id)
            .expect("status after partial acceptance");
        assert_eq!(status.snapshot.document.pages.values().next().unwrap().name, "Page 1");
        assert_eq!(
            status.snapshot.document.layers.values().next().unwrap().name,
            "Renamed layer"
        );

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn stale_acceptance_refreshes_preview_without_committing() {
        let root = test_directory();
        let path = root.join("proposal-stale.inkfinite");
        let actor = ActorId::from("actor:proposal");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:proposal-stale"), actor.clone(), None)
            .expect("create session");
        let snapshot = opened.status.snapshot.clone();
        let proposal = service
            .propose(
                &opened.session_id,
                agent_rename(&snapshot, actor.clone(), "Agent result"),
            )
            .expect("propose transaction");
        service
            .commit(&opened.session_id, rename_transaction(&snapshot, actor, "Local edit"))
            .expect("intervening local edit");

        let error = service
            .accept_proposal(&opened.session_id, &proposal.id, None)
            .expect_err("stale acceptance must not commit");
        let refreshed = match error {
            SessionError::ProposalStale { proposal, .. } => proposal,
            other => panic!("expected refreshed proposal, got {other:?}"),
        };
        assert_eq!(
            refreshed.transaction.base_heads,
            service.status(&opened.session_id).unwrap().snapshot.heads
        );
        assert_eq!(
            service
                .status(&opened.session_id)
                .unwrap()
                .snapshot
                .document
                .pages
                .values()
                .next()
                .unwrap()
                .name,
            "Local edit"
        );

        let accepted = service
            .accept_proposal(&opened.session_id, &refreshed.id, None)
            .expect("accept refreshed proposal");
        assert_eq!(accepted.commit.patch.changed.len(), 1);
        assert_eq!(
            service
                .status(&opened.session_id)
                .unwrap()
                .snapshot
                .document
                .pages
                .values()
                .next()
                .unwrap()
                .name,
            "Agent result"
        );

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn live_apply_commits_valid_agent_transactions() {
        let root = test_directory();
        let path = root.join("live-apply.inkfinite");
        let actor = ActorId::from("actor:proposal");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:live-apply"), actor.clone(), None)
            .expect("create session");
        let snapshot = opened.status.snapshot.clone();
        let transaction = agent_rename(&snapshot, actor, "Scripted edit");

        let committed = service
            .apply(&opened.session_id, transaction)
            .expect("apply live transaction");
        assert_eq!(
            committed
                .status
                .snapshot
                .document
                .pages
                .values()
                .next()
                .expect("page")
                .name,
            "Scripted edit"
        );

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn expired_proposals_and_oversized_transactions_are_rejected() {
        let root = test_directory();
        let path = root.join("proposal-limits.inkfinite");
        let actor = ActorId::from("actor:proposal");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:proposal-limits"), actor.clone(), None)
            .expect("create session");
        let snapshot = opened.status.snapshot.clone();
        let mut oversized = agent_rename(&snapshot, actor.clone(), "Too many operations");
        oversized.operations = (0..=MAX_PROPOSAL_OPERATIONS)
            .map(|_| Operation::RenamePage {
                page_id: snapshot.document.page_ids[0].clone(),
                name: "same".into(),
                expected_version: None,
            })
            .collect();
        assert!(matches!(
            service.propose(&opened.session_id, oversized),
            Err(SessionError::ProposalTooLarge { .. })
        ));

        let proposal = service
            .propose(&opened.session_id, agent_rename(&snapshot, actor, "Will expire"))
            .expect("propose expiring transaction");
        service
            .sessions
            .get_mut(&opened.session_id)
            .unwrap()
            .proposals
            .get_mut(&proposal.id)
            .unwrap()
            .created_at = Instant::now()
            .checked_sub(PROPOSAL_TTL)
            .expect("proposal TTL is representable");
        assert!(matches!(
            service.accept_proposal(&opened.session_id, &proposal.id, None),
            Err(SessionError::ProposalExpired(_))
        ));
        let renewed = service
            .renew_proposal(&opened.session_id, &proposal.id)
            .expect("renew expired proposal");
        assert_eq!(renewed.id, proposal.id);
        assert_eq!(
            service
                .proposal_status(&opened.session_id, &proposal.id)
                .expect("renewed status")
                .state,
            ProposalReviewState::Refreshed
        );

        service.close(&opened.session_id).expect("close session");
        remove_test_directory(root);
    }

    #[test]
    fn two_trusted_replicas_converge_after_offline_edits_and_restart() {
        let root = test_directory();
        let left_path = root.join("left.inkfinite");
        let right_path = root.join("right.inkfinite");
        let document_id = DocumentId::from("document:session-sync");
        let left_actor = ActorId::from("actor:left");
        let right_actor = ActorId::from("actor:right");
        let mut left_service = SessionService::new();
        let left = left_service
            .create(&left_path, document_id, left_actor.clone(), None)
            .expect("create left");
        fs::copy(&left_path, &right_path).expect("copy baseline to right");
        let mut right_service = SessionService::new();
        let right = right_service
            .open(&right_path, right_actor.clone())
            .expect("open right");

        left_service
            .connect_peer(&left.session_id, right_actor.clone())
            .expect("connect left peer");
        right_service
            .connect_peer(&right.session_id, left_actor.clone())
            .expect("connect right peer");
        let left_snapshot = left_service.status(&left.session_id).expect("left status").snapshot;
        left_service
            .commit(
                &left.session_id,
                rename_transaction(&left_snapshot, left_actor.clone(), "Left offline edit"),
            )
            .expect("left offline edit");
        let right_snapshot = right_service.status(&right.session_id).expect("right status").snapshot;
        right_service
            .commit(
                &right.session_id,
                rename_transaction(&right_snapshot, right_actor.clone(), "Right offline edit"),
            )
            .expect("right offline edit");

        exchange_sessions(
            &mut left_service,
            &left.session_id,
            &right_actor,
            &mut right_service,
            &right.session_id,
            &left_actor,
        );
        assert_eq!(
            left_service
                .status(&left.session_id)
                .expect("left merged status")
                .snapshot,
            right_service
                .status(&right.session_id)
                .expect("right merged status")
                .snapshot
        );

        left_service.close(&left.session_id).expect("close left");
        right_service.close(&right.session_id).expect("close right");

        let mut left_restart = SessionService::new();
        let left_reopened = left_restart.open(&left_path, left_actor.clone()).expect("restart left");
        let mut right_restart = SessionService::new();
        let right_reopened = right_restart
            .open(&right_path, right_actor.clone())
            .expect("restart right");
        assert!(matches!(left_reopened.status.sync, SyncState::Enabled { .. }));
        assert!(matches!(right_reopened.status.sync, SyncState::Enabled { .. }));

        exchange_sessions(
            &mut left_restart,
            &left_reopened.session_id,
            &right_actor,
            &mut right_restart,
            &right_reopened.session_id,
            &left_actor,
        );
        assert_eq!(
            left_restart
                .status(&left_reopened.session_id)
                .expect("restarted left status")
                .snapshot,
            right_restart
                .status(&right_reopened.session_id)
                .expect("restarted right status")
                .snapshot
        );

        left_restart
            .close(&left_reopened.session_id)
            .expect("close restarted left");
        right_restart
            .close(&right_reopened.session_id)
            .expect("close restarted right");
        remove_test_directory(root);
    }

    #[test]
    fn corrupt_sync_checkpoint_warns_without_replacing_valid_document() {
        let root = test_directory();
        let path = root.join("corrupt-sync.inkfinite");
        let actor = ActorId::from("actor:session-sync");
        let mut service = SessionService::new();
        let opened = service
            .create(&path, DocumentId::from("document:corrupt-sync"), actor.clone(), None)
            .expect("create document");
        service
            .connect_peer(&opened.session_id, ActorId::from("actor:trusted"))
            .expect("connect peer");
        let expected_snapshot = opened.status.snapshot.clone();
        service.close(&opened.session_id).expect("close document");

        let sync_path = crate::file::sync_state_path_for(
            &path,
            &expected_snapshot.document_id,
            &crate::file::PersistenceOptions::default(),
        );
        fs::write(&sync_path, b"not-json").expect("corrupt sync checkpoint");

        let reopened = service.open(&path, actor).expect("open valid document");
        assert_eq!(reopened.status.snapshot, expected_snapshot);
        assert!(matches!(
            reopened.status.sync,
            SyncState::Enabled { warning: Some(_), .. }
        ));
        service.close(&reopened.session_id).expect("close reopened document");
        remove_test_directory(root);
    }

    fn exchange_sessions(
        left: &mut SessionService, left_session: &SessionId, left_peer: &ActorId, right: &mut SessionService,
        right_session: &SessionId, right_peer: &ActorId,
    ) {
        for _ in 0..64 {
            let left_message = left
                .next_sync_message(left_session, left_peer)
                .expect("left sync message");
            let right_message = right
                .next_sync_message(right_session, right_peer)
                .expect("right sync message");
            let idle = left_message.is_none() && right_message.is_none();
            if let Some(message) = left_message {
                right
                    .receive_sync_message(right_session, &message)
                    .expect("left to right sync");
            }
            if let Some(message) = right_message {
                left.receive_sync_message(left_session, &message)
                    .expect("right to left sync");
            }
            if idle {
                break;
            }
        }
    }

    fn agent_rename(snapshot: &DocumentSnapshot, actor_id: ActorId, name: &str) -> TransactionDraft {
        let mut transaction = rename_transaction(snapshot, actor_id, name);
        transaction.origin = Origin::Agent;
        transaction.operations = vec![Operation::RenamePage {
            page_id: snapshot.document.page_ids[0].clone(),
            name: name.into(),
            expected_version: None,
        }];
        transaction
    }

    fn rename_transaction(snapshot: &DocumentSnapshot, actor_id: ActorId, name: &str) -> TransactionDraft {
        let page_id = snapshot.document.page_ids[0].clone();
        TransactionDraft {
            id: TransactionId(format!("transaction:{}", name.to_lowercase())),
            actor_id,
            origin: Origin::Human,
            base_heads: snapshot.heads.clone(),
            description: "session test edit".into(),
            operations: vec![Operation::RenamePage {
                page_id,
                name: name.into(),
                expected_version: Some(RecordVersion(1)),
            }],
            timestamp: Timestamp(1),
        }
    }

    fn test_directory() -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("inkfinite-session-test-{id}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn remove_test_directory(path: PathBuf) {
        let _ = fs::remove_dir_all(path);
    }
}
