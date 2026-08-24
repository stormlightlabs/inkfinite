use inkfinite_core::engine::TransactionEngine;
use inkfinite_core::proto::{Operation, ShapePatch, TransactionDraft, TransactionId};
use inkfinite_core::render::{SvgRenderOptions, render_svg};
use inkfinite_core::svg_import::import_svg;
use inkfinite_core::svg_transaction::{SvgImportTransactionOptions, build_svg_import_transaction};
use inkfinite_core::{ActorId, ChangeHash, DocumentId, Origin, Timestamp, Transform, Vec2, blank_document};

fn import_transaction(
    engine: &mut TransactionEngine, actor: &ActorId, source: &str, name: &str,
) -> inkfinite_core::svg_transaction::SvgImportTransaction {
    let snapshot = engine.snapshot().expect("snapshot should materialize");
    let page_id = snapshot.document.page_ids[0].clone();
    let layer_id = snapshot.document.pages[&page_id].layer_ids[0].clone();
    build_svg_import_transaction(
        &snapshot,
        &import_svg(source).expect("fixture should parse"),
        SvgImportTransactionOptions {
            actor_id: actor.clone(),
            origin: Origin::Human,
            page_id,
            layer_id,
            transaction_id: TransactionId(format!("transaction:import:{name}")),
            description: format!("Import {name}"),
            source_name: Some(name.into()),
            timestamp: Timestamp(1),
        },
    )
    .expect("import transaction should build")
}

#[test]
fn native_svg_survives_edit_export_save_reopen_undo_redo_and_merge() {
    let actor = ActorId::from("actor:svg-round-trip");
    let document_id = DocumentId::from("document:svg-round-trip");
    let mut engine = TransactionEngine::create(document_id.clone(), actor.clone(), blank_document(&document_id, None))
        .expect("engine should create");
    let baseline = engine.snapshot().expect("baseline should materialize");
    let mut peer = engine.clone();

    let imported = import_transaction(
        &mut engine,
        &actor,
        r#"<svg viewBox="0 0 80 60"><g id="nested" transform="translate(4 5) rotate(10)"><path id="ring" fill-rule="evenodd" d="M0 0h40v40H0z M10 10h20v20H10z"/></g></svg>"#,
        "native.svg",
    );
    let child_id = imported.shape_ids.last().expect("path child should exist").clone();
    engine.commit(imported.transaction).expect("import should commit");

    let snapshot = engine.snapshot().expect("imported snapshot should materialize");
    let first_svg = render_svg(&snapshot, &SvgRenderOptions::default())
        .expect("import should render")
        .svg;
    let second_svg = render_svg(&snapshot, &SvgRenderOptions::default())
        .expect("import should render again")
        .svg;
    assert_eq!(first_svg, second_svg);
    assert!(first_svg.contains("<path"));
    assert!(first_svg.contains("fill-rule=\"evenodd\""));
    assert!(!first_svg.contains("data:image/svg+xml"));

    let child = snapshot.document.shapes[&child_id].clone();
    engine
        .commit(TransactionDraft {
            id: TransactionId("transaction:edit-imported-child".into()),
            actor_id: actor.clone(),
            origin: Origin::Human,
            base_heads: snapshot.heads,
            description: "Move imported child".into(),
            operations: vec![Operation::PatchShape {
                shape_id: child_id.clone(),
                patch: ShapePatch {
                    transform: Some(Transform { translation: Vec2 { x: 12.0, y: 18.0 }, ..child.transform }),
                    ..ShapePatch::default()
                },
                expected_version: Some(child.version),
            }],
            timestamp: Timestamp(2),
        })
        .expect("imported child should be independently editable");

    engine.undo(&actor).expect("child edit should undo");
    engine.redo(&actor).expect("child edit should redo");
    let edited = engine.snapshot().expect("edited snapshot should materialize");
    assert_eq!(
        edited.document.shapes[&child_id].transform.translation,
        Vec2 { x: 12.0, y: 18.0 }
    );

    let bytes = engine.save().expect("document should save");
    let mut reopened =
        TransactionEngine::load(&bytes, ActorId::from("actor:reopened")).expect("saved document should reopen");
    assert_eq!(
        reopened.snapshot().expect("reopened snapshot").document,
        edited.document
    );

    let changes = engine.changes_since(&baseline.heads).expect("changes should encode");
    peer.merge_changes(&changes).expect("peer should merge import and edit");
    assert_eq!(peer.snapshot().expect("merged snapshot").document, edited.document);

    // The explicit type keeps this test honest if the public head representation changes.
    let _: &[ChangeHash] = &baseline.heads;
}

#[test]
fn unsupported_visuals_use_a_deterministic_sanitized_static_fallback() {
    let source = include_str!("../../../fixtures/svg-import/unsupported/feature-matrix.svg");
    let first = import_svg(source).expect("unsupported fixture should import");
    let second = import_svg(source).expect("unsupported fixture should import deterministically");
    assert_eq!(first, second);
    assert_eq!(first.root.children.len(), 1);

    let fallback = first.assets.last().expect("fallback asset should exist");
    assert_eq!(fallback.media_type, "image/svg+xml");
    let sanitized = std::str::from_utf8(&fallback.bytes).expect("fallback should remain UTF-8 SVG");
    assert!(sanitized.contains("<linearGradient"));
    assert!(sanitized.contains("<filter"));
    assert!(!sanitized.contains("<script"));
    assert!(!sanitized.contains("<animate"));
    assert!(!sanitized.contains("<foreignObject"));
    assert!(!sanitized.contains("onload"));
    assert!(!sanitized.contains("onclick"));
    assert!(!sanitized.contains("https://example.com"));

    let actor = ActorId::from("actor:fallback");
    let document_id = DocumentId::from("document:fallback");
    let mut engine = TransactionEngine::create(document_id.clone(), actor.clone(), blank_document(&document_id, None))
        .expect("engine should create");
    let transaction = import_transaction(&mut engine, &actor, source, "fallback.svg");
    engine.commit(transaction.transaction).expect("fallback should commit");
    let snapshot = engine.snapshot().expect("fallback snapshot should materialize");
    let first_render = render_svg(&snapshot, &SvgRenderOptions::default())
        .expect("fallback should render")
        .svg;
    let second_render = render_svg(&snapshot, &SvgRenderOptions::default())
        .expect("fallback should render again")
        .svg;
    assert_eq!(first_render, second_render);
    assert!(first_render.contains("data:image/svg+xml;base64,"));
}
