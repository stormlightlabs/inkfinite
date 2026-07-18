use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use inkfinite_engine::TransactionDraft;
use inkfinite_model::{
    ActorId, Document, DocumentId, LayerId, LayerRecord, Opacity, Origin, PageId, PageRecord,
    RecordVersion, Timestamp,
};
use inkfinite_protocol::{Operation, TransactionId};
use serde_json::Value;

use super::{
    DocumentFile, FileError, PersistenceOptions, export_snapshot_json, import_v1_file,
    import_v1_json,
};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn imports_all_valid_v1_features_into_normalized_v2_records() {
    let input = include_str!("../../../fixtures/v1/desktop/all-features.inkfinite.json");
    let imported = import_v1_json(input, ActorId::from("actor:test")).expect("fixture imports");
    let source: Value = serde_json::from_str(input).expect("fixture JSON");
    let document = &imported.document;

    let expected_page_ids = source["order"]["pageIds"]
        .as_array()
        .expect("page order")
        .iter()
        .map(|id| id.as_str().expect("page ID"))
        .collect::<Vec<_>>();
    assert_eq!(
        document
            .page_ids
            .iter()
            .map(inkfinite_model::PageId::as_str)
            .collect::<Vec<_>>(),
        expected_page_ids
    );
    assert_eq!(document.pages.len(), 2);
    assert_eq!(document.layers.len(), 2);
    for page in document.pages.values() {
        assert_eq!(page.layer_ids.len(), 1);
        let layer = &document.layers[&page.layer_ids[0]];
        let flattened = flatten_shape_order(document, &layer.shape_ids);
        let expected = source["order"]["shapeOrder"][page.id.as_str()]
            .as_array()
            .expect("shape order")
            .iter()
            .map(|id| id.as_str().expect("shape ID"))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(flattened, expected);
    }

    assert!(
        document
            .shapes
            .contains_key(&"shape:stencil-process".into())
    );
    assert!(document.shapes.contains_key(&"shape:arrow".into()));
    assert!(document.shapes.contains_key(&"shape:markdown".into()));
    assert_eq!(document.shapes.len(), 16);
    assert_eq!(
        document.shapes[&"shape:stencil-process".into()].properties["width"].as_f64(),
        Some(120.0)
    );
    assert_eq!(
        document.shapes[&"shape:stencil-process".into()].properties["height"].as_f64(),
        Some(80.0)
    );
    let stroke_opacity = document.shapes[&"shape:stroke".into()]
        .style
        .stroke_opacity
        .expect("stroke opacity")
        .get();
    assert!((stroke_opacity - 0.75).abs() < f32::EPSILON);
    assert_eq!(
        document.shapes[&"shape:text".into()].properties["legacy_group_id"],
        Value::from("group:content")
    );
    let card_group = &document.shapes[&"group:card".into()];
    assert_eq!(
        card_group.child_ids,
        vec![
            "shape:stencil-card".into(),
            "shape:stencil-card-divider".into()
        ]
    );
    assert!(matches!(
        document.bindings[&"binding:arrow-start".into()].anchor,
        inkfinite_model::BindingAnchor::Edge { x: 1.0, y: 0.0 }
    ));
    assert!(matches!(
        document.bindings[&"binding:arrow-end".into()].anchor,
        inkfinite_model::BindingAnchor::Center
    ));
}

#[test]
fn imports_web_and_performance_v1_fixtures() {
    let web = include_str!("../../../fixtures/v1/web/all-features.web.json");
    let imported = import_v1_json(web, ActorId::from("actor:web")).expect("web fixture imports");
    assert_eq!(imported.document.page_ids.len(), 2);
    assert_eq!(imported.document.layers.len(), 2);
    assert_eq!(imported.document.shapes.len(), 16);

    let performance = include_str!("../../../fixtures/v1/performance/board-10000.inkfinite.json");
    let imported = import_v1_json(performance, ActorId::from("actor:performance"))
        .expect("large fixture imports");
    assert_eq!(imported.document.page_ids, vec![PageId::from("page:10000")]);
    assert_eq!(imported.document.shapes.len(), 10_000);
    let page = &imported.document.pages[&PageId::from("page:10000")];
    let layer = &imported.document.layers[&page.layer_ids[0]];
    assert_eq!(layer.shape_ids.len(), 10_000);
    assert_eq!(
        flatten_shape_order(&imported.document, &layer.shape_ids).len(),
        10_000
    );
}

