//! Canonical file persistence, advisory locks, atomic replacement, and recovery.

use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::crdt::EncodedChange;
use crate::engine::{TransactionDraft, TransactionEngine};
use crate::{ActorId, ChangeHash, Document, DocumentId, DocumentSnapshot};
use serde::{Deserialize, Serialize};

use super::{FileError, ImportedV1, import_v1_json};

const RECOVERY_FORMAT: &str = "inkfinite.recovery";
const RECOVERY_VERSION: u32 = 1;
const DEFAULT_MAX_JOURNAL_ENTRIES: usize = 32;
const DEFAULT_MAX_JOURNAL_BYTES: usize = 8 * 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Options controlling where recovery records live and how large their
/// incremental journal may become.
#[derive(Clone, Debug)]
pub struct PersistenceOptions {
    /// Optional app-data directory for recovery records. When absent, a
    /// .inkfinite-recovery directory is created beside the canonical file.
    pub recovery_directory: Option<PathBuf>,
    /// Maximum number of encoded changes retained in one recovery journal.
    pub max_journal_entries: usize,
    /// Maximum total encoded byte length retained in one recovery journal.
    pub max_journal_bytes: usize,
}

impl Default for PersistenceOptions {
    fn default() -> Self {
        Self {
            recovery_directory: None,
            max_journal_entries: DEFAULT_MAX_JOURNAL_ENTRIES,
            max_journal_bytes: DEFAULT_MAX_JOURNAL_BYTES,
        }
    }
}

impl PersistenceOptions {
    /// Returns options using the supplied directory for recovery records.
    #[must_use]
    pub fn with_recovery_directory(directory: impl Into<PathBuf>) -> Self {
        Self { recovery_directory: Some(directory.into()), ..Self::default() }
    }

    fn recovery_directory_for(&self, document_path: &Path) -> PathBuf {
        self.recovery_directory.clone().unwrap_or_else(|| {
            document_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(".inkfinite-recovery")
        })
    }

    fn max_journal_entries(&self) -> usize {
        self.max_journal_entries.max(1)
    }

    fn max_journal_bytes(&self) -> usize {
        self.max_journal_bytes.max(1)
    }
}

/// Result of a successful canonical save.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SaveResult {
    /// Canonical file that was replaced.
    pub path: PathBuf,
    /// Causal heads written to the file.
    pub heads: Vec<ChangeHash>,
    /// Number of canonical bytes written.
    pub bytes_written: usize,
    /// Recovery sidecar associated with the document.
    pub recovery_path: PathBuf,
    /// Whether cleanup of the recovery sidecar could not be confirmed.
    pub recovery_retained: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RecoveryFile {
    format: String,
    version: u32,
    source_path: String,
    document_id: DocumentId,
    base_heads: Vec<ChangeHash>,
    current_heads: Vec<ChangeHash>,
    /// Compact Automerge bytes at the beginning of the recovery window.
    snapshot: Vec<u8>,
    /// Changes after `base_heads`, retained in causal order.
    journal: Vec<EncodedChange>,
}

impl RecoveryFile {
    fn new(source_path: &Path, document_id: DocumentId, snapshot: Vec<u8>, heads: Vec<ChangeHash>) -> Self {
        Self {
            format: RECOVERY_FORMAT.into(),
            version: RECOVERY_VERSION,
            source_path: path_string(source_path),
            document_id,
            base_heads: heads.clone(),
            current_heads: heads,
            snapshot,
            journal: Vec::new(),
        }
    }
}

/// A lock-held Rust document session.
pub struct DocumentFile {
    path: PathBuf,
    actor_id: ActorId,
    engine: TransactionEngine,
    options: PersistenceOptions,
    baseline_bytes: Vec<u8>,
    baseline_heads: Vec<ChangeHash>,
    pending_recovery: Option<RecoveryFile>,
    lock: AdvisoryLock,
}

