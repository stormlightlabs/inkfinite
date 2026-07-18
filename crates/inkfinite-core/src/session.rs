//! Document sessions used by desktop and local adapters.
//!
//! A session keeps the file, the materialized snapshot, and actor-scoped
//! history together.
//!
//! Adapters can expose this service over Tauri, local IPC, or a CLI without
//! moving document bytes into the frontend.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::engine::{EngineError, validate_document};
use crate::file::{DocumentFile, FileError};
use crate::proto::{
    ApplyAuthorization, CommitResult, DocumentPath, Proposal, ProposalId, Query, QueryResult, SaveResult, SessionId,
    TransactionDraft, TransactionId, Warning,
};
use crate::{ActorId, DocumentId, DocumentSnapshot, Origin, Timestamp, blank_document};

/// Maximum number of pending proposals held by one live session.
pub const MAX_PROPOSALS_PER_SESSION: usize = 32;
/// Maximum number of operations accepted by a proposal or direct live apply.
pub const MAX_PROPOSAL_OPERATIONS: usize = 256;
/// Maximum UTF-8 byte length of a proposal description.
pub const MAX_PROPOSAL_DESCRIPTION_BYTES: usize = 4096;
/// Monotonic lifetime of an unaccepted proposal.
pub const PROPOSAL_TTL: Duration = Duration::from_secs(5 * 60);
/// Monotonic lifetime of a one-time direct-apply authorization.
pub const APPLY_AUTHORIZATION_TTL: Duration = Duration::from_secs(2 * 60);

/// State of the session's future synchronization boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum SyncState {
    /// Peer synchronization is not enabled for this local session yet.
    Disabled,
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
    /// Synchronization state retained for the later peer layer.
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

/// Result returned after a successful save or save-as.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionSaved {
    /// Persisted path and causal heads.
    pub save: SaveResult,
    /// Session state after persistence.
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
    /// The desktop UI did not issue an explicit direct-apply authorization.
    #[error("explicit apply authorization is required")]
    AuthorizationRequired,
    /// The supplied authorization was issued for another session or token.
    #[error("explicit apply authorization is invalid")]
    InvalidAuthorization,
    /// The supplied authorization passed its expiry time.
    #[error("explicit apply authorization expired")]
    AuthorizationExpired,
    /// The operating system could not create a one-time authorization token.
    #[error("could not create apply authorization: {0}")]
    AuthorizationUnavailable(String),
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
    sync: SyncState,
    proposals: BTreeMap<ProposalId, PendingProposal>,
    expired_proposals: BTreeSet<ProposalId>,
    authorizations: BTreeMap<String, ApplyGrant>,
}

#[derive(Clone)]
struct PendingProposal {
    proposal: Proposal,
    created_at: Instant,
}

struct ApplyGrant {
    authorization: ApplyAuthorization,
    expires_at: Instant,
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