#[test]
fn rejects_invalid_and_newer_inputs_before_persistence() {
    let actor = ActorId::from("actor:test");
    let invalid_inputs = [
        include_str!("../../../fixtures/v1/invalid/malformed-json.inkfinite.json"),
        include_str!("../../../fixtures/v1/invalid/missing-envelope-fields.json"),
        include_str!("../../../fixtures/v1/invalid/dangling-references.inkfinite.json"),
        include_str!("../../../fixtures/v1/invalid/duplicate-order.inkfinite.json"),
    ];
    for input in invalid_inputs {
        assert!(
            matches!(
                import_v1_json(input, actor.clone()),
                Err(FileError::Json(_) | FileError::InvalidV1(_))
            ),
            "input should be rejected"
        );
    }
    assert!(matches!(
        import_v1_json(
            r#"{"format":"inkfinite.document","format_version":3}"#,
            actor.clone()
        ),
        Err(FileError::UnsupportedFormat { version: 3, .. })
    ));

    let temporary = TestDirectory::new();
    let source = temporary.path.join("invalid.inkfinite.json");
    let destination = temporary.path.join("existing.inkfinite");
    fs::write(
        &source,
        include_str!("../../../fixtures/v1/invalid/duplicate-order.inkfinite.json"),
    )
    .expect("write source");
    fs::write(&destination, b"keep this file").expect("write destination");
    let result = import_v1_file(&source, &destination, actor);
    assert!(matches!(result, Err(FileError::InvalidV1(_))));
    assert_eq!(
        fs::read(&destination).expect("read destination"),
        b"keep this file"
    );
}

#[test]
fn canonical_sessions_lock_save_reopen_and_export_deterministically() {
    let input = include_str!("../../../fixtures/v1/desktop/all-features.inkfinite.json");
    let imported = import_v1_json(input, ActorId::from("actor:test")).expect("fixture imports");
    let expected_document = imported.document.clone();
    let temporary = TestDirectory::new();
    let canonical = temporary.path.join("board.inkfinite");
    let snapshot_json = temporary.path.join("board.inkfinite.json");
    let options = PersistenceOptions::with_recovery_directory(temporary.path.join("recovery"));

    let mut session = DocumentFile::create_with_options(
        &canonical,
        imported.document_id.clone(),
        ActorId::from("actor:test"),
        imported.document,
        options.clone(),
    )
    .expect("create canonical document");
    let first_json = session.export_json().expect("export JSON");
    assert_eq!(first_json, session.export_json().expect("repeat export"));
    assert!(first_json.contains("\"format\": \"inkfinite.document\""));
    session
        .export_json_to(&snapshot_json)
        .expect("write snapshot JSON");
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
    assert!(serde_json::from_slice::<Value>(&canonical_bytes).is_err());
    let exported: inkfinite_model::DocumentSnapshot =
        serde_json::from_str(&fs::read_to_string(&snapshot_json).expect("snapshot JSON"))
            .expect("snapshot parses");
    assert_eq!(exported.document, expected_document);

    let mut reopened =
        DocumentFile::open_with_options(&canonical, ActorId::from("actor:reopen"), options)
            .expect("reopen canonical document");
    assert_eq!(
        reopened.snapshot().expect("snapshot").document,
        expected_document
    );
    assert_eq!(
        export_snapshot_json(&reopened.snapshot().expect("snapshot")).expect("export"),
        first_json
    );
}

#[test]
fn recovery_restores_journal_after_canonical_replace_failure() {
    let temporary = TestDirectory::new();
    let canonical = temporary.path.join("board.inkfinite");
    let recovery_directory = temporary.path.join("recovery");
    let options = PersistenceOptions {
        recovery_directory: Some(recovery_directory.clone()),
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
    let recovery: Value =
        serde_json::from_slice(&fs::read(&recovery_path).expect("recovery bytes"))
            .expect("recovery JSON");
    assert!(
        recovery["snapshot"]
            .as_array()
            .is_some_and(|bytes| !bytes.is_empty())
    );
    assert_eq!(recovery["journal"].as_array().expect("journal").len(), 1);
    drop(session);

    fs::remove_dir(&canonical).expect("remove failure directory");
    fs::rename(&backup, &canonical).expect("restore old canonical");
    let mut recovered = DocumentFile::recover(&canonical, ActorId::from("actor:recovery"), options)
        .expect("recover interrupted save");
    assert_eq!(
        recovered
            .snapshot()
            .expect("recovered snapshot")
            .document
            .pages[&PageId::from("page:one")]
            .name,
        "Recovered"
    );
    let save = recovered.save().expect("save recovered document");
    assert!(!save.recovery_retained);
    assert!(!recovery_path.exists());
    drop(recovered);

    let mut reopened =
        DocumentFile::open(&canonical, ActorId::from("actor:verify")).expect("reopen recovered");
    assert_eq!(
        reopened.snapshot().expect("snapshot").document.pages[&PageId::from("page:one")].name,
        "Recovered"
    );
}

fn flatten_shape_order(document: &Document, shape_ids: &[inkfinite_model::ShapeId]) -> Vec<String> {
    let mut flattened = Vec::new();
    for shape_id in shape_ids {
        if let Some(shape) = document.shapes.get(shape_id) {
            if shape.kind.as_str() != inkfinite_model::CONTAINER_KIND {
                flattened.push(shape_id.as_str().to_owned());
            }
            flattened.extend(flatten_shape_order(document, &shape.child_ids));
        } else {
            flattened.push(shape_id.as_str().to_owned());
        }
    }
    flattened
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
            layer_id.clone(),
            LayerRecord {
                id: layer_id,
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