impl DocumentFile {
    /// Opens a canonical .inkfinite file and holds its advisory lock for the
    /// lifetime of the session.
    ///
    /// # Errors
    ///
    /// Returns a typed filesystem, CRDT, or validation error. An existing
    /// recovery record is left untouched; call recover explicitly to adopt it.
    pub fn open(path: impl AsRef<Path>, actor_id: ActorId) -> Result<Self, FileError> {
        Self::open_with_options(path, actor_id, PersistenceOptions::default())
    }

    /// Opens a canonical file with explicit recovery settings.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the actor, lock, canonical bytes, or
    /// materialized document is invalid.
    pub fn open_with_options(
        path: impl AsRef<Path>, actor_id: ActorId, options: PersistenceOptions,
    ) -> Result<Self, FileError> {
        ensure_actor(&actor_id)?;
        let path = absolute_path(path.as_ref())?;
        let lock = AdvisoryLock::acquire(&path)?;
        let bytes = read_bytes(&path, "read canonical document")?;
        let mut engine = load_canonical_bytes(&bytes, actor_id.clone())?;
        let heads = engine.snapshot()?.heads;
        Ok(Self {
            path,
            actor_id,
            engine,
            options,
            baseline_bytes: bytes,
            baseline_heads: heads,
            pending_recovery: None,
            lock,
        })
    }

    /// Creates and safely persists a new canonical document.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the document is invalid, the destination
    /// exists, or a safe write cannot complete.
    pub fn create(
        path: impl AsRef<Path>, document_id: DocumentId, actor_id: ActorId, document: Document,
    ) -> Result<Self, FileError> {
        Self::create_with_options(path, document_id, actor_id, document, PersistenceOptions::default())
    }

    /// Creates and safely persists a new document with explicit recovery
    /// settings.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the document is invalid, the destination
    /// exists, or a safe write cannot complete.
    pub fn create_with_options(
        path: impl AsRef<Path>, document_id: DocumentId, actor_id: ActorId, document: Document,
        options: PersistenceOptions,
    ) -> Result<Self, FileError> {
        ensure_actor(&actor_id)?;
        let path = absolute_path(path.as_ref())?;
        let lock = AdvisoryLock::acquire(&path)?;
        if path.exists() {
            return Err(FileError::AlreadyExists { path });
        }
        let mut engine = TransactionEngine::create(document_id, actor_id.clone(), document)?;
        let baseline_bytes = engine.save()?;
        let baseline_heads = engine.snapshot()?.heads;
        let mut session =
            Self { path, actor_id, engine, options, baseline_bytes, baseline_heads, pending_recovery: None, lock };
        session.save()?;
        Ok(session)
    }

    /// Imports a v1 file into a newly persisted canonical destination.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when migration or canonical persistence fails.
    pub fn import_v1(
        source: impl AsRef<Path>, destination: impl AsRef<Path>, actor_id: ActorId,
    ) -> Result<Self, FileError> {
        import_v1_file(source, destination, actor_id)
    }

    /// Imports a v1 file with explicit recovery settings.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when migration or canonical persistence fails.
    pub fn import_v1_with_options(
        source: impl AsRef<Path>, destination: impl AsRef<Path>, actor_id: ActorId, options: PersistenceOptions,
    ) -> Result<Self, FileError> {
        import_v1_file_with_options(source, destination, actor_id, options)
    }

