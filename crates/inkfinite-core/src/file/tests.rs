use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::engine::TransactionDraft;
use crate::proto::{Operation, TransactionId};
use crate::{
    ActorId, Document, DocumentId, LayerId, LayerRecord, Opacity, Origin, PageId, PageRecord, RecordVersion, Timestamp,
};

use super::{DocumentFile, FileError, PersistenceOptions, export_snapshot_json};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn canonical_sessions_lock_save_reopen_and_export_deterministically() {
    let expected_document = simple_document();
    let temporary = TestDirectory::new();
    let canonical = temporary.path.join("board.inkfinite");
    let snapshot_json = temporary.path.join("board.snapshot.json");
    let options = PersistenceOptions::with_recovery_directory(temporary.path.join("recovery"));

    let mut session = DocumentFile::create_with_options(
        &canonical,
        DocumentId::from("document:canonical"),
        ActorId::from("actor:test"),
        expected_document.clone(),
        options.clone(),
    )
    .expect("create canonical document");
    let first_json = session.export_json().expect("export JSON");
    assert_eq!(first_json, session.export_json().expect("repeat export"));
    assert!(first_json.contains("\"format\": \"inkfinite.document\""));
    session.export_json_to(&snapshot_json).expect("write snapshot JSON");
    assert!(matches!(
        session.export_json_to(&canonical),
        Err(FileError::SamePath { .. })
    ));
    assert!(matches!(
        DocumentFile::open_with_options(&canonical, ActorId::from("actor:other"), options.clone()),
        Err(FileError::Locked { .. })
    ));
    drop(session);

    let canonical_bytes = fs::read(&canonical).expect("canonical bytes");
    assert!(serde_json::from_slice::<serde_json::Value>(&canonical_bytes).is_err());
    let exported: crate::DocumentSnapshot =
        serde_json::from_str(&fs::read_to_string(&snapshot_json).expect("snapshot JSON")).expect("snapshot parses");
    assert_eq!(exported.document, expected_document);

    let mut reopened = DocumentFile::open_with_options(&canonical, ActorId::from("actor:reopen"), options)
        .expect("reopen canonical document");
    assert_eq!(reopened.snapshot().expect("snapshot").document, expected_document);
    assert_eq!(
        export_snapshot_json(&reopened.snapshot().expect("snapshot")).expect("export"),
        first_json
    );
}

#[test]
fn stale_lock_sidecar_does_not_block_a_new_writer() {
    let temporary = TestDirectory::new();
    let canonical = temporary.path.join("board.inkfinite");
    let lock = temporary.path.join(".board.inkfinite.lock");
    fs::write(&lock, b"pid=999999999\n").expect("write abandoned lock sidecar");

    let session = DocumentFile::create(
        &canonical,
        DocumentId::from("document:stale-lock"),
        ActorId::from("actor:first"),
        simple_document(),
    )
    .expect("reclaim stale lock sidecar");
    assert!(matches!(
        DocumentFile::open(&canonical, ActorId::from("actor:blocked")),
        Err(FileError::Locked { .. })
    ));

    drop(session);
    assert!(lock.exists());
    DocumentFile::open(&canonical, ActorId::from("actor:restart")).expect("open after the previous writer exits");
}

#[test]
fn rejects_invalid_canonical_bytes_without_replacing_the_file() {
    let temporary = TestDirectory::new();
    let canonical = temporary.path.join("invalid.inkfinite");
    fs::write(&canonical, b"not an Automerge document").expect("write invalid document");

    let result = DocumentFile::open(&canonical, ActorId::from("actor:test"));

    assert!(result.is_err());
    assert_eq!(
        fs::read(&canonical).expect("read invalid document"),
        b"not an Automerge document"
    );
}

#[test]
fn rejects_empty_actor_before_touching_the_document() {
    let temporary = TestDirectory::new();
    let canonical = temporary.path.join("actor.inkfinite");
    let document = simple_document();
    let _session = DocumentFile::create(
        &canonical,
        DocumentId::from("document:actor"),
        ActorId::from("actor:writer"),
        document,
    )
    .expect("create document");

    let result = DocumentFile::open(&canonical, ActorId::from("  "));

    assert!(matches!(result, Err(FileError::InvalidDocument(message)) if message.contains("actor ID")));
}

