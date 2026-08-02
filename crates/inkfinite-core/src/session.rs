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

use crate::engine::{EngineError, SyncApplyResult, validate_document};
use crate::file::{DocumentFile, FileError};
use crate::proto::{
    AgentAccessMode, Bounds, CommitResult, DocumentPath, Proposal, ProposalId, Query, QueryResult, SaveResult,
    SessionId, TransactionDraft, TransactionId, Warning,
};
use crate::sync::{PeerSyncStatus, SyncMessage};
use crate::{ActorId, ChangeHash, DocumentId, DocumentSnapshot, Origin, PageId, ShapeId, Timestamp, blank_document};

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
    /// Agent mutation policy chosen in the desktop UI for this session.
    pub agent_access: AgentAccessMode,
    /// Current materialized CRDT snapshot.
    pub snapshot: DocumentSnapshot,
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

/// Review state exposed to an agent without granting review authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalReviewState {
    /// The proposal is waiting for a desktop review decision.
    Pending,
    /// A human accepted the proposal in the desktop UI.
    Accepted,
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
    /// Agent mutation policy currently selected in the desktop UI.
    pub agent_access: AgentAccessMode,
    /// Current causal heads.
    pub heads: Vec<ChangeHash>,
    /// Page currently visible in the editor.
    pub page_id: Option<PageId>,
    /// Shapes selected by the user in stable UI order.
    pub selection_ids: Vec<ShapeId>,
    /// Visible world-space rectangle, when the renderer has reported one.
    pub viewport: Option<Bounds>,
    /// Wall-clock time of the latest editor context update.
    pub updated_at: Timestamp,
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
    /// Direct agent changes are disabled for this desktop session.
    #[error("direct agent changes are disabled; switch Agent access to Direct in the desktop app")]
    DirectApplyDisabled,
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
}

struct DocumentSession {
    file: DocumentFile,
    proposals: BTreeMap<ProposalId, PendingProposal>,
    expired_proposals: BTreeSet<ProposalId>,
    proposal_outcomes: BTreeMap<ProposalId, ProposalStatus>,
    proposal_outcome_order: VecDeque<ProposalId>,
    page_id: Option<PageId>,
    selection_ids: Vec<ShapeId>,
    viewport: Option<Bounds>,
    context_updated_at: Timestamp,
    agent_access: AgentAccessMode,
}

#[derive(Clone)]
struct PendingProposal {
    proposal: Proposal,
    created_at: Instant,
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

