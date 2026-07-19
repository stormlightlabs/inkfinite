#![forbid(unsafe_code)]

//! Durable file boundary for Inkfinite documents.
//!
//! The file boundary persists the Rust-owned CRDT as compact Automerge bytes.
//! Snapshot JSON is an inspection/export format; it does not contain the CRDT
//! history needed to reproduce a canonical `.inkfinite` file.

use std::path::PathBuf;

use crate::engine::EngineError;
use crate::sync::SyncError;
use thiserror::Error;

/// Recoverable failure at the validation, persistence, or recovery boundary.
#[derive(Debug, Error)]
pub enum FileError {
    /// The input was not a valid canonical document or document-related value.
    #[error("invalid document: {0}")]
    InvalidDocument(String),
    /// JSON could not be parsed or serialized.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    /// A recognized format version is newer than this implementation supports.
    #[error("unsupported document format {format:?} version {version}")]
    UnsupportedFormat { format: String, version: u32 },
    /// A shape kind has no registry entry.
    #[error("unsupported shape kind {kind:?} for shape {shape_id}")]
    UnsupportedShapeKind { kind: String, shape_id: String },
    /// A source and destination path were the same file.
    #[error("refusing to overwrite a file with itself: {path}")]
    SamePath { path: PathBuf },
    /// Another cooperating writer owns the document lock.
    #[error("document is locked by another writer: {path}")]
    Locked { path: PathBuf },
    /// The requested recovery record does not exist.
    #[error("no recovery record exists for {path}")]
    RecoveryNotFound { path: PathBuf },
    /// A recovery record is malformed or does not match its document.
    #[error("invalid recovery record: {0}")]
    InvalidRecovery(String),
    /// A recovery record contains newer state than the currently opened file.
    #[error("recovery state is ahead of the opened document: {path}")]
    RecoveryAhead { path: PathBuf },
    /// The transaction engine rejected a document or CRDT operation.
    #[error(transparent)]
    Engine(#[from] EngineError),
    /// A trusted peer synchronization operation was rejected.
    #[error(transparent)]
    Sync(#[from] SyncError),
    /// A filesystem operation failed.
    #[error("{operation} {path}: {source}")]
    Io {
        /// Operation attempted when the error occurred.
        operation: &'static str,
        /// Path involved in the operation.
        path: PathBuf,
        /// Underlying operating-system error.
        #[source]
        source: std::io::Error,
    },
    /// A canonical destination already exists when creating a new document.
    #[error("document already exists: {path}")]
    AlreadyExists { path: PathBuf },
}

mod persistence;

pub use crate::DocumentSnapshot;
pub use crate::crdt::CrdtDocument;
pub use crate::engine::{CommitResult, TransactionDraft, TransactionEngine};
pub use persistence::{
    DocumentFile, PersistenceOptions, SaveResult, export_snapshot_json, recovery_path_for, sync_state_path_for,
    write_snapshot_json,
};

#[cfg(test)]
mod tests;