    /// Recovers the newest interrupted save associated with the path.
    ///
    /// Recovery loads the compact base snapshot, applies its bounded change
    /// journal, validates the result through the transaction engine, and keeps
    /// the recovery record until the caller successfully saves the recovered
    /// document.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the recovery record is absent, malformed, or
    /// cannot be validated and adopted.
    pub fn recover(path: impl AsRef<Path>, actor_id: ActorId, options: PersistenceOptions) -> Result<Self, FileError> {
        ensure_actor(&actor_id)?;
        let path = absolute_path(path.as_ref())?;
        let recovery_path = find_recovery_path(&path, &options)?;
        let lock = AdvisoryLock::acquire(&path)?;
        let recovery = read_recovery(&recovery_path, &path, &options)?;
        let mut engine = TransactionEngine::load(&recovery.snapshot, actor_id.clone())?;
        let base_snapshot = engine.snapshot()?;
        if base_snapshot.document_id != recovery.document_id || !same_heads(&base_snapshot.heads, &recovery.base_heads)
        {
            return Err(FileError::InvalidRecovery(
                "base snapshot identity does not match recovery metadata".into(),
            ));
        }
        if !recovery.journal.is_empty() {
            engine.merge_changes(&recovery.journal)?;
        }
        let recovered_snapshot = engine.snapshot()?;
        if recovered_snapshot.document_id != recovery.document_id
            || !same_heads(&recovered_snapshot.heads, &recovery.current_heads)
        {
            return Err(FileError::InvalidRecovery(
                "recovery journal did not produce the recorded heads".into(),
            ));
        }
        Ok(Self {
            path,
            actor_id,
            engine,
            options,
            baseline_bytes: recovery.snapshot.clone(),
            baseline_heads: recovery.base_heads.clone(),
            pending_recovery: Some(recovery),
            lock,
        })
    }

    /// Returns the canonical path held by this session.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns the actor used for future local changes.
    #[must_use]
    pub fn actor_id(&self) -> &ActorId {
        &self.actor_id
    }

    /// Returns the current causal heads held by the session.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the current CRDT snapshot cannot be
    /// materialized.
    pub fn heads(&mut self) -> Result<Vec<ChangeHash>, FileError> {
        Ok(self.engine.snapshot()?.heads)
    }

    /// Reports whether the materialized state differs from the last successful
    /// save for this path.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the current CRDT snapshot cannot be
    /// materialized.
    pub fn is_dirty(&mut self) -> Result<bool, FileError> {
        Ok(!same_heads(&self.engine.snapshot()?.heads, &self.baseline_heads))
    }

    /// Reports whether the session actor has a transaction available to undo.
    #[must_use]
    pub fn can_undo(&self) -> bool {
        self.engine.can_undo(&self.actor_id)
    }

    /// Reports whether the session actor has a compensated transaction
    /// available to redo.
    #[must_use]
    pub fn can_redo(&self) -> bool {
        self.engine.can_redo(&self.actor_id)
    }

    /// Borrows the transaction engine for read-only inspection.
    #[must_use]
    pub fn engine(&self) -> &TransactionEngine {
        &self.engine
    }

    /// Borrows the transaction engine for commits, undo, redo, and queries.
    pub fn engine_mut(&mut self) -> &mut TransactionEngine {
        &mut self.engine
    }

    /// Commits one validated transaction through the held document session.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the transaction engine rejects the draft.
    pub fn commit(&mut self, transaction: TransactionDraft) -> Result<crate::engine::CommitResult, FileError> {
        Ok(self.engine.commit(transaction)?)
    }

    /// Materializes the current v2 snapshot.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the CRDT snapshot cannot be materialized.
    pub fn snapshot(&mut self) -> Result<DocumentSnapshot, FileError> {
        Ok(self.engine.snapshot()?)
    }

    /// Returns deterministic inspection JSON for the current snapshot.
    ///
    /// This projection contains records and causal heads only. It cannot
    /// preserve the Automerge history of the canonical file.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the snapshot cannot be materialized or
    /// serialized.
    pub fn export_json(&mut self) -> Result<String, FileError> {
        let snapshot = self.snapshot()?;
        export_snapshot_json(&snapshot)
    }

    /// Writes deterministic snapshot JSON to a separate file atomically.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the snapshot cannot be materialized or the
    /// destination cannot be written safely.
    pub fn export_json_to(&mut self, path: impl AsRef<Path>) -> Result<(), FileError> {
        let destination = absolute_path(path.as_ref())?;
        if paths_equivalent(&self.path, &destination) {
            return Err(FileError::SamePath { path: self.path.clone() });
        }
        let snapshot = self.snapshot()?;
        write_snapshot_json(destination, &snapshot)
    }