    /// Opens a canonical document, or imports a selected frozen v1 JSON file
    /// into its adjacent `.inkfinite` canonical path.
    ///
    /// # Errors
    ///
    /// Returns a typed file, migration, lock, or validation error when the
    /// document cannot be opened safely.
    pub fn open(&mut self, path: impl AsRef<Path>, actor_id: ActorId) -> Result<SessionOpened, SessionError> {
        let path = path.as_ref().to_owned();
        let file = if is_v1_path(&path) {
            let destination = canonical_import_path(&path);
            if destination.exists() {
                DocumentFile::open(destination, actor_id)?
            } else {
                DocumentFile::import_v1(&path, destination, actor_id)?
            }
        } else {
            DocumentFile::open(path, actor_id)?
        };
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
            pending.proposal.transaction.clone()
        } else {
            let mut transaction = pending.proposal.transaction.clone();
            transaction.id = TransactionId(format!("{}:partial", pending.proposal.id.0));
            transaction.description = format!("{} (partial proposal acceptance)", transaction.description);
            transaction.operations = operations;
            transaction
        };
        let commit = session.file.commit(transaction)?;
        session.proposals.remove(proposal_id);
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
            Ok(())
        } else if session.expired_proposals.remove(proposal_id) {
            Err(SessionError::ProposalExpired(proposal_id.clone()))
        } else {
            Err(SessionError::ProposalNotFound(proposal_id.clone()))
        }
    }

    /// Issues a one-time authorization that the desktop UI can pass to a
    /// direct live apply request.
    ///
    /// # Errors
    ///
    /// Returns a session lookup or operating-system random-source error.
    pub fn authorize_apply(&mut self, session_id: &SessionId) -> Result<ApplyAuthorization, SessionError> {
        let session = self.session_mut(session_id)?;
        session.expire_state();
        let token = random_token().map_err(SessionError::AuthorizationUnavailable)?;
        let expires_at = Instant::now() + APPLY_AUTHORIZATION_TTL;
        let authorization = ApplyAuthorization {
            token: token.clone(),
            session_id: session_id.clone(),
            expires_at: timestamp_after(APPLY_AUTHORIZATION_TTL),
        };
        session
            .authorizations
            .insert(token, ApplyGrant { authorization: authorization.clone(), expires_at });
        Ok(authorization)
    }

    /// Applies one agent transaction after consuming a one-time desktop grant.
    ///
    /// # Errors
    ///
    /// Returns a typed authorization, validation, permission, or persistence error.
    pub fn apply_authorized(
        &mut self, session_id: &SessionId, authorization: &ApplyAuthorization, transaction: TransactionDraft,
    ) -> Result<SessionCommit, SessionError> {
        let session = self.session_mut(session_id)?;
        session.expire_state();
        let Some(grant) = session.authorizations.remove(&authorization.token) else {
            return Err(SessionError::AuthorizationRequired);
        };
        if grant.authorization.token != authorization.token || grant.authorization.session_id != *session_id {
            return Err(SessionError::InvalidAuthorization);
        }
        if Instant::now() >= grant.expires_at {
            return Err(SessionError::AuthorizationExpired);
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

    fn insert(&mut self, file: DocumentFile) -> Result<SessionOpened, SessionError> {
        let path = file.path().to_owned();
        if let Some((session_id, _)) = self.sessions.iter().find(|(_, session)| session.file.path() == path) {
            return Err(SessionError::AlreadyOpen {
                session_id: session_id.clone(),
                path: DocumentPath(path.to_string_lossy().into_owned()),
            });
        }

        self.next_session_number = self.next_session_number.saturating_add(1);
        let session_id = SessionId(format!("session:{}", self.next_session_number));
        let mut session = DocumentSession {
            file,
            sync: SyncState::Disabled,
            proposals: BTreeMap::new(),
            expired_proposals: BTreeSet::new(),
            authorizations: BTreeMap::new(),
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
            self.expired_proposals.insert(proposal_id);
        }
        while self.expired_proposals.len() > MAX_PROPOSALS_PER_SESSION {
            let Some(oldest) = self.expired_proposals.iter().next().cloned() else { break };
            self.expired_proposals.remove(&oldest);
        }
        self.authorizations.retain(|_, grant| now < grant.expires_at);
    }

    fn status(&mut self, session_id: &SessionId) -> Result<SessionStatus, SessionError> {
        let snapshot = self.file.snapshot()?;
        let dirty = self.file.is_dirty()?;
        let recovery_available = self.file.recovery_available()?;
        Ok(SessionStatus {
            session_id: session_id.clone(),
            path: DocumentPath(self.file.path().to_string_lossy().into_owned()),
            actor_id: self.file.actor_id().clone(),
            snapshot,
            dirty,
            lock_held: true,
            recovery_available,
            can_undo: self.file.can_undo(),
            can_redo: self.file.can_redo(),
            sync: self.sync.clone(),
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

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut token, "{byte:02x}").map_err(|error| error.to_string())?;
    }
    Ok(token)
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

fn is_v1_path(path: &Path) -> bool {
    path.to_string_lossy().ends_with(".inkfinite.json")
}

fn canonical_import_path(path: &Path) -> PathBuf {
    let mut destination = path.to_owned();
    destination.set_extension("inkfinite");
    destination
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
                rename_transaction(&opened.status.snapshot, actor.clone(), "Changed"),
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
            .commit(
                &opened.session_id,
                rename_transaction(&snapshot, actor.clone(), "Local edit"),
            )
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
    fn direct_apply_consumes_explicit_authorization_once() {
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
        let authorization = service.authorize_apply(&opened.session_id).expect("authorize apply");
        service
            .apply_authorized(&opened.session_id, &authorization, transaction.clone())
            .expect("apply authorized transaction");
        assert!(matches!(
            service.apply_authorized(&opened.session_id, &authorization, transaction),
            Err(SessionError::AuthorizationRequired)
        ));

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
