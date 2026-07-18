//! Tauri commands for document sessions.

use std::sync::{Arc, Mutex, MutexGuard};

use inkfinite_core::proto::{DocumentPath, ProtocolError, Query, QueryResult, SessionId, TransactionDraft};
use inkfinite_core::session::{
    SessionCommit, SessionError, SessionOpened, SessionSaved, SessionService, SessionStatus,
};
use inkfinite_core::{ActorId, ChangeHash, DocumentId};
use tauri::State;

type Result<T> = std::result::Result<T, ProtocolError>;

/// Owner of every open document session in this app process.
pub struct DesktopState {
    service: Arc<Mutex<SessionService>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self { service: Arc::new(Mutex::new(SessionService::new())) }
    }
}

impl DesktopState {
    pub fn service_handle(&self) -> Arc<Mutex<SessionService>> {
        Arc::clone(&self.service)
    }
}

fn lock_service(state: &DesktopState) -> Result<MutexGuard<'_, SessionService>> {
    state.service.lock().map_err(|_| ProtocolError {
        code: "session_service_unavailable".into(),
        message: "the desktop session service lock is poisoned".into(),
        details: None,
    })
}

fn to_protocol_error(error: SessionError) -> ProtocolError {
    inkfinite_core::ipc::session_protocol_error(&error)
}

/// Creates a new canonical `.inkfinite` file and opens its session.
#[tauri::command]
pub fn create_document(
    state: State<'_, DesktopState>, path: String, document_id: String, actor_id: String, page_name: Option<String>,
) -> Result<SessionOpened> {
    lock_service(&state)?
        .create(
            path,
            DocumentId::new(document_id),
            ActorId::new(actor_id),
            page_name.as_deref(),
        )
        .map_err(to_protocol_error)
}

/// Opens a canonical document or imports a selected frozen v1 JSON file.
#[tauri::command]
pub fn open_document(state: State<'_, DesktopState>, path: String, actor_id: String) -> Result<SessionOpened> {
    lock_service(&state)?
        .open(path, ActorId::new(actor_id))
        .map_err(to_protocol_error)
}

/// Returns the current snapshot and session state.
#[tauri::command]
pub fn snapshot(state: State<'_, DesktopState>, session_id: String) -> Result<SessionStatus> {
    lock_service(&state)?
        .status(&SessionId(session_id))
        .map_err(to_protocol_error)
}

/// Commits one typed transaction through the shared transaction engine.
#[tauri::command]
pub fn commit(
    state: State<'_, DesktopState>, session_id: String, transaction: TransactionDraft,
) -> Result<SessionCommit> {
    lock_service(&state)?
        .commit(&SessionId(session_id), transaction)
        .map_err(to_protocol_error)
}

/// Compensates the latest transaction for the session actor.
#[tauri::command]
pub fn undo(state: State<'_, DesktopState>, session_id: String, actor_id: String) -> Result<SessionCommit> {
    let session_id = SessionId(session_id);
    let actor_id = ActorId::new(actor_id);
    lock_service(&state)?
        .undo(&session_id, &actor_id)
        .map_err(to_protocol_error)
}

/// Reapplies the latest compensated transaction for the session actor.
#[tauri::command]
pub fn redo(state: State<'_, DesktopState>, session_id: String, actor_id: String) -> Result<SessionCommit> {
    let session_id = SessionId(session_id);
    let actor_id = ActorId::new(actor_id);
    lock_service(&state)?
        .redo(&session_id, &actor_id)
        .map_err(to_protocol_error)
}

/// Saves the current session after checking the caller's causal heads.
#[tauri::command]
pub fn save(
    state: State<'_, DesktopState>, session_id: String, expected_heads: Vec<ChangeHash>,
) -> Result<SessionSaved> {
    lock_service(&state)?
        .save(&SessionId(session_id), &expected_heads)
        .map_err(to_protocol_error)
}