    /// Returns the expected recovery sidecar path for this document.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the current snapshot cannot be materialized.
    pub fn recovery_path(&mut self) -> Result<PathBuf, FileError> {
        let document_id = self.snapshot()?.document_id;
        Ok(recovery_path_for(&self.path, &document_id, &self.options))
    }

    /// Reports whether a recovery sidecar is present for this session.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when the current snapshot cannot be materialized.
    pub fn recovery_available(&mut self) -> Result<bool, FileError> {
        Ok(self.recovery_path()?.exists())
    }

    /// Safely persists compact Automerge bytes and retains recovery until the
    /// canonical replacement succeeds.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] when recovery preparation, flushing, replacement,
    /// or validation fails. A failed canonical replacement leaves recovery data
    /// available for [`Self::recover`].
    pub fn save(&mut self) -> Result<SaveResult, FileError> {
        let snapshot = self.engine.snapshot()?;
        let document_id = snapshot.document_id.clone();
        let heads = snapshot.heads.clone();
        let bytes = self.engine.save()?;
        let recovery_path = recovery_path_for(&self.path, &document_id, &self.options);

        let mut recovery = if let Some(recovery) = self.pending_recovery.clone() {
            recovery
        } else if recovery_path.exists() {
            read_recovery(&recovery_path, &self.path, &self.options)?
        } else {
            RecoveryFile::new(
                &self.path,
                document_id.clone(),
                self.baseline_bytes.clone(),
                self.baseline_heads.clone(),
            )
        };
        if recovery.document_id != document_id {
            return Err(FileError::RecoveryAhead { path: recovery_path });
        }
        if !same_heads(&recovery.current_heads, &heads) {
            let changes = self
                .engine
                .changes_since(&recovery.current_heads)
                .map_err(|_| FileError::RecoveryAhead { path: recovery_path.clone() })?;
            recovery.journal.extend(changes);
        }
        recovery.current_heads.clone_from(&heads);
        if journal_bytes(&recovery.journal) > self.options.max_journal_bytes()
            || recovery.journal.len() > self.options.max_journal_entries()
        {
            recovery.snapshot.clone_from(&bytes);
            recovery.base_heads.clone_from(&heads);
            recovery.journal.clear();
        }
        self.pending_recovery = Some(recovery.clone());
        let recovery_directory = recovery_path
            .parent()
            .ok_or_else(|| FileError::InvalidRecovery("recovery path has no parent".into()))?;
        fs::create_dir_all(recovery_directory)
            .map_err(|error| io_error("create recovery directory", recovery_directory.to_owned(), error))?;
        write_recovery(&recovery_path, &recovery)?;

        if let Err(error) = atomic_write(&self.path, &bytes) {
            self.pending_recovery = Some(recovery);
            return Err(error);
        }
        self.baseline_bytes.clone_from(&bytes);
        self.baseline_heads.clone_from(&heads);
        self.pending_recovery = None;

        let recovery_retained = match fs::remove_file(&recovery_path) {
            Ok(()) => false,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => true,
        };
        Ok(SaveResult { path: self.path.clone(), heads, bytes_written: bytes.len(), recovery_path, recovery_retained })
    }