#[test]
fn recovery_restores_journal_after_canonical_replace_failure() {
    let temporary = TestDirectory::new();
    let canonical = temporary.path.join("board.inkfinite");
    let recovery_directory = temporary.path.join("recovery");
    let options = PersistenceOptions {
        recovery_directory: Some(recovery_directory),
        max_journal_entries: 1,
        max_journal_bytes: 1024 * 1024,
    };
    let mut session = DocumentFile::create_with_options(
        &canonical,
        DocumentId::from("document:recovery"),
        ActorId::from("actor:writer"),
        simple_document(),
        options.clone(),
    )
    .expect("create document");
    let base = session.snapshot().expect("base snapshot");
    session
        .commit(TransactionDraft {
            id: TransactionId("transaction:rename".into()),
            actor_id: ActorId::from("actor:writer"),
            origin: Origin::Human,
            base_heads: base.heads,
            description: "rename page".into(),
            operations: vec![Operation::RenamePage {
                page_id: PageId::from("page:one"),
                name: "Recovered".into(),
                expected_version: Some(RecordVersion(1)),
            }],
            timestamp: Timestamp(1),
        })
        .expect("commit edit");
    let recovery_path = session.recovery_path().expect("recovery path");
    let backup = temporary.path.join("old.inkfinite");
    fs::rename(&canonical, &backup).expect("move canonical aside");
    fs::create_dir(&canonical).expect("make replacement fail");

    let result = session.save();
    assert!(matches!(result, Err(FileError::Io { .. })));
    assert!(recovery_path.exists());
    let recovery: serde_json::Value =
        serde_json::from_slice(&fs::read(&recovery_path).expect("recovery bytes")).expect("recovery JSON");
    assert!(recovery["snapshot"].as_array().is_some_and(|bytes| !bytes.is_empty()));
    assert_eq!(recovery["journal"].as_array().expect("journal").len(), 1);
    drop(session);

    fs::remove_dir(&canonical).expect("remove failure directory");
    fs::rename(&backup, &canonical).expect("restore old canonical");
    let mut recovered =
        DocumentFile::recover(&canonical, ActorId::from("actor:recovery"), options).expect("recover interrupted save");
    assert_eq!(
        recovered.snapshot().expect("recovered snapshot").document.pages[&PageId::from("page:one")].name,
        "Recovered"
    );
    let save = recovered.save().expect("save recovered document");
    assert!(!save.recovery_retained);
    assert!(!recovery_path.exists());
    drop(recovered);

    let mut reopened = DocumentFile::open(&canonical, ActorId::from("actor:verify")).expect("reopen recovered");
    assert_eq!(
        reopened.snapshot().expect("snapshot").document.pages[&PageId::from("page:one")].name,
        "Recovered"
    );
}

fn simple_document() -> Document {
    let page_id = PageId::from("page:one");
    let layer_id = LayerId::from("layer:one");
    Document {
        pages: BTreeMap::from([(
            page_id.clone(),
            PageRecord {
                id: page_id.clone(),
                name: "Page".into(),
                layer_ids: vec![layer_id.clone()],
                version: RecordVersion(1),
            },
        )]),
        page_ids: vec![page_id.clone()],
        layers: BTreeMap::from([(
            layer_id,
            LayerRecord {
                id: LayerId::from("layer:one"),
                page_id,
                name: "Default".into(),
                shape_ids: Vec::new(),
                visible: true,
                locked: false,
                opacity: Opacity::OPAQUE,
                version: RecordVersion(1),
            },
        )]),
        shapes: BTreeMap::new(),
        bindings: BTreeMap::new(),
        assets: BTreeMap::new(),
    }
}

struct TestDirectory {
    path: PathBuf,
}

impl TestDirectory {
    fn new() -> Self {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("inkfinite-file-test-{id}"));
        fs::create_dir_all(&path).expect("create test directory");
        Self { path }
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