/// Saves the current session at a replacement path after checking its heads.
#[tauri::command]
pub fn save_as(
    state: State<'_, DesktopState>, session_id: String, path: DocumentPath, expected_heads: Vec<ChangeHash>,
) -> Result<SessionSaved> {
    lock_service(&state)?
        .save_as(&SessionId(session_id), path.0, &expected_heads)
        .map_err(to_protocol_error)
}

/// Queries records through the shared deterministic query implementation.
#[tauri::command]
pub fn query(state: State<'_, DesktopState>, session_id: String, query: Query) -> Result<QueryResult> {
    lock_service(&state)?
        .query(&SessionId(session_id), &query)
        .map_err(to_protocol_error)
}

/// Validates the current session without changing it.
#[tauri::command]
pub fn validate(state: State<'_, DesktopState>, session_id: String) -> Result<SessionStatus> {
    lock_service(&state)?
        .validate(&SessionId(session_id))
        .map_err(to_protocol_error)
}

/// Closes a session and releases its advisory file lock.
#[tauri::command]
pub fn close(state: State<'_, DesktopState>, session_id: String) -> Result<()> {
    lock_service(&state)?
        .close(&SessionId(session_id))
        .map_err(to_protocol_error)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;
    use inkfinite_core::proto::{Operation, TransactionId};
    use inkfinite_core::{Origin, PageId, RecordVersion, Timestamp};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn protocol_errors_keep_stale_heads_typed() {
        let error = to_protocol_error(SessionError::StaleHeads);
        assert_eq!(error.code, "stale_heads");
    }

    #[test]
    fn command_service_supports_edit_save_reopen_undo_and_close() {
        let root = test_directory();
        let path = root.join("board.inkfinite");
        let actor = ActorId::from("actor:desktop");
        let mut service = SessionService::new();
        let opened = service
            .create(
                &path,
                DocumentId::from("document:desktop"),
                actor.clone(),
                Some("Canvas"),
            )
            .expect("create session");
        let base_heads = opened.status.snapshot.heads.clone();
        let commit = service
            .commit(
                &opened.session_id,
                TransactionDraft {
                    id: TransactionId("transaction:rename".into()),
                    actor_id: actor.clone(),
                    origin: Origin::Human,
                    base_heads,
                    description: "rename page".into(),
                    operations: vec![Operation::RenamePage {
                        page_id: PageId::from("page:document:desktop:1"),
                        name: "Renamed".into(),
                        expected_version: Some(RecordVersion(1)),
                    }],
                    timestamp: Timestamp(1),
                },
            )
            .expect("commit edit");
        assert!(commit.status.dirty);
        assert!(commit.status.can_undo);

        let undone = service.undo(&opened.session_id, &actor).expect("undo edit");
        assert_eq!(
            undone.status.snapshot.document.pages[&PageId::from("page:document:desktop:1")].name,
            "Canvas"
        );
        let redone = service.redo(&opened.session_id, &actor).expect("redo edit");
        let saved = service
            .save(&opened.session_id, &redone.status.snapshot.heads)
            .expect("save edit");
        assert!(!saved.status.dirty);
        let replacement = root.join("board-copy.inkfinite");
        let saved_as = service
            .save_as(&opened.session_id, &replacement, &saved.status.snapshot.heads)
            .expect("save as edit");
        assert_eq!(saved_as.status.path.0, replacement.to_string_lossy());
        assert!(path.exists());
        service.close(&opened.session_id).expect("close session");

        let reopened = service.open(&replacement, actor.clone()).expect("reopen file");
        assert_eq!(
            reopened.status.snapshot.document.pages[&PageId::from("page:document:desktop:1")].name,
            "Renamed"
        );
        service.close(&reopened.session_id).expect("close reopened session");
        remove_test_directory(root);
    }

    fn test_directory() -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("inkfinite-session-test-{id}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn remove_test_directory(path: PathBuf) {
        let _ = std::fs::remove_dir_all(path);
    }
}
