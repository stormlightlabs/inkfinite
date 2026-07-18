//! Rust-owned document sessions used by desktop and local adapters.
//!
//! A session keeps the durable file boundary, the materialized snapshot, and
//! actor-scoped history together. Adapters can expose this service over Tauri,
//! local IPC, or a CLI without moving document bytes into the frontend.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::engine::{EngineError, validate_document};
use crate::file::{DocumentFile, FileError};
use crate::proto::{CommitResult, DocumentPath, Query, QueryResult, SaveResult, SessionId, TransactionDraft};
use crate::{ActorId, DocumentId, DocumentSnapshot, blank_document};

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
}

/// In-process owner of all open desktop document sessions.
pub struct SessionService {
    sessions: BTreeMap<SessionId, DocumentSession>,
    next_session_number: u64,
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
        Self { sessions: BTreeMap::new(), next_session_number: 0 }
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
        session.status(session_id)
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
        let mut session = DocumentSession { file, sync: SyncState::Disabled };
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