    /// Persists the current CRDT state to a replacement path and keeps the
    /// replacement locked for the rest of the session.
    ///
    /// Save-as starts a fresh recovery window at the replacement path. The
    /// original file and its lock remain untouched when preparing or writing
    /// the replacement fails.
    ///
    /// # Errors
    ///
    /// Returns [`FileError::SamePath`] for the current path, or a typed lock,
    /// recovery, or filesystem error when the replacement cannot be written.
    pub fn save_as(&mut self, path: impl AsRef<Path>) -> Result<SaveResult, FileError> {
        let destination = absolute_path(path.as_ref())?;
        if paths_equivalent(&self.path, &destination) {
            return Err(FileError::SamePath { path: self.path.clone() });
        }

        let replacement_lock = AdvisoryLock::acquire(&destination)?;
        let snapshot = self.engine.snapshot()?;
        let document_id = snapshot.document_id.clone();
        let heads = snapshot.heads.clone();
        let bytes = self.engine.save()?;
        let recovery_path = recovery_path_for(&destination, &document_id, &self.options);
        let recovery = RecoveryFile::new(&destination, document_id, bytes.clone(), heads.clone());
        let recovery_directory = recovery_path
            .parent()
            .ok_or_else(|| FileError::InvalidRecovery("recovery path has no parent".into()))?;
        fs::create_dir_all(recovery_directory)
            .map_err(|error| io_error("create recovery directory", recovery_directory.to_owned(), error))?;
        write_recovery(&recovery_path, &recovery)?;

        atomic_write(&destination, &bytes)?;

        let recovery_retained = match fs::remove_file(&recovery_path) {
            Ok(()) => false,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => true,
        };
        self.path = destination;
        self.baseline_bytes = bytes;
        self.baseline_heads.clone_from(&heads);
        self.pending_recovery = None;
        self.lock = replacement_lock;

        Ok(SaveResult {
            path: self.path.clone(),
            heads,
            bytes_written: self.baseline_bytes.len(),
            recovery_path,
            recovery_retained,
        })
    }
}

/// Reads and migrates a v1 JSON file without writing any destination.
///
/// # Errors
///
/// Returns [`FileError`] when the source cannot be read, locked, parsed, or
/// migrated.
pub fn read_v1_file(path: impl AsRef<Path>, actor_id: ActorId) -> Result<ImportedV1, FileError> {
    ensure_actor(&actor_id)?;
    let path = absolute_path(path.as_ref())?;
    let _lock = AdvisoryLock::acquire(&path)?;
    let input = String::from_utf8(read_bytes(&path, "read v1 document")?)
        .map_err(|error| FileError::InvalidV1(format!("v1 document is not UTF-8: {error}")))?;
    import_v1_json(&input, actor_id)
}

/// Imports a v1 file and safely writes its canonical v2 representation.
///
/// # Errors
///
/// Returns [`FileError`] when the source cannot be migrated or the destination
/// cannot be written safely.
pub fn import_v1_file(
    source: impl AsRef<Path>, destination: impl AsRef<Path>, actor_id: ActorId,
) -> Result<DocumentFile, FileError> {
    import_v1_file_with_options(source, destination, actor_id, PersistenceOptions::default())
}

/// Imports a v1 file and safely writes its canonical v2 representation with
/// explicit recovery settings.
///
/// # Errors
///
/// Returns [`FileError`] when the source cannot be migrated or the destination
/// cannot be written safely.
pub fn import_v1_file_with_options(
    source: impl AsRef<Path>, destination: impl AsRef<Path>, actor_id: ActorId, options: PersistenceOptions,
) -> Result<DocumentFile, FileError> {
    ensure_actor(&actor_id)?;
    let source = absolute_path(source.as_ref())?;
    let destination = absolute_path(destination.as_ref())?;
    if paths_equivalent(&source, &destination) {
        return Err(FileError::SamePath { path: source });
    }
    let imported = read_v1_file(&source, actor_id.clone())?;
    let engine = imported.into_engine(actor_id.clone())?;
    create_session_from_engine(destination, actor_id, engine, options)
}

/// Loads canonical Automerge bytes into a validated transaction engine.
///
/// # Errors
///
/// Returns [`FileError`] when the actor, CRDT bytes, or materialized document is
/// invalid.
pub fn load_canonical_bytes(bytes: &[u8], actor_id: ActorId) -> Result<TransactionEngine, FileError> {
    ensure_actor(&actor_id)?;
    Ok(TransactionEngine::load(bytes, actor_id)?)
}