    /// Returns the latest page, selection, viewport, actor, and heads reported by the desktop editor.
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
            agent_access: session.agent_access,
            heads: snapshot.heads,
            page_id: session.page_id.clone(),
            selection_ids: session.selection_ids.clone(),
            viewport: session.viewport,
            updated_at: session.context_updated_at,
        })
    }

    /// Records the current frontend page, selection, and world-space viewport.
    ///
    /// # Errors
    ///
    /// Returns a session, snapshot, or context validation error.
    pub fn update_context(
        &mut self, session_id: &SessionId, page_id: Option<PageId>, selection_ids: Vec<ShapeId>,
        viewport: Option<Bounds>,
    ) -> Result<(), SessionError> {
        let session = self.session_mut(session_id)?;
        if page_id != session.page_id || selection_ids != session.selection_ids {
            let snapshot = session.file.snapshot()?;
            if let Some(page_id) = &page_id
                && !snapshot.document.pages.contains_key(page_id)
            {
                return Err(SessionError::InvalidContext(format!("page {page_id} does not exist")));
            }
            if let Some(shape_id) = selection_ids
                .iter()
                .find(|shape_id| !snapshot.document.shapes.contains_key(*shape_id))
            {
                return Err(SessionError::InvalidContext(format!("shape {shape_id} does not exist")));
            }
            if page_id.is_none() && !selection_ids.is_empty() {
                return Err(SessionError::InvalidContext(
                    "a selection requires an active page".into(),
                ));
            }
            if let Some(page_id) = &page_id {
                for selected_shape_id in &selection_ids {
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
        if let Some(bounds) = viewport
            && (!bounds.x.is_finite()
                || !bounds.y.is_finite()
                || !bounds.width.is_finite()
                || !bounds.height.is_finite()
                || bounds.width < 0.0
                || bounds.height < 0.0)
        {
            return Err(SessionError::InvalidContext(
                "viewport must be finite with non-negative width and height".into(),
            ));
        }
        session.page_id = page_id;
        session.selection_ids = selection_ids;
        session.viewport = viewport;
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
            PendingProposal { proposal: proposal.clone(), created_at: Instant::now() },
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
            if session.expired_proposals.remove(proposal_id) {
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
                PendingProposal { proposal: refreshed.clone(), created_at: pending.created_at },
            );
            return Err(SessionError::ProposalStale {
                proposal_id: proposal_id.clone(),
                proposal: Box::new(refreshed),
            });
        }

        let operations = select_operations(&pending.proposal.transaction.operations, operation_positions)?;
        let transaction = if operation_positions.is_none() {
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
            state: ProposalReviewState::Accepted,
            heads: commit.heads.clone(),
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
                proposal: None,
            });
            Ok(())
        } else if session.expired_proposals.remove(proposal_id) {
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
                state: ProposalReviewState::Pending,
                heads: session.file.snapshot()?.heads,
                proposal: Some(pending.proposal.clone()),
            });
        }
        session
            .proposal_outcomes
            .get(proposal_id)
            .cloned()
            .ok_or_else(|| SessionError::ProposalNotFound(proposal_id.clone()))
    }

    /// Changes the agent mutation policy for this desktop session.
    ///
    /// # Errors
    ///
    /// Returns a session lookup or snapshot error.
    pub fn set_agent_access(
        &mut self, session_id: &SessionId, agent_access: AgentAccessMode,
    ) -> Result<SessionStatus, SessionError> {
        let session = self.session_mut(session_id)?;
        let previous = session.agent_access;
        session.agent_access = agent_access;
        match session.status(session_id) {
            Ok(status) => Ok(status),
            Err(error) => {
                session.agent_access = previous;
                Err(error)
            }
        }
    }

    /// Applies one agent transaction when direct access is enabled.
    ///
    /// # Errors
    ///
    /// Returns a typed access, validation, permission, or persistence error.
    pub fn apply_direct(
        &mut self, session_id: &SessionId, transaction: TransactionDraft,
    ) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        if session.agent_access != AgentAccessMode::Direct {
            return Err(SessionError::DirectApplyDisabled);
        }
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
        let page_id = file.snapshot()?.document.page_ids.first().cloned();
        let mut session = DocumentSession {
            file,
            proposals: BTreeMap::new(),
            expired_proposals: BTreeSet::new(),
            proposal_outcomes: BTreeMap::new(),
            proposal_outcome_order: VecDeque::new(),
            page_id,
            selection_ids: Vec::new(),
            viewport: None,
            context_updated_at: timestamp_now(),
            agent_access: AgentAccessMode::Review,
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
            self.proposals.remove(&proposal_id);
            self.expired_proposals.insert(proposal_id.clone());
            if let Ok(snapshot) = self.file.snapshot() {
                self.record_proposal_outcome(ProposalStatus {
                    proposal_id,
                    state: ProposalReviewState::Expired,
                    heads: snapshot.heads,
                    proposal: None,
                });
            }
        }
        while self.expired_proposals.len() > MAX_PROPOSALS_PER_SESSION {
            let Some(oldest) = self.expired_proposals.iter().next().cloned() else { break };
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
            agent_access: self.agent_access,
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
    let preview = file.engine_mut().preview(&transaction)?;
    Ok(Proposal {
        id,
        transaction,
        preview: preview.patch,
        affected_regions: preview.affected_regions,
        warnings: Vec::<Warning>::new(),
        expires_at: expires_at.unwrap_or_else(|| timestamp_after(PROPOSAL_TTL)),
    })
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
            .update_context(&opened.session_id, Some(page_id.clone()), Vec::new(), Some(viewport))
            .expect("update context");
        let context = service.context(&opened.session_id).expect("read context");

        assert_eq!(context.page_id, Some(page_id));
        assert_eq!(context.viewport, Some(viewport));
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
        assert_eq!(review.state, ProposalReviewState::Accepted);
        assert_eq!(review.heads, accepted.commit.heads);

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
    fn direct_apply_requires_session_access_and_remains_enabled() {
        let root = test_directory();
        let path = root.join("apply-authorized.inkfinite");
        let actor = ActorId::from("actor:proposal");
        let mut service = SessionService::new();
        let opened = service
            .create(
                &path,
                DocumentId::from("document:apply-authorized"),
                actor.clone(),
                None,
            )
            .expect("create session");
        let snapshot = opened.status.snapshot.clone();
        let transaction = agent_rename(&snapshot, actor, "Authorized edit");
        assert_eq!(opened.status.agent_access, AgentAccessMode::Review);
        assert!(matches!(
            service.apply_direct(&opened.session_id, transaction.clone()),
            Err(SessionError::DirectApplyDisabled)
        ));
        service
            .set_agent_access(&opened.session_id, AgentAccessMode::Direct)
            .expect("enable direct access");
        service
            .apply_direct(&opened.session_id, transaction)
            .expect("apply direct transaction");
        assert_eq!(
            service.status(&opened.session_id).expect("session status").agent_access,
            AgentAccessMode::Direct
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