/// Serializes a v2 materialized snapshot in deterministic, human-readable JSON.
///
/// Map keys are ordered by the v2 model's `BTreeMap` fields and causal heads are
/// sorted for stable output. The result is a snapshot projection: applying it
/// to a new CRDT would create new history rather than preserve the original
/// Automerge changes.
///
/// # Errors
///
/// Returns [`FileError::Json`] when the snapshot cannot be serialized.
pub fn export_snapshot_json(snapshot: &DocumentSnapshot) -> Result<String, FileError> {
    let mut snapshot = snapshot.clone();
    snapshot.heads.sort();
    Ok(format!("{}\n", serde_json::to_string_pretty(&snapshot)?))
}

/// Writes a deterministic snapshot JSON file with a same-directory temporary
/// file and atomic replacement.
///
/// # Errors
///
/// Returns [`FileError`] when the snapshot cannot be serialized or the
/// destination cannot be written safely.
pub fn write_snapshot_json(path: impl AsRef<Path>, snapshot: &DocumentSnapshot) -> Result<(), FileError> {
    let path = absolute_path(path.as_ref())?;
    let _lock = AdvisoryLock::acquire(&path)?;
    let contents = export_snapshot_json(snapshot)?;
    atomic_write(&path, contents.as_bytes()).map(|_| ())
}

/// Returns the recovery sidecar path for a document ID and persistence policy.
pub fn recovery_path_for(
    document_path: impl AsRef<Path>, document_id: &DocumentId, options: &PersistenceOptions,
) -> PathBuf {
    let document_path = document_path.as_ref();
    options
        .recovery_directory_for(document_path)
        .join(format!("{}.recovery", encode_path_component(document_id.as_str())))
}

fn create_session_from_engine(
    path: PathBuf, actor_id: ActorId, mut engine: TransactionEngine, options: PersistenceOptions,
) -> Result<DocumentFile, FileError> {
    let lock = AdvisoryLock::acquire(&path)?;
    let baseline_bytes = engine.save()?;
    let baseline_heads = engine.snapshot()?.heads;
    let mut session =
        DocumentFile { path, actor_id, engine, options, baseline_bytes, baseline_heads, pending_recovery: None, lock };
    session.save()?;
    Ok(session)
}

fn write_recovery(path: &Path, recovery: &RecoveryFile) -> Result<(), FileError> {
    let bytes = serde_json::to_vec(recovery)?;
    atomic_write(path, &bytes).map(|_| ())
}

fn read_recovery(path: &Path, document_path: &Path, options: &PersistenceOptions) -> Result<RecoveryFile, FileError> {
    let bytes = read_bytes(path, "read recovery record")?;
    let recovery: RecoveryFile = serde_json::from_slice(&bytes)
        .map_err(|error| FileError::InvalidRecovery(format!("{}: {error}", path.display())))?;
    if recovery.format != RECOVERY_FORMAT || recovery.version != RECOVERY_VERSION {
        return Err(FileError::InvalidRecovery(format!(
            "unsupported recovery format {:?} version {}",
            recovery.format, recovery.version
        )));
    }
    if recovery.source_path != path_string(document_path) {
        return Err(FileError::InvalidRecovery(
            "recovery record belongs to another document".into(),
        ));
    }
    if recovery.snapshot.is_empty()
        || recovery.base_heads.is_empty()
        || recovery.current_heads.is_empty()
        || recovery.journal.len() > options.max_journal_entries()
        || journal_bytes(&recovery.journal) > options.max_journal_bytes()
    {
        return Err(FileError::InvalidRecovery(
            "recovery snapshot or bounded journal is invalid".into(),
        ));
    }
    Ok(recovery)
}

fn find_recovery_path(document_path: &Path, options: &PersistenceOptions) -> Result<PathBuf, FileError> {
    let directory = options.recovery_directory_for(document_path);
    let entries = fs::read_dir(&directory).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            FileError::RecoveryNotFound { path: document_path.to_owned() }
        } else {
            io_error("list recovery directory", directory.clone(), error)
        }
    })?;
    let expected_source = path_string(document_path);
    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| io_error("read recovery entry", directory.clone(), error))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("recovery") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let Ok(recovery) = serde_json::from_slice::<RecoveryFile>(&bytes) else {
            continue;
        };
        if recovery.source_path == expected_source {
            candidates.push(path);
        }
    }
    candidates.sort();
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| FileError::RecoveryNotFound { path: document_path.to_owned() })
}

fn ensure_actor(actor_id: &ActorId) -> Result<(), FileError> {
    if actor_id.as_str().trim().is_empty() {
        Err(FileError::InvalidV1("actor ID must not be empty".into()))
    } else {
        Ok(())
    }
}

fn journal_bytes(journal: &[EncodedChange]) -> usize {
    journal.iter().map(|change| change.as_bytes().len()).sum()
}

fn same_heads(left: &[ChangeHash], right: &[ChangeHash]) -> bool {
    let mut left = left.to_vec();
    let mut right = right.to_vec();
    left.sort();
    right.sort();
    left == right
}

fn read_bytes(path: &Path, operation: &'static str) -> Result<Vec<u8>, FileError> {
    fs::read(path).map_err(|error| io_error(operation, path.to_owned(), error))
}

fn absolute_path(path: &Path) -> Result<PathBuf, FileError> {
    if path.is_absolute() {
        return Ok(path.to_owned());
    }
    let current =
        std::env::current_dir().map_err(|error| io_error("resolve current directory", PathBuf::from("."), error))?;
    Ok(current.join(path))
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| left.to_owned());
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_owned());
    left == right
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn encode_path_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.') {
            encoded.push(char::from(byte));
        } else {
            let _ = write!(&mut encoded, "%{byte:02X}");
        }
    }
    if encoded.is_empty() { "document".into() } else { encoded }
}

fn lock_path(path: &Path) -> PathBuf {
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("document");
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(".{file_name}.lock"))
}

struct AdvisoryLock {
    path: PathBuf,
    _file: File,
}

impl AdvisoryLock {
    fn acquire(document_path: &Path) -> Result<Self, FileError> {
        let path = lock_path(document_path);
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(FileError::Locked { path: document_path.to_owned() });
            }
            Err(error) => return Err(io_error("create document lock", path, error)),
        };
        let owner = format!("pid={}\n", std::process::id());
        if let Err(error) = file.write_all(owner.as_bytes()).and_then(|()| file.sync_all()) {
            let _ = fs::remove_file(&path);
            return Err(io_error("write document lock", path, error));
        }
        Ok(Self { path, _file: file })
    }
}

impl Drop for AdvisoryLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<usize, FileError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("document");
    let temporary = parent.join(format!(
        ".{file_name}.tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = match OpenOptions::new().write(true).create_new(true).open(&temporary) {
        Ok(file) => file,
        Err(error) => return Err(io_error("create temporary document", temporary, error)),
    };
    let result = file
        .write_all(bytes)
        .and_then(|()| file.flush())
        .and_then(|()| file.sync_all());
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(io_error("flush temporary document", temporary, error));
    }
    drop(file);
    if let Err(error) = replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(io_error("replace canonical document", path.to_owned(), error));
    }
    if let Err(error) = sync_directory(parent) {
        return Err(io_error("flush document directory", parent.to_owned(), error));
    }
    Ok(bytes.len())
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    if !destination.exists() {
        return fs::rename(temporary, destination);
    }
    let backup = destination.with_extension("inkfinite-replace-backup");
    fs::rename(destination, &backup)?;
    match fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, destination);
            Err(error)
        }
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> std::io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn io_error(operation: &'static str, path: PathBuf, source: std::io::Error) -> FileError {
    FileError::Io { operation, path, source }
}
